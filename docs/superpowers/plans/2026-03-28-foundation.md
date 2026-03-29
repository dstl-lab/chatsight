# Chatsight Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing batch-labeling data model and UI with four new tables, core API routes, feature route stubs, and a fully functional queue mode labeling screen.

**Architecture:** Tasks 1–6 (backend) and Tasks 7–12 (frontend) can be worked on in parallel by two team members once Task 1 is complete, since the frontend uses a mock API flag (`VITE_USE_MOCK=true`) and shared TypeScript types. The backend rewrites `models.py`, `schemas.py`, and `main.py`; it keeps `database.py` and the two existing chatlog read routes unchanged. The frontend is restructured with React Router and a queue mode screen built from focused components.

**Tech Stack:** Python/FastAPI/SQLModel/SQLite + PostgreSQL (external read-only), pytest; React 19/TypeScript/Vite 6/Tailwind v4, react-router-dom, vitest, @testing-library/react

---

## File Map

**Backend — modified:**
- `server/python/models.py` — replace `LabelSet`+`Label` with `LabelDefinition`, `LabelApplication`, `LabelingSession`, `SkippedMessage`
- `server/python/schemas.py` — replace with new Pydantic request/response shapes
- `server/python/main.py` — replace old routes; keep `_fetch_conversation_events`, `_build_content`, and the two chatlog read routes; add all new routes + stubs

**Backend — created:**
- `server/python/tests/__init__.py`
- `server/python/tests/conftest.py` — pytest fixtures
- `server/python/tests/test_labels.py` — label CRUD route tests
- `server/python/tests/test_session.py` — session route tests
- `server/python/tests/test_queue_actions.py` — apply/skip route tests
- `server/python/tests/test_stubs.py` — stub route shape tests

**Frontend — modified:**
- `src/App.tsx` — React Router + layout shell
- `src/types/index.ts` — all new TypeScript types
- `src/services/api.ts` — rewritten fetch functions + mock mode
- `vite.config.ts` — add vitest config block

**Frontend — created:**
- `src/mocks/index.ts` — mock responses for all routes
- `src/components/Navigation.tsx`
- `src/pages/QueuePage.tsx`
- `src/pages/LabelsPage.tsx`
- `src/pages/AnalysisPage.tsx`
- `src/components/queue/ProgressSidebar.tsx`
- `src/components/queue/MessageCard.tsx`
- `src/components/queue/LabelStrip.tsx`
- `src/components/queue/NewLabelPopover.tsx`
- `src/tests/setup.ts`
- `src/tests/Navigation.test.tsx`
- `src/tests/ProgressSidebar.test.tsx`
- `src/tests/MessageCard.test.tsx`
- `src/tests/LabelStrip.test.tsx`
- `src/tests/QueuePage.test.tsx`

**Frontend — deleted:**
- `src/components/BehaviorTimeline.tsx`
- `src/components/LabelsPanel.tsx`
- `src/components/LabelingDashboard.tsx`
- `src/components/SteeringPanel.tsx`
- `src/components/TranscriptPanel.tsx`
- `src/components/ChatlogList.tsx`

---

## Task 1 — Backend test infrastructure

**Files:**
- Create: `server/python/tests/__init__.py`
- Create: `server/python/tests/conftest.py`

- [ ] **Step 1: Install pytest**

```bash
cd server/python && uv add --dev pytest
```

- [ ] **Step 2: Create the tests package**

```bash
mkdir -p server/python/tests
touch server/python/tests/__init__.py
```

- [ ] **Step 3: Write `conftest.py`**

```python
# server/python/tests/conftest.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlmodel.pool import StaticPool

from main import app
from database import get_session


@pytest.fixture(name="engine")
def engine_fixture():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(name="session")
def session_fixture(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session):
    def override():
        yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
```

- [ ] **Step 4: Verify pytest discovers the fixtures**

```bash
cd server/python && uv run pytest tests/ --collect-only
```

Expected: `no tests ran` with no import errors.

- [ ] **Step 5: Commit**

```bash
git add server/python/tests/
git commit -m "test: add backend pytest infrastructure"
```

---

## Task 2 — Data model migration

**Files:**
- Modify: `server/python/models.py`
- Create: `server/python/tests/test_models_smoke.py`

- [ ] **Step 1: Write a failing smoke test**

```python
# server/python/tests/test_models_smoke.py
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage

def test_model_classes_importable():
    ld = LabelDefinition(name="Concept Question")
    assert ld.name == "Concept Question"
    assert ld.description is None
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd server/python && uv run pytest tests/test_models_smoke.py -v
```

Expected: `ImportError` — `LabelDefinition` not defined yet.

- [ ] **Step 3: Rewrite `models.py`**

```python
# server/python/models.py
from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class LabelDefinition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LabelApplication(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    applied_by: str = "human"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LabelingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime = Field(default_factory=datetime.utcnow)
    labeled_count: int = 0


class SkippedMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

- [ ] **Step 4: Run the smoke test**

```bash
cd server/python && uv run pytest tests/test_models_smoke.py -v
```

Expected: `PASSED`.

- [ ] **Step 5: Delete the old SQLite DB so tables are recreated fresh**

```bash
rm -f server/python/chatsight.db
```

- [ ] **Step 6: Commit**

```bash
git add server/python/models.py server/python/tests/test_models_smoke.py
git commit -m "feat: replace LabelSet/Label with new data model"
```

---

## Task 3 — Schemas

**Files:**
- Modify: `server/python/schemas.py`

- [ ] **Step 1: Rewrite `schemas.py`**

```python
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
```

- [ ] **Step 2: Verify import**

```bash
cd server/python && uv run python -c "from schemas import LabelDefinitionResponse, QueueItemResponse, SessionResponse; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/python/schemas.py
git commit -m "feat: rewrite schemas for new data model"
```

---

## Task 4 — Label CRUD routes

**Files:**
- Modify: `server/python/main.py`
- Create: `server/python/tests/test_labels.py`

- [ ] **Step 1: Write failing tests**

```python
# server/python/tests/test_labels.py

def test_get_labels_empty(client):
    r = client.get("/api/labels")
    assert r.status_code == 200
    assert r.json() == []


def test_create_label(client):
    r = client.post("/api/labels", json={"name": "Concept Question"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Concept Question"
    assert data["description"] is None
    assert data["count"] == 0
    assert "id" in data


def test_create_label_with_description(client):
    r = client.post("/api/labels", json={
        "name": "Clarification",
        "description": "Student asks to restate or clarify AI's explanation"
    })
    assert r.status_code == 200
    assert r.json()["description"] == "Student asks to restate or clarify AI's explanation"


def test_update_label(client):
    label_id = client.post("/api/labels", json={"name": "Old Name"}).json()["id"]
    r = client.put(f"/api/labels/{label_id}", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"


def test_get_labels_returns_count(client):
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    # No applications yet
    labels = client.get("/api/labels").json()
    assert labels[0]["count"] == 0
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server/python && uv run pytest tests/test_labels.py -v
```

Expected: all `FAILED` with 404 or similar.

- [ ] **Step 3: Rewrite `main.py` with the label routes**

Replace the entire `main.py` with:

```python
# server/python/main.py
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text
from sqlalchemy.engine import Connection
from sqlmodel import Session, select

from database import create_db_and_tables, get_session, ext_engine
from models import LabelDefinition, LabelApplication, LabelingSession, SkippedMessage
from schemas import (
    # Requests
    CreateLabelRequest, UpdateLabelRequest, ApplyLabelRequest,
    SkipMessageRequest, SuggestRequest, MergeLabelRequest, SplitLabelRequest,
    # Responses
    LabelDefinitionResponse, QueueItemResponse, SessionResponse,
    ChatlogSummary, ChatlogResponse,
)


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


# ── Helpers (kept from old code) ──────────────────────────────────────────────

def get_ext_conn():
    with ext_engine.connect() as conn:
        yield conn


def _fetch_conversation_events(conn: Connection, chatlog_id: int):
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


# ── Chatlog read routes (unchanged) ───────────────────────────────────────────

@app.get("/api/chatlogs", response_model=List[ChatlogSummary])
def list_chatlogs(conn: Connection = Depends(get_ext_conn)):
    rows = conn.execute(text("""
        SELECT MIN(id) AS id, MAX(user_email) AS user_email,
               MAX(payload->>'notebook') AS notebook, MIN(created_at) AS created_at
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
def get_chatlog(chatlog_id: int, conn: Connection = Depends(get_ext_conn)):
    rows = _fetch_conversation_events(conn, chatlog_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Chatlog not found")
    first = rows[0]
    return ChatlogResponse(
        id=chatlog_id,
        filename=f"{first['user_email']} — {first['notebook'] or 'unknown'}",
        content=_build_content(rows),
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
```

- [ ] **Step 4: Run label tests**

```bash
cd server/python && uv run pytest tests/test_labels.py -v
```

Expected: all `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_labels.py
git commit -m "feat: add label CRUD routes"
```

---

## Task 5 — Session routes

**Files:**
- Modify: `server/python/main.py` (append)
- Create: `server/python/tests/test_session.py`

- [ ] **Step 1: Write failing tests**

```python
# server/python/tests/test_session.py

def test_start_session(client):
    r = client.post("/api/session/start")
    assert r.status_code == 200
    data = r.json()
    assert data["labeled_count"] == 0
    assert "id" in data


def test_get_session(client):
    client.post("/api/session/start")
    r = client.get("/api/session")
    assert r.status_code == 200
    assert r.json()["labeled_count"] == 0


def test_get_session_404_when_none(client):
    r = client.get("/api/session")
    assert r.status_code == 404


def test_apply_label_increments_session(client):
    client.post("/api/session/start")
    label_id = client.post("/api/labels", json={"name": "Test"}).json()["id"]
    client.post("/api/queue/apply", json={
        "chatlog_id": 1, "message_index": 0, "label_id": label_id
    })
    assert client.get("/api/session").json()["labeled_count"] == 1
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server/python && uv run pytest tests/test_session.py -v
```

Expected: all `FAILED`.

- [ ] **Step 3: Append session + apply + skip routes to `main.py`**

Add after the label routes:

```python
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
```

- [ ] **Step 4: Run session tests**

```bash
cd server/python && uv run pytest tests/test_session.py -v
```

Expected: all `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_session.py
git commit -m "feat: add session and queue apply/skip routes"
```

---

## Task 6 — Queue fetch route + stub routes

**Files:**
- Modify: `server/python/main.py` (append)
- Create: `server/python/tests/test_stubs.py`

> **Note:** `GET /api/queue` queries the external PostgreSQL DB (`kubectl port-forward` must be running). It has no unit test — verify it manually with the dev server running.

- [ ] **Step 1: Write stub shape tests**

```python
# server/python/tests/test_stubs.py

def test_suggest_stub(client):
    r = client.post("/api/queue/suggest", json={"chatlog_id": 1, "message_index": 0})
    assert r.status_code == 200
    data = r.json()
    assert "label_name" in data
    assert "evidence" in data
    assert "rationale" in data


def test_merge_stub(client):
    r = client.post("/api/labels/merge", json={"source_label_id": 1, "target_label_id": 2})
    assert r.status_code == 200


def test_split_stub(client):
    r = client.post("/api/labels/split", json={"label_id": 1, "name_a": "A", "name_b": "B"})
    assert r.status_code == 200


def test_analysis_summary_stub(client):
    r = client.get("/api/analysis/summary")
    assert r.status_code == 200
    data = r.json()
    assert "label_counts" in data
    assert "coverage" in data


def test_export_csv_stub(client):
    r = client.get("/api/export/csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]


def test_recalibration_stub(client):
    r = client.get("/api/session/recalibration")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_queue_sample_stub(client):
    r = client.get("/api/queue/sample")
    assert r.status_code == 200
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd server/python && uv run pytest tests/test_stubs.py -v
```

Expected: all `FAILED` with 404/405.

- [ ] **Step 3: Append queue fetch + all stubs to `main.py`**

```python
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
```

- [ ] **Step 4: Run all backend tests**

```bash
cd server/python && uv run pytest tests/ -v
```

Expected: all `PASSED`. (`test_models_smoke.py` + label + session + stub tests)

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_stubs.py
git commit -m "feat: add queue fetch route and feature stub routes"
```

---

## Task 7 — Frontend test infra, TypeScript types, mock API, and service layer

> **Parallel start point:** Frontend tasks 7–12 can begin while Task 4–6 are in progress, since the frontend runs against mock data.

**Files:**
- Modify: `vite.config.ts`, `src/types/index.ts`, `src/services/api.ts`
- Create: `src/mocks/index.ts`, `src/tests/setup.ts`

- [ ] **Step 1: Install frontend test dependencies and React Router**

```bash
npm install react-router-dom
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Update `vite.config.ts` to add vitest config**

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:8000' }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
  },
})
```

- [ ] **Step 3: Add test script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create `src/tests/setup.ts`**

```typescript
// src/tests/setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Write `src/types/index.ts`**

```typescript
// src/types/index.ts

export interface LabelDefinition {
  id: number
  name: string
  description: string | null
  created_at: string
  count: number
}

export interface QueueItem {
  chatlog_id: number
  message_index: number
  message_text: string
  context_before: string | null
  context_after: string | null
}

export interface LabelingSession {
  id: number
  started_at: string
  last_active: string
  labeled_count: number
}

export interface SuggestResponse {
  label_name: string
  evidence: string
  rationale: string
}

export interface AnalysisSummary {
  label_counts: Record<string, number>
  notebook_breakdown: Record<string, Record<string, number>>
  coverage: {
    human_labeled: number
    ai_labeled: number
    unlabeled: number
    total: number
  }
}

export interface ApplyLabelRequest {
  chatlog_id: number
  message_index: number
  label_id: number
}

export interface CreateLabelRequest {
  name: string
  description?: string
}

export interface UpdateLabelRequest {
  name?: string
  description?: string
}
```

- [ ] **Step 6: Write `src/mocks/index.ts`**

```typescript
// src/mocks/index.ts
import type { LabelDefinition, QueueItem, LabelingSession, SuggestResponse } from '../types'

export const mockApi = {
  queue: [
    {
      chatlog_id: 1,
      message_index: 0,
      message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
      context_before: "You can think of it like a spreadsheet with rows and columns...",
      context_after: "Great question! The key difference is that DataFrames are optimized for...",
    },
    {
      chatlog_id: 1,
      message_index: 2,
      message_text: "How do I filter rows where the grade column is above 90?",
      context_before: "You can use boolean indexing to filter DataFrames...",
      context_after: "Exactly. You can also use df.query('grade > 90') for the same result.",
    },
  ] satisfies QueueItem[],

  labels: [
    { id: 1, name: "Concept Question", description: "Student asks for an explanation of a new concept", created_at: "2026-03-28T00:00:00", count: 5 },
    { id: 2, name: "Clarification", description: null, created_at: "2026-03-28T00:00:00", count: 3 },
    { id: 3, name: "Debug Help", description: "Student needs help fixing an error", created_at: "2026-03-28T00:00:00", count: 2 },
  ] satisfies LabelDefinition[],

  session: {
    id: 1,
    started_at: "2026-03-28T10:00:00",
    last_active: "2026-03-28T10:30:00",
    labeled_count: 14,
  } satisfies LabelingSession,

  suggestion: {
    label_name: "Concept Question",
    evidence: "explain what a DataFrame is",
    rationale: "Student asks for a definition of a new concept, not debugging help.",
  } satisfies SuggestResponse,
}
```

- [ ] **Step 7: Write `src/services/api.ts`**

```typescript
// src/services/api.ts
import type {
  LabelDefinition, QueueItem, LabelingSession, SuggestResponse,
  ApplyLabelRequest, CreateLabelRequest, UpdateLabelRequest,
} from '../types'
import { mockApi } from '../mocks'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  getQueue: (limit = 20): Promise<QueueItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.queue)
             : req(`/api/queue?limit=${limit}`),

  applyLabel: (body: ApplyLabelRequest): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req('/api/queue/apply', { method: 'POST', ...json(body) }),

  skipMessage: (chatlog_id: number, message_index: number): Promise<void> =>
    USE_MOCK ? Promise.resolve()
             : req('/api/queue/skip', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  suggestLabel: (chatlog_id: number, message_index: number): Promise<SuggestResponse> =>
    USE_MOCK ? Promise.resolve(mockApi.suggestion)
             : req('/api/queue/suggest', { method: 'POST', ...json({ chatlog_id, message_index }) }),

  getLabels: (): Promise<LabelDefinition[]> =>
    USE_MOCK ? Promise.resolve(mockApi.labels)
             : req('/api/labels'),

  createLabel: (body: CreateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve({ ...body, id: Date.now(), description: body.description ?? null, created_at: new Date().toISOString(), count: 0 })
             : req('/api/labels', { method: 'POST', ...json(body) }),

  updateLabel: (id: number, body: UpdateLabelRequest): Promise<LabelDefinition> =>
    USE_MOCK ? Promise.resolve(mockApi.labels[0])
             : req(`/api/labels/${id}`, { method: 'PUT', ...json(body) }),

  getSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session'),

  startSession: (): Promise<LabelingSession> =>
    USE_MOCK ? Promise.resolve(mockApi.session)
             : req('/api/session/start', { method: 'POST' }),
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts src/types/index.ts src/services/api.ts src/mocks/index.ts src/tests/setup.ts package.json package-lock.json
git commit -m "feat: add frontend test infra, types, mock API, and service layer"
```

---

## Task 8 — Frontend shell (React Router + Navigation + placeholder pages)

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/Navigation.tsx`, `src/pages/LabelsPage.tsx`, `src/pages/AnalysisPage.tsx`
- Create: `src/tests/Navigation.test.tsx`

- [ ] **Step 1: Write failing navigation test**

```tsx
// src/tests/Navigation.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navigation } from '../components/Navigation'

test('renders Queue, Labels, and Analysis links', () => {
  render(<MemoryRouter><Navigation /></MemoryRouter>)
  expect(screen.getByText('Queue')).toBeInTheDocument()
  expect(screen.getByText('Labels')).toBeInTheDocument()
  expect(screen.getByText('Analysis')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test
```

Expected: `FAILED` — `Navigation` not found.

- [ ] **Step 3: Write `src/components/Navigation.tsx`**

```tsx
// src/components/Navigation.tsx
import { NavLink } from 'react-router-dom'

export function Navigation() {
  return (
    <nav className="flex items-center gap-6 px-6 py-3 border-b border-neutral-800 bg-neutral-950 shrink-0">
      <span className="text-sm font-semibold text-white tracking-wide">Chatsight</span>
      <div className="flex gap-5 ml-4">
        {[
          { to: '/queue', label: 'Queue' },
          { to: '/labels', label: 'Labels' },
          { to: '/analysis', label: 'Analysis' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `text-sm transition-colors ${isActive ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Write placeholder pages**

```tsx
// src/pages/LabelsPage.tsx
export function LabelsPage() {
  return (
    <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      Label Management — coming soon
    </div>
  )
}
```

```tsx
// src/pages/AnalysisPage.tsx
export function AnalysisPage() {
  return (
    <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
      Analysis — coming soon
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `src/App.tsx`**

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { QueuePage } from './pages/QueuePage'
import { LabelsPage } from './pages/LabelsPage'
import { AnalysisPage } from './pages/AnalysisPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
        <Navigation />
        <main className="flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/queue" replace />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
```

> `QueuePage` doesn't exist yet — create a temporary stub so the app compiles:
> ```tsx
> // src/pages/QueuePage.tsx (temporary stub — replaced in Task 12)
> export function QueuePage() {
>   return <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">Queue loading...</div>
> }
> ```

- [ ] **Step 6: Run navigation test**

```bash
npm test
```

Expected: `Navigation.test.tsx` — `PASSED`.

- [ ] **Step 7: Verify app builds**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/Navigation.tsx src/pages/LabelsPage.tsx src/pages/AnalysisPage.tsx src/pages/QueuePage.tsx src/tests/Navigation.test.tsx
git commit -m "feat: add React Router shell with Navigation and placeholder pages"
```

---

## Task 9 — ProgressSidebar

**Files:**
- Create: `src/components/queue/ProgressSidebar.tsx`
- Create: `src/tests/ProgressSidebar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/tests/ProgressSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { mockApi } from '../mocks'

test('shows labeled count and total', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      totalMessages={100}
      skippedCount={0}
    />
  )
  expect(screen.getByText('14 / 100')).toBeInTheDocument()
})

test('shows skipped count when non-zero', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      totalMessages={100}
      skippedCount={5}
    />
  )
  expect(screen.getByText('Skipped: 5')).toBeInTheDocument()
})

test('renders all label names', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      totalMessages={100}
      skippedCount={0}
    />
  )
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test
```

Expected: `ProgressSidebar.test.tsx` — `FAILED`.

- [ ] **Step 3: Write `src/components/queue/ProgressSidebar.tsx`**

```tsx
// src/components/queue/ProgressSidebar.tsx
import type { LabelDefinition, LabelingSession } from '../../types'

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  totalMessages: number
  skippedCount: number
}

export function ProgressSidebar({ session, labels, totalMessages, skippedCount }: Props) {
  const labeled = session?.labeled_count ?? 0
  const pct = totalMessages > 0 ? Math.round((labeled / totalMessages) * 100) : 0

  return (
    <aside className="w-40 shrink-0 border-r border-neutral-800 p-3 flex flex-col gap-4 overflow-y-auto">
      <div>
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Progress</p>
        <div className="h-1 bg-neutral-800 rounded-full mb-1">
          <div className="h-1 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-neutral-200">{labeled} / {totalMessages}</p>
        {skippedCount > 0 && (
          <p className="text-[9px] text-neutral-500 italic mt-1">Skipped: {skippedCount}</p>
        )}
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
        <div className="flex flex-col gap-1">
          {labels.map(label => (
            <div key={label.id} className="flex justify-between items-center bg-neutral-900 rounded px-2 py-1">
              <span className="text-[10px] text-neutral-200 truncate" title={label.name}>
                {label.name}
              </span>
              <span className="text-[9px] text-neutral-500 ml-1 shrink-0">{label.count}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: `ProgressSidebar.test.tsx` — `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/components/queue/ProgressSidebar.tsx src/tests/ProgressSidebar.test.tsx
git commit -m "feat: add ProgressSidebar component"
```

---

## Task 10 — MessageCard

**Files:**
- Create: `src/components/queue/MessageCard.tsx`
- Create: `src/tests/MessageCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/tests/MessageCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageCard } from '../components/queue/MessageCard'
import { mockApi } from '../mocks'

const item = mockApi.queue[0]

test('renders student message text', () => {
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  expect(screen.getByText(item.message_text)).toBeInTheDocument()
})

test('shows AI lock indicator when not unlocked', () => {
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  expect(screen.getByText(/AI unlocks at 50/i)).toBeInTheDocument()
})

test('shows ghost tag with why? when AI unlocked and suggestion present', () => {
  render(<MessageCard item={item} aiUnlocked={true} suggestion={mockApi.suggestion} onSkip={() => {}} />)
  expect(screen.getByText(/Concept Question/)).toBeInTheDocument()
  expect(screen.getByText(/why\?/i)).toBeInTheDocument()
})

test('expands rationale when why? is clicked', () => {
  render(<MessageCard item={item} aiUnlocked={true} suggestion={mockApi.suggestion} onSkip={() => {}} />)
  fireEvent.click(screen.getByText(/why\?/i))
  expect(screen.getByText(mockApi.suggestion.rationale)).toBeInTheDocument()
})

test('calls onSkip when skip button clicked', () => {
  const onSkip = vi.fn()
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={onSkip} />)
  fireEvent.click(screen.getByText(/skip/i))
  expect(onSkip).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test
```

Expected: `MessageCard.test.tsx` — `FAILED`.

- [ ] **Step 3: Write `src/components/queue/MessageCard.tsx`**

```tsx
// src/components/queue/MessageCard.tsx
import { useState } from 'react'
import type { QueueItem, SuggestResponse } from '../../types'

interface Props {
  item: QueueItem
  aiUnlocked: boolean
  suggestion: SuggestResponse | null
  onSkip: () => void
}

export function MessageCard({ item, aiUnlocked, suggestion, onSkip }: Props) {
  const [showRationale, setShowRationale] = useState(false)

  return (
    <div className="flex-1 flex flex-col gap-2 p-3 overflow-y-auto">
      {item.context_before && (
        <div className="bg-neutral-900 border-l-2 border-neutral-700 rounded px-3 py-2">
          <span className="text-[9px] uppercase text-neutral-600 block mb-1">AI</span>
          <p className="text-[11px] text-neutral-500 leading-relaxed">{item.context_before}</p>
        </div>
      )}

      <div className="relative flex-1 bg-[#0d1f33] border border-blue-800 rounded p-3">
        <span className="text-[9px] uppercase tracking-wide text-blue-400 block mb-2">
          Student · message {item.message_index}
        </span>
        <p className="text-sm text-neutral-100 leading-relaxed">{item.message_text}</p>

        <div className="absolute bottom-2 right-2">
          {aiUnlocked && suggestion ? (
            <button
              onClick={() => setShowRationale(v => !v)}
              className="text-[9px] text-neutral-500 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 hover:text-neutral-300 transition-colors"
            >
              ✦ {suggestion.label_name} · why?
            </button>
          ) : !aiUnlocked ? (
            <span className="text-[8px] text-neutral-600 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5">
              AI unlocks at 50
            </span>
          ) : null}
        </div>
      </div>

      {showRationale && suggestion && (
        <div className="border-l-2 border-neutral-700 pl-3 py-1">
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            <span className="text-neutral-600">Evidence: </span>
            &ldquo;{suggestion.evidence}&rdquo;
          </p>
          <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
            <span className="text-neutral-600">Rationale: </span>
            {suggestion.rationale}
          </p>
        </div>
      )}

      {item.context_after && (
        <div className="bg-neutral-900 border-l-2 border-neutral-700 rounded px-3 py-2">
          <span className="text-[9px] uppercase text-neutral-600 block mb-1">AI</span>
          <p className="text-[11px] text-neutral-500 leading-relaxed">{item.context_after}</p>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onSkip}
          className="text-xs text-neutral-500 border border-neutral-700 rounded px-3 py-1 hover:text-neutral-300 hover:border-neutral-500 transition-colors"
        >
          Skip →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: `MessageCard.test.tsx` — `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/components/queue/MessageCard.tsx src/tests/MessageCard.test.tsx
git commit -m "feat: add MessageCard component with AI ghost tag and rationale"
```

---

## Task 11 — LabelStrip and NewLabelPopover

**Files:**
- Create: `src/components/queue/LabelStrip.tsx`
- Create: `src/components/queue/NewLabelPopover.tsx`
- Create: `src/tests/LabelStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/tests/LabelStrip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { LabelStrip } from '../components/queue/LabelStrip'
import { mockApi } from '../mocks'

test('renders all label chips', () => {
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={() => {}} />)
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
  expect(screen.getByText('Debug Help')).toBeInTheDocument()
})

test('calls onApply with correct id when chip clicked', () => {
  const onApply = vi.fn()
  render(<LabelStrip labels={mockApi.labels} onApply={onApply} onCreateAndApply={() => {}} />)
  fireEvent.click(screen.getByText('Concept Question'))
  expect(onApply).toHaveBeenCalledWith(1)
})

test('shows new label popover when + New label clicked', () => {
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={() => {}} />)
  fireEvent.click(screen.getByText('+ New label'))
  expect(screen.getByPlaceholderText('Label name (required)')).toBeInTheDocument()
})

test('calls onCreateAndApply when popover confirmed', () => {
  const onCreateAndApply = vi.fn()
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={onCreateAndApply} />)
  fireEvent.click(screen.getByText('+ New label'))
  fireEvent.change(screen.getByPlaceholderText('Label name (required)'), {
    target: { value: 'New Label' },
  })
  fireEvent.click(screen.getByText('Create & apply'))
  expect(onCreateAndApply).toHaveBeenCalledWith('New Label', undefined)
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test
```

Expected: `LabelStrip.test.tsx` — `FAILED`.

- [ ] **Step 3: Write `src/components/queue/NewLabelPopover.tsx`**

```tsx
// src/components/queue/NewLabelPopover.tsx
import { useState } from 'react'

interface Props {
  onConfirm: (name: string, description?: string) => void
  onCancel: () => void
}

export function NewLabelPopover({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleConfirm = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed, description.trim() || undefined)
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 bg-neutral-900 border border-neutral-700 rounded-lg p-4 shadow-2xl w-72 z-10">
      <p className="text-xs text-neutral-300 font-medium mb-3">New label</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        placeholder="Label name (required)"
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 mb-2 focus:outline-none focus:border-blue-600"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 mb-3 focus:outline-none focus:border-blue-600 resize-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-neutral-500 px-3 py-1 hover:text-neutral-300"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="text-xs bg-blue-600 text-white rounded px-3 py-1 disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          Create & apply
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `src/components/queue/LabelStrip.tsx`**

```tsx
// src/components/queue/LabelStrip.tsx
import { useState } from 'react'
import type { LabelDefinition } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'

interface Props {
  labels: LabelDefinition[]
  onApply: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
}

export function LabelStrip({ labels, onApply, onCreateAndApply }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  return (
    <div className="border-t border-neutral-800 px-3 py-2 relative shrink-0">
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <button
            key={label.id}
            onClick={() => onApply(label.id)}
            className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 hover:border-blue-600 transition-colors"
          >
            {label.name}
          </button>
        ))}
        <button
          onClick={() => setShowPopover(true)}
          className="bg-transparent border border-dashed border-neutral-700 rounded px-3 py-1 text-xs text-blue-400 hover:border-blue-500 transition-colors"
        >
          + New label
        </button>
      </div>

      {showPopover && (
        <NewLabelPopover
          onConfirm={(name, description) => {
            onCreateAndApply(name, description)
            setShowPopover(false)
          }}
          onCancel={() => setShowPopover(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: `LabelStrip.test.tsx` — `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add src/components/queue/LabelStrip.tsx src/components/queue/NewLabelPopover.tsx src/tests/LabelStrip.test.tsx
git commit -m "feat: add LabelStrip and NewLabelPopover components"
```

---

## Task 12 — QueuePage

**Files:**
- Modify: `src/pages/QueuePage.tsx` (replace stub)
- Create: `src/tests/QueuePage.test.tsx`

- [ ] **Step 1: Write a failing integration test**

```tsx
// src/tests/QueuePage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { QueuePage } from '../pages/QueuePage'
import * as apiModule from '../services/api'
import { mockApi } from '../mocks'

vi.mock('../services/api', () => ({
  api: {
    startSession: vi.fn().mockResolvedValue(mockApi.session),
    getLabels: vi.fn().mockResolvedValue(mockApi.labels),
    getQueue: vi.fn().mockResolvedValue(mockApi.queue),
    applyLabel: vi.fn().mockResolvedValue(undefined),
    skipMessage: vi.fn().mockResolvedValue(undefined),
    createLabel: vi.fn().mockResolvedValue({ id: 99, name: 'New', description: null, created_at: '', count: 0 }),
  },
}))

const renderQueue = () =>
  render(<MemoryRouter><QueuePage /></MemoryRouter>)

test('shows first message after loading', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getByText(mockApi.queue[0].message_text)).toBeInTheDocument()
  })
})

test('shows label chips', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getByText('Concept Question')).toBeInTheDocument()
  })
})

test('advances to next message when label chip clicked', async () => {
  renderQueue()
  await waitFor(() => screen.getByText(mockApi.queue[0].message_text))
  fireEvent.click(screen.getByText('Concept Question'))
  await waitFor(() => {
    expect(screen.getByText(mockApi.queue[1].message_text)).toBeInTheDocument()
  })
})

test('skips current message when skip clicked', async () => {
  renderQueue()
  await waitFor(() => screen.getByText(mockApi.queue[0].message_text))
  fireEvent.click(screen.getByText(/skip/i))
  expect(apiModule.api.skipMessage).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test
```

Expected: `QueuePage.test.tsx` — `FAILED` (stub `QueuePage` doesn't load data).

- [ ] **Step 3: Replace stub `src/pages/QueuePage.tsx` with full implementation**

```tsx
// src/pages/QueuePage.tsx
import { useState, useEffect, useCallback } from 'react'
import type { QueueItem, LabelDefinition, LabelingSession } from '../types'
import { api } from '../services/api'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { MessageCard } from '../components/queue/MessageCard'
import { LabelStrip } from '../components/queue/LabelStrip'

export function QueuePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [labels, setLabels] = useState<LabelDefinition[]>([])
  const [session, setSession] = useState<LabelingSession | null>(null)
  const [skippedCount, setSkippedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const currentMessage = queue[currentIdx] ?? null
  const aiUnlocked = (session?.labeled_count ?? 0) >= 50

  const loadQueue = useCallback(async () => {
    const q = await api.getQueue(20)
    setQueue(q)
  }, [])

  useEffect(() => {
    Promise.all([api.startSession(), api.getLabels(), api.getQueue(20)])
      .then(([sess, lbls, q]) => {
        setSession(sess)
        setLabels(lbls)
        setQueue(q)
        setLoading(false)
      })
  }, [])

  const advance = useCallback(() => {
    setCurrentIdx(i => {
      const next = i + 1
      if (next < queue.length) return next
      loadQueue()
      return 0
    })
  }, [queue.length, loadQueue])

  const handleApplyLabel = async (labelId: number) => {
    if (!currentMessage) return
    await api.applyLabel({
      chatlog_id: currentMessage.chatlog_id,
      message_index: currentMessage.message_index,
      label_id: labelId,
    })
    setSession(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
    api.getLabels().then(setLabels)
    advance()
  }

  const handleCreateAndApply = async (name: string, description?: string) => {
    if (!currentMessage) return
    const newLabel = await api.createLabel({ name, description })
    setLabels(prev => [...prev, newLabel])
    await api.applyLabel({
      chatlog_id: currentMessage.chatlog_id,
      message_index: currentMessage.message_index,
      label_id: newLabel.id,
    })
    setSession(s => s ? { ...s, labeled_count: s.labeled_count + 1 } : s)
    advance()
  }

  const handleSkip = async () => {
    if (!currentMessage) return
    await api.skipMessage(currentMessage.chatlog_id, currentMessage.message_index)
    setSkippedCount(s => s + 1)
    advance()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        Loading...
      </div>
    )
  }

  if (!currentMessage) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        All messages labeled!
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-1 min-h-0">
        <ProgressSidebar
          session={session}
          labels={labels}
          totalMessages={queue.length}
          skippedCount={skippedCount}
        />
        <MessageCard
          item={currentMessage}
          aiUnlocked={aiUnlocked}
          suggestion={null}
          onSkip={handleSkip}
        />
      </div>
      <LabelStrip
        labels={labels}
        onApply={handleApplyLabel}
        onCreateAndApply={handleCreateAndApply}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run all frontend tests**

```bash
npm test
```

Expected: all `PASSED`.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/QueuePage.tsx src/tests/QueuePage.test.tsx
git commit -m "feat: implement QueuePage — fully functional queue mode screen"
```

---

## Task 13 — Cleanup

**Files:**
- Delete: `src/components/BehaviorTimeline.tsx`, `src/components/LabelsPanel.tsx`, `src/components/LabelingDashboard.tsx`, `src/components/SteeringPanel.tsx`, `src/components/TranscriptPanel.tsx`, `src/components/ChatlogList.tsx`

- [ ] **Step 1: Delete old components**

```bash
rm src/components/BehaviorTimeline.tsx \
   src/components/LabelsPanel.tsx \
   src/components/LabelingDashboard.tsx \
   src/components/SteeringPanel.tsx \
   src/components/TranscriptPanel.tsx \
   src/components/ChatlogList.tsx
```

- [ ] **Step 2: Verify build passes with no dangling imports**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Run all tests**

```bash
npm test && cd server/python && uv run pytest tests/ -v
```

Expected: all `PASSED`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: remove old batch-labeling components"
```

---

## Running the full foundation

To verify everything works end-to-end with real data:

```bash
# Terminal 1 — backend
cd server/python && uv run uvicorn main:app --reload

# Terminal 2 — frontend (real API)
npm run dev

# Terminal 2 — frontend (mock API, no backend needed)
VITE_USE_MOCK=true npm run dev
```

Open http://localhost:5173 — you should see the queue mode with the first student message loaded, label chips at the bottom, and progress in the sidebar.
