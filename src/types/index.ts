// src/types/index.ts

export interface LabelDefinition {
  id: number
  name: string
  description: string | null
  created_at: string
  count: number
}

export interface LabelExample {
  chatlog_id: number
  message_index: number
  message_text: string
  label_id: number
  applied_by: string
}

export interface ConciseResponse {
  concise_text: string
}

export interface SplitAutoLabelRequest {
  label_id: number
  name_a: string
  name_b: string
  assignments: Record<string, string> // "chatlog_id:message_index" -> "name_a" | "name_b"
}

export interface ApplyBatchRequest {
  assignments: Record<string, number> // "cid:midx" -> label_id
  delete_original_label_id?: number
}

export interface QueueItem {
  chatlog_id: number
  message_index: number
  message_text: string
  context_before: string | null
  context_after: string | null
}

export interface LabelingSession {
  id: number
  started_at: string
  last_active: string
  labeled_count: number
}

export interface SuggestResponse {
  label_name: string
  evidence: string
  rationale: string
}

export interface AnalysisSummary {
  label_counts: Record<string, number>
  notebook_breakdown: Record<string, Record<string, number>>
  coverage: {
    human_labeled: number
    ai_labeled: number
    unlabeled: number
    total: number
  }
}

export interface QueueStats {
  total_messages: number
  labeled_count: number
  skipped_count: number
}

export interface ApplyLabelRequest {
  chatlog_id: number
  message_index: number
  label_id: number
}

export interface CreateLabelRequest {
  name: string
  description?: string
}

export interface UpdateLabelRequest {
  name?: string
  description?: string
}
