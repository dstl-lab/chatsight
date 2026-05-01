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


class LabelApplication(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    applied_by: str = "human"
    confidence: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LabelingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime = Field(default_factory=datetime.utcnow)
    labeled_count: int = 0


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
    example_messages: str  # JSON string (legacy column, retained)

    # Legacy fields — retained for backwards compat with old rows
    status: str = "pending"  # pending | accepted | rejected (legacy)
    source_run_id: str  # legacy string-keyed run id
    similar_to: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # New RAG-discovery fields
    kind: str = "broad_label"  # "broad_label" | "co_occurrence"
    discovery_run_id: Optional[int] = Field(
        default=None, foreign_key="discoveryrun.id"
    )
    shown_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decision: Optional[str] = None  # accept | reject | dismiss | suggest_merge | note
    created_label_id: Optional[int] = Field(
        default=None, foreign_key="labeldefinition.id"
    )
    evidence_message_ids: Optional[str] = None  # JSON list of {chatlog_id, message_index}
    co_occurrence_label_ids: Optional[str] = None  # JSON [int, int]
    co_occurrence_count: Optional[int] = None


class SuggestionCache(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    label_name: str
    evidence: str
    rationale: str
    labels_hash: str  # hash of all active label names; invalidated when labels change
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DiscoveryRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    query_kind: str  # "broad_label" | "co_occurrence"
    trigger: str  # "manual" | "badge"
    drift_value_at_trigger: Optional[float] = None
    pool_size_at_trigger: int
    n_candidates: int = 0
    error: Optional[str] = None
