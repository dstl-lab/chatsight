from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Dict, Any
import threading
from fastapi import FastAPI, Depends, HTTPException, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text, update
from sqlalchemy.engine import Connection

from database import create_db_and_tables, get_session, ext_engine, engine
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage
from schemas import (
    CreateLabelRequest,
    DeleteLabelResponse,
    UpdateLabelRequest,
    ApplyLabelRequest,
    ApplyBatchRequest,
    SkipMessageRequest,
    SuggestRequest,
    MergeLabelRequest,
    SplitLabelRequest,
    SplitAutoLabelRequest,
    AdvanceRequest,
    UndoRequest,
    LabelExampleResponse,
    LabelDefinitionResponse,
    QueueItemResponse,
    SessionResponse,
    LabelApplicationResponse,
    ChatlogSummary,
    ChatlogResponse,
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


@app.post("/api/labels", response_model=LabelDefinitionResponse)
def create_label(req: CreateLabelRequest, db: Session = Depends(get_session)):
    label = LabelDefinition(name=req.name, description=req.description)
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

    apps = db.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id)
        .order_by(func.random())
        .limit(limit)
    ).all()

    if not apps:
        return []

    results = []
    with ext_engine.connect() as conn:
        for app_ in apps:
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
            msg_text = row[0] if row and row[0] else ""
            results.append(
                LabelExampleResponse(
                    chatlog_id=app_.chatlog_id,
                    message_index=app_.message_index,
                    message_text=msg_text,
                    label_id=app_.label_id,
                    applied_by=app_.applied_by
                )
            )
    return results


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
        (r.chatlog_id, r.message_index) for r in db.exec(select(LabelApplication)).all()
    }
    skipped = {
        (r.chatlog_id, r.message_index) for r in db.exec(select(SkippedMessage)).all()
    }
    excluded = labeled | skipped

    with ext_engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
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
        """)
            )
            .mappings()
            .all()
        )

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
    labeled_count = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .distinct()
            .subquery()
        )
    ).one()
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
                    FROM events GROUP BY payload->>'conversation_id'
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
                        db.add(
                            LabelApplication(
                                label_id=label_map[label_name],
                                chatlog_id=msg["chatlog_id"],
                                message_index=msg["message_index"],
                                applied_by="ai",
                            )
                        )
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
    labels = db.exec(select(LabelDefinition)).all()
    if not labels:
        return {"label_name": "", "evidence": "", "rationale": "No labels defined yet."}

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

    return {
        "label_name": labels[0].name,
        "evidence": message_text[:100],
        "rationale": "Fallback suggestion.",
    }


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
    for app in apps:
        db.delete(app)

    db.delete(label)
    db.commit()
    return DeleteLabelResponse(ok=True, deleted_applications=len(apps))


@app.get("/api/analysis/summary")
def get_analysis_summary():
    return {
        "label_counts": {"Concept Question": 22, "Clarification": 18},
        "notebook_breakdown": {"lab01": {"Concept Question": 10}},
        "coverage": {
            "human_labeled": 40,
            "ai_labeled": 0,
            "unlabeled": 260,
            "total": 300,
        },
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
