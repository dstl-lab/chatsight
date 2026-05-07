# server/python/models.py
from datetime import datetime
from typing import Optional
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class LabelDefinition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: Optional[datetime] = Field(default=None)
    # Single-label pivot additions
    mode: str = Field(default="multi")  # "multi" | "single"
    phase: str = Field(default="labeling")  # "labeling" | "handed_off" | "reviewing" | "complete" | "queued"
    is_active: bool = Field(default=False)
    queue_position: Optional[int] = Field(default=None)
    summary_json: Optional[str] = Field(default=None)  # cached AI summary blob
    classified_count: Optional[int] = Field(default=None)  # progress: rows AI has classified
    classification_total: Optional[int] = Field(default=None)  # progress: total to classify


class LabelApplication(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", "message_index", name="uq_labelapp_msg"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    applied_by: str = "human"
    confidence: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Single-label pivot: explicit decision value (multi-label leaves NULL)
    value: Optional[str] = Field(default=None)  # "yes" | "no" | "skip" | None (multi)


class LabelPrediction(SQLModel, table=True):
    """Cached nearest-neighbor results for a label's unlabeled messages.
    Rebuilt lazily by assist_service when the human label count diverges
    from the stored model_version by >= 5."""
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", "message_index", name="uq_labelpred_msg"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id", index=True)
    chatlog_id: int = Field(index=True)
    message_index: int
    nearest_neighbors: str  # JSON-encoded list of AssistNeighbor dicts
    model_version: int  # = human_label_count at the time of build
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LabelingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime = Field(default_factory=datetime.utcnow)
    labeled_count: int = 0
    # Single-label pivot: per-label run tracking
    label_id: Optional[int] = Field(default=None, foreign_key="labeldefinition.id")
    handed_off_at: Optional[datetime] = Field(default=None)
    closed_at: Optional[datetime] = Field(default=None)


class ConversationCursor(SQLModel, table=True):
    """Tracks resume position per (label_id, chatlog_id) for the single-label flow."""
    label_id: int = Field(foreign_key="labeldefinition.id", primary_key=True)
    chatlog_id: int = Field(primary_key=True)
    last_message_index_decided: int
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AssignmentMapping(SQLModel, table=True):
    """Instructor-curated mapping: regex on notebook filename → assignment name."""
    id: Optional[int] = Field(default=None, primary_key=True)
    pattern: str  # regex evaluated against MessageCache.notebook
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SkippedMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MessageCache(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    message_text: str
    context_before: Optional[str] = None
    context_after: Optional[str] = None
    # Single-label pivot: assignment metadata derived from external events.payload->notebook
    notebook: Optional[str] = Field(default=None)
    assignment_id: Optional[int] = Field(default=None, foreign_key="assignmentmapping.id")


class MessageEmbedding(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("chatlog_id", "message_index", "model_version"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    embedding: bytes
    model_version: str = "gemini-embedding-001"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RecalibrationEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    original_label_ids: str        # JSON array of label IDs from original labeling
    relabel_ids: str               # JSON array of label IDs from blind re-label
    final_label_ids: str           # JSON array of label IDs after reconciliation
    matched: bool                  # True if original_label_ids == relabel_ids
    session_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConceptCandidate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str
    example_messages: str  # JSON string
    status: str = "pending"  # pending | accepted | rejected
    source_run_id: str
    similar_to: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SuggestionCache(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    label_name: str
    evidence: str
    rationale: str
    labels_hash: str  # hash of all active label names; invalidated when labels change
    created_at: datetime = Field(default_factory=datetime.utcnow)
