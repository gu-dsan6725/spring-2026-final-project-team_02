/**
 * Policy memo types — mirrors Python Pydantic models in
 * backend/src/policy_memo_agent/models/memo.py
 */

import type { NotesLogEntry } from './claims';

export interface MemoInput {
  topic: string;
  background?: string;
  known_sources?: string[];
  template?: string;
  uploaded_files?: File[];
  max_tool_calls?: number;
  max_research_tokens?: number;
}

export interface MemoSection {
  title: string;
  content: string;
  claim_ids: string[];
}

export interface MemoOutput {
  memo_markdown: string;
  notes_log: NotesLogEntry[];
  metadata: {
    generation_timestamp: string;
    token_usage: number;
    tool_calls_count: number;
  };
}
