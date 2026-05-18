# server/python/schemas.py
from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel


# ── Request shapes ────────────────────────────────────────────────────────────

class CreateLabelRequest(BaseModel):
    name: str
    description: Optional[str] = None


class UpdateLabelRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ApplyLabelRequest(BaseModel):
    chatlog_id: int
    message_index: int
    label_id: int


class SkipMessageRequest(BaseModel):
    chatlog_id: int
    message_index: int


class SuggestRequest(BaseModel):
    chatlog_id: int
    message_index: int


class MergeLabelRequest(BaseModel):
    source_label_id: int
    target_label_id: int


class SplitLabelRequest(BaseModel):
    label_id: int
    name_a: str
    name_b: str


class ReorderLabelsRequest(BaseModel):
    label_ids: List[int]


class AdvanceRequest(BaseModel):
    chatlog_id: int
    message_index: int


class UndoRequest(BaseModel):
    chatlog_id: int
    message_index: int


class ConciseRequest(BaseModel):
    chatlog_id: int
    message_index: int


class ApplyBatchRequest(BaseModel):
    assignments: dict[str, int]  # "chatlog_id:message_index" -> label_id
    delete_original_label_id: Optional[int] = None


class SplitAutoLabelRequest(BaseModel):
    label_id: int
    name_a: str
    name_b: str
    assignments: dict[str, str]  # e.g., "chatlog_id:message_index" -> "name_a" or "name_b"


# ── Response shapes ───────────────────────────────────────────────────────────

class LabelExampleResponse(BaseModel):
    chatlog_id: int
    message_index: int
    message_text: str
    label_id: int
    applied_by: str

class ConciseResponse(BaseModel):
    concise_text: str

class PairedLabelSummary(BaseModel):
    """Stats for the mode='single' label that's been promoted from a multi-label.
    `count` on the parent stays multi-only (Phase 1 semantics); this object
    surfaces the validation-pass numbers separately so the UI can show both."""
    label_id: int
    name: str
    phase: str  # queued | labeling | classifying | handed_off | failed | complete
    yes_count: int
    no_count: int
    skip_count: int


class LabelDefinitionResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    created_at: datetime
    count: int
    paired_label_id: Optional[int] = None
    paired_summary: Optional[PairedLabelSummary] = None


class QueueItemResponse(BaseModel):
    chatlog_id: int
    message_index: int
    message_text: str
    context_before: Optional[str]
    context_after: Optional[str]


class SessionResponse(BaseModel):
    id: int
    started_at: datetime
    last_active: datetime
    labeled_count: int


class LabelApplicationResponse(BaseModel):
    id: int
    label_id: int
    chatlog_id: int
    message_index: int
    applied_by: str
    created_at: datetime

class DeleteLabelResponse(BaseModel):
    ok: bool
    deleted_applications: Optional[int] = None


class OrphanedMessageItem(BaseModel):
    chatlog_id: int
    message_index: int
    preview_text: str


class OrphanedMessagesResponse(BaseModel):
    messages: list[OrphanedMessageItem]
    count: int


class ArchiveResponse(BaseModel):
    archived_at: datetime
    messages_returned_to_queue: int


class LabelReviewResponse(BaseModel):
    label_id: int
    name: str
    description: Optional[str]
    example_text: Optional[str]


# ── Kept from old code (chatlog read routes) ──────────────────────────────────

class ChatlogSummary(BaseModel):
    id: int
    filename: str
    notebook: Optional[str]
    user_email: Optional[str]
    created_at: datetime


class ChatlogResponse(BaseModel):
    id: int
    filename: str
    content: str
    created_at: datetime


# ── Concept Induction ──────────────────────────────────────────────

class DiscoverConceptsResponse(BaseModel):
    run_id: str
    status: str  # "running"


class ConceptCandidateResponse(BaseModel):
    id: int
    name: str
    description: str
    example_messages: List[dict]  # parsed from JSON
    status: str
    source_run_id: str
    similar_to: Optional[str] = None
    created_at: datetime


class ResolveCandidateRequest(BaseModel):
    action: str  # "accept" | "reject"
    name: Optional[str] = None  # rename on accept


class EmbedStatusResponse(BaseModel):
    cached: int
    total_unlabeled: int
    running: bool


# ── Recalibration ──────────────────────────────────────────────────

class RecalibrationItemResponse(BaseModel):
    chatlog_id: int
    message_index: int
    message_text: str
    context_before: Optional[str]
    context_after: Optional[str]
    original_label_ids: List[int]


class SaveRecalibrationRequest(BaseModel):
    chatlog_id: int
    message_index: int
    original_label_ids: List[int]
    relabel_ids: List[int]
    final_label_ids: List[int]


class SaveRecalibrationResponse(BaseModel):
    matched: bool
    trend: str  # "improving" | "steady" | "shifting"


class RecalibrationStatsResponse(BaseModel):
    recent_results: List[bool]
    trend: str  # "improving" | "steady" | "shifting"
    current_interval: int
    total_recalibrations: int


# ─── Single-label binary flow ───

class CreateSingleLabelRequest(BaseModel):
    name: str
    description: Optional[str] = None


class QueueLabelRequest(BaseModel):
    name: str
    description: Optional[str] = None


class DecideRequest(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # "yes" | "no" | "skip"


class SingleLabelResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    mode: str
    phase: str
    is_active: bool
    queue_position: Optional[int]
    yes_count: int
    no_count: int
    skip_count: int
    conversations_walked: int
    total_conversations: int
    hybrid_explore_fraction: Optional[float] = None
    hybrid_explore_effective: float = 0.35


class TurnResponse(BaseModel):
    message_index: int
    role: str  # "student" | "tutor"
    text: str


class FocusedMessageResponse(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    notebook: Optional[str]
    conversation_turn_count: int
    thread: List[TurnResponse]
    focus_index: int
    sampling_pick: Optional[str] = None  # "continue" | "explore" | "round_robin"
    conversation_summary: Optional[str] = None
    pick_rationale: Optional[str] = None
    sampling_hint: Optional[str] = None  # deprecated; use conversation_summary / pick_rationale
    conversation_student_messages: Optional[int] = None
    pending_student_message_number: Optional[int] = None
    neighbor_scores_available: bool = False
    neighbor_uncertainty_pct: Optional[int] = None
    neighbor_novelty_pct: Optional[int] = None
    conversation_novelty_pct: Optional[int] = None
    theme_novelty_pct: Optional[int] = None
    student_specificity_pct: Optional[int] = None
    student_rarity_pct: Optional[int] = None


class ReadinessResponse(BaseModel):
    tier: str  # "gray" | "amber" | "green"
    yes_count: int
    no_count: int
    skip_count: int
    conversations_walked: int
    total_conversations: int
    hint: Optional[str]


class DecideResponse(BaseModel):
    """Combined response for decide/undo/skip-conversation: the next focused
    message (or None if nothing left) plus refreshed readiness. Bundling these
    saves the /run UI a separate getReadiness round-trip per cycle."""
    next: Optional[FocusedMessageResponse]
    readiness: ReadinessResponse


class SummaryPattern(BaseModel):
    excerpt: str
    frequency: str  # "common" | "moderate" | "rare"
    confidence_avg: float


class SummaryResponse(BaseModel):
    label_id: int
    label_name: str
    yes_count: int
    no_count: int
    review_threshold: float
    review_count: int
    included: List[SummaryPattern]
    excluded: List[SummaryPattern]


class HandoffResponse(BaseModel):
    label_id: int
    classified: int
    yes_count: int
    no_count: int
    review_count: int


class ReviewItemResponse(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    notebook: Optional[str]
    ai_value: str
    ai_confidence: float


class ReviewRequest(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # "yes" | "no"


class AssistNeighbor(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # "yes" | "no"
    similarity: float
    message_text: str


class AssistResponse(BaseModel):
    neighbors: List[AssistNeighbor]


# ─── Assignment mappings ───

class CreateAssignmentRequest(BaseModel):
    pattern: str
    name: str
    description: Optional[str] = None


class AssignmentResponse(BaseModel):
    id: int
    pattern: str
    name: str
    description: Optional[str]
    message_count: int


class UnmappedCountResponse(BaseModel):
    unmapped_count: int
    total_count: int


class InferAssignmentsResponse(BaseModel):
    created: int
    total_notebooks: int
    groups: List[dict]


class HandoffSummaryListItem(BaseModel):
    label_id: int
    label_name: str
    description: Optional[str]
    phase: str
    yes_count: int
    no_count: int
    review_count: int
    review_threshold: float
    included: List[SummaryPattern]
    excluded: List[SummaryPattern]
    classified_count: Optional[int] = None
    classification_total: Optional[int] = None
    error: Optional[str] = None
    error_kind: Optional[str] = None  # "rate_limited" | "error" | None
    # Gemini Batch API instrumentation. `batch_state` is non-null only while a
    # batch job is in flight; the UI uses its presence to switch from the
    # `classified_count / classification_total` % bar to an indeterminate
    # state-aware display. `batch_submitted_at` powers an elapsed-time label;
    # `batch_polled_at` powers a liveness hint (stale = task may be dead).
    # When work is split across multiple sub-batches, `batch_total_count` and
    # `batch_completed_count` let the UI render "X of N batches done".
    batch_state: Optional[str] = None
    batch_submitted_at: Optional[datetime] = None
    batch_polled_at: Optional[datetime] = None
    batch_total_count: Optional[int] = None
    batch_completed_count: Optional[int] = None


class MergeAssignmentsRequest(BaseModel):
    source_ids: List[int]
    target_id: int
    new_name: Optional[str] = None


class MergeAssignmentsResponse(BaseModel):
    merged: int
    moved_messages: int
    target_id: int


class SkipConversationRequest(BaseModel):
    chatlog_id: int


class SkipConversationResponse(BaseModel):
    skipped: int
    chatlog_id: int


# ──────────────────────────────────────────────────────────────────────────
# Summaries page (Phase 1) — single-label master-detail UI
# See docs/superpowers/specs/2026-05-14-summaries-page-revamp-design.md
# ──────────────────────────────────────────────────────────────────────────


class ConfidenceHistogramBin(BaseModel):
    range_lo: float
    range_hi: float
    count: int


class SingleLabelDetailResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    phase: str
    yes_count: int
    no_count: int
    review_count: int
    review_threshold: float
    agreement_vs_gold: Optional[float]  # null when gold set < 20 rows
    confidence_histogram: List[ConfidenceHistogramBin]


class MessageListItem(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    confidence: Optional[float]
    verdict: Optional[Literal["yes", "no", "review"]]
    applied_by: Optional[Literal["ai", "human"]]
    flagged: bool
    has_note: bool
    notebook: Optional[str]


class MessageListResponse(BaseModel):
    items: List[MessageListItem]
    total: int
    offset: int
    limit: int


class ConversationTurn(BaseModel):
    role: Literal["tutor", "student"]
    turn_index: int
    text: str


class MessageDetailResponse(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    confidence: Optional[float]
    verdict: Optional[Literal["yes", "no", "review"]]
    applied_by: Optional[Literal["ai", "human"]]
    matched_pattern: Optional[str]
    rationale: Optional[str]
    flagged: bool
    note: Optional[str]
    context_before: List[ConversationTurn]
    context_after: List[ConversationTurn]
    notebook: Optional[str]
    turn_index: int
    total_turns: int


class FlipRequest(BaseModel):
    verdict: Literal["yes", "no"]


class NoteRequest(BaseModel):
    text: str  # empty string deletes the note


class LabelUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    review_threshold: Optional[float] = None
    hybrid_explore_fraction: Optional[float] = None
