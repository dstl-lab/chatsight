// src/types/index.ts

export interface LabelDefinition {
  id: number
  name: string
  description: string | null
  created_at: string
  count: number
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
