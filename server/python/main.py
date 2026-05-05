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
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from calendar import monthrange
from fastapi import FastAPI, Depends, HTTPException, Query, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text, update
from sqlalchemy.engine import Connection

from database import create_db_and_tables, get_session, ext_engine, engine
import json as json_mod
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage, MessageCache, ConceptCandidate, SuggestionCache, RecalibrationEvent, ConversationCursor
from schemas import (
    CreateLabelRequest, DeleteLabelResponse, UpdateLabelRequest, ApplyLabelRequest,
    ApplyBatchRequest, SkipMessageRequest, SuggestRequest, ConciseRequest, ConciseResponse,
    MergeLabelRequest, SplitLabelRequest, SplitAutoLabelRequest, ReorderLabelsRequest,
    AdvanceRequest, UndoRequest, LabelExampleResponse, LabelDefinitionResponse,
    QueueItemResponse, SessionResponse, LabelApplicationResponse, ChatlogSummary,
    ChatlogResponse, OrphanedMessagesResponse, OrphanedMessageItem, ArchiveResponse,
    DiscoverConceptsResponse, ConceptCandidateResponse, ResolveCandidateRequest, EmbedStatusResponse,
    LabelReviewResponse,
    RecalibrationItemResponse, SaveRecalibrationRequest, SaveRecalibrationResponse, RecalibrationStatsResponse,
    CreateSingleLabelRequest, QueueLabelRequest, DecideRequest,
    SkipConversationRequest, SkipConversationResponse,
    SingleLabelResponse, FocusedMessageResponse, ReadinessResponse,
    SummaryResponse, SummaryPattern, HandoffResponse,
    ReviewItemResponse, ReviewRequest,
    CreateAssignmentRequest, AssignmentResponse, UnmappedCountResponse,
    InferAssignmentsResponse, HandoffSummaryListItem,
    MergeAssignmentsRequest, MergeAssignmentsResponse,
)
import decision_service
import queue_service
import binary_autolabel_service
import assignment_service
from models import AssignmentMapping

REVIEW_THRESHOLD = 0.75
from sqlmodel import Session, select


def populate_message_cache():
    """Populate the local MessageCache from the external PostgreSQL events table.
    Read-only on the external DB. Idempotent: skips if cache already populated."""
    with Session(engine) as db:
        existing = db.exec(select(func.count(MessageCache.id))).one()
        if existing > 0:
            backfill_notebooks_if_missing(db)
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
                    SELECT payload->>'conversation_id' AS conv_id,
                           MIN(id) AS chatlog_id,
                           MAX(payload->>'notebook') AS notebook
                    FROM events
                    WHERE event_type IN ('tutor_query', 'tutor_response')
                    GROUP BY payload->>'conversation_id'
                )
                SELECT s.message_text, s.message_index, ci.chatlog_id, ci.notebook,
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
                    notebook=r["notebook"],
                    context_before=r["context_before"],
                    context_after=r["context_after"],
                ))
            db.commit()
    except Exception as e:
        print(f"Warning: could not populate message cache: {e}")


def backfill_notebooks_if_missing(db: Session):
    """If the cache exists but notebook fields are NULL (older cache), fetch notebooks
    from the external DB by chatlog_id and fill them in. Read-only on external DB."""
    missing_count = db.exec(
        select(func.count(MessageCache.id)).where(MessageCache.notebook == None)  # noqa: E711
    ).one()
    if missing_count == 0:
        return

    chatlog_ids = db.exec(
        select(MessageCache.chatlog_id).distinct().where(MessageCache.notebook == None)  # noqa: E711
    ).all()
    if not chatlog_ids:
        return

    try:
        with ext_engine.connect() as conn:
            sql = text("""
                SELECT MIN(id) AS chatlog_id, MAX(payload->>'notebook') AS notebook
                FROM events
                WHERE event_type IN ('tutor_query','tutor_response')
                  AND payload->>'conversation_id' IS NOT NULL
                GROUP BY payload->>'conversation_id'
                HAVING MIN(id) = ANY(:ids)
            """)
            rows = conn.execute(sql, {"ids": chatlog_ids}).mappings().all()
    except Exception as e:
        print(f"Warning: notebook backfill skipped — external DB unreachable: {e}")
        return

    notebook_by_chatlog = {r["chatlog_id"]: r["notebook"] for r in rows}
    if not notebook_by_chatlog:
        return
    cache_rows = db.exec(
        select(MessageCache).where(MessageCache.notebook == None)  # noqa: E711
    ).all()
    updated = 0
    for mc in cache_rows:
        nb = notebook_by_chatlog.get(mc.chatlog_id)
        if nb:
            mc.notebook = nb
            db.add(mc)
            updated += 1
    db.commit()
    if updated:
        print(f"Backfilled notebook for {updated} cache rows.")


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
    # Multi-label flow only — single-mode labels are exposed via /api/single-labels/.
    query = (
        select(LabelDefinition)
        .where(LabelDefinition.mode == "multi")
        .order_by(LabelDefinition.sort_order, LabelDefinition.id)
    )
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


@app.get("/api/session/label-review", response_model=List[LabelReviewResponse])
def get_label_review(db: Session = Depends(get_session)):
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
        LabelReviewResponse(
            label_id=label.id,
            name=label.name,
            description=label.description,
            example_text=example_map.get(label.id),
        )
        for label, _ in label_data
    ]


# ── Recalibration ────────────────────────────────────────────────────────────

RECALIBRATION_BASE_INTERVAL = 10
RECALIBRATION_MIN_INTERVAL = 5
RECALIBRATION_MAX_INTERVAL = 30
RECALIBRATION_WINDOW = 5
RECALIBRATION_COOLDOWN = 50

DEV_MODE = os.getenv("CHATSIGHT_DEV", "").lower() in ("1", "true", "yes")


def _compute_recalibration_interval(events: list[RecalibrationEvent]) -> int:
    """Replay recalibration history to derive the current adaptive interval."""
    interval = RECALIBRATION_BASE_INTERVAL
    if len(events) < RECALIBRATION_WINDOW:
        return interval
    for i in range(RECALIBRATION_WINDOW, len(events) + 1):
        window = events[i - RECALIBRATION_WINDOW : i]
        matches = sum(1 for e in window if e.matched)
        consistency = matches / RECALIBRATION_WINDOW
        if consistency >= 0.90:
            interval = min(interval + 5, RECALIBRATION_MAX_INTERVAL)
        elif consistency < 0.70:
            interval = max(interval - 5, RECALIBRATION_MIN_INTERVAL)
    return interval


def _compute_trend(events: list[RecalibrationEvent]) -> str:
    """Compare match rate of last 4 events vs prior 4 to determine trend."""
    if len(events) < 4:
        return "steady"
    recent = events[-4:]
    prior = events[-8:-4] if len(events) >= 8 else events[: len(events) - 4]
    if not prior:
        return "steady"
    recent_matches = sum(1 for e in recent if e.matched)
    prior_matches = sum(1 for e in prior if e.matched)
    if recent_matches - prior_matches > 1:
        return "improving"
    elif prior_matches - recent_matches > 1:
        return "shifting"
    return "steady"


@app.get("/api/session/recalibration")
def get_recalibration(force: bool = False, db: Session = Depends(get_session)):
    # `force=true` is honored only when CHATSIGHT_DEV is set; otherwise silently ignored.
    force = force and DEV_MODE
    # 1. Check for active session
    labeling_session = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()
    if not labeling_session:
        return None

    # 2. Get all recalibration events (chronological) for interval computation
    all_events = list(db.exec(
        select(RecalibrationEvent).order_by(RecalibrationEvent.id.asc())
    ).all())
    interval = _compute_recalibration_interval(all_events)

    # 3. Count human-labeled messages since last recalibration
    last_event = all_events[-1] if all_events else None
    cutoff = last_event.created_at if last_event else labeling_session.started_at

    labeled_since = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.applied_by == "human")
            .where(LabelApplication.created_at > cutoff)
            .distinct()
            .subquery()
        )
    ).one()

    if not force and labeled_since < interval:
        return None

    # 4. Select a message using stratified-by-label + age-weighted sampling
    import random

    # Get all human-labeled messages with their label IDs and timestamps
    labeled_messages = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.label_id,
            LabelApplication.created_at,
        )
        .where(LabelApplication.applied_by == "human")
        .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
        .where(LabelDefinition.archived_at == None)  # noqa: E711
    ).all()

    # Build message -> labels and message -> oldest timestamp maps
    msg_labels: dict[tuple[int, int], list[int]] = {}
    msg_oldest: dict[tuple[int, int], datetime] = {}
    for chatlog_id, message_index, label_id, created_at in labeled_messages:
        key = (chatlog_id, message_index)
        msg_labels.setdefault(key, []).append(label_id)
        if key not in msg_oldest or created_at < msg_oldest[key]:
            msg_oldest[key] = created_at

    # Exclude messages on cooldown (recalibrated recently)
    if all_events:
        for event in all_events:
            ekey = (event.chatlog_id, event.message_index)
            # Count labeled messages since this event
            since_count = db.exec(
                select(func.count()).select_from(
                    select(LabelApplication.chatlog_id, LabelApplication.message_index)
                    .where(LabelApplication.applied_by == "human")
                    .where(LabelApplication.created_at > event.created_at)
                    .distinct()
                    .subquery()
                )
            ).one()
            if since_count < RECALIBRATION_COOLDOWN:
                msg_labels.pop(ekey, None)
                msg_oldest.pop(ekey, None)

    if not msg_labels:
        return None

    # Compute label deficit for stratification
    total_recal = len(all_events) if all_events else 0
    label_msg_count: dict[int, int] = {}
    for labels in msg_labels.values():
        for lid in labels:
            label_msg_count[lid] = label_msg_count.get(lid, 0) + 1

    total_msg_count = len(msg_labels)
    recal_label_count: dict[int, int] = {}
    if all_events:
        for event in all_events:
            for lid in json_mod.loads(event.original_label_ids):
                recal_label_count[lid] = recal_label_count.get(lid, 0) + 1

    label_deficit: dict[int, float] = {}
    for lid, count in label_msg_count.items():
        expected = count / total_msg_count if total_msg_count > 0 else 0
        actual = (recal_label_count.get(lid, 0) / total_recal) if total_recal > 0 else 0
        label_deficit[lid] = max(0.0, expected - actual)

    # Weight each message by: label deficit (sum across its labels) * age
    now = datetime.utcnow()
    candidates = []
    weights = []
    for key, labels in msg_labels.items():
        deficit_weight = sum(label_deficit.get(lid, 0) for lid in labels)
        if deficit_weight == 0:
            deficit_weight = 0.1  # small floor so all messages have a chance
        age_seconds = max(1.0, (now - msg_oldest[key]).total_seconds())
        candidates.append(key)
        weights.append(deficit_weight * age_seconds)

    selected = random.choices(candidates, weights=weights, k=1)[0]

    # Fetch the message and its labels
    cached = db.exec(
        select(MessageCache).where(
            MessageCache.chatlog_id == selected[0],
            MessageCache.message_index == selected[1],
        )
    ).first()
    if not cached:
        return None

    original_ids = sorted(msg_labels[selected])

    return RecalibrationItemResponse(
        chatlog_id=cached.chatlog_id,
        message_index=cached.message_index,
        message_text=cached.message_text,
        context_before=cached.context_before,
        context_after=cached.context_after,
        original_label_ids=original_ids,
    )


@app.post("/api/session/recalibration", response_model=SaveRecalibrationResponse)
def save_recalibration(req: SaveRecalibrationRequest, db: Session = Depends(get_session)):
    # Get current session
    labeling_session = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()

    matched = sorted(req.original_label_ids) == sorted(req.relabel_ids)

    event = RecalibrationEvent(
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
        original_label_ids=json_mod.dumps(sorted(req.original_label_ids)),
        relabel_ids=json_mod.dumps(sorted(req.relabel_ids)),
        final_label_ids=json_mod.dumps(sorted(req.final_label_ids)),
        matched=matched,
        session_id=labeling_session.id if labeling_session else None,
    )
    db.add(event)

    # Reconcile LabelApplication rows to match final_label_ids
    current_apps = db.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == req.chatlog_id,
            LabelApplication.message_index == req.message_index,
            LabelApplication.applied_by == "human",
        )
    ).all()
    current_label_ids = {app.label_id for app in current_apps}
    final_set = set(req.final_label_ids)

    # Delete labels not in final set
    for app in current_apps:
        if app.label_id not in final_set:
            db.delete(app)

    # Add labels in final set but not currently applied
    for lid in final_set - current_label_ids:
        db.add(LabelApplication(
            label_id=lid,
            chatlog_id=req.chatlog_id,
            message_index=req.message_index,
            applied_by="human",
        ))

    db.commit()

    # Compute trend for response
    all_events = list(db.exec(
        select(RecalibrationEvent).order_by(RecalibrationEvent.id.asc())
    ).all())
    trend = _compute_trend(all_events)

    return SaveRecalibrationResponse(matched=matched, trend=trend)


@app.get("/api/session/recalibration/stats", response_model=RecalibrationStatsResponse)
def get_recalibration_stats(db: Session = Depends(get_session)):
    all_events = list(db.exec(
        select(RecalibrationEvent).order_by(RecalibrationEvent.id.asc())
    ).all())

    recent_results = [e.matched for e in all_events[-8:]]
    trend = _compute_trend(all_events)
    interval = _compute_recalibration_interval(all_events)

    return RecalibrationStatsResponse(
        recent_results=recent_results,
        trend=trend,
        current_interval=interval,
        total_recalibrations=len(all_events),
    )


@app.get("/api/queue/sample")
def get_sample():
    return {"message": "Sampling strategy not yet implemented"}


# ─────────────────────────────────────────────────────────────────────────────
# Single-label binary flow
# ─────────────────────────────────────────────────────────────────────────────

def _label_to_response(db: Session, label: LabelDefinition) -> SingleLabelResponse:
    yes, no, skip, walked = decision_service.label_counts(db, label.id)
    total_convs = db.exec(select(MessageCache.chatlog_id).distinct()).all()
    return SingleLabelResponse(
        id=label.id,
        name=label.name,
        description=label.description,
        mode=label.mode,
        phase=label.phase,
        is_active=label.is_active,
        queue_position=label.queue_position,
        yes_count=yes,
        no_count=no,
        skip_count=skip,
        conversations_walked=walked,
        total_conversations=len(total_convs),
    )


@app.get("/api/single-labels", response_model=List[SingleLabelResponse])
def list_single_labels(
    phase: Optional[str] = None,
    db: Session = Depends(get_session),
):
    q = (
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.archived_at == None)  # noqa: E711
    )
    if phase:
        q = q.where(LabelDefinition.phase == phase)
    q = q.order_by(LabelDefinition.queue_position, LabelDefinition.created_at)
    labels = db.exec(q).all()
    return [_label_to_response(db, lab) for lab in labels]


@app.get("/api/single-labels/active", response_model=Optional[SingleLabelResponse])
def get_active_single_label(db: Session = Depends(get_session)):
    label = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.is_active == True)  # noqa: E712
    ).first()
    if not label:
        return None
    return _label_to_response(db, label)


@app.post("/api/single-labels", response_model=SingleLabelResponse)
def create_single_label(
    req: CreateSingleLabelRequest,
    db: Session = Depends(get_session),
):
    label = LabelDefinition(
        name=req.name,
        description=req.description,
        mode="single",
        phase="labeling",
        is_active=False,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return _label_to_response(db, label)


@app.post("/api/single-labels/queue", response_model=SingleLabelResponse)
def queue_single_label(
    req: QueueLabelRequest,
    db: Session = Depends(get_session),
):
    """Add a queued label that will auto-activate when the current active label closes."""
    existing = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.name == req.name)
    ).first()
    if existing:
        # Idempotent: surface the existing label rather than create a duplicate.
        return _label_to_response(db, existing)

    max_pos = db.exec(
        select(func.max(LabelDefinition.queue_position))
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.phase == "queued")
    ).one()
    next_pos = (max_pos or -1) + 1

    label = LabelDefinition(
        name=req.name,
        description=req.description,
        mode="single",
        phase="queued",
        is_active=False,
        queue_position=next_pos,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return _label_to_response(db, label)


@app.post("/api/single-labels/{label_id}/activate", response_model=SingleLabelResponse)
def activate_single_label(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")

    # Deactivate other single-mode labels.
    others = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.is_active == True)  # noqa: E712
        .where(LabelDefinition.id != label_id)
    ).all()
    for o in others:
        o.is_active = False
        db.add(o)

    label.is_active = True
    label.phase = "labeling"
    label.queue_position = None
    db.add(label)
    db.commit()
    db.refresh(label)
    return _label_to_response(db, label)


@app.post("/api/single-labels/{label_id}/close", response_model=SingleLabelResponse)
def close_single_label(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    label.is_active = False
    label.phase = "complete"
    db.add(label)
    db.commit()

    # Auto-pop next queued single label
    next_q = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.phase == "queued")
        .order_by(LabelDefinition.queue_position)
    ).first()
    if next_q:
        next_q.is_active = True
        next_q.phase = "labeling"
        next_q.queue_position = None
        db.add(next_q)
        db.commit()

    db.refresh(label)
    return _label_to_response(db, label)


@app.get("/api/single-labels/{label_id}/next", response_model=Optional[FocusedMessageResponse])
def get_next_focused(
    label_id: int,
    assignment_id: Optional[int] = None,
    db: Session = Depends(get_session),
):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    payload = queue_service.next_message_for_label(db, label_id, assignment_id)
    if not payload:
        return None
    return FocusedMessageResponse(**payload)


@app.post("/api/single-labels/{label_id}/decide", response_model=Optional[FocusedMessageResponse])
def post_decide(
    label_id: int,
    req: DecideRequest,
    db: Session = Depends(get_session),
):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    if req.value not in {"yes", "no", "skip"}:
        raise HTTPException(status_code=400, detail="value must be yes|no|skip")
    decision_service.record_decision(
        db,
        label_id=label_id,
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
        value=req.value,
    )
    payload = queue_service.next_message_for_label(db, label_id)
    if not payload:
        return None
    return FocusedMessageResponse(**payload)


@app.post(
    "/api/single-labels/{label_id}/skip-conversation",
    response_model=Optional[FocusedMessageResponse],
)
def post_skip_conversation(
    label_id: int,
    req: SkipConversationRequest,
    db: Session = Depends(get_session),
):
    """Skip every still-undecided student message in `chatlog_id` for this label so
    the queue jumps to the next conversation. Already-decided messages are untouched.
    Returns the next focused message (next conversation in the per-label walk order)
    or None when nothing remains."""
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail=f"No label with id={label_id}")
    if label.mode != "single":
        raise HTTPException(
            status_code=400,
            detail=f"Label {label_id} ({label.name!r}) is mode={label.mode!r}, not 'single'",
        )
    decision_service.skip_conversation(db, label_id, req.chatlog_id)
    payload = queue_service.next_message_for_label(db, label_id)
    if not payload:
        return None
    return FocusedMessageResponse(**payload)


@app.post("/api/single-labels/{label_id}/undo", response_model=Optional[FocusedMessageResponse])
def post_undo(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    decision_service.undo_last_decision(db, label_id)
    payload = queue_service.next_message_for_label(db, label_id)
    if not payload:
        return None
    return FocusedMessageResponse(**payload)


@app.get("/api/single-labels/{label_id}/readiness", response_model=ReadinessResponse)
def get_readiness(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    state = decision_service.compute_readiness(db, label_id)
    return ReadinessResponse(**state)


CLASSIFICATION_CHUNK_SIZE = 50
PARALLEL_CONCURRENCY = 8
# Temporarily bumped from 500 → 100000 for the label 16 resume so the run stays
# on the parallel-sync path with live progress instead of going to Batch API
# (which sits at 0% until completion). Revert after that handoff finishes.
BATCH_THRESHOLD = 100000
BATCH_POLL_INTERVAL_SEC = 15


def _do_classification(db: Session, label: LabelDefinition) -> None:
    """Classify pending messages for `label` and emit a summary. Routes large jobs
    (> BATCH_THRESHOLD) to the Gemini Batch API and small jobs to a parallel
    synchronous path (ThreadPoolExecutor over chunks). Both paths share the
    pre/post bookkeeping below: collect pending + few-shot examples, write AI
    rows + progress, then summarize and flip phase to 'handed_off'."""
    decided_keys = set(
        db.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.label_id == label.id)
        ).all()
    )
    cached = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index, MessageCache.message_text)
    ).all()
    pending = [(c, i, t) for (c, i, t) in cached if (c, i) not in decided_keys]

    yes_examples_rows = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(
            LabelApplication.label_id == label.id,
            LabelApplication.applied_by == "human",
            LabelApplication.value == "yes",
        )
        .order_by(LabelApplication.created_at.desc())  # type: ignore[arg-type]
    ).all()
    no_examples_rows = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(
            LabelApplication.label_id == label.id,
            LabelApplication.applied_by == "human",
            LabelApplication.value == "no",
        )
        .order_by(LabelApplication.created_at.desc())  # type: ignore[arg-type]
    ).all()

    def _texts_for(rows):
        out = []
        for c, i in rows:
            mc = db.exec(
                select(MessageCache).where(
                    MessageCache.chatlog_id == c, MessageCache.message_index == i
                )
            ).first()
            if mc:
                out.append(mc.message_text)
        return out

    yes_examples = _texts_for(yes_examples_rows[:10])
    no_examples = _texts_for(no_examples_rows[:10])

    label.classification_total = len(pending)
    label.classified_count = 0
    db.add(label)
    db.commit()

    if len(pending) > BATCH_THRESHOLD:
        yes_msgs, no_msgs = _classify_via_batch_api(
            db, label, pending, yes_examples, no_examples
        )
    else:
        yes_msgs, no_msgs = _classify_in_parallel(
            db, label, pending, yes_examples, no_examples
        )

    summary = binary_autolabel_service.summarize_batch(
        label_name=label.name,
        label_description=label.description,
        yes_messages=yes_msgs,
        no_messages=no_msgs,
    )
    label.summary_json = json_mod.dumps(summary)
    label.phase = "handed_off"
    db.add(label)
    db.commit()


def _classify_in_parallel(
    db: Session,
    label: LabelDefinition,
    pending: list,
    yes_examples: list,
    no_examples: list,
) -> tuple[list[str], list[str]]:
    """Parallel sync path: ThreadPoolExecutor fans out chunks across worker threads,
    each calling `classify_binary` (still patchable for tests). DB writes happen
    in the main thread as futures complete; `classified_count` advances by the
    count of each completed chunk. Exceptions propagate to the caller (matching
    the legacy fail-fast behavior expected by test_failed_handoff_still_appears_with_error)."""
    chunks = [
        pending[i:i + CLASSIFICATION_CHUNK_SIZE]
        for i in range(0, len(pending), CLASSIFICATION_CHUNK_SIZE)
    ]
    yes_msgs: list[str] = []
    no_msgs: list[str] = []

    def run_chunk(chunk):
        chunk_texts = [t for _, _, t in chunk]
        classifications = binary_autolabel_service.classify_binary(
            label_name=label.name,
            label_description=label.description,
            yes_examples=yes_examples,
            no_examples=no_examples,
            messages=chunk_texts,
        )
        return chunk, classifications

    completed = 0
    with ThreadPoolExecutor(max_workers=PARALLEL_CONCURRENCY) as ex:
        futures = [ex.submit(run_chunk, chunk) for chunk in chunks]
        try:
            for fut in as_completed(futures):
                chunk, classifications = fut.result()
                for (cid, midx, text), cls in zip(chunk, classifications):
                    value = cls.get("value", "no")
                    confidence = float(cls.get("confidence", 0.5))
                    db.add(LabelApplication(
                        label_id=label.id,
                        chatlog_id=cid,
                        message_index=midx,
                        applied_by="ai",
                        confidence=confidence,
                        value=value,
                    ))
                    if value == "yes":
                        yes_msgs.append(text)
                    else:
                        no_msgs.append(text)
                completed += len(chunk)
                label.classified_count = completed
                db.add(label)
                db.commit()
        finally:
            for f in futures:
                f.cancel()

    return yes_msgs, no_msgs


def _classify_via_batch_api(
    db: Session,
    label: LabelDefinition,
    pending: list,
    yes_examples: list,
    no_examples: list,
) -> tuple[list[str], list[str]]:
    """Batch API path: build a JSONL with one request per chunk, upload, submit a
    batch job, poll until terminal, then download and parse the result file.

    Trade-off vs parallel sync: Google handles internal concurrency (much higher
    throughput than 8 worker threads) at 50% cost, with a 24h SLA. Progress is
    coarse — `classified_count` only advances at the end since the Batch API
    surfaces job-level state, not per-request progress."""
    from google.genai import types as genai_types

    bas = binary_autolabel_service
    chunks = [
        pending[i:i + CLASSIFICATION_CHUNK_SIZE]
        for i in range(0, len(pending), CLASSIFICATION_CHUNK_SIZE)
    ]

    # Build JSONL of batch requests. Key encodes the chunk index so we can map
    # results back to the right pending tuples regardless of return order.
    jsonl_path = None
    uploaded_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
        ) as f:
            jsonl_path = f.name
            for idx, chunk in enumerate(chunks):
                chunk_texts = [t for _, _, t in chunk]
                req = bas.build_classify_batch_request(
                    key=f"chunk-{idx}",
                    label_name=label.name,
                    label_description=label.description,
                    yes_examples=yes_examples,
                    no_examples=no_examples,
                    messages=chunk_texts,
                )
                f.write(json_mod.dumps(req) + "\n")

        uploaded = bas.client.files.upload(
            file=jsonl_path,
            config=genai_types.UploadFileConfig(
                display_name=f"binary-classify-label-{label.id}",
                mime_type="jsonl",
            ),
        )
        uploaded_name = uploaded.name

        job = bas.client.batches.create(
            model=bas.CLASSIFY_MODEL,
            src=uploaded.name,
            config={"display_name": f"binary-classify-label-{label.id}"},
        )

        terminal = {
            "JOB_STATE_SUCCEEDED",
            "JOB_STATE_FAILED",
            "JOB_STATE_CANCELLED",
            "JOB_STATE_EXPIRED",
        }
        while job.state.name not in terminal:
            time.sleep(BATCH_POLL_INTERVAL_SEC)
            job = bas.client.batches.get(name=job.name)

        if job.state.name != "JOB_STATE_SUCCEEDED":
            err = getattr(job, "error", None)
            raise RuntimeError(f"Batch job ended in {job.state.name}: {err}")

        # Read results — Batch returns either a result file or inline responses.
        results_by_key: dict[str, dict] = {}
        dest = getattr(job, "dest", None)
        result_file_name = getattr(dest, "file_name", None) if dest else None
        if result_file_name:
            content = bas.client.files.download(file=result_file_name)
            text = content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else content
            for line in text.splitlines():
                if not line.strip():
                    continue
                row = json_mod.loads(line)
                key = row.get("key")
                if key:
                    results_by_key[key] = row
        else:
            inlined = getattr(dest, "inlined_responses", None) or []
            for i, inline in enumerate(inlined):
                key = getattr(inline, "key", None) or f"chunk-{i}"
                results_by_key[key] = {
                    "key": key,
                    "response": getattr(inline, "response", None),
                    "error": getattr(inline, "error", None),
                }
    finally:
        if jsonl_path:
            try:
                os.unlink(jsonl_path)
            except OSError:
                pass
        if uploaded_name:
            try:
                bas.client.files.delete(name=uploaded_name)
            except Exception:
                pass

    yes_msgs: list[str] = []
    no_msgs: list[str] = []
    completed = 0
    for idx, chunk in enumerate(chunks):
        row = results_by_key.get(f"chunk-{idx}")
        response_obj = (row or {}).get("response")
        if response_obj is not None and not isinstance(response_obj, dict):
            # SDK may return typed objects for inline responses; coerce to dict.
            response_obj = response_obj.to_json_dict() if hasattr(response_obj, "to_json_dict") else None
        classifications = bas.parse_classify_batch_response(response_obj, len(chunk))
        for (cid, midx, text), cls in zip(chunk, classifications):
            value = cls.get("value", "no")
            confidence = float(cls.get("confidence", 0.5))
            db.add(LabelApplication(
                label_id=label.id,
                chatlog_id=cid,
                message_index=midx,
                applied_by="ai",
                confidence=confidence,
                value=value,
            ))
            if value == "yes":
                yes_msgs.append(text)
            else:
                no_msgs.append(text)
        completed += len(chunk)
        label.classified_count = completed
        db.add(label)
        db.commit()

    return yes_msgs, no_msgs


def _classify_error_kind(exc: BaseException) -> str:
    """Categorize a classification failure for the UI. Returns 'rate_limited' for
    Gemini quota/429 responses, otherwise 'error'. Looks at HTTP status, gRPC code,
    and the message text since the genai SDK surfaces these inconsistently."""
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status in (429, "RESOURCE_EXHAUSTED"):
        return "rate_limited"
    text = (str(exc) or "").lower()
    if "429" in text or "resource_exhausted" in text or "rate limit" in text or "quota" in text:
        return "rate_limited"
    return "error"


def _classify_in_background(label_id: int) -> None:
    """Top-level wrapper for FastAPI BackgroundTasks: opens its own session and
    runs `_do_classification`. On failure, marks the label `phase='failed'` and
    stashes the error in `summary_json` so the instructor can see what went wrong
    on /summaries instead of having the label silently disappear."""
    with Session(engine) as db:
        label = db.get(LabelDefinition, label_id)
        if not label:
            return
        try:
            _do_classification(db, label)
        except Exception as e:
            logger.exception(f"Background classification failed for label {label_id}: {e}")
            label.phase = "failed"
            label.summary_json = json_mod.dumps({
                "error": str(e) or e.__class__.__name__,
                "error_kind": _classify_error_kind(e),
            })
            db.add(label)
            db.commit()


@app.post("/api/single-labels/{label_id}/handoff", response_model=HandoffResponse)
def handoff_single_label(
    label_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
    """Hand off a label to Gemini in the background. Returns immediately with
    the next-active label info — the actual classification runs after response.

    Behavior:
    - Active label moves to phase = 'classifying' (deactivated)
    - Next queued label (if any) auto-activates and moves to phase = 'labeling'
    - Background task runs Gemini classification + summary; on success sets phase
      to 'handed_off' and stores summary_json
    - The classifying label appears on /api/handoff-summaries with empty patterns
      until the background task completes."""
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    if label.phase == "classifying":
        raise HTTPException(status_code=409, detail="Already classifying")

    label.phase = "classifying"
    label.is_active = False
    db.add(label)

    next_q = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.phase == "queued")
        .order_by(LabelDefinition.queue_position)
    ).first()
    if next_q:
        next_q.is_active = True
        next_q.phase = "labeling"
        next_q.queue_position = None
        db.add(next_q)
    db.commit()

    bg.add_task(_classify_in_background, label_id)

    return HandoffResponse(
        label_id=label_id,
        classified=0,
        yes_count=0,
        no_count=0,
        review_count=0,
    )


@app.get("/api/single-labels/{label_id}/summary", response_model=SummaryResponse)
def get_summary(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")

    yes_count = db.exec(
        select(func.count(LabelApplication.id))
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
            LabelApplication.value == "yes",
        )
    ).one()
    no_count = db.exec(
        select(func.count(LabelApplication.id))
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
            LabelApplication.value == "no",
        )
    ).one()
    review_count = db.exec(
        select(func.count(LabelApplication.id))
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
            LabelApplication.confidence < REVIEW_THRESHOLD,
        )
    ).one()

    payload = json_mod.loads(label.summary_json) if label.summary_json else {"included": [], "excluded": []}
    return SummaryResponse(
        label_id=label_id,
        label_name=label.name,
        yes_count=yes_count,
        no_count=no_count,
        review_threshold=REVIEW_THRESHOLD,
        review_count=review_count,
        included=[SummaryPattern(**p) for p in payload.get("included", [])],
        excluded=[SummaryPattern(**p) for p in payload.get("excluded", [])],
    )


@app.post("/api/single-labels/{label_id}/refine", response_model=SingleLabelResponse)
def refine_single_label(label_id: int, db: Session = Depends(get_session)):
    """Discard AI predictions and clear summary so the instructor can add more
    examples and re-run handoff. Phase reverts to 'labeling'."""
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    ai_rows = db.exec(
        select(LabelApplication)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
        )
    ).all()
    for r in ai_rows:
        db.delete(r)
    label.phase = "labeling"
    label.summary_json = None
    db.add(label)
    db.commit()
    db.refresh(label)
    return _label_to_response(db, label)


@app.get("/api/single-labels/{label_id}/review-queue", response_model=List[ReviewItemResponse])
def get_review_queue(
    label_id: int,
    limit: int = 50,
    db: Session = Depends(get_session),
):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    rows = db.exec(
        select(LabelApplication)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
            LabelApplication.confidence < REVIEW_THRESHOLD,
        )
        .order_by(LabelApplication.confidence)  # type: ignore[arg-type]
        .limit(limit)
    ).all()
    out: list[ReviewItemResponse] = []
    for r in rows:
        mc = db.exec(
            select(MessageCache).where(
                MessageCache.chatlog_id == r.chatlog_id,
                MessageCache.message_index == r.message_index,
            )
        ).first()
        if not mc:
            continue
        out.append(ReviewItemResponse(
            chatlog_id=r.chatlog_id,
            message_index=r.message_index,
            text=mc.message_text,
            notebook=mc.notebook,
            ai_value=r.value or "no",
            ai_confidence=r.confidence or 0.0,
        ))
    return out


@app.post("/api/single-labels/{label_id}/review", response_model=ReviewItemResponse)
def post_review(
    label_id: int,
    req: ReviewRequest,
    db: Session = Depends(get_session),
):
    """Override an AI prediction. Sets applied_by='human', confidence=1.0, value=req.value."""
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    if req.value not in {"yes", "no"}:
        raise HTTPException(status_code=400, detail="value must be yes|no for review")
    row = db.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.chatlog_id == req.chatlog_id,
            LabelApplication.message_index == req.message_index,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    row.applied_by = "human"
    row.confidence = 1.0
    row.value = req.value
    db.add(row)
    db.commit()
    mc = db.exec(
        select(MessageCache).where(
            MessageCache.chatlog_id == req.chatlog_id,
            MessageCache.message_index == req.message_index,
        )
    ).first()
    return ReviewItemResponse(
        chatlog_id=req.chatlog_id,
        message_index=req.message_index,
        text=mc.message_text if mc else "",
        notebook=mc.notebook if mc else None,
        ai_value=req.value,
        ai_confidence=1.0,
    )


@app.delete("/api/single-labels/{label_id}", response_model=DeleteLabelResponse)
def delete_single_label(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    # Drop all decisions + cursors for this label
    apps = db.exec(select(LabelApplication).where(LabelApplication.label_id == label_id)).all()
    for a in apps:
        db.delete(a)
    cursors = db.exec(select(ConversationCursor).where(ConversationCursor.label_id == label_id)).all()
    for c in cursors:
        db.delete(c)
    db.delete(label)
    db.commit()
    return DeleteLabelResponse(ok=True, deleted_applications=len(apps))


# ─────────────────────────────────────────────────────────────────────────────
# Assignment mappings
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/assignments", response_model=List[AssignmentResponse])
def list_assignments(db: Session = Depends(get_session)):
    mappings = db.exec(select(AssignmentMapping).order_by(AssignmentMapping.id)).all()
    counts = assignment_service.message_count_per_assignment(db)
    return [
        AssignmentResponse(
            id=m.id,
            pattern=m.pattern,
            name=m.name,
            description=m.description,
            message_count=counts.get(m.id, 0),
        )
        for m in mappings
    ]


@app.get("/api/assignments/unmapped", response_model=UnmappedCountResponse)
def get_unmapped_count(db: Session = Depends(get_session)):
    counts = assignment_service.message_count_per_assignment(db)
    return UnmappedCountResponse(
        unmapped_count=counts.get(None, 0),
        total_count=sum(counts.values()),
    )


@app.post("/api/assignments", response_model=AssignmentResponse)
def create_assignment(
    req: CreateAssignmentRequest,
    db: Session = Depends(get_session),
):
    import re as _re
    try:
        _re.compile(req.pattern)
    except _re.error as e:
        raise HTTPException(status_code=400, detail=f"Invalid regex: {e}")

    mapping = AssignmentMapping(
        pattern=req.pattern,
        name=req.name,
        description=req.description,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    assignment_service.match_all_messages(db)
    counts = assignment_service.message_count_per_assignment(db)
    return AssignmentResponse(
        id=mapping.id,
        pattern=mapping.pattern,
        name=mapping.name,
        description=mapping.description,
        message_count=counts.get(mapping.id, 0),
    )


@app.post("/api/assignments/merge", response_model=MergeAssignmentsResponse)
def merge_assignments_endpoint(
    req: MergeAssignmentsRequest,
    db: Session = Depends(get_session),
):
    """Merge multiple assignment mappings into one. The target keeps its id;
    sources are deleted and their tagged messages reassigned to the target.
    Patterns are unioned so the merge survives a future re-tag pass."""
    try:
        return MergeAssignmentsResponse(**assignment_service.merge_assignments(
            db,
            source_ids=req.source_ids,
            target_id=req.target_id,
            new_name=req.new_name,
        ))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/assignments/infer", response_model=InferAssignmentsResponse)
def infer_assignments(db: Session = Depends(get_session)):
    """Auto-detect assignments from cached notebook filenames. Read-only on external DB.
    Tries to backfill notebooks first if any cache rows are missing them, then groups
    distinct notebooks into Lab N / Project N / Homework N (or stem fallback)."""
    # Best-effort backfill from external DB; safe no-op if unreachable.
    try:
        backfill_notebooks_if_missing(db)
    except Exception as e:
        logger.warning(f"Notebook backfill skipped: {e}")
    return InferAssignmentsResponse(**assignment_service.infer_assignments_from_cache(db))


@app.delete("/api/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_session)):
    mapping = db.get(AssignmentMapping, assignment_id)
    if not mapping:
        raise HTTPException(status_code=404, detail="Assignment not found")
    cleared = assignment_service.clear_assignment(db, assignment_id)
    db.delete(mapping)
    db.commit()
    return {"ok": True, "cleared": cleared}


@app.get("/api/handoff-summaries", response_model=List[HandoffSummaryListItem])
def list_handoff_summaries(db: Session = Depends(get_session)):
    """List every single-label that has been handed off (in-progress, failed, ready
    for review, actively under review, or fully closed). Failed handoffs surface here
    too so the instructor can see what went wrong instead of having the label vanish."""
    labels = db.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.phase.in_(  # type: ignore[attr-defined]
            ["classifying", "handed_off", "reviewing", "complete", "failed"]
        ))
        .order_by(LabelDefinition.id.desc())
    ).all()

    out: list[HandoffSummaryListItem] = []
    for label in labels:
        try:
            payload = json_mod.loads(label.summary_json) if label.summary_json else {}
        except json_mod.JSONDecodeError:
            payload = {}
        yes_count = db.exec(
            select(func.count(LabelApplication.id)).where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "ai",
                LabelApplication.value == "yes",
            )
        ).one()
        no_count = db.exec(
            select(func.count(LabelApplication.id)).where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "ai",
                LabelApplication.value == "no",
            )
        ).one()
        review_count = db.exec(
            select(func.count(LabelApplication.id)).where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "ai",
                LabelApplication.confidence < REVIEW_THRESHOLD,
            )
        ).one()
        out.append(HandoffSummaryListItem(
            label_id=label.id,
            label_name=label.name,
            description=label.description,
            phase=label.phase,
            yes_count=yes_count,
            no_count=no_count,
            review_count=review_count,
            review_threshold=REVIEW_THRESHOLD,
            included=[SummaryPattern(**p) for p in payload.get("included", [])],
            excluded=[SummaryPattern(**p) for p in payload.get("excluded", [])],
            classified_count=label.classified_count,
            classification_total=label.classification_total,
            error=payload.get("error") if label.phase == "failed" else None,
            error_kind=payload.get("error_kind") if label.phase == "failed" else None,
        ))
    return out
