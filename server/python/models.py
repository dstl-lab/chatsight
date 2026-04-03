# server/python/models.py
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class LabelDefinition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LabelApplication(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    applied_by: str = "human"
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
