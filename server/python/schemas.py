# server/python/schemas.py
from datetime import datetime
from typing import List, Optional
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

class LabelDefinitionResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    created_at: datetime
    count: int


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


class ReadinessResponse(BaseModel):
    tier: str  # "gray" | "amber" | "green"
    yes_count: int
    no_count: int
    skip_count: int
    conversations_walked: int
    total_conversations: int
    hint: Optional[str]


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
