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
  max_tool_calls?: number;
  max_research_tokens?: number;
}

export interface MemoSection {
  title: string;
  content: string;
  claim_ids: string[];
}

export interface MemoOutput {
  memo_id: string;
  title: string;
  sections: MemoSection[];
  notes_log: NotesLogEntry[];
  total_tool_calls: number;
  total_research_tokens: number;
  model_used: string;
}
