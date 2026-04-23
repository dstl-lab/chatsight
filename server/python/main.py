from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional
import hashlib
from collections import defaultdict
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional
import csv
import os
import io
import logging
import threading
from calendar import monthrange
from fastapi import FastAPI, Depends, HTTPException, Query, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text, update
from sqlalchemy.engine import Connection

from database import create_db_and_tables, get_session, ext_engine, engine
import json as json_mod
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage, MessageCache, ConceptCandidate, SuggestionCache
from schemas import (
    CreateLabelRequest, DeleteLabelResponse, UpdateLabelRequest, ApplyLabelRequest,
    ApplyBatchRequest, SkipMessageRequest, SuggestRequest, ConciseRequest, ConciseResponse,
    MergeLabelRequest, SplitLabelRequest, SplitAutoLabelRequest, ReorderLabelsRequest,
    AdvanceRequest, UndoRequest, LabelExampleResponse, LabelDefinitionResponse,
    QueueItemResponse, SessionResponse, LabelApplicationResponse, ChatlogSummary,
    ChatlogResponse, OrphanedMessagesResponse, OrphanedMessageItem, ArchiveResponse,
    DiscoverConceptsResponse, ConceptCandidateResponse, ResolveCandidateRequest, EmbedStatusResponse,
    RecalibrationResponse,
)
from sqlmodel import Session, select


def populate_message_cache():
    """Populate the local MessageCache from the external PostgreSQL events table."""
    with Session(engine) as db:
        existing = db.exec(select(func.count(MessageCache.id))).one()
        if existing > 0:
            return  # Cache already populated

    try:
        with ext_engine.connect() as conn:
            rows = conn.execute(text("""
                WITH student AS (
                    SELECT id,
                           payload->>'conversation_id' AS conv_id,
                           payload->>'question' AS message_text,
                           (ROW_NUMBER() OVER (
                               PARTITION BY payload->>'conversation_id'
                               ORDER BY id
                           )) - 1 AS message_index
                    FROM events WHERE event_type = 'tutor_query'
                ),
                chatlog_ids AS (
                    SELECT payload->>'conversation_id' AS conv_id, MIN(id) AS chatlog_id
                    FROM events
                    WHERE event_type IN ('tutor_query', 'tutor_response')
                    GROUP BY payload->>'conversation_id'
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
            """)).mappings().all()

        with Session(engine) as db:
            for r in rows:
                db.add(MessageCache(
                    chatlog_id=r["chatlog_id"],
                    message_index=r["message_index"],
                    message_text=r["message_text"],
                    context_before=r["context_before"],
                    context_after=r["context_after"],
                ))
            db.commit()
    except Exception as e:
        print(f"Warning: could not populate message cache: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    populate_message_cache()
    yield


app = FastAPI(lifespan=lifespan)

logger = logging.getLogger(__name__)

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
    rows = (
        conn.execute(
            text("""
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
    """),
            {"chatlog_id": chatlog_id},
        )
        .mappings()
        .all()
    )
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
    rows = (
        conn.execute(
            text("""
        SELECT MIN(id)          AS id,
               MAX(user_email)  AS user_email,
               MAX(payload->>'notebook') AS notebook,
               MIN(created_at)  AS created_at
        FROM events
        WHERE event_type IN ('tutor_query', 'tutor_response')
          AND payload->>'conversation_id' IS NOT NULL
        GROUP BY payload->>'conversation_id'
        ORDER BY MIN(created_at) DESC
    """)
        )
        .mappings()
        .all()
    )

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


@app.get("/api/chatlogs/{chatlog_id}/messages")
def get_chatlog_messages(
    chatlog_id: int,
    conn: Connection = Depends(get_ext_conn),
    db: Session = Depends(get_session),
):
    """Return the full conversation as a structured array with per-message label info."""
    rows = _fetch_conversation_events(conn, chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")

    messages = []
    student_idx = 0
    seen_query = False
    for row in rows:
        if row["event_type"] == "tutor_query" and row["question"]:
            seen_query = True
            apps = db.exec(
                select(LabelApplication, LabelDefinition)
                .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
                .where(
                    LabelApplication.chatlog_id == chatlog_id,
                    LabelApplication.message_index == student_idx,
                    LabelDefinition.archived_at == None,  # noqa: E711
                )
            ).all()
            labels = [{"label_name": ld.name, "applied_by": la.applied_by} for la, ld in apps]
            messages.append({
                "role": "student",
                "text": row["question"],
                "message_index": student_idx,
                "labels": labels,
            })
            student_idx += 1
        elif row["event_type"] == "tutor_response" and row["response"] and seen_query:
            messages.append({
                "role": "assistant",
                "text": row["response"],
                "message_index": None,
                "labels": [],
            })
    return messages


# ── Label routes ──────────────────────────────────────────────────────────────


@app.get("/api/labels", response_model=List[LabelDefinitionResponse])
def get_labels(include_archived: bool = False, db: Session = Depends(get_session)):
    query = select(LabelDefinition).order_by(LabelDefinition.sort_order, LabelDefinition.id)
    if not include_archived:
        query = query.where(LabelDefinition.archived_at == None)  # noqa: E711
    labels = db.exec(query).all()
    result = []
    for label in labels:
        count = db.exec(
            select(func.count(LabelApplication.id)).where(
                LabelApplication.label_id == label.id
            )
        ).one()
        result.append(
            LabelDefinitionResponse(
                id=label.id,
                name=label.name,
                description=label.description,
                created_at=label.created_at,
                count=count,
            )
        )
    return result


@app.put("/api/labels/reorder")
def reorder_labels(req: ReorderLabelsRequest, db: Session = Depends(get_session)):
    for i, label_id in enumerate(req.label_ids):
        label = db.get(LabelDefinition, label_id)
        if not label:
            raise HTTPException(status_code=400, detail=f"Label {label_id} not found")
        label.sort_order = i
        db.add(label)
    db.commit()
    return {"ok": True}


@app.post("/api/labels", response_model=LabelDefinitionResponse)
def create_label(req: CreateLabelRequest, db: Session = Depends(get_session)):
    max_order = db.exec(select(func.max(LabelDefinition.sort_order))).one() or 0
    label = LabelDefinition(name=req.name, description=req.description, sort_order=max_order + 1)
    db.add(label)
    db.commit()
    db.refresh(label)
    return LabelDefinitionResponse(
        id=label.id,
        name=label.name,
        description=label.description,
        created_at=label.created_at,
        count=0,
    )


@app.put("/api/labels/{label_id}", response_model=LabelDefinitionResponse)
def update_label(
    label_id: int, req: UpdateLabelRequest, db: Session = Depends(get_session)
):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if req.name is not None:
        existing = db.exec(
            select(LabelDefinition).where(
                LabelDefinition.name == req.name,
                LabelDefinition.id != label_id,
            )
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="A label with this name already exists")
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


@app.post("/api/labels/{label_id}/generate-description", response_model=LabelDefinitionResponse)
def generate_label_description(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    # Fetch up to 10 most recent human-labeled examples for this label
    applications = db.exec(
        select(LabelApplication)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
        )
        .order_by(LabelApplication.created_at.desc())
        .limit(10)
    ).all()

    # Join with MessageCache to get message text
    example_messages = []
    for app_row in applications:
        cache = db.exec(
            select(MessageCache).where(
                MessageCache.chatlog_id == app_row.chatlog_id,
                MessageCache.message_index == app_row.message_index,
            )
        ).first()
        if cache:
            example_messages.append(cache.message_text)

    if not example_messages:
        raise HTTPException(
            status_code=422,
            detail="No human-labeled examples found — cannot generate a definition.",
        )

    if label.description and not label.description.startswith("AI Generated:"):
        raise HTTPException(
            status_code=409,
            detail="Label already has a manually-written description. Remove it before generating an AI one.",
        )

    from definition_service import generate_label_definition
    raw = generate_label_definition(label.name, example_messages)
    label.description = f"AI Generated: {raw}"
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


@app.get("/api/labels/{label_id}/orphaned-messages", response_model=OrphanedMessagesResponse)
def get_orphaned_messages(label_id: int, db: Session = Depends(get_session)):
    """Messages that have this label as their ONLY active label."""
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    # Get all (chatlog_id, message_index) pairs with this label
    target_pairs = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
    ).all()

    orphaned = []
    for chatlog_id, message_index in target_pairs:
        other_active = db.exec(
            select(func.count(LabelApplication.id))
            .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
            .where(
                LabelApplication.chatlog_id == chatlog_id,
                LabelApplication.message_index == message_index,
                LabelApplication.label_id != label_id,
                LabelDefinition.archived_at == None,  # noqa: E711
            )
        ).one()
        if other_active == 0:
            cached = db.exec(
                select(MessageCache).where(
                    MessageCache.chatlog_id == chatlog_id,
                    MessageCache.message_index == message_index,
                )
            ).first()
            preview = (cached.message_text[:100] + "...") if cached and len(cached.message_text) > 100 else (cached.message_text if cached else "")
            orphaned.append(OrphanedMessageItem(
                chatlog_id=chatlog_id,
                message_index=message_index,
                preview_text=preview,
            ))

    return OrphanedMessagesResponse(messages=orphaned, count=len(orphaned))


@app.put("/api/labels/{label_id}/archive", response_model=ArchiveResponse)
def archive_label(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label.archived_at is not None:
        raise HTTPException(status_code=400, detail="Label already archived")

    target_pairs = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
    ).all()

    orphan_count = 0
    for chatlog_id, message_index in target_pairs:
        other_active = db.exec(
            select(func.count(LabelApplication.id))
            .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
            .where(
                LabelApplication.chatlog_id == chatlog_id,
                LabelApplication.message_index == message_index,
                LabelApplication.label_id != label_id,
                LabelDefinition.archived_at == None,  # noqa: E711
            )
        ).one()
        if other_active == 0:
            orphan_count += 1

    label.archived_at = datetime.utcnow()
    db.add(label)
    db.commit()
    db.refresh(label)

    return ArchiveResponse(
        archived_at=label.archived_at,
        messages_returned_to_queue=orphan_count,
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

    # Idempotent: don't create duplicate
    existing = db.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == req.label_id,
            LabelApplication.chatlog_id == req.chatlog_id,
            LabelApplication.message_index == req.message_index,
        )
    ).first()
    if existing:
        return {"ok": True, "already_applied": True}

    application = LabelApplication(
        label_id=req.label_id,
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
        applied_by="human",
    )
    db.add(application)
    db.commit()
    return {"ok": True}


@app.delete("/api/queue/apply")
def unapply_label(
    chatlog_id: int,
    message_index: int,
    label_id: int,
    db: Session = Depends(get_session),
):
    application = db.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).first()
    if not application:
        raise HTTPException(status_code=404, detail="Label application not found")
    db.delete(application)
    db.commit()
    return {"ok": True}


@app.get("/api/queue/applied")
def get_applied_labels(
    chatlog_id: int, message_index: int, db: Session = Depends(get_session)
):
    rows = db.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).all()
    return {"label_ids": [r.label_id for r in rows]}


@app.post("/api/queue/apply-batch")
def apply_batch(req: ApplyBatchRequest, db: Session = Depends(get_session)):
    for key, label_id in req.assignments.items():
        cid_str, midx_str = key.split(":")
        cid, midx = int(cid_str), int(midx_str)

        # Check for duplicate
        existing = db.exec(
            select(LabelApplication).where(
                LabelApplication.label_id == label_id,
                LabelApplication.chatlog_id == cid,
                LabelApplication.message_index == midx,
            )
        ).first()
        if not existing:
            db.add(
                LabelApplication(
                    label_id=label_id,
                    chatlog_id=cid,
                    message_index=midx,
                    applied_by="human",
                )
            )

    if req.delete_original_label_id:
        original = db.get(LabelDefinition, req.delete_original_label_id)
        if original:
            # Delete apps of original label that weren't reassigned (if any)
            db.exec(
                text("DELETE FROM labelapplication WHERE label_id = :lid"),
                {"lid": req.delete_original_label_id}
            )
            db.delete(original)

    db.commit()
    return {"ok": True}


@app.post("/api/queue/advance")
def advance_message(req: AdvanceRequest, db: Session = Depends(get_session)):
    has_labels = db.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == req.chatlog_id,
            LabelApplication.message_index == req.message_index,
        )
    ).first()

    labeling_session = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()

    counted = False
    if has_labels and labeling_session:
        labeling_session.labeled_count += 1
        labeling_session.last_active = datetime.utcnow()
        db.add(labeling_session)
        counted = True

    db.commit()
    return {"ok": True, "counted": counted}


@app.post("/api/queue/undo")
def undo_labels(req: UndoRequest, db: Session = Depends(get_session)):
    rows = db.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == req.chatlog_id,
            LabelApplication.message_index == req.message_index,
        )
    ).all()
    removed = len(rows)
    for r in rows:
        db.delete(r)

    if removed > 0:
        labeling_session = db.exec(
            select(LabelingSession).order_by(LabelingSession.id.desc())
        ).first()
        if labeling_session and labeling_session.labeled_count > 0:
            labeling_session.labeled_count -= 1
            db.add(labeling_session)

    db.commit()
    return {"ok": True, "removed_count": removed}


@app.get(
    "/api/labels/{label_id}/messages", response_model=List[LabelApplicationResponse]
)
def get_label_messages(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    rows = db.exec(
        select(LabelApplication).where(LabelApplication.label_id == label_id)
    ).all()
    return [
        LabelApplicationResponse(
            id=r.id,
            label_id=r.label_id,
            chatlog_id=r.chatlog_id,
            message_index=r.message_index,
            applied_by=r.applied_by,
            created_at=r.created_at,
        )
        for r in rows
    ]


@app.get(
    "/api/labels/{label_id}/examples", response_model=List[LabelExampleResponse]
)
def get_label_examples(label_id: int, limit: int = 50, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    rows = db.exec(
        select(LabelApplication, MessageCache.message_text)
        .join(
            MessageCache,
            (LabelApplication.chatlog_id == MessageCache.chatlog_id) &
            (LabelApplication.message_index == MessageCache.message_index)
        )
        .where(LabelApplication.label_id == label_id)
        .order_by(func.random())
        .limit(limit)
    ).all()

    return [
        LabelExampleResponse(
            chatlog_id=app_.chatlog_id,
            message_index=app_.message_index,
            message_text=msg_text,
            label_id=app_.label_id,
            applied_by=app_.applied_by
        )
        for app_, msg_text in rows
    ]


@app.post("/api/queue/skip")
def skip_message(req: SkipMessageRequest, db: Session = Depends(get_session)):
    skipped = SkippedMessage(
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
    )
    db.add(skipped)
    db.commit()
    return {"ok": True}


@app.delete("/api/queue/skip")
def unskip_message(chatlog_id: int, message_index: int, db: Session = Depends(get_session)):
    row = db.exec(
        select(SkippedMessage).where(
            SkippedMessage.chatlog_id == chatlog_id,
            SkippedMessage.message_index == message_index,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/api/queue/skipped", response_model=List[QueueItemResponse])
def get_skipped_queue(db: Session = Depends(get_session)):
    skipped_rows = db.exec(
        select(SkippedMessage).order_by(SkippedMessage.created_at.asc())
    ).all()
    results = []
    for row in skipped_rows:
        cache = db.exec(
            select(MessageCache).where(
                MessageCache.chatlog_id == row.chatlog_id,
                MessageCache.message_index == row.message_index,
            )
        ).first()
        if not cache:
            continue
        results.append(QueueItemResponse(
            chatlog_id=cache.chatlog_id,
            message_index=cache.message_index,
            message_text=cache.message_text,
            context_before=cache.context_before,
            context_after=cache.context_after,
        ))
    return results


# ── Queue fetch route ─────────────────────────────────────────────────────────

@app.get("/api/queue", response_model=List[QueueItemResponse])
def get_queue(limit: int = 20, seed: Optional[int] = None, db: Session = Depends(get_session)):
    # Only count applications of active (non-archived) labels
    labeled_pairs = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
        .where(LabelDefinition.archived_at == None)  # noqa: E711
        .distinct()
    ).all()
    skipped_pairs = db.exec(
        select(SkippedMessage.chatlog_id, SkippedMessage.message_index)
    ).all()
    excluded = {(cid, midx) for cid, midx in labeled_pairs} | {(cid, midx) for cid, midx in skipped_pairs}

    # Query from cache instead of external DB CTE
    all_cached = db.exec(select(MessageCache)).all()

    candidates = [
        c for c in all_cached
        if (c.chatlog_id, c.message_index) not in excluded
    ]

    # Apply seed-based deterministic ordering or random shuffle
    if seed is not None:
        import hashlib
        candidates.sort(key=lambda c: hashlib.md5(f"{c.id}{seed}".encode()).hexdigest())
    else:
        import random
        random.shuffle(candidates)

    queue = [
        QueueItemResponse(
            chatlog_id=c.chatlog_id,
            message_index=c.message_index,
            message_text=c.message_text,
            context_before=c.context_before,
            context_after=c.context_after,
        )
        for c in candidates[:limit]
    ]

    return queue


@app.get("/api/queue/stats")
def get_queue_stats(db: Session = Depends(get_session)):
    labeled_count = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
            .where(LabelDefinition.archived_at == None)  # noqa: E711
            .distinct()
            .subquery()
        )
    ).one()
    skipped_count = db.exec(select(func.count(SkippedMessage.id))).one()
    total = db.exec(select(func.count(MessageCache.id))).one() or 0
    return {
        "total_messages": total,
        "labeled_count": labeled_count,
        "skipped_count": skipped_count,
    }


@app.get("/api/queue/position")
def get_queue_position(db: Session = Depends(get_session)):
    labeled_count = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
            .where(LabelDefinition.archived_at == None)  # noqa: E711
            .distinct()
            .subquery()
        )
    ).one()
    skipped_count = db.exec(select(func.count(SkippedMessage.id))).one()
    total = db.exec(select(func.count(MessageCache.id))).one() or 0
    total_remaining = max(0, total - labeled_count - skipped_count)
    position = labeled_count + skipped_count + 1
    return {"position": position, "total_remaining": total_remaining}


@app.get("/api/queue/message")
def get_queue_message(chatlog_id: int, message_index: int, db: Session = Depends(get_session)):
    cached = db.exec(
        select(MessageCache).where(
            MessageCache.chatlog_id == chatlog_id,
            MessageCache.message_index == message_index,
        )
    ).first()

    if not cached:
        raise HTTPException(status_code=404, detail="Message not found")

    return {
        "chatlog_id": cached.chatlog_id,
        "message_index": cached.message_index,
        "message_text": cached.message_text,
        "context_before": cached.context_before,
        "context_after": cached.context_after,
    }


@app.get("/api/queue/history")
def get_queue_history(
    limit: int = 20,
    offset: int = 0,
    filter: Optional[str] = None,
    sort_by: str = "processed_at",
    search: Optional[str] = None,
    db: Session = Depends(get_session),
):
    # Gather labeled message keys with applied_by and confidence
    labeled_rows = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            func.max(LabelApplication.created_at).label("processed_at"),
            func.min(LabelApplication.applied_by).label("applied_by"),
            func.min(LabelApplication.confidence).label("confidence"),
        )
        .group_by(LabelApplication.chatlog_id, LabelApplication.message_index)
    ).all()
    labeled_entries = [
        {
            "chatlog_id": cid, "message_index": midx, "processed_at": ts,
            "status": "labeled", "applied_by": ab, "confidence": conf,
        }
        for cid, midx, ts, ab, conf in labeled_rows
    ]

    # Gather skipped message keys
    skipped_rows = db.exec(
        select(SkippedMessage.chatlog_id, SkippedMessage.message_index, SkippedMessage.created_at)
    ).all()
    skipped_entries = [
        {
            "chatlog_id": cid, "message_index": midx, "processed_at": ts,
            "status": "skipped", "applied_by": None, "confidence": None,
        }
        for cid, midx, ts in skipped_rows
    ]

    # Merge
    all_entries = labeled_entries + skipped_entries

    # Apply filter
    if filter == "human":
        all_entries = [e for e in all_entries if e["applied_by"] == "human"]
    elif filter == "ai":
        all_entries = [e for e in all_entries if e["applied_by"] == "ai"]
    elif filter == "skipped":
        all_entries = [e for e in all_entries if e["status"] == "skipped"]

    # Sort
    if sort_by == "confidence":
        all_entries.sort(key=lambda e: e["confidence"] if e["confidence"] is not None else 999)
    else:
        all_entries.sort(key=lambda e: e["processed_at"] if e["processed_at"] else "", reverse=True)

    total = len(all_entries)
    page = all_entries[offset:offset + limit]

    if not page:
        return {"items": [], "total": total}

    # Batch fetch message text from cache (one query for all page items)
    page_keys = [(e["chatlog_id"], e["message_index"]) for e in page]
    page_key_set = set(page_keys)
    cached_msgs = db.exec(select(MessageCache)).all()
    cache_lookup = {(c.chatlog_id, c.message_index): c for c in cached_msgs}

    # Batch fetch all labels for labeled items on this page (one query)
    labeled_keys = [(e["chatlog_id"], e["message_index"]) for e in page if e["status"] == "labeled"]
    labels_by_msg: dict[tuple[int, int], list[str]] = {}
    if labeled_keys:
        label_rows = db.exec(
            select(
                LabelApplication.chatlog_id,
                LabelApplication.message_index,
                LabelDefinition.name,
            )
            .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
            .where(LabelDefinition.archived_at == None)  # noqa: E711
        ).all()
        for cid, midx, name in label_rows:
            key = (cid, midx)
            if key in page_key_set:
                labels_by_msg.setdefault(key, []).append(name)

    result = []
    for entry in page:
        chatlog_id = entry["chatlog_id"]
        message_index = entry["message_index"]
        key = (chatlog_id, message_index)
        cached = cache_lookup.get(key)

        message_text = cached.message_text if cached else ""
        context_before = cached.context_before if cached else None
        context_after = cached.context_after if cached else None

        # Apply search filter
        if search and search.lower() not in message_text.lower():
            continue

        processed_at = entry["processed_at"]
        result.append({
            "chatlog_id": chatlog_id,
            "message_index": message_index,
            "message_text": message_text,
            "context_before": context_before,
            "context_after": context_after,
            "labels": labels_by_msg.get(key, []),
            "status": entry["status"],
            "applied_by": entry["applied_by"],
            "confidence": entry["confidence"],
            "processed_at": processed_at.isoformat() if processed_at else "",
        })

    return {"items": result, "total": total}


# ── Auto-labeling ────────────────────────────────────────────────────────────

_autolabel_status = {"running": False, "processed": 0, "total": 0, "error": None}


def _run_split_autolabel(
    original_label_name: str,
    new_label_a_id: int,
    new_label_a_name: str,
    new_label_b_id: int,
    new_label_b_name: str,
    human_examples: List[Dict[str, Any]],  # [{text, label_name}]
    remaining_messages: List[Dict[str, Any]],  # [{chatlog_id, message_index, message_text}]
):
    """Background task: split remaining messages between two new labels using Gemini."""
    from autolabel_service import classify_batch

    global _autolabel_status
    _autolabel_status = {
        "running": True,
        "processed": 0,
        "total": len(remaining_messages),
        "error": None,
    }

    label_defs = [
        {"name": new_label_a_name, "description": f"Sub-category of {original_label_name}"},
        {"name": new_label_b_name, "description": f"Sub-category of {original_label_name}"},
    ]

    examples_by_label = {
        new_label_a_name: [ex["text"] for ex in human_examples if ex["label_name"] == new_label_a_name],
        new_label_b_name: [ex["text"] for ex in human_examples if ex["label_name"] == new_label_b_name],
    }

    label_map = {new_label_a_name: new_label_a_id, new_label_b_name: new_label_b_id}

    BATCH_SIZE = 30
    for i in range(0, len(remaining_messages), BATCH_SIZE):
        batch = remaining_messages[i : i + BATCH_SIZE]
        try:
            # We don't have context_before for these right now, could be added later
            results = classify_batch(label_defs, examples_by_label, batch)
        except Exception as e:
            _autolabel_status["error"] = f"Gemini error at batch {i}: {str(e)}"
            continue

        with Session(engine) as db:
            for r in results:
                idx = r.get("index")
                label_name = r.get("label")
                if idx is None or idx >= len(batch) or label_name not in label_map:
                    continue
                msg = batch[idx]
                db.add(
                    LabelApplication(
                        label_id=label_map[label_name],
                        chatlog_id=msg["chatlog_id"],
                        message_index=msg["message_index"],
                        applied_by="ai",
                    )
                )
            db.commit()

        _autolabel_status["processed"] = min(i + BATCH_SIZE, len(remaining_messages))

    _autolabel_status["running"] = False


def _run_autolabel():
    """Background task: classify all unlabeled messages using Gemini."""
    from autolabel_service import classify_batch

    global _autolabel_status
    _autolabel_status = {"running": True, "processed": 0, "total": 0, "error": None}

    try:
        with Session(engine) as db:
            # Get label definitions
            labels = db.exec(select(LabelDefinition)).all()
            if not labels:
                _autolabel_status = {
                    "running": False,
                    "processed": 0,
                    "total": 0,
                    "error": "No labels defined",
                }
                return

            label_map = {l.name: l.id for l in labels}
            label_defs = [
                {"name": l.name, "description": l.description} for l in labels
            ]

            # Get human-labeled examples for each label
            examples_by_label: dict[str, list[str]] = {}
            for label in labels:
                apps = db.exec(
                    select(LabelApplication).where(
                        LabelApplication.label_id == label.id,
                        LabelApplication.applied_by == "human",
                    )
                ).all()
                # We need message text — fetch from external DB
                if apps:
                    pairs = [(a.chatlog_id, a.message_index) for a in apps[:10]]
                    with ext_engine.connect() as conn:
                        for cid, midx in pairs:
                            row = conn.execute(
                                text("""
                                WITH student AS (
                                    SELECT payload->>'question' AS msg,
                                           (ROW_NUMBER() OVER (
                                               PARTITION BY payload->>'conversation_id' ORDER BY id
                                           )) - 1 AS idx
                                    FROM events
                                    WHERE event_type = 'tutor_query'
                                      AND payload->>'conversation_id' = (
                                          SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                                      )
                                )
                                SELECT msg FROM student WHERE idx = :midx
                            """),
                                {"cid": cid, "midx": midx},
                            ).first()
                            if row and row[0]:
                                examples_by_label.setdefault(label.name, []).append(
                                    row[0]
                                )

            # Get unlabeled messages
            labeled_set = {
                (r.chatlog_id, r.message_index)
                for r in db.exec(select(LabelApplication)).all()
            }
            skipped_set = {
                (r.chatlog_id, r.message_index)
                for r in db.exec(select(SkippedMessage)).all()
            }
            excluded = labeled_set | skipped_set

        # Fetch all student messages from external DB
        with ext_engine.connect() as conn:
            rows = (
                conn.execute(
                    text("""
                WITH student AS (
                    SELECT id,
                           payload->>'conversation_id' AS conv_id,
                           payload->>'question' AS message_text,
                           (ROW_NUMBER() OVER (
                               PARTITION BY payload->>'conversation_id' ORDER BY id
                           )) - 1 AS message_index
                    FROM events WHERE event_type = 'tutor_query'
                ),
                chatlog_ids AS (
                    SELECT payload->>'conversation_id' AS conv_id, MIN(id) AS chatlog_id
                    FROM events
                    WHERE event_type IN ('tutor_query', 'tutor_response')
                    GROUP BY payload->>'conversation_id'
                )
                SELECT s.message_text, s.message_index, ci.chatlog_id,
                    (SELECT e2.payload->>'response' FROM events e2
                     WHERE e2.payload->>'conversation_id' = s.conv_id
                       AND e2.event_type = 'tutor_response' AND e2.id < s.id
                     ORDER BY e2.id DESC LIMIT 1) AS context_before
                FROM student s
                JOIN chatlog_ids ci ON s.conv_id = ci.conv_id
            """)
                )
                .mappings()
                .all()
            )

        unlabeled = [
            dict(r)
            for r in rows
            if (r["chatlog_id"], r["message_index"]) not in excluded
        ]
        _autolabel_status["total"] = len(unlabeled)

        # Process in batches of 30
        BATCH_SIZE = 30
        for i in range(0, len(unlabeled), BATCH_SIZE):
            batch = unlabeled[i : i + BATCH_SIZE]
            try:
                results = classify_batch(label_defs, examples_by_label, batch)
            except Exception as e:
                _autolabel_status["error"] = f"Gemini error at batch {i}: {str(e)}"
                continue

            with Session(engine) as db:
                for r in results:
                    idx = r.get("index")
                    label_name = r.get("label")
                    if idx is None or idx >= len(batch) or label_name not in label_map:
                        continue
                    msg = batch[idx]
                    # Check for duplicate
                    existing = db.exec(
                        select(LabelApplication).where(
                            LabelApplication.label_id == label_map[label_name],
                            LabelApplication.chatlog_id == msg["chatlog_id"],
                            LabelApplication.message_index == msg["message_index"],
                        )
                    ).first()
                    if not existing:
                        conf = r.get("confidence")
                        if isinstance(conf, (int, float)):
                            conf = max(0.0, min(1.0, float(conf)))
                        else:
                            conf = None
                        db.add(LabelApplication(
                            label_id=label_map[label_name],
                            chatlog_id=msg["chatlog_id"],
                            message_index=msg["message_index"],
                            applied_by="ai",
                            confidence=conf,
                        ))
                db.commit()

            _autolabel_status["processed"] = min(i + BATCH_SIZE, len(unlabeled))

        _autolabel_status["running"] = False

    except Exception as e:
        _autolabel_status = {
            "running": False,
            "processed": _autolabel_status["processed"],
            "total": _autolabel_status["total"],
            "error": str(e),
        }


@app.post("/api/queue/autolabel")
def start_autolabel(db: Session = Depends(get_session)):
    if _autolabel_status["running"]:
        raise HTTPException(status_code=409, detail="Auto-labeling already in progress")
    thread = threading.Thread(target=_run_autolabel, daemon=True)
    thread.start()
    return {"ok": True, "message": "Auto-labeling started"}


@app.get("/api/queue/autolabel/status")
def get_autolabel_status():
    return _autolabel_status


# ── Stub routes (feature tracks implement these) ──────────────────────────────


@app.post("/api/queue/suggest")
def suggest_label(req: SuggestRequest, db: Session = Depends(get_session)):
    labels = db.exec(
        select(LabelDefinition).where(LabelDefinition.archived_at == None)  # noqa: E711
    ).all()
    if not labels:
        return {"label_name": "", "evidence": "", "rationale": "No labels defined yet."}

    counts = dict(db.exec(
        select(LabelApplication.label_id, func.count(LabelApplication.id))
        .where(LabelApplication.applied_by == "human")
        .group_by(LabelApplication.label_id)
    ).all())

    cache_key_input = "|".join(
        f"{l.name}:{counts.get(l.id, 0)}" for l in sorted(labels, key=lambda x: x.id)
    )
    labels_hash = hashlib.md5(cache_key_input.encode()).hexdigest()

    # Check cache
    cached = db.exec(
        select(SuggestionCache).where(
            SuggestionCache.chatlog_id == req.chatlog_id,
            SuggestionCache.message_index == req.message_index,
            SuggestionCache.labels_hash == labels_hash,
        )
    ).first()
    if cached:
        return {"label_name": cached.label_name, "evidence": cached.evidence, "rationale": cached.rationale}

    # Build examples for each label
    examples_by_label: dict[str, list[str]] = {}
    for label in labels:
        apps = db.exec(
            select(LabelApplication)
            .where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "human",
            )
            .limit(5)
        ).all()
        if apps:
            with ext_engine.connect() as conn:
                for a in apps:
                    row = conn.execute(
                        text("""
                        WITH student AS (
                            SELECT payload->>'question' AS msg,
                                    (ROW_NUMBER() OVER (
                                        PARTITION BY payload->>'conversation_id' ORDER BY id
                                    )) - 1 AS idx
                            FROM events
                            WHERE event_type = 'tutor_query'
                                AND payload->>'conversation_id' = (
                                    SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                                )
                        )
                        SELECT msg FROM student WHERE idx = :midx
                    """),
                        {"cid": a.chatlog_id, "midx": a.message_index},
                    ).first()
                    if row and row[0]:
                        examples_by_label.setdefault(label.name, []).append(
                            row[0][:200]
                        )

    # Get the message text to classify
    with ext_engine.connect() as conn:
        row = conn.execute(
            text("""
            WITH student AS (
                SELECT payload->>'question' AS msg,
                        (ROW_NUMBER() OVER (
                            PARTITION BY payload->>'conversation_id' ORDER BY id
                        )) - 1 AS idx
                FROM events
                WHERE event_type = 'tutor_query'
                    AND payload->>'conversation_id' = (
                        SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                    )
            )
            SELECT msg FROM student WHERE idx = :midx
        """),
            {"cid": req.chatlog_id, "midx": req.message_index},
        ).first()

    if not row or not row[0]:
        return {
            "label_name": "",
            "evidence": "",
            "rationale": "Could not find message.",
        }

    message_text = row[0]

    def _cache_and_return(result: dict) -> dict:
        db.add(SuggestionCache(
            chatlog_id=req.chatlog_id,
            message_index=req.message_index,
            label_name=result["label_name"],
            evidence=result["evidence"],
            rationale=result["rationale"],
            labels_hash=labels_hash,
        ))
        db.commit()
        return result

    # Call Gemini for suggestion
    try:
        from autolabel_service import classify_batch

        label_defs = [{"name": l.name, "description": l.description} for l in labels]
        messages = [{"message_text": message_text, "context_before": None}]
        results = classify_batch(label_defs, examples_by_label, messages)
        if results:
            label_name = results[0].get("label", "")
            return _cache_and_return({
                "label_name": label_name,
                "evidence": message_text[:100],
                "rationale": f"AI classified this as '{label_name}' based on {len(examples_by_label.get(label_name, []))} human-labeled examples.",
            })
    except Exception:
        pass

    return _cache_and_return({
        "label_name": labels[0].name,
        "evidence": message_text[:100],
        "rationale": "Fallback suggestion.",
    })


@app.post("/api/queue/concise", response_model=ConciseResponse)
def get_concise_message(req: ConciseRequest, db: Session = Depends(get_session)):
    with ext_engine.connect() as conn:
        row = conn.execute(
            text("""
            WITH student AS (
                SELECT payload->>'question' AS msg,
                       (ROW_NUMBER() OVER (
                           PARTITION BY payload->>'conversation_id' ORDER BY id
                       )) - 1 AS idx
                FROM events
                WHERE event_type = 'tutor_query'
                  AND payload->>'conversation_id' = (
                      SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                  )
            )
            SELECT msg FROM student WHERE idx = :midx
        """),
            {"cid": req.chatlog_id, "midx": req.message_index},
        ).first()

    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="Message not found")

    from autolabel_service import summarize_message
    concise = summarize_message(row[0])
    return {"concise_text": concise}


@app.post("/api/labels/merge")
def merge_labels(req: MergeLabelRequest, db: Session = Depends(get_session)):
    source_label = db.get(LabelDefinition, req.source_label_id)
    target_label = db.get(LabelDefinition, req.target_label_id)

    if not source_label:
        raise HTTPException(status_code=404, detail="Source label not found")
    if not target_label:
        raise HTTPException(status_code=404, detail="Target label not found")

    db.exec(
        update(LabelApplication)
        .where(LabelApplication.label_id == req.source_label_id)
        .values(label_id=req.target_label_id)
    )

    # Delete source
    db.delete(source_label)
    db.commit()
    db.refresh(target_label)

    count = db.exec(
        select(func.count(LabelApplication.id)).where(
            LabelApplication.label_id == target_label.id
        )
    ).one()

    return LabelDefinitionResponse(
        id=target_label.id,
        name=target_label.name,
        description=target_label.description,
        created_at=target_label.created_at,
        count=count,
    )


@app.post("/api/labels/split-autolabel", response_model=List[LabelDefinitionResponse])
def split_label_autolabel(
    req: SplitAutoLabelRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
):
    original_label = db.get(LabelDefinition, req.label_id)
    if not original_label:
        raise HTTPException(status_code=404, detail="Label not found")

    # Check for existing labels or create new ones
    def get_or_create_label(name: str):
        existing = db.exec(select(LabelDefinition).where(LabelDefinition.name == name)).first()
        if existing:
            return existing
        new_lbl = LabelDefinition(name=name, description=f"Sub-category of {original_label.name}")
        db.add(new_lbl)
        db.commit()
        db.refresh(new_lbl)
        return new_lbl

    label_a = get_or_create_label(req.name_a)
    label_b = get_or_create_label(req.name_b)

    # Convert assignments (which are human-labeled)
    # req.assignments is { "cid:midx": "name_a" | "name_b" | "some_other_label" }
    human_examples = []
    processed_keys = set()
    with ext_engine.connect() as conn:
        for key, target_name in req.assignments.items():
            cid_str, midx_str = key.split(":")
            cid, midx = int(cid_str), int(midx_str)
            
            # Find the actual label ID for the assigned name
            target_label = db.exec(select(LabelDefinition).where(LabelDefinition.name == target_name)).first()
            if not target_label:
                # If it doesn't exist (e.g. user typed something new in the UI), create it
                target_label = LabelDefinition(name=target_name)
                db.add(target_label)
                db.commit()
                db.refresh(target_label)
            
            target_id = target_label.id

            # Save human application
            db.add(
                LabelApplication(
                    label_id=target_id,
                    chatlog_id=cid,
                    message_index=midx,
                    applied_by="human",
                )
            )
            processed_keys.add((cid, midx))

            # Fetch text for example - ONLY if it's one of the two split labels
            # We only use these to "train" the AI for the remaining split
            if target_name in [req.name_a, req.name_b]:
                row = conn.execute(
                    text("""
                    WITH student AS (
                        SELECT payload->>'question' AS msg,
                               (ROW_NUMBER() OVER (
                                   PARTITION BY payload->>'conversation_id' ORDER BY id
                               )) - 1 AS idx
                        FROM events
                        WHERE event_type = 'tutor_query'
                          AND payload->>'conversation_id' = (
                              SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                          )
                    )
                    SELECT msg FROM student WHERE idx = :midx
                    """),
                    {"cid": cid, "midx": midx},
                ).first()
                if row and row[0]:
                    human_examples.append({"text": row[0], "label_name": target_name})

    # Find remaining messages of original label
    remaining_apps = db.exec(
        select(LabelApplication).where(LabelApplication.label_id == req.label_id)
    ).all()
    remaining_messages = []
    with ext_engine.connect() as conn:
        for app_ in remaining_apps:
            if (app_.chatlog_id, app_.message_index) in processed_keys:
                continue

            # Fetch text for AI classification
            row = conn.execute(
                text("""
                WITH student AS (
                    SELECT payload->>'question' AS msg,
                           (ROW_NUMBER() OVER (
                               PARTITION BY payload->>'conversation_id' ORDER BY id
                           )) - 1 AS idx
                    FROM events
                    WHERE event_type = 'tutor_query'
                      AND payload->>'conversation_id' = (
                          SELECT payload->>'conversation_id' FROM events WHERE id = :cid LIMIT 1
                      )
                )
                SELECT msg FROM student WHERE idx = :midx
                """),
                {"cid": app_.chatlog_id, "midx": app_.message_index},
            ).first()
            if row and row[0]:
                remaining_messages.append(
                    {
                        "chatlog_id": app_.chatlog_id,
                        "message_index": app_.message_index,
                        "message_text": row[0],
                    }
                )

    # Delete original label and its applications
    for app_ in remaining_apps:
        db.delete(app_)
    
    # Only delete original if it's not one of the target labels (edge case)
    if original_label.id not in [label_a.id, label_b.id]:
        db.delete(original_label)
    
    db.commit()

    # Start background task
    background_tasks.add_task(
        _run_split_autolabel,
        original_label.name,
        label_a.id,
        label_a.name,
        label_b.id,
        label_b.name,
        human_examples,
        remaining_messages,
    )

    return [
        LabelDefinitionResponse(
            id=label_a.id,
            name=label_a.name,
            description=label_a.description,
            created_at=label_a.created_at,
            count=db.exec(select(func.count(LabelApplication.id)).where(LabelApplication.label_id == label_a.id)).one(),
        ),
        LabelDefinitionResponse(
            id=label_b.id,
            name=label_b.name,
            description=label_b.description,
            created_at=label_b.created_at,
            count=db.exec(select(func.count(LabelApplication.id)).where(LabelApplication.label_id == label_b.id)).one(),
        ),
    ]


@app.post("/api/labels/split", response_model=List[LabelDefinitionResponse])
def split_label(req: SplitLabelRequest, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, req.label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    label_a = LabelDefinition(name=req.name_a, description=label.description)
    label_b = LabelDefinition(name=req.name_b, description=label.description)
    db.add(label_a)
    db.add(label_b)

    apps = db.exec(
        select(LabelApplication).where(LabelApplication.label_id == req.label_id)
    ).all()
    for app_ in apps:
        db.delete(app_)

    db.delete(label)
    db.commit()
    db.refresh(label_a)
    db.refresh(label_b)

    return [
        LabelDefinitionResponse(
            id=label_a.id,
            name=label_a.name,
            description=label_a.description,
            created_at=label_a.created_at,
            count=0,
        ),
        LabelDefinitionResponse(
            id=label_b.id,
            name=label_b.name,
            description=label_b.description,
            created_at=label_b.created_at,
            count=0,
        ),
    ]


@app.delete("/api/labels/{label_id}")
def delete_label(
    label_id: int, force: bool = False, db: Session = Depends(get_session)
):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")

    apps = db.exec(
        select(LabelApplication).where(LabelApplication.label_id == label_id)
    ).all()
    if apps and not force:
        raise HTTPException(
            status_code=400, detail="Label has applications, use force=true to delete"
        )
    db.delete(label)
    db.commit()
    return DeleteLabelResponse(ok=True, deleted_applications=len(apps))


# ── Concept Induction ──────────────────────────────────────────────

_discover_status: dict = {"running": False, "run_id": None, "error": None}


def _run_discover():
    """Background task: embed, cluster, and discover concepts."""
    import uuid
    from concept_service import discover_concepts
    from database import engine as local_engine
    global _discover_status

    run_id = str(uuid.uuid4())[:8]
    _discover_status = {"running": True, "run_id": run_id, "error": None}

    try:
        with Session(local_engine) as db:
            # Get labeled (chatlog_id, message_index) pairs
            labeled_keys = set()
            for la in db.exec(select(LabelApplication)).all():
                labeled_keys.add((la.chatlog_id, la.message_index))

            # Get all messages from cache that are unlabeled
            all_messages = []
            for mc in db.exec(select(MessageCache)).all():
                key = (mc.chatlog_id, mc.message_index)
                if key not in labeled_keys:
                    all_messages.append({
                        "chatlog_id": mc.chatlog_id,
                        "message_index": mc.message_index,
                        "message_text": mc.message_text,
                    })

            if not all_messages:
                _discover_status = {"running": False, "run_id": run_id, "error": "No unlabeled messages found"}
                return

            discover_concepts(all_messages, db)
            _discover_status = {"running": False, "run_id": run_id, "error": None}

    except Exception as e:
        _discover_status = {"running": False, "run_id": _discover_status.get("run_id"), "error": str(e)}


@app.post("/api/concepts/discover", response_model=DiscoverConceptsResponse)
def start_discover():
    if _discover_status["running"]:
        raise HTTPException(status_code=409, detail="Concept discovery already in progress")
    thread = threading.Thread(target=_run_discover, daemon=True)
    thread.start()
    return DiscoverConceptsResponse(run_id=_discover_status.get("run_id") or "starting", status="running")


@app.get("/api/concepts/candidates", response_model=List[ConceptCandidateResponse])
def get_candidates(db: Session = Depends(get_session)):
    rows = db.exec(
        select(ConceptCandidate).where(ConceptCandidate.status == "pending").order_by(ConceptCandidate.created_at)
    ).all()
    return [
        ConceptCandidateResponse(
            id=r.id,
            name=r.name,
            description=r.description,
            example_messages=json_mod.loads(r.example_messages),
            status=r.status,
            source_run_id=r.source_run_id,
            similar_to=r.similar_to,
            created_at=r.created_at,
        )
        for r in rows
    ]


@app.put("/api/concepts/candidates/{candidate_id}")
def resolve_candidate(candidate_id: int, req: ResolveCandidateRequest, db: Session = Depends(get_session)):
    candidate = db.get(ConceptCandidate, candidate_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if req.action == "accept":
        label_name = req.name if req.name else candidate.name
        # Check for duplicate label name
        existing = db.exec(
            select(LabelDefinition).where(LabelDefinition.name == label_name)
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Label '{label_name}' already exists")

        max_order = db.exec(select(func.max(LabelDefinition.sort_order))).one() or 0
        label = LabelDefinition(
            name=label_name,
            description=candidate.description,
            sort_order=max_order + 1,
        )
        db.add(label)
        candidate.status = "accepted"
        db.add(candidate)
        db.commit()
        db.refresh(label)

        count = db.exec(
            select(func.count(LabelApplication.id)).where(LabelApplication.label_id == label.id)
        ).one()
        return LabelDefinitionResponse(
            id=label.id, name=label.name, description=label.description,
            created_at=label.created_at, count=count,
        )

    elif req.action == "reject":
        candidate.status = "rejected"
        db.add(candidate)
        db.commit()
        return {"ok": True}

    else:
        raise HTTPException(status_code=400, detail="action must be 'accept' or 'reject'")


@app.get("/api/concepts/embed-status")
def get_embed_status(db: Session = Depends(get_session)):
    from models import MessageEmbedding
    cached = db.exec(select(func.count(MessageEmbedding.id))).one()

    labeled_keys = set()
    for la in db.exec(select(LabelApplication)).all():
        labeled_keys.add((la.chatlog_id, la.message_index))
    total_cached = db.exec(select(func.count(MessageCache.id))).one()
    total_unlabeled = total_cached - len(labeled_keys)

    return {
        "cached": cached,
        "total_unlabeled": max(total_unlabeled, 0),
        "running": _discover_status["running"],
        "error": _discover_status.get("error"),
    }



@app.get("/api/analysis/summary")
def get_analysis_summary(db: Session = Depends(get_session)):
    label_rows = db.exec(
        select(LabelDefinition.name, func.count(LabelApplication.id))
        .select_from(LabelApplication)
        .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
        .group_by(LabelDefinition.name)
    ).all()
    label_counts = {name: int(cnt) for name, cnt in label_rows}

    human_rows = db.exec(
        select(LabelDefinition.name, func.count(LabelApplication.id))
        .select_from(LabelApplication)
        .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
        .where(LabelApplication.applied_by == "human")
        .group_by(LabelDefinition.name)
    ).all()
    human_label_counts = {name: int(cnt) for name, cnt in human_rows}

    ai_rows = db.exec(
        select(LabelDefinition.name, func.count(LabelApplication.id))
        .select_from(LabelApplication)
        .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
        .where(LabelApplication.applied_by == "ai")
        .group_by(LabelDefinition.name)
    ).all()
    ai_label_counts = {name: int(cnt) for name, cnt in ai_rows}

    pos_rows = db.exec(
        select(LabelApplication.message_index, LabelDefinition.name)
        .select_from(LabelApplication)
        .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
    ).all()
    pos_acc: dict[str, dict[str, int]] = defaultdict(lambda: {"early": 0, "mid": 0, "late": 0})
    for msg_idx, lbl_name in pos_rows:
        if msg_idx <= 2:
            pos_acc[lbl_name]["early"] += 1
        elif msg_idx <= 6:
            pos_acc[lbl_name]["mid"] += 1
        else:
            pos_acc[lbl_name]["late"] += 1
    position_distribution = {k: dict(v) for k, v in pos_acc.items()}

    human_pairs = set()
    ai_pairs = set()
    for row in db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index, LabelApplication.applied_by)
    ).all():
        cid, mid, applied_by = row
        if applied_by == "human":
            human_pairs.add((cid, mid))
        elif applied_by == "ai":
            ai_pairs.add((cid, mid))
    human_labeled = len(human_pairs)
    ai_labeled = len(ai_pairs)
    labeled_any = len(human_pairs | ai_pairs)

    notebook_breakdown: dict = {}
    total = 0
    try:
        with ext_engine.connect() as conn:
            total = int(
                conn.execute(text("SELECT COUNT(*) FROM events WHERE event_type = 'tutor_query'")).scalar_one()
            )
            nb_rows = conn.execute(
                text("""
                    SELECT MIN(id) AS chatlog_id, MAX(payload->>'notebook') AS notebook
                    FROM events
                    WHERE event_type IN ('tutor_query', 'tutor_response')
                      AND payload->>'conversation_id' IS NOT NULL
                    GROUP BY payload->>'conversation_id'
                """)
            ).mappings().all()
            chatlog_notebook = {}
            for r in nb_rows:
                cid = int(r["chatlog_id"])
                nb = r["notebook"] if r["notebook"] else "unknown"
                chatlog_notebook[cid] = nb

            nb_counts: dict = defaultdict(lambda: defaultdict(int))
            for lbl_name, chatlog_id in db.exec(
                select(LabelDefinition.name, LabelApplication.chatlog_id)
                .select_from(LabelApplication)
                .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
            ).all():
                nb_key = chatlog_notebook.get(int(chatlog_id), "unknown")
                nb_counts[nb_key][lbl_name] += 1
            notebook_breakdown = {k: dict(v) for k, v in nb_counts.items()}
    except Exception:
        total = 0
        notebook_breakdown = {}

    unlabeled = max(0, total - labeled_any)

    return {
        "label_counts": label_counts,
        "human_label_counts": human_label_counts,
        "ai_label_counts": ai_label_counts,
        "notebook_breakdown": notebook_breakdown,
        "coverage": {
            "human_labeled": human_labeled,
            "ai_labeled": ai_labeled,
            "unlabeled": unlabeled,
            "total": total,
        },
        "position_distribution": position_distribution,
    }


def _normalize_heatmap_rows(raw: list[list[float]]) -> list[list[float]]:
    out = []
    for row in raw:
        s = sum(row)
        out.append([float(x) / s if s > 0 else 0.0 for x in row])
    return out


def _normalize_heatmap_columns(raw: list[list[float]]) -> list[list[float]]:
    if not raw:
        return []
    rows_n = len(raw)
    cols_n = len(raw[0])
    col_sums = [sum(raw[r][c] for r in range(rows_n)) for c in range(cols_n)]
    return [
        [float(raw[r][c]) / col_sums[c] if col_sums[c] > 0 else 0.0 for c in range(cols_n)]
        for r in range(rows_n)
    ]


@app.get("/api/analysis/temporal")
def get_analysis_temporal(
    db: Session = Depends(get_session),
    calendar_from: Optional[date] = Query(None, alias="calendar_from"),
    calendar_to: Optional[date] = Query(None, alias="calendar_to"),
):
    today = date.today()
    if calendar_from is None and calendar_to is None:
        cal_from = date(today.year, today.month, 1)
        cal_to = date(today.year, today.month, monthrange(today.year, today.month)[1])
    elif calendar_from is None or calendar_to is None:
        raise HTTPException(
            status_code=400,
            detail="calendar_from and calendar_to must both be set, or both omitted (defaults to current month).",
        )
    else:
        cal_from = calendar_from
        cal_to = calendar_to
    if cal_from > cal_to:
        raise HTTPException(status_code=400, detail="calendar_from must be <= calendar_to")

    analysis_tz = (os.getenv("ANALYSIS_TIMEZONE") or "America/Los_Angeles").strip() or "America/Los_Angeles"

    by_hour = [{"hour": h, "count": 0} for h in range(24)]
    by_weekday = [{"weekday": w, "count": 0} for w in range(7)]
    tutor_usage_by_day: list = []
    timezone_note = (
        f"Tutor usage uses PostgreSQL `events.created_at` (stored as timestamptz, usually UTC). "
        f"Hours, weekdays, and calendar days are grouped in `{analysis_tz}` so the axes match that "
        "zone’s local wall clock (set `ANALYSIS_TIMEZONE` to another IANA name to change)."
    )
    tutor_usage_error: Optional[str] = None

    try:
        with ext_engine.connect() as conn:
            hour_rows = conn.execute(
                text("""
                    SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE :tz))::int AS hour,
                           COUNT(*)::bigint AS cnt
                    FROM events
                    WHERE event_type = 'tutor_query'
                    GROUP BY 1
                """),
                {"tz": analysis_tz},
            ).mappings().all()
            for r in hour_rows:
                h = int(r["hour"])
                if 0 <= h <= 23:
                    by_hour[h]["count"] = int(r["cnt"])

            dow_rows = conn.execute(
                text("""
                    SELECT EXTRACT(DOW FROM (created_at AT TIME ZONE :tz))::int AS weekday,
                           COUNT(*)::bigint AS cnt
                    FROM events
                    WHERE event_type = 'tutor_query'
                    GROUP BY 1
                """),
                {"tz": analysis_tz},
            ).mappings().all()
            for r in dow_rows:
                w = int(r["weekday"])
                if 0 <= w <= 6:
                    by_weekday[w]["count"] = int(r["cnt"])

            tutor_daily_rows = conn.execute(
                text("""
                    SELECT (created_at AT TIME ZONE :tz)::date AS d, COUNT(*)::bigint AS cnt
                    FROM events
                    WHERE event_type = 'tutor_query'
                      AND (created_at AT TIME ZONE :tz)::date >= :d0
                      AND (created_at AT TIME ZONE :tz)::date <= :d1
                    GROUP BY 1
                """),
                {"tz": analysis_tz, "d0": cal_from, "d1": cal_to},
            ).mappings().all()
            day_counts: dict[str, int] = {}
            for r in tutor_daily_rows:
                d = r["d"]
                dk = d.isoformat() if hasattr(d, "isoformat") else str(d)
                day_counts[dk] = int(r["cnt"])
            cur = cal_from
            while cur <= cal_to:
                ds = cur.isoformat()
                tutor_usage_by_day.append({"date": ds, "count": day_counts.get(ds, 0)})
                cur += timedelta(days=1)
    except Exception as e:
        logger.warning("tutor_usage aggregates skipped: %s", e)
        tutor_usage_error = str(e)[:300]
        tutor_usage_by_day = []

    labels_list: list[str] = []
    notebooks_list: list[str] = []
    raw_matrix: list[list[int]] = []
    row_norm: list[list[float]] = []
    col_norm: list[list[float]] = []

    try:
        with ext_engine.connect() as conn:
            nb_rows = conn.execute(
                text("""
                    SELECT MIN(id) AS chatlog_id, MAX(payload->>'notebook') AS notebook
                    FROM events
                    WHERE event_type IN ('tutor_query', 'tutor_response')
                      AND payload->>'conversation_id' IS NOT NULL
                    GROUP BY payload->>'conversation_id'
                """)
            ).mappings().all()
            chatlog_notebook: dict[int, str] = {}
            for r in nb_rows:
                cid = int(r["chatlog_id"])
                nb = r["notebook"] if r["notebook"] else "unknown"
                chatlog_notebook[cid] = nb

            pair_counts: dict = defaultdict(lambda: defaultdict(int))
            label_names_seen: set = set()
            notebook_names_seen: set = set()
            for lbl_name, chatlog_id in db.exec(
                select(LabelDefinition.name, LabelApplication.chatlog_id)
                .select_from(LabelApplication)
                .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
            ).all():
                nb_key = chatlog_notebook.get(int(chatlog_id), "unknown")
                pair_counts[nb_key][lbl_name] += 1
                label_names_seen.add(lbl_name)
                notebook_names_seen.add(nb_key)

            labels_list = sorted(label_names_seen)
            notebooks_list = sorted(notebook_names_seen)
            raw_matrix = [
                [int(pair_counts[nb].get(lbl, 0)) for lbl in labels_list] for nb in notebooks_list
            ]
            raw_float = [[float(x) for x in row] for row in raw_matrix]
            row_norm = _normalize_heatmap_rows(raw_float)
            col_norm = _normalize_heatmap_columns(raw_float)
    except Exception:
        labels_list = []
        notebooks_list = []
        raw_matrix = []
        row_norm = []
        col_norm = []

    daily: dict = defaultdict(lambda: {"human": 0, "ai": 0})
    for row in db.exec(
        select(
            func.date(LabelApplication.created_at),
            LabelApplication.applied_by,
            func.count(LabelApplication.id),
        )
        .select_from(LabelApplication)
        .group_by(func.date(LabelApplication.created_at), LabelApplication.applied_by)
    ).all():
        d_raw, applied_by, cnt = row
        if d_raw is None:
            continue
        ds = d_raw.isoformat() if hasattr(d_raw, "isoformat") else str(d_raw)
        if applied_by == "human":
            daily[ds]["human"] += int(cnt)
        elif applied_by == "ai":
            daily[ds]["ai"] += int(cnt)

    labeling_throughput: list = []
    if daily:
        dates_sorted = sorted(daily.keys())
        d0 = date.fromisoformat(dates_sorted[0])
        d1 = date.fromisoformat(dates_sorted[-1])
        cur = d0
        while cur <= d1:
            ds = cur.isoformat()
            h = daily[ds]["human"]
            a = daily[ds]["ai"]
            labeling_throughput.append({"date": ds, "human": h, "ai": a, "total": h + a})
            cur += timedelta(days=1)

    return {
        "tutor_usage": {
            "by_hour": by_hour,
            "by_weekday": by_weekday,
            "by_day": tutor_usage_by_day,
            "display_timezone": analysis_tz,
            "timezone_note": timezone_note,
            "error": tutor_usage_error,
        },
        "notebook_label_heatmap": {
            "labels": labels_list,
            "notebooks": notebooks_list,
            "raw_counts": raw_matrix,
            "row_normalized": row_norm,
            "column_normalized": col_norm,
        },
        "labeling_throughput": labeling_throughput,
    }


@app.get("/api/export/csv")
def export_csv(db: Session = Depends(get_session)):
    rows = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelDefinition.name,
            LabelApplication.applied_by,
            LabelApplication.created_at,
        )
        .select_from(LabelApplication)
        .join(LabelDefinition, LabelDefinition.id == LabelApplication.label_id)
        .order_by(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.id,
        )
    ).all()

    keys = {(r[0], r[1]) for r in rows}
    text_by_key: dict = {}
    if keys:
        for mc in db.exec(select(MessageCache)).all():
            k = (mc.chatlog_id, mc.message_index)
            if k in keys:
                text_by_key[k] = mc.message_text or ""

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["chatlog_id", "message_index", "message_text", "label_name", "applied_by", "created_at"]
    )
    for chatlog_id, message_index, label_name, applied_by, created_at in rows:
        msg_text = text_by_key.get((chatlog_id, message_index), "")
        writer.writerow(
            [
                chatlog_id,
                message_index,
                msg_text,
                label_name,
                applied_by,
                created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
            ]
        )

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=chatsight-labels.csv"},
    )


@app.get("/api/session/recalibration", response_model=List[RecalibrationResponse])
def get_recalibration(db: Session = Depends(get_session)):
    from concurrent.futures import ThreadPoolExecutor
    from definition_service import generate_label_definition, select_best_example

    labels = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.archived_at == None)
        .order_by(LabelDefinition.created_at.desc())
    ).all()

    # Collect all DB data first (before spawning threads — db session is not thread-safe)
    label_data = []
    for label in labels:
        app_rows = db.exec(
            select(LabelApplication)
            .where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "human",
            )
            .order_by(LabelApplication.created_at.desc())
            .limit(20)
        ).all()

        example_messages = []
        for app_row in app_rows:
            cache_row = db.exec(
                select(MessageCache).where(
                    MessageCache.chatlog_id == app_row.chatlog_id,
                    MessageCache.message_index == app_row.message_index,
                )
            ).first()
            if cache_row:
                example_messages.append(cache_row.message_text)

        label_data.append((label, example_messages))

    # Run Gemini calls for all labels in parallel
    def process(item):
        label, example_messages = item
        if not example_messages:
            return label.id, None
        description = label.description or generate_label_definition(label.name, example_messages)
        example_text = select_best_example(label.name, description, example_messages)
        return label.id, example_text

    with ThreadPoolExecutor() as executor:
        example_map = dict(executor.map(process, label_data))

    return [
        RecalibrationResponse(
            label_id=label.id,
            name=label.name,
            description=label.description,
            example_text=example_map.get(label.id),
        )
        for label, _ in label_data
    ]


@app.get("/api/queue/sample")
def get_sample():
    return {"message": "Sampling strategy not yet implemented"}
