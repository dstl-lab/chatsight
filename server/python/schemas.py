# server/python/schemas.py
from datetime import datetime
from typing import List, Literal, Optional, Tuple
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

class StartDiscoverRequest(BaseModel):
    query_kind: Literal["broad_label", "co_occurrence"]
    trigger: Literal["manual", "badge"] = "manual"


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
    # New RAG-discovery fields
    kind: str = "broad_label"
    discovery_run_id: Optional[int] = None
    decision: Optional[str] = None
    created_label_id: Optional[int] = None
    evidence_message_ids: Optional[List[dict]] = None
    co_occurrence_label_ids: Optional[List[int]] = None
    co_occurrence_count: Optional[int] = None


class RipeSignalResponse(BaseModel):
    ripe: bool
    pool_size: int
    drift_value: Optional[float] = None
    reasons: List[str]


class AcceptCandidateResponse(BaseModel):
    candidate_id: int
    created_label_id: int
    applied_count: int


class DismissRequest(BaseModel):
    reason: Optional[str] = None


class GenericOk(BaseModel):
    ok: bool = True


class MakeLabelResponse(BaseModel):
    candidate_id: int
    created_label_id: int


class SuggestMergeRequest(BaseModel):
    archive_label_id: int
    keep_label_id: int


class SuggestMergeResponse(BaseModel):
    archived_label_id: int
    kept_label_id: int
    retagged_count: int


class DiscoveryRunResponse(BaseModel):
    id: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    query_kind: str
    trigger: str
    drift_value_at_trigger: Optional[float] = None
    pool_size_at_trigger: int
    n_candidates: int
    error: Optional[str] = None


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
