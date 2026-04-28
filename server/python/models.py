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
    phase: str = Field(default="labeling")  # labeling | handed_off | reviewing | complete
    is_active: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: Optional[datetime] = Field(default=None)


class LabelApplication(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", "message_index", name="uq_labelapp_label_msg"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    value: str = Field(default="yes")  # yes | no | skip
    applied_by: str = "human"
    confidence: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LabelingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: Optional[int] = Field(default=None, foreign_key="labeldefinition.id")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime = Field(default_factory=datetime.utcnow)
    handed_off_at: Optional[datetime] = Field(default=None)
    closed_at: Optional[datetime] = Field(default=None)
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


class ConversationCursor(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", name="uq_cursor_label_chatlog"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    last_message_index: int = Field(default=-1)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
