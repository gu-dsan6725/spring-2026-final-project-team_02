'use client';

import { useMemo } from 'react';
import { CLAIM_TYPE_CONFIG } from '@/types/claims';
import type { ClaimType, NotesLogEntry } from '@/types/claims';
import type { MemoSection } from '@/types/memo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoViewerProps {
  title: string;
  sections: MemoSection[];
  notesLog: NotesLogEntry[];
  selectedClaimId: string | null;
  onClaimClick: (claimId: string) => void;
}

// ---------------------------------------------------------------------------
// Inline content parser
//
// Parses a text string containing [C-XXX] markers and **bold** syntax.
// Text that immediately precedes a [C-XXX] marker gets a colored underline
// and superscript label. This matches the citation style: "claim text [C-001]."
// ---------------------------------------------------------------------------

const BOLD_RE = /(\*\*[^*]+\*\*)/g;
const CLAIM_MARKER_RE = /(\[C-\d{3,}\])/g;

function renderBoldSegment(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(BOLD_RE);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b${i.toString()}`}>{part.slice(2, -2)}</strong>;
    }
    return part.length > 0 ? part : null;
  });
}

function parseInlineContent(
  text: string,
  claimIndex: Map<string, ClaimType>,
  selectedClaimId: string | null,
  onClaimClick: (claimId: string) => void,
  keyPrefix: string,
): React.ReactNode[] {
  const parts = text.split(CLAIM_MARKER_RE);
  // parts alternates: [text, marker, text, marker, …]
  const nodes: React.ReactNode[] = [];

  let i = 0;
  while (i < parts.length) {
    const part = parts[i] ?? '';
    const isMarker = /^\[C-\d{3,}\]$/.test(part);

    if (isMarker) {
      // Orphaned marker at the start — render as plain text
      nodes.push(
        <span
          key={`${keyPrefix}-m${i.toString()}`}
          style={{ color: 'var(--color-muted)', fontSize: '0.75em' }}
        >
          {part}
        </span>,
      );
      i++;
      continue;
    }

    // Check whether the NEXT segment is a claim marker
    const nextPart = parts[i + 1] ?? '';
    const nextIsMarker = nextPart.length > 0 && /^\[C-\d{3,}\]$/.test(nextPart);

    if (nextIsMarker && part.length > 0) {
      const claimId = nextPart.slice(1, -1); // strip [ ]
      const claimType = claimIndex.get(claimId);
      const isSelected = selectedClaimId === claimId;

      if (claimType !== undefined) {
        const cfg = CLAIM_TYPE_CONFIG[claimType];
        nodes.push(
          <span
            key={`${keyPrefix}-claim-${i.toString()}`}
            style={{
              borderBottom: `2px solid ${cfg.color}`,
              paddingBottom: '1px',
              cursor: 'pointer',
              backgroundColor: isSelected ? `${cfg.color}15` : undefined,
              transition: 'background-color 0.2s',
            }}
            onClick={() => {
              onClaimClick(claimId);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onClaimClick(claimId);
            }}
            title={`${cfg.label} — Click to view sources`}
            aria-label={`${claimId}: ${cfg.label}. Click to view in Notes Log.`}
          >
            {renderBoldSegment(part, `${keyPrefix}-bold-${i.toString()}`)}
            <sup
              style={{
                color: cfg.color,
                fontSize: '0.68em',
                fontWeight: 700,
                marginLeft: '2px',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {claimId}
            </sup>
          </span>,
        );
      } else {
        // Claim not in notes log — render plain with greyed marker
        nodes.push(...renderBoldSegment(part, `${keyPrefix}-plain-${i.toString()}`));
        nodes.push(
          <sup
            key={`${keyPrefix}-unknown-${i.toString()}`}
            style={{ color: 'var(--color-muted)', fontSize: '0.7em', marginLeft: '2px' }}
          >
            {nextPart}
          </sup>,
        );
      }
      // Consume both text and marker
      i += 2;
    } else {
      // Plain text segment
      if (part.length > 0) {
        nodes.push(...renderBoldSegment(part, `${keyPrefix}-plain-${i.toString()}`));
      }
      i++;
    }
  }

  return nodes.filter((n) => n !== null);
}

// ---------------------------------------------------------------------------
// Markdown line renderer
//
// Handles: ## heading, # heading, ---, 1. list items, blank lines, paragraphs
// ---------------------------------------------------------------------------

interface RenderedBlock {
  type: 'h1' | 'h2' | 'hr' | 'li' | 'p';
  content: string;
  key: string;
}

function parseMarkdownBlocks(content: string): RenderedBlock[] {
  const lines = content.split('\n');
  const blocks: RenderedBlock[] = [];
  let idx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      idx++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', content: trimmed.slice(3), key: `blk-${idx.toString()}` });
    } else if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', content: trimmed.slice(2), key: `blk-${idx.toString()}` });
    } else if (trimmed === '---') {
      blocks.push({ type: 'hr', content: '', key: `blk-${idx.toString()}` });
    } else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({
        type: 'li',
        content: trimmed.replace(/^\d+\.\s/, ''),
        key: `blk-${idx.toString()}`,
      });
    } else {
      blocks.push({ type: 'p', content: trimmed, key: `blk-${idx.toString()}` });
    }
    idx++;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MemoViewer({
  title,
  sections,
  notesLog,
  selectedClaimId,
  onClaimClick,
}: MemoViewerProps) {
  const claimIndex = useMemo(
    () => new Map(notesLog.map((e) => [e.claim_id, e.claim_type])),
    [notesLog],
  );

  return (
    <article className="max-w-2xl mx-auto" aria-label="Policy memo">
      {/* Document title */}
      <h1
        className="text-3xl font-bold mb-2 leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
      >
        {title}
      </h1>
      <hr
        className="mb-8 mt-4"
        style={{
          borderColor: 'var(--color-gold)',
          borderTopWidth: '2px',
          width: '4rem',
          marginLeft: 0,
        }}
      />

      {/* Claim type legend */}
      <div
        className="flex flex-wrap gap-3 mb-8 pb-6"
        style={{ borderBottom: '1px solid var(--color-paper-dark)' }}
      >
        <span
          className="text-xs font-semibold tracking-widest uppercase self-center"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          Claim types:
        </span>
        {Object.entries(CLAIM_TYPE_CONFIG).map(([type, cfg]) => (
          <span
            key={type}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
            style={{
              color: cfg.color,
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              borderBottom: `2px solid ${cfg.color}`,
            }}
          >
            {cfg.icon} {cfg.label}
          </span>
        ))}
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const blocks = parseMarkdownBlocks(section.content);
        const listItems = blocks.filter((b) => b.type === 'li');
        const nonListBlocks = blocks.filter((b) => b.type !== 'li');

        return (
          <section key={section.title} className="mb-8">
            <h2
              className="text-xl font-bold mb-4"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
            >
              {section.title}
            </h2>

            {nonListBlocks.map((block) => {
              if (block.type === 'hr') {
                return (
                  <hr
                    key={block.key}
                    className="my-6"
                    style={{ borderColor: 'var(--color-paper-dark)' }}
                  />
                );
              }
              if (block.type === 'h1') {
                return (
                  <h3
                    key={block.key}
                    className="text-lg font-bold mt-6 mb-2"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}
                  >
                    {parseInlineContent(
                      block.content,
                      claimIndex,
                      selectedClaimId,
                      onClaimClick,
                      block.key,
                    )}
                  </h3>
                );
              }
              if (block.type === 'h2') {
                return (
                  <h4
                    key={block.key}
                    className="text-base font-bold mt-4 mb-1"
                    style={{ fontFamily: 'var(--font-sans)', color: 'var(--color-navy)' }}
                  >
                    {parseInlineContent(
                      block.content,
                      claimIndex,
                      selectedClaimId,
                      onClaimClick,
                      block.key,
                    )}
                  </h4>
                );
              }
              // paragraph
              return (
                <p
                  key={block.key}
                  className="mb-4"
                  style={{
                    fontFamily: 'var(--font-body)',
                    color: 'var(--color-navy)',
                    lineHeight: 1.8,
                    fontSize: '1rem',
                  }}
                >
                  {parseInlineContent(
                    block.content,
                    claimIndex,
                    selectedClaimId,
                    onClaimClick,
                    block.key,
                  )}
                </p>
              );
            })}

            {listItems.length > 0 && (
              <ol
                className="list-decimal list-outside pl-6 space-y-2 mb-4"
                style={{
                  fontFamily: 'var(--font-body)',
                  color: 'var(--color-navy)',
                  lineHeight: 1.8,
                }}
              >
                {listItems.map((item) => (
                  <li key={item.key}>
                    {parseInlineContent(
                      item.content,
                      claimIndex,
                      selectedClaimId,
                      onClaimClick,
                      item.key,
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </article>
  );
}
