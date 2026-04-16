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
  const blob = new Blob([memo.memo_markdown], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, safeFilename(filename));
}

// ---------------------------------------------------------------------------
// Docx export
// ---------------------------------------------------------------------------

/** Convert a single markdown line to a docx Paragraph. */
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

  // Strip [C-xxx] citation markers
  const cleaned = line.replace(/\[C-\d{3,}\]/g, '').trim();

  if (cleaned.length === 0) {
    return new Paragraph({ children: [] });
  }

  // Inline bold (**text**)
  const runs: TextRun[] = [];
  const segments = cleaned.split(/(\*\*[^*]+\*\*)/g);
  for (const seg of segments) {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      runs.push(new TextRun({ text: seg.slice(2, -2), bold: true }));
    } else if (seg.length > 0) {
      runs.push(new TextRun(seg));
    }
  }

  const opts: IParagraphOptions = { children: runs };
  return new Paragraph(opts);
}

/**
 * Download the memo as a .docx file.
 */
export async function exportAsDocx(memo: MemoOutput, filename = 'policy-memo.docx'): Promise<void> {
  const lines = memo.memo_markdown.split('\n');
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
  needs_revision_count: number;
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
    needs_revision_count: results.filter((r) => r.verdict === 'needs_revision').length,
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

  // Memo markdown
  zip.file('memo.md', memo.memo_markdown);

  // Notes log
  zip.file('notes-log.json', JSON.stringify(memo.notes_log, null, 2));

  // HERALD report (if results provided)
  if (results !== undefined && results.length > 0) {
    const report = buildHeraldReport(results);
    zip.file('HERALD-report.json', JSON.stringify(report, null, 2));
  }

  // Docx version of the memo
  const docxLines = memo.memo_markdown.split('\n').map(markdownLineToParagraph);
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
