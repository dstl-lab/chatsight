// src/types/index.ts

export interface PairedLabelSummary {
  label_id: number
  name: string
  /** queued | labeling | classifying | handed_off | failed | complete */
  phase: string
  yes_count: number
  no_count: number
  skip_count: number
}

export interface LabelDefinition {
  id: number
  name: string
  description: string | null
  created_at: string
  /** Multi-label NULL applications only (the discovery count). Validation
   * counts from the paired single live in `paired_summary`. */
  count: number
  paired_label_id?: number | null
  paired_summary?: PairedLabelSummary | null
}

export interface LabelExample {
  chatlog_id: number
  message_index: number
  message_text: string
  label_id: number
  /** "human" | "ai" for actual labelings; "none" for unlabeled candidates
   * surfaced by QuickRefineModal. Filters that branch on this string must
   * handle the "none" case. */
  applied_by: "human" | "ai" | "none"
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

export interface PairedLabelCount {
  paired_id: number
  /** queued | labeling | classifying | handed_off | failed | complete */
  phase: string
  yes: number
  no: number
  skip: number
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
  /** Keyed by parent multi-label name; present for any multi-label that has
   * been promoted to /run via POST /api/labels/{id}/promote. */
  paired_label_counts: Record<string, PairedLabelCount>
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
    /** Set when this sub-block failed; sibling blocks may still have data. */
    error?: string | null
  }
  /** Per-card failure isolation: if `error` is set, `data` is empty. */
  labeling_throughput: {
    data: Array<{
      date: string
      human: number
      ai: number
      total: number
    }>
    error?: string | null
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

// ─── Single-label binary flow ───

export type LabelMode = 'multi' | 'single'
export type LabelPhase = 'labeling' | 'handed_off' | 'reviewing' | 'complete' | 'queued'
export type DecisionValue = 'yes' | 'no' | 'skip'
export type TurnRole = 'student' | 'tutor'

export interface SingleLabel {
  id: number
  name: string
  description: string | null
  guidance: string | null
  mode: LabelMode
  phase: LabelPhase
  is_active: boolean
  queue_position: number | null
  yes_count: number
  no_count: number
  skip_count: number
  conversations_walked: number
  total_conversations: number
  hybrid_explore_fraction: number | null
  hybrid_explore_effective: number
}

export type SamplingPick = 'continue' | 'explore' | 'round_robin'

export interface ConversationTurn {
  message_index: number
  role: TurnRole
  text: string
}

export interface FocusedMessage {
  chatlog_id: number
  message_index: number
  text: string
  notebook: string | null
  conversation_turn_count: number
  thread: ConversationTurn[]
  focus_index: number
  sampling_pick: SamplingPick | null
  conversation_summary: string | null
  pick_rationale: string | null
  conversation_student_messages: number | null
  pending_student_message_number: number | null
  neighbor_scores_available: boolean
  neighbor_uncertainty_pct: number | null
  neighbor_novelty_pct: number | null
  conversation_novelty_pct: number | null
  theme_novelty_pct: number | null
  student_specificity_pct: number | null
  student_rarity_pct: number | null
  /** @deprecated use conversation_summary / pick_rationale */
  sampling_hint: string | null
}

export type ReadinessTier = 'gray' | 'amber' | 'green'

export interface ReadinessState {
  tier: ReadinessTier
  yes_count: number
  no_count: number
  skip_count: number
  conversations_walked: number
  total_conversations: number
  hint: string | null
}

/** Combined response from decide/undo/skip-conversation: avoids a separate
 *  getReadiness round-trip per cycle. */
export interface DecideResult {
  next: FocusedMessage | null
  readiness: ReadinessState
}

export interface SummaryPattern {
  excerpt: string
  frequency: string
  confidence_avg: number
}

export interface SingleLabelSummary {
  label_id: number
  label_name: string
  yes_count: number
  no_count: number
  review_threshold: number
  review_count: number
  included: SummaryPattern[]
  excluded: SummaryPattern[]
}

export interface HandoffResponse {
  label_id: number
  classified: number
  yes_count: number
  no_count: number
  review_count: number
}

export interface ReviewItem {
  chatlog_id: number
  message_index: number
  text: string
  notebook: string | null
  ai_value: 'yes' | 'no'
  ai_confidence: number
}

export interface AssignmentMapping {
  id: number
  pattern: string
  name: string
  description: string | null
  message_count: number
}

export interface UnmappedCount {
  unmapped_count: number
  total_count: number
}

export interface InferAssignmentsResult {
  created: number
  total_notebooks: number
  groups: { name: string; notebooks: string[]; count: number }[]
}

export interface HandoffSummaryItem {
  label_id: number
  label_name: string
  description: string | null
  phase: string
  yes_count: number
  no_count: number
  review_count: number
  review_threshold: number
  included: SummaryPattern[]
  excluded: SummaryPattern[]
  classified_count: number | null
  classification_total: number | null
  error: string | null
  error_kind: 'rate_limited' | 'error' | null
  // Gemini Batch API instrumentation — non-null only while a batch job is in
  // flight. When `batch_state` is set, the UI shows a state-aware display.
  // For multi-batch handoffs, `batch_total_count` / `batch_completed_count`
  // drive the "X of N batches done" text and let the real % bar take over
  // as soon as the first sub-batch lands.
  batch_state: string | null
  batch_submitted_at: string | null
  batch_polled_at: string | null
  batch_total_count: number | null
  batch_completed_count: number | null
}

export interface AssistNeighbor {
  chatlog_id: number
  message_index: number
  value: 'yes' | 'no'
  similarity: number
  message_text: string
}

export interface AssistResponse {
  neighbors: AssistNeighbor[]
}

// ─── Single-label analysis ───

export type SingleLabelCohortRow = {
  run_id: number
  label_name: string
  description: string | null
  phase: 'queued' | 'labeling' | 'handed_off' | 'reviewing' | 'complete'
  yes_count: number
  no_count: number
  /** 0–100; 0 if (yes + no) == 0 */
  yes_pct: number
  /** 0–100; null when overlap_count == 0 */
  disagreement_pct: number | null
  overlap_count: number
  /** ISO 8601 timestamp of the most recent activity on this run */
  updated_at: string
  /** ≤ 8 weekly yes-rate values (0–100), oldest → newest, for the rail sparkline */
  weekly_sparkline: number[]
}

export interface SingleLabelCohortResponse {
  runs: SingleLabelCohortRow[]
}

export interface ConfidenceBin {
  /** inclusive */
  lo: number
  /** exclusive (last bin includes 1.0) */
  hi: number
  count: number
  yes: number
  no: number
}

export interface AgreementBucket {
  lo: number
  hi: number
  overlap_count: number
  agree: number
  /** 0–100, null when overlap_count == 0 */
  agreement_rate: number | null
}

export interface ExampleMsg {
  /** LabelApplication.id of the row this message was sampled for */
  message_id: number
  chatlog_id: number
  message_index: number
  text: string
  ai_pred: 'yes' | 'no' | null
  ai_confidence: number | null
  human_decision: 'yes' | 'no' | null
  assignment: string | null
  position_bucket: 'early' | 'mid' | 'late' | null
  created_at: string
  flag: 'low_confidence' | 'human_overruled' | null
}

export interface SingleLabelRunDetail {
  run: {
    id: number
    label_name: string
    description: string | null
    phase: 'queued' | 'labeling' | 'handed_off' | 'reviewing' | 'complete'
    updated_at: string
    yes_count: number
    no_count: number
    /** per-message yes-rate, 0–100 */
    yes_pct: number
    /** per-conversation yes-rate, 0–100 */
    conv_yes_pct: number
  }
  confidence_histogram: {
    bins: ConfidenceBin[]
    coverage: { with_confidence: number; total_ai: number }
  }
  ai_coverage: {
    /** distinct (chatlog_id, message_index) with AI rows for this label */
    covered: number
    /** total MessageCache entries (denominator universe) */
    total: number
    /** 0–100 */
    pct: number
  }
  agreement_by_confidence: {
    /** length 5, edges [0, .2, .4, .6, .8, 1.0] */
    buckets: AgreementBucket[]
  }
  disagreement: {
    overlap_count: number
    agree: number
    disagree: number
    /** 0–100 or null */
    rate: number | null
    breakdown: {
      ai_yes_human_no: number
      ai_no_human_yes: number
    }
  }
  by_assignment: { key: string; yes: number; no: number; yes_pct: number }[]
  by_position: { bucket: 'early' | 'mid' | 'late'; yes: number; no: number; yes_pct: number }[]
  /** 24 buckets, one per hour-of-day (0–23), in the analysis timezone. */
  by_hour_of_day: { hour: number; yes: number; no: number; yes_pct: number }[]
  /** Three buckets by total conversation length: short (≤5), mid (6–15), long (16+). */
  by_conversation_depth: {
    bucket: 'short' | 'mid' | 'long'
    yes: number
    no: number
    yes_pct: number
  }[]
  examples: {
    yes: ExampleMsg[]
    no: ExampleMsg[]
    edge: ExampleMsg[]
  }
}

export interface AssignmentMilestone {
  title: string
  /** YYYY-MM-DD */
  date: string
  kind: 'due' | 'late' | 'release'
  note?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Summaries page (Phase 1) — single-label master-detail UI
// See docs/superpowers/specs/2026-05-14-summaries-page-revamp-design.md
// ──────────────────────────────────────────────────────────────────────────

export interface ConfidenceHistogramBin {
  range_lo: number
  range_hi: number
  count: number
}

export interface SingleLabelDetail {
  id: number
  name: string
  description: string | null
  phase: string
  yes_count: number
  no_count: number
  review_count: number
  review_threshold: number
  agreement_vs_gold: number | null
  confidence_histogram: ConfidenceHistogramBin[]
}

export type MessageVerdict = 'yes' | 'no' | 'review'

export interface MessageListItem {
  chatlog_id: number
  message_index: number
  text: string
  confidence: number | null
  verdict: MessageVerdict | null
  applied_by: 'ai' | 'human' | null
  flagged: boolean
  has_note: boolean
  notebook: string | null
}

export interface MessageListResponse {
  items: MessageListItem[]
  total: number
  offset: number
  limit: number
}

// NOTE: ConversationTurn already exists (different shape). Summaries version uses turn_index.
export interface SummariesConversationTurn {
  role: 'tutor' | 'student'
  turn_index: number
  text: string
}

export interface MessageDetail {
  chatlog_id: number
  message_index: number
  text: string
  confidence: number | null
  verdict: MessageVerdict | null
  applied_by: 'ai' | 'human' | null
  matched_pattern: string | null
  rationale: string | null
  flagged: boolean
  note: string | null
  context_before: SummariesConversationTurn[]
  context_after: SummariesConversationTurn[]
  notebook: string | null
  turn_index: number
  total_turns: number
}

export type ContextDepth = '1' | '2' | '3' | 'full'
export type BrowseSort = 'confidence_asc' | 'confidence_desc' | 'recently_flipped'
export type BrowseBucket = 'all' | 'yes' | 'no' | 'review' | 'flagged' | 'notes' | `pattern=${string}`
