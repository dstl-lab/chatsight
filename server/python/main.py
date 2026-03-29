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


# ── Session routes ────────────────────────────────────────────────────────────

@app.post("/api/session/start", response_model=SessionResponse)
def start_session(db: Session = Depends(get_session)):
    labeling_session = LabelingSession()
    db.add(labeling_session)
    db.commit()
    db.refresh(labeling_session)
    return SessionResponse(
        id=labeling_session.id,
        started_at=labeling_session.started_at,
        last_active=labeling_session.last_active,
        labeled_count=labeling_session.labeled_count,
    )


@app.get("/api/session", response_model=SessionResponse)
def get_session_state(db: Session = Depends(get_session)):
    labeling_session = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()
    if not labeling_session:
        raise HTTPException(status_code=404, detail="No active session")
    return SessionResponse(
        id=labeling_session.id,
        started_at=labeling_session.started_at,
        last_active=labeling_session.last_active,
        labeled_count=labeling_session.labeled_count,
    )


# ── Queue action routes ───────────────────────────────────────────────────────

@app.post("/api/queue/apply")
def apply_label(req: ApplyLabelRequest, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, req.label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    application = LabelApplication(
        label_id=req.label_id,
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
        applied_by="human",
    )
    db.add(application)

    labeling_session = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()
    if labeling_session:
        labeling_session.labeled_count += 1
        labeling_session.last_active = datetime.utcnow()
        db.add(labeling_session)

    db.commit()
    return {"ok": True}


@app.post("/api/queue/skip")
def skip_message(req: SkipMessageRequest, db: Session = Depends(get_session)):
    skipped = SkippedMessage(
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
    )
    db.add(skipped)
    db.commit()
    return {"ok": True}


# ── Queue fetch route ─────────────────────────────────────────────────────────

@app.get("/api/queue", response_model=List[QueueItemResponse])
def get_queue(limit: int = 20, db: Session = Depends(get_session)):
    labeled = {
        (r.chatlog_id, r.message_index)
        for r in db.exec(select(LabelApplication)).all()
    }
    skipped = {
        (r.chatlog_id, r.message_index)
        for r in db.exec(select(SkippedMessage)).all()
    }
    excluded = labeled | skipped

    with ext_engine.connect() as conn:
        rows = conn.execute(text("""
            WITH student AS (
                SELECT id,
                       payload->>'conversation_id' AS conv_id,
                       payload->>'question'        AS message_text,
                       (ROW_NUMBER() OVER (
                           PARTITION BY payload->>'conversation_id'
                           ORDER BY id
                       )) - 1 AS message_index
                FROM events WHERE event_type = 'tutor_query'
            ),
            chatlog_ids AS (
                SELECT payload->>'conversation_id' AS conv_id, MIN(id) AS chatlog_id
                FROM events GROUP BY payload->>'conversation_id'
            )
            SELECT s.message_text, s.message_index, ci.chatlog_id,
                (SELECT e2.payload->>'response' FROM events e2
                 WHERE e2.payload->>'conversation_id' = s.conv_id
                   AND e2.event_type = 'tutor_response' AND e2.id < s.id
                 ORDER BY e2.id DESC LIMIT 1) AS context_before,
                (SELECT e3.payload->>'response' FROM events e3
                 WHERE e3.payload->>'conversation_id' = s.conv_id
                   AND e3.event_type = 'tutor_response' AND e3.id > s.id
                 ORDER BY e3.id ASC LIMIT 1) AS context_after
            FROM student s
            JOIN chatlog_ids ci ON s.conv_id = ci.conv_id
            ORDER BY RANDOM()
        """)).mappings().all()

    queue = [
        QueueItemResponse(
            chatlog_id=r["chatlog_id"],
            message_index=r["message_index"],
            message_text=r["message_text"],
            context_before=r["context_before"],
            context_after=r["context_after"],
        )
        for r in rows
        if (r["chatlog_id"], r["message_index"]) not in excluded
    ][:limit]

    return queue


@app.get("/api/queue/stats")
def get_queue_stats(db: Session = Depends(get_session)):
    labeled_count = db.exec(select(func.count(LabelApplication.id))).one()
    skipped_count = db.exec(select(func.count(SkippedMessage.id))).one()
    with ext_engine.connect() as conn:
        total = conn.execute(
            text("SELECT COUNT(*) FROM events WHERE event_type = 'tutor_query'")
        ).scalar()
    return {
        "total_messages": total,
        "labeled_count": labeled_count,
        "skipped_count": skipped_count,
    }


# ── Stub routes (feature tracks implement these) ──────────────────────────────

@app.post("/api/queue/suggest")
def suggest_label(_req: SuggestRequest):
    return {
        "label_name": "Concept Question",
        "evidence": "explain what a DataFrame is",
        "rationale": "Student asks for a definition of a new concept, not debugging help.",
    }


@app.post("/api/labels/merge")
def merge_labels(_req: MergeLabelRequest):
    return {"ok": True}


@app.post("/api/labels/split")
def split_label(_req: SplitLabelRequest):
    return {"ok": True}


@app.get("/api/analysis/summary")
def get_analysis_summary():
    return {
        "label_counts": {"Concept Question": 22, "Clarification": 18},
        "notebook_breakdown": {"lab01": {"Concept Question": 10}},
        "coverage": {"human_labeled": 40, "ai_labeled": 0, "unlabeled": 260, "total": 300},
    }


@app.get("/api/export/csv")
def export_csv():
    return Response(
        content="chatlog_id,message_index,label,applied_by\n",
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=labels.csv"},
    )


@app.get("/api/session/recalibration")
def get_recalibration():
    return []


@app.get("/api/queue/sample")
def get_sample():
    return {"message": "Sampling strategy not yet implemented"}
