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

/** Distinct messages (chatlog + index) that have this label from human only, AI only, or both. */
export interface LabelSourceMixRow {
  human_only: number
  ai_only: number
  both: number
}

export type LabelMessageSource = 'human_only' | 'ai_only' | 'both'

export interface LabelMessagePreviewItem {
  chatlog_id: number
  message_index: number
  preview: string
}

export interface LabelMessagesResponse {
  label_name: string
  source: LabelMessageSource
  total_count: number
  returned_count: number
  truncated: boolean
  messages: LabelMessagePreviewItem[]
}

export interface NotebookQuestionDistributionRow {
  chatlog_id: number
  message_index: number
  question_preview: string
  assistant_preview: string
  label_counts: Record<string, number>
  total_labels: number
}

export interface NotebookQuestionsResponse {
  notebook: string
  question_count: number
  questions: NotebookQuestionDistributionRow[]
}

export interface AnalysisSummary {
  label_counts: Record<string, number>
  human_label_counts: Record<string, number>
  ai_label_counts: Record<string, number>
  notebook_breakdown: Record<string, Record<string, number>>
  coverage: {
    human_labeled: number
    ai_labeled: number
    unlabeled: number
    total: number
  }
  position_distribution: Record<string, { early: number; mid: number; late: number }>
  position_distribution_human: Record<string, { early: number; mid: number; late: number }>
  position_distribution_ai: Record<string, { early: number; mid: number; late: number }>
  label_source_mix: Record<string, LabelSourceMixRow>
  ai_confidence: {
    overall: {
      avg_confidence: number | null
      count_with_confidence: number
    }
    by_label: Record<string, { avg_confidence: number | null; count_with_confidence: number }>
  }
}

/** Weekday 0 = Sunday … 6 = Saturday in `display_timezone` (same convention as PostgreSQL DOW). */
export interface TemporalAnalysis {
  tutor_usage: {
    by_hour: Array<{ hour: number; count: number }>
    by_weekday: Array<{ weekday: number; count: number }>
    /** One row per calendar day from `calendar_from` … `calendar_to` (inclusive). */
    by_day: Array<{ date: string; count: number }>
    /** IANA zone used to bucket tutor_query timestamps (e.g. America/Los_Angeles). */
    display_timezone?: string
    timezone_note: string
    /** Set when Postgres could not be queried (otherwise null/omitted). */
    error?: string | null
  }
  notebook_label_heatmap: {
    labels: string[]
    notebooks: string[]
    raw_counts: number[][]
    row_normalized: number[][]
    column_normalized: number[][]
  }
  labeling_throughput: Array<{
    date: string
    human: number
    ai: number
    total: number
  }>
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

export interface OrphanedMessage {
  chatlog_id: number
  message_index: number
  preview_text: string
}

export interface OrphanedMessagesResponse {
  messages: OrphanedMessage[]
  count: number
}

export interface ArchiveResponse {
  archived_at: string
  messages_returned_to_queue: number
}

export interface ArchiveReviewState {
  labelId: number
  labelName: string
  orphanedMessages: OrphanedMessage[]
  completedMessageKeys: Set<string>
}

export interface LabelReviewItem {
  label_id: number
  name: string
  description: string | null
  example_text: string | null
}

export interface HistoryItem {
  chatlog_id: number
  message_index: number
  message_text: string
  context_before: string | null
  context_after: string | null
  labels: string[]
  status: 'labeled' | 'skipped'
  applied_by: 'human' | 'ai' | null
  confidence: number | null
  processed_at: string
}

export interface ConceptCandidate {
  id: number
  name: string
  description: string
  example_messages: { excerpt: string; chatlog_id?: number; message_index?: number }[]
  status: 'pending' | 'accepted' | 'rejected'
  source_run_id: string
  similar_to: string | null
  created_at: string
}

export interface EmbedStatus {
  cached: number
  total_unlabeled: number
  running: boolean
}

export interface ConversationMessageLabel {
  label_name: string
  applied_by: string
}

export interface ConversationMessage {
  role: "student" | "assistant"
  text: string
  message_index: number | null
  labels: ConversationMessageLabel[]
}

export interface RecalibrationItem extends QueueItem {
  original_label_ids: number[]
}

export interface RecalibrationStats {
  recent_results: boolean[]
  trend: 'improving' | 'steady' | 'shifting'
  current_interval: number
  total_recalibrations: number
}

export interface SaveRecalibrationRequest {
  chatlog_id: number
  message_index: number
  original_label_ids: number[]
  relabel_ids: number[]
  final_label_ids: number[]
}

export interface SaveRecalibrationResponse {
  matched: boolean
  trend: 'improving' | 'steady' | 'shifting'
}
