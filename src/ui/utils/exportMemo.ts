/**
 * exportMemo — client-side export utilities for policy memos.
 *
 * Exports the memo and HERALD evaluation data in four formats:
 *   - Markdown (.md)
 *   - Word document (.docx) via the `docx` package
 *   - Notes log JSON (.json)
 *   - Full ZIP bundle containing all of the above
 *
 * All functions are browser-safe (no Node.js APIs).
 * Import dynamically on the client to avoid SSR bundling issues with JSZip/docx.
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, type IParagraphOptions } from 'docx';
import JSZip from 'jszip';

import type { NotesLogEntry } from '@/types/claims';
import type { HeraldResult } from '@/types/herald';
import type { MemoOutput } from '@/types/memo';

// ---------------------------------------------------------------------------
// Footnote builder — export-only, keeps memo_markdown clean for the UI
// ---------------------------------------------------------------------------

/**
 * Replaces inline [C-XXX] claim markers with numbered footnote references
 * ([^1], [^2], …) and appends a Markdown References section.
 *
 * Called only at export time so memo_markdown stays unmodified for the
 * MemoViewer's colored-underline claim highlighting.
 */
function addFootnotes(memoMarkdown: string, notesLog: NotesLogEntry[]): string {
  const claimSources = new Map<string, NotesLogEntry['sources']>();
  for (const entry of notesLog) {
    claimSources.set(entry.claim_id, entry.sources);
  }

  const urlToNumber = new Map<string, number>();
  const orderedSources: Array<{ number: number; title: string; url: string }> = [];
  let nextNumber = 1;

  const withRefs = memoMarkdown.replace(/\[C-\d{3,}\]/g, (marker) => {
    const claimId = marker.slice(1, -1);
    const sources = claimSources.get(claimId) ?? [];
    if (sources.length === 0) return marker;

    const refs: string[] = [];
    for (const source of sources) {
      const url = source.source_url;
      if (!urlToNumber.has(url)) {
        urlToNumber.set(url, nextNumber);
        orderedSources.push({ number: nextNumber, title: source.source_title, url });
        nextNumber++;
      }
      refs.push(`[^${String(urlToNumber.get(url) ?? nextNumber - 1)}]`);
    }
    return [...new Set(refs)].join('');
  });

  if (orderedSources.length === 0) return memoMarkdown;

  const footnoteDefinitions = orderedSources
    .map(({ number, title, url }) => `[^${String(number)}]: ${title} — ${url}`)
    .join('\n');

  const referencesList = orderedSources
    .map(({ number, title, url }) => `${String(number)}. ${title}  \n   ${url}`)
    .join('\n\n');

  return `${withRefs}\n\n---\n\n## References\n\n${referencesList}\n\n${footnoteDefinitions}`;
}

// ---------------------------------------------------------------------------
// Shared download helper
// ---------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to allow the download to start
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 500);
}

function safeFilename(base: string): string {
  // Replace characters invalid in filenames with hyphens
  return base.replace(/[^a-z0-9_\-. ]/gi, '-').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

/**
 * Download the memo as a Markdown file.
 */
export function exportAsMarkdown(memo: MemoOutput, filename = 'policy-memo.md'): void {
  const markdown = addFootnotes(memo.memo_markdown, memo.notes_log);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, safeFilename(filename));
}

// ---------------------------------------------------------------------------
// Docx export
// ---------------------------------------------------------------------------

/**
 * Convert a single markdown line to a docx Paragraph.
 *
 * Handles:
 *  - Headings (# / ## / ###)
 *  - Horizontal rules (---) → empty paragraph
 *  - Footnote definitions ([^N]: ...) → italic reference paragraph
 *  - Inline footnote refs ([^N]) → superscript numbers
 *  - Inline bold (**text**)
 *  - Legacy raw [C-xxx] markers (stripped for safety)
 */
function markdownLineToParagraph(line: string): Paragraph {
  // Detect heading levels
  const h1 = /^# (.+)$/.exec(line);
  if (h1 !== null) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(h1[1])],
    });
  }
  const h2 = /^## (.+)$/.exec(line);
  if (h2 !== null) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(h2[1])],
    });
  }
  const h3 = /^### (.+)$/.exec(line);
  if (h3 !== null) {
    return new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun(h3[1])],
    });
  }

  // Horizontal rule
  if (/^---+$/.test(line.trim())) {
    return new Paragraph({ children: [] });
  }

  // Footnote definition line: [^N]: Title — URL
  const fnDef = /^\[\^(\d+)\]:\s*(.+)$/.exec(line);
  if (fnDef !== null) {
    return new Paragraph({
      children: [
        new TextRun({ text: `[${fnDef[1]}] `, superScript: true }),
        new TextRun({ text: fnDef[2], italics: true, size: 18 }),
      ],
    });
  }

  // Strip legacy [C-xxx] markers (shouldn't appear after footnote conversion, but just in case)
  const withoutLegacy = line.replace(/\[C-\d{3,}\]/g, '');

  if (withoutLegacy.trim().length === 0) {
    return new Paragraph({ children: [] });
  }

  // Tokenise: split on [^N] refs and **bold** spans
  const runs: TextRun[] = [];
  const tokenRegex = /(\[\^(\d+)\]|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;

  for (const match of withoutLegacy.matchAll(tokenRegex)) {
    // Plain text before this token
    const before = withoutLegacy.slice(lastIndex, match.index);
    if (before.length > 0) runs.push(new TextRun(before));

    if (match[0].startsWith('[^')) {
      // Footnote ref → superscript number
      runs.push(new TextRun({ text: match[2], superScript: true }));
    } else {
      // Bold span
      runs.push(new TextRun({ text: match[0].slice(2, -2), bold: true }));
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  const tail = withoutLegacy.slice(lastIndex);
  if (tail.length > 0) runs.push(new TextRun(tail));

  if (runs.length === 0) return new Paragraph({ children: [] });

  const opts: IParagraphOptions = { children: runs };
  return new Paragraph(opts);
}

/**
 * Download the memo as a .docx file.
 */
export async function exportAsDocx(memo: MemoOutput, filename = 'policy-memo.docx'): Promise<void> {
  const lines = addFootnotes(memo.memo_markdown, memo.notes_log).split('\n');
  const paragraphs = lines.map(markdownLineToParagraph);

  const doc = new Document({
    sections: [
      {
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBlob(doc);
  triggerDownload(buffer, safeFilename(filename));
}

// ---------------------------------------------------------------------------
// Notes log JSON export
// ---------------------------------------------------------------------------

/**
 * Download the notes log as a JSON file.
 */
export function exportNotesLog(notes: NotesLogEntry[], filename = 'notes-log.json'): void {
  const json = JSON.stringify(notes, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, safeFilename(filename));
}

// ---------------------------------------------------------------------------
// HERALD report JSON export
// ---------------------------------------------------------------------------

export interface HeraldReportExport {
  generated_at: string;
  total_claims: number;
  valid_count: number;
  invalid_count: number;
  invalid_with_revision_count: number;
  uncertain_count: number;
  results: HeraldResult[];
}

/**
 * Build a HERALD report object from results.
 */
export function buildHeraldReport(results: HeraldResult[]): HeraldReportExport {
  return {
    generated_at: new Date().toISOString(),
    total_claims: results.length,
    valid_count: results.filter((r) => r.verdict === 'valid').length,
    invalid_count: results.filter((r) => r.verdict === 'invalid').length,
    invalid_with_revision_count: results.filter(
      (r) => r.verdict === 'invalid' && r.suggested_revision !== null,
    ).length,
    uncertain_count: results.filter((r) => r.verdict === 'uncertain').length,
    results,
  };
}

/**
 * Download the HERALD evaluation report as a JSON file.
 */
export function exportHeraldReport(results: HeraldResult[], filename = 'HERALD-report.json'): void {
  const report = buildHeraldReport(results);
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  triggerDownload(blob, safeFilename(filename));
}

// ---------------------------------------------------------------------------
// ZIP bundle export
// ---------------------------------------------------------------------------

export interface ZipExportOptions {
  memo: MemoOutput;
  heraldResults?: HeraldResult[];
  /** Base name for the zip file (without extension). */
  baseName?: string;
}

/**
 * Bundle memo.md, notes-log.json, and HERALD-report.json into a single .zip
 * and trigger a download.
 */
export async function exportAsZip({
  memo,
  heraldResults: results,
  baseName = 'policy-memo-export',
}: ZipExportOptions): Promise<void> {
  const zip = new JSZip();

  // Convert [C-XXX] markers to numbered footnotes for all exported formats
  const markdownWithFootnotes = addFootnotes(memo.memo_markdown, memo.notes_log);

  // Memo markdown
  zip.file('memo.md', markdownWithFootnotes);

  // Notes log
  zip.file('notes-log.json', JSON.stringify(memo.notes_log, null, 2));

  // HERALD report (if results provided)
  if (results !== undefined && results.length > 0) {
    const report = buildHeraldReport(results);
    zip.file('HERALD-report.json', JSON.stringify(report, null, 2));
  }

  // Docx version of the memo
  const docxLines = markdownWithFootnotes.split('\n').map(markdownLineToParagraph);
  const doc = new Document({ sections: [{ children: docxLines }] });
  const docxBlob = await Packer.toBlob(doc);
  const docxBuffer = await docxBlob.arrayBuffer();
  zip.file('memo.docx', docxBuffer);

  // README
  const readmeLines = [
    '# Policy Memo Export',
    '',
    `Exported: ${new Date().toISOString()}`,
    '',
    '## Files',
    '',
    '- `memo.md` — Memo in Markdown format',
    '- `memo.docx` — Memo in Word format',
    '- `notes-log.json` — Structured claim provenance (Notes Log)',
    ...(results !== undefined && results.length > 0
      ? ['- `HERALD-report.json` — HERALD evaluation results for all claims']
      : []),
  ];
  zip.file('README.md', readmeLines.join('\n'));

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(zipBlob, `${safeFilename(baseName)}.zip`);
}
