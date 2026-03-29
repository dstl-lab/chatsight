from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text
from sqlalchemy.engine import Connection

from database import create_db_and_tables, get_session, ext_engine
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage
from schemas import (
    CreateLabelRequest, UpdateLabelRequest, ApplyLabelRequest,
    SkipMessageRequest, SuggestRequest, MergeLabelRequest, SplitLabelRequest,
    LabelDefinitionResponse, QueueItemResponse, SessionResponse,
    ChatlogSummary, ChatlogResponse,
)
from sqlmodel import Session, select


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_ext_conn():
    with ext_engine.connect() as conn:
        yield conn


def _fetch_conversation_events(conn: Connection, chatlog_id: int):
    """Return all tutor events for the conversation whose first event has the given id."""
    rows = conn.execute(text("""
        WITH conv AS (
            SELECT payload->>'conversation_id' AS conv_id,
                   user_email,
                   MIN(created_at) AS started_at
            FROM events
            WHERE id = :chatlog_id
              AND event_type IN ('tutor_query', 'tutor_response')
            GROUP BY payload->>'conversation_id', user_email
        )
        SELECT e.event_type,
               e.payload->>'question'  AS question,
               e.payload->>'response'  AS response,
               e.payload->>'notebook'  AS notebook,
               e.created_at,
               c.user_email,
               c.started_at
        FROM events e
        JOIN conv c ON e.payload->>'conversation_id' = c.conv_id
        WHERE e.event_type IN ('tutor_query', 'tutor_response')
        ORDER BY e.created_at
    """), {"chatlog_id": chatlog_id}).mappings().all()
    return rows


def _build_content(rows) -> str:
    parts = []
    seen_query = False
    for row in rows:
        if row["event_type"] == "tutor_query" and row["question"]:
            seen_query = True
            parts.append(f"Student: {row['question']}")
        elif row["event_type"] == "tutor_response" and row["response"] and seen_query:
            parts.append(f"Assistant: {row['response']}")
    return "\n\n".join(parts)


@app.get("/api/chatlogs", response_model=List[ChatlogSummary])
def list_chatlogs(conn: Connection = Depends(get_ext_conn)):
    rows = conn.execute(text("""
        SELECT MIN(id)          AS id,
               MAX(user_email)  AS user_email,
               MAX(payload->>'notebook') AS notebook,
               MIN(created_at)  AS created_at
        FROM events
        WHERE event_type IN ('tutor_query', 'tutor_response')
          AND payload->>'conversation_id' IS NOT NULL
        GROUP BY payload->>'conversation_id'
        ORDER BY MIN(created_at) DESC
    """)).mappings().all()

    return [
        ChatlogSummary(
            id=row["id"],
            filename=f"{row['user_email']} — {row['notebook'] or 'unknown'}",
            notebook=row["notebook"],
            user_email=row["user_email"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@app.get("/api/chatlogs/{chatlog_id}", response_model=ChatlogResponse)
def get_chatlog(
    chatlog_id: int,
    conn: Connection = Depends(get_ext_conn),
):
    rows = _fetch_conversation_events(conn, chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")

    first = rows[0]
    filename = f"{first['user_email']} — {first['notebook'] or 'unknown'}"
    content = _build_content(rows)

    return ChatlogResponse(
        id=chatlog_id,
        filename=filename,
        content=content,
        created_at=first["started_at"],
    )


# ── Label routes ──────────────────────────────────────────────────────────────

@app.get("/api/labels", response_model=List[LabelDefinitionResponse])
def get_labels(db: Session = Depends(get_session)):
    labels = db.exec(select(LabelDefinition)).all()
    result = []
    for label in labels:
        count = db.exec(
            select(func.count(LabelApplication.id)).where(
                LabelApplication.label_id == label.id
            )
        ).one()
        result.append(LabelDefinitionResponse(
            id=label.id, name=label.name, description=label.description,
            created_at=label.created_at, count=count,
        ))
    return result


@app.post("/api/labels", response_model=LabelDefinitionResponse)
def create_label(req: CreateLabelRequest, db: Session = Depends(get_session)):
    label = LabelDefinition(name=req.name, description=req.description)
    db.add(label)
    db.commit()
    db.refresh(label)
    return LabelDefinitionResponse(
        id=label.id, name=label.name, description=label.description,
        created_at=label.created_at, count=0,
    )


@app.put("/api/labels/{label_id}", response_model=LabelDefinitionResponse)
def update_label(label_id: int, req: UpdateLabelRequest, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if req.name is not None:
        label.name = req.name
    if req.description is not None:
        label.description = req.description
    db.add(label)
    db.commit()
    db.refresh(label)
    count = db.exec(
        select(func.count(LabelApplication.id)).where(LabelApplication.label_id == label.id)
    ).one()
    return LabelDefinitionResponse(
        id=label.id, name=label.name, description=label.description,
        created_at=label.created_at, count=count,
    )
