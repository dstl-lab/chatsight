from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional
import threading
from fastapi import FastAPI, Depends, HTTPException, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text
from sqlalchemy.engine import Connection

from database import create_db_and_tables, get_session, ext_engine, engine
import json as json_mod
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage, MessageCache, ConceptCandidate
from schemas import (
    CreateLabelRequest, UpdateLabelRequest, ApplyLabelRequest,
    SkipMessageRequest, SuggestRequest, MergeLabelRequest, SplitLabelRequest,
    ReorderLabelsRequest, AdvanceRequest, UndoRequest,
    LabelDefinitionResponse, QueueItemResponse, SessionResponse,
    LabelApplicationResponse, ChatlogSummary, ChatlogResponse,
    OrphanedMessagesResponse, OrphanedMessageItem, ArchiveResponse,
    DiscoverConceptsResponse, ConceptCandidateResponse, ResolveCandidateRequest, EmbedStatusResponse,
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
        result.append(LabelDefinitionResponse(
            id=label.id, name=label.name, description=label.description,
            created_at=label.created_at, count=count,
        ))
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
        id=label.id, name=label.name, description=label.description,
        created_at=label.created_at, count=0,
    )


@app.put("/api/labels/{label_id}", response_model=LabelDefinitionResponse)
def update_label(label_id: int, req: UpdateLabelRequest, db: Session = Depends(get_session)):
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
    chatlog_id: int, message_index: int, label_id: int,
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
def get_applied_labels(chatlog_id: int, message_index: int, db: Session = Depends(get_session)):
    rows = db.exec(
        select(LabelApplication).where(
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).all()
    return {"label_ids": [r.label_id for r in rows]}


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


@app.get("/api/labels/{label_id}/messages", response_model=List[LabelApplicationResponse])
def get_label_messages(label_id: int, db: Session = Depends(get_session)):
    label = db.get(LabelDefinition, label_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    rows = db.exec(
        select(LabelApplication).where(LabelApplication.label_id == label_id)
    ).all()
    return [
        LabelApplicationResponse(
            id=r.id, label_id=r.label_id, chatlog_id=r.chatlog_id,
            message_index=r.message_index, applied_by=r.applied_by,
            created_at=r.created_at,
        )
        for r in rows
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
            if key in {(e["chatlog_id"], e["message_index"]) for e in page}:
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
                _autolabel_status = {"running": False, "processed": 0, "total": 0, "error": "No labels defined"}
                return

            label_map = {l.name: l.id for l in labels}
            label_defs = [{"name": l.name, "description": l.description} for l in labels]

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
                            row = conn.execute(text("""
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
                            """), {"cid": cid, "midx": midx}).first()
                            if row and row[0]:
                                examples_by_label.setdefault(label.name, []).append(row[0])

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
            rows = conn.execute(text("""
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
                    FROM events GROUP BY payload->>'conversation_id'
                )
                SELECT s.message_text, s.message_index, ci.chatlog_id,
                    (SELECT e2.payload->>'response' FROM events e2
                     WHERE e2.payload->>'conversation_id' = s.conv_id
                       AND e2.event_type = 'tutor_response' AND e2.id < s.id
                     ORDER BY e2.id DESC LIMIT 1) AS context_before
                FROM student s
                JOIN chatlog_ids ci ON s.conv_id = ci.conv_id
            """)).mappings().all()

        unlabeled = [
            dict(r) for r in rows
            if (r["chatlog_id"], r["message_index"]) not in excluded
        ]
        _autolabel_status["total"] = len(unlabeled)

        # Process in batches of 30
        BATCH_SIZE = 30
        for i in range(0, len(unlabeled), BATCH_SIZE):
            batch = unlabeled[i:i + BATCH_SIZE]
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
        _autolabel_status = {"running": False, "processed": _autolabel_status["processed"], "total": _autolabel_status["total"], "error": str(e)}


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
    labels = db.exec(select(LabelDefinition)).all()
    if not labels:
        return {"label_name": "", "evidence": "", "rationale": "No labels defined yet."}

    # Build examples for each label
    examples_by_label: dict[str, list[str]] = {}
    for label in labels:
        apps = db.exec(
            select(LabelApplication).where(
                LabelApplication.label_id == label.id,
                LabelApplication.applied_by == "human",
            ).limit(5)
        ).all()
        if apps:
            with ext_engine.connect() as conn:
                for a in apps:
                    row = conn.execute(text("""
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
                    """), {"cid": a.chatlog_id, "midx": a.message_index}).first()
                    if row and row[0]:
                        examples_by_label.setdefault(label.name, []).append(row[0][:200])

    # Get the message text to classify
    with ext_engine.connect() as conn:
        row = conn.execute(text("""
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
        """), {"cid": req.chatlog_id, "midx": req.message_index}).first()

    if not row or not row[0]:
        return {"label_name": "", "evidence": "", "rationale": "Could not find message."}

    message_text = row[0]

    # Call Gemini for suggestion
    try:
        from autolabel_service import classify_batch
        label_defs = [{"name": l.name, "description": l.description} for l in labels]
        messages = [{"message_text": message_text, "context_before": None}]
        results = classify_batch(label_defs, examples_by_label, messages)
        if results:
            label_name = results[0].get("label", "")
            return {
                "label_name": label_name,
                "evidence": message_text[:100],
                "rationale": f"AI classified this as '{label_name}' based on {len(examples_by_label.get(label_name, []))} human-labeled examples.",
            }
    except Exception:
        pass

    return {"label_name": labels[0].name, "evidence": message_text[:100], "rationale": "Fallback suggestion."}


@app.post("/api/labels/merge")
def merge_labels(_req: MergeLabelRequest):
    return {"ok": True}


@app.post("/api/labels/split")
def split_label(_req: SplitLabelRequest):
    return {"ok": True}


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
