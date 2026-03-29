from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

class LabelResponse(BaseModel):
    id: int
    label_set_id: int
    message_index: int
    label: str
    evidence: str
    rationale: str

class LabelSetResponse(BaseModel):
    id: int
    chatlog_id: int
    steering_notes: str
    created_at: datetime
    labels: List[LabelResponse]

class ChatlogResponse(BaseModel):
    id: int
    filename: str
    content: str
    created_at: datetime
    latest_label_set: Optional[LabelSetResponse] = None

class ChatlogSummary(BaseModel):
    id: int
    filename: str
    notebook: Optional[str]
    user_email: Optional[str]
    created_at: datetime

class GenerateLabelsRequest(BaseModel):
    chatlog_id: int
    steering_notes: str = ""
