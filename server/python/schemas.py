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


class AdvanceRequest(BaseModel):
    chatlog_id: int
    message_index: int


class UndoRequest(BaseModel):
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
