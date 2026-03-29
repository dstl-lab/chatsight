# server/python/schemas.py
from datetime import datetime
from typing import Optional
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


# ── Response shapes ───────────────────────────────────────────────────────────

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
