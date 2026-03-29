from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel

class LabelSet(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    steering_notes: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Label(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_set_id: int = Field(foreign_key="labelset.id")
    message_index: int
    label: str
    evidence: str
    rationale: str
