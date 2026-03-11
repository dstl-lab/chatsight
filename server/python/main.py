from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from sqlalchemy import text
from sqlalchemy.engine import Connection
from typing import List

from database import create_db_and_tables, get_session, ext_engine
from models import LabelSet, Label
from schemas import (
    ChatlogResponse, ChatlogSummary, LabelSetResponse,
    LabelResponse, GenerateLabelsRequest
)
from label_service import generate_labels


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
    session: Session = Depends(get_session),
):
    rows = _fetch_conversation_events(conn, chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")

    first = rows[0]
    filename = f"{first['user_email']} — {first['notebook'] or 'unknown'}"
    content = _build_content(rows)

    label_sets = session.exec(
        select(LabelSet).where(LabelSet.chatlog_id == chatlog_id).order_by(LabelSet.created_at.desc())
    ).all()

    latest_label_set_response = None
    if label_sets:
        latest = label_sets[0]
        labels = session.exec(select(Label).where(Label.label_set_id == latest.id)).all()
        latest_label_set_response = LabelSetResponse(
            id=latest.id,
            chatlog_id=latest.chatlog_id,
            steering_notes=latest.steering_notes,
            created_at=latest.created_at,
            labels=[LabelResponse(
                id=l.id, label_set_id=l.label_set_id,
                message_index=l.message_index, label=l.label,
                evidence=l.evidence, rationale=l.rationale,
                granularity=l.granularity
            ) for l in labels]
        )

    return ChatlogResponse(
        id=chatlog_id,
        filename=filename,
        content=content,
        created_at=first["started_at"],
        latest_label_set=latest_label_set_response,
    )


@app.post("/api/label")
def label_chatlog(
    req: GenerateLabelsRequest,
    conn: Connection = Depends(get_ext_conn),
    session: Session = Depends(get_session),
):
    rows = _fetch_conversation_events(conn, req.chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")

    content = _build_content(rows)
    raw_labels = generate_labels(content, req.steering_notes)

    label_set = LabelSet(chatlog_id=req.chatlog_id, steering_notes=req.steering_notes)
    session.add(label_set)
    session.commit()
    session.refresh(label_set)

    labels = []
    for item in raw_labels:
        label = Label(
            label_set_id=label_set.id,
            message_index=item.get("message_index", 0),
            label=item.get("label", ""),
            evidence=item.get("evidence", ""),
            rationale=item.get("rationale", ""),
            granularity=item.get("granularity", "mid"),
        )
        session.add(label)
        labels.append(label)

    session.commit()
    for l in labels:
        session.refresh(l)

    return {
        "label_set_id": label_set.id,
        "labels": [
            {
                "id": l.id,
                "message_index": l.message_index,
                "label": l.label,
                "evidence": l.evidence,
                "rationale": l.rationale,
                "granularity": l.granularity,
            }
            for l in labels
        ]
    }


@app.get("/api/chatlogs/{chatlog_id}/label-sets", response_model=List[LabelSetResponse])
def get_label_sets(
    chatlog_id: int,
    conn: Connection = Depends(get_ext_conn),
    session: Session = Depends(get_session),
):
    rows = _fetch_conversation_events(conn, chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")

    label_sets = session.exec(
        select(LabelSet).where(LabelSet.chatlog_id == chatlog_id).order_by(LabelSet.created_at.desc())
    ).all()

    result = []
    for ls in label_sets:
        labels = session.exec(select(Label).where(Label.label_set_id == ls.id)).all()
        result.append(LabelSetResponse(
            id=ls.id,
            chatlog_id=ls.chatlog_id,
            steering_notes=ls.steering_notes,
            created_at=ls.created_at,
            labels=[LabelResponse(
                id=l.id, label_set_id=l.label_set_id,
                message_index=l.message_index, label=l.label,
                evidence=l.evidence, rationale=l.rationale,
                granularity=l.granularity
            ) for l in labels]
        ))

    return result
