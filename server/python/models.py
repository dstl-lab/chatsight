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
