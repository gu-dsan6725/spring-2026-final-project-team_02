/**
 * Claim extraction utilities — post-processing helpers for notes log validation,
 * memo completeness checking, heuristic claim classification, and HERALD routing.
 *
 * The agent classifies claims during generation; these utilities provide:
 *   - Structural validation of the notes log it produces
 *   - Completeness cross-referencing between memo prose and notes log
 *   - Fallback heuristic classifier for post-hoc reclassification
 *   - HERALD tier routing derived from the claim taxonomy
 */

import {
  ClaimType,
  DerivationMethod,
  CLAIM_TYPE_CONFIG,
  type NotesLogEntry,
  type Source,
} from '../types/claims';

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface ValidationError {
  claim_id: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface CompletenessReport {
  is_complete: boolean;
  /** Claim IDs referenced in the memo prose but absent from the notes log. */
  orphaned_claim_ids: string[];
  /** Claim IDs present in the notes log but never referenced in the memo prose. */
  unused_claim_ids: string[];
}

export interface HeraldRouting {
  startTier: 1 | 2;
  nliThreshold: number | null;
}

// ---------------------------------------------------------------------------
// 1. validateNotesLog
// ---------------------------------------------------------------------------

const VALID_CLAIM_TYPES = new Set<string>(Object.values(ClaimType));
const VALID_DERIVATION_METHODS = new Set<string>(Object.values(DerivationMethod));

/**
 * Validates structural integrity of a notes log produced by the agent.
 * Returns lists of errors (blocking) and warnings (advisory).
 */
export function validateNotesLog(log: NotesLogEntry[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const entry of log) {
    const id = entry.claim_id;

    if (!VALID_CLAIM_TYPES.has(entry.claim_type)) {
      errors.push({
        claim_id: id,
        field: 'claim_type',
        message: `Invalid claim_type "${entry.claim_type}". Must be one of: ${[...VALID_CLAIM_TYPES].join(', ')}.`,
      });
    }

    if (!VALID_DERIVATION_METHODS.has(entry.derivation)) {
      errors.push({
        claim_id: id,
        field: 'derivation',
        message: `Invalid derivation "${entry.derivation}". Must be one of: ${[...VALID_DERIVATION_METHODS].join(', ')}.`,
      });
    }

    if (entry.sources.length === 0) {
      errors.push({
        claim_id: id,
        field: 'sources',
        message: 'sources array is empty. Every claim must have at least one source.',
      });
    }

    for (const source of entry.sources) {
      if (source.relevant_chunk.trim().length === 0) {
        errors.push({
          claim_id: id,
          field: `sources[${source.source_id}].relevant_chunk`,
          message: `Source "${source.source_id}" has an empty relevant_chunk. Use "Source unavailable — retrieval failed." if the source could not be retrieved.`,
        });
      }
    }

    if (entry.claim_text.trim().length === 0) {
      errors.push({ claim_id: id, field: 'claim_text', message: 'claim_text is empty.' });
    }

    if (entry.reasoning.trim().length === 0) {
      warnings.push({
        claim_id: id,
        field: 'reasoning',
        message: 'reasoning is empty. Provide a brief explanation of how the claim was derived.',
      });
    }

    if (entry.derivation === DerivationMethod.AgentInference) {
      warnings.push({
        claim_id: id,
        field: 'derivation',
        message:
          'agent_inference derivation detected — this claim will receive elevated HERALD scrutiny.',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// 2. checkMemoCompleteness
// ---------------------------------------------------------------------------

const CLAIM_MARKER_RE = /\[C-\d{3,}\]/g;

/**
 * Cross-references [C-XXX] markers in the memo prose against the notes log.
 * Reports orphaned markers (in memo but not in log) and unused entries (in log
 * but never referenced in the memo).
 */
export function checkMemoCompleteness(memo: string, log: NotesLogEntry[]): CompletenessReport {
  const referencedIds = new Set(
    [...memo.matchAll(CLAIM_MARKER_RE)].map((m) => m[0].slice(1, -1)), // strip [ ]
  );

  const logIds = new Set(log.map((e) => e.claim_id));

  const orphaned_claim_ids = [...referencedIds].filter((id) => !logIds.has(id)).sort();
  const unused_claim_ids = [...logIds].filter((id) => !referencedIds.has(id)).sort();

  return {
    is_complete: orphaned_claim_ids.length === 0 && unused_claim_ids.length === 0,
    orphaned_claim_ids,
    unused_claim_ids,
  };
}

// ---------------------------------------------------------------------------
// 3. classifyClaim — heuristic fallback classifier
// ---------------------------------------------------------------------------

/** Tokenise text into lowercase word tokens, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0);
}

/**
 * Fraction of claim tokens that appear in the source chunk (recall-style overlap).
 * Returns a value in [0, 1].
 */
function tokenOverlap(claimText: string, chunk: string): number {
  const claimTokens = tokenize(claimText);
  if (claimTokens.length === 0) return 0;
  const chunkTokenSet = new Set(tokenize(chunk));
  const matches = claimTokens.filter((t) => chunkTokenSet.has(t)).length;
  return matches / claimTokens.length;
}

/** True if any single source chunk is a close match for the claim text. */
function hasCloseSourceMatch(claimText: string, sources: Source[], threshold = 0.5): boolean {
  return sources.some((s) => tokenOverlap(claimText, s.relevant_chunk) >= threshold);
}

const STATISTICAL_RE =
  /\d+([.,]\d+)?(%|percent|per cent|\$|usd|eur|gbp|kg|km|m²|ha|per\s+\d+|per cent|\brate\b|\bratio\b|\bindex\b)/i;
const STATISTICAL_WORD_RE =
  /\b(percent|rate|ratio|per\s+100|per\s+1,?000|million|billion|trillion)\b/i;

const CAUSAL_RE =
  /\b(caused?|contributes? to|contributed to|leads? to|led to|results? in|resulted in|driven by|due to|because of|stems? from|attributed to)\b/i;

const COMPARATIVE_RE =
  /\b(more than|less than|higher than|lower than|greater than|stronger|weaker|faster|slower|outperform(ed)?|underperform(ed)?|compared to|relative to|exceeded?)\b/i;

const PREDICTIVE_RE =
  /\b(projected?|forecast(ed)?|expected? to|will\b|anticipated?|is likely to|are likely to|by 20\d\d|set to\b)\b/i;

const NORMATIVE_RE =
  /\b(should\b|ought to|best practice|recommended?|considered? (to be|best|optimal|effective)|must\b|need(s)? to\b)\b/i;

const AGENT_INFERENCE_RE = /\b(infer(red|s)?|suggest(s|ed)?|combination of|combin(ed|ing))\b/i;

/**
 * Heuristic fallback classifier. The agent classifies claims at write-time;
 * use this for post-hoc reclassification or validation of agent output.
 *
 * @param claimText  The claim text to classify.
 * @param sources    Sources attached to this claim (used for derivation method).
 * @param reasoning  Optional reasoning text from the notes log entry (used to
 *                   detect agent_inference derivation).
 */
export function classifyClaim(
  claimText: string,
  sources: Source[],
  reasoning = '',
): { type: ClaimType; derivation: DerivationMethod } {
  // --- Claim type ---
  let type: ClaimType;

  // Specific semantic types take priority over statistical — a claim containing
  // "contributed to a 15% increase" is causal, not statistical.
  if (CAUSAL_RE.test(claimText)) {
    type = ClaimType.Causal;
  } else if (COMPARATIVE_RE.test(claimText)) {
    type = ClaimType.Comparative;
  } else if (PREDICTIVE_RE.test(claimText)) {
    type = ClaimType.Predictive;
  } else if (NORMATIVE_RE.test(claimText)) {
    type = ClaimType.Normative;
  } else if (STATISTICAL_RE.test(claimText) || STATISTICAL_WORD_RE.test(claimText)) {
    type = ClaimType.Statistical;
  } else if (sources.length > 1 && !hasCloseSourceMatch(claimText, sources)) {
    type = ClaimType.Synthesis;
  } else {
    // Default: statistical is the most common claim type in policy memos.
    type = ClaimType.Statistical;
  }

  // --- Derivation method ---
  let derivation: DerivationMethod;

  if (AGENT_INFERENCE_RE.test(reasoning)) {
    derivation = DerivationMethod.AgentInference;
  } else if (sources.length >= 2) {
    derivation = DerivationMethod.CrossSource;
  } else if (sources.length === 1) {
    const overlap = tokenOverlap(claimText, sources[0].relevant_chunk);
    derivation = overlap >= 0.7 ? DerivationMethod.DirectExtraction : DerivationMethod.Paraphrase;
  } else {
    // No sources — must be agent inference.
    derivation = DerivationMethod.AgentInference;
  }

  return { type, derivation };
}

// ---------------------------------------------------------------------------
// 4. getHeraldRoutingForClaim
// ---------------------------------------------------------------------------

/**
 * Returns the HERALD starting tier and NLI escalation threshold for a claim,
 * implementing the routing table from CLAUDE.md exactly.
 *
 * | Claim Type  | Start Tier | NLI Threshold |
 * |-------------|------------|---------------|
 * | statistical | 1          | 0.9           |
 * | comparative | 1          | 0.9           |
 * | causal      | 1          | 0.85          |
 * | predictive  | 2          | null          |
 * | normative   | 2          | null          |
 * | synthesis   | 2          | null          |
 */
export function getHeraldRoutingForClaim(entry: NotesLogEntry): HeraldRouting {
  const config = CLAIM_TYPE_CONFIG[entry.claim_type];
  return {
    startTier: config.skipNLI ? 2 : 1,
    nliThreshold: config.nliEscalationThreshold,
  };
}
