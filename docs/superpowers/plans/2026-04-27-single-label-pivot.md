# Single-Label Binary Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User preference:** The user reviews and commits code themselves. Treat the `Commit` step as documentation of *what* should be in the commit; do not run `git commit` unless the user explicitly asks.

**Goal:** Pivot Chatsight from multi-label per-message labeling to single-label binary (yes/no/skip) classification with conversation-level cycling and per-label Gemini handoff.

**Architecture:** New branch `single-label-pivot` (worktree). Reuses existing `LabelDefinition` and `LabelApplication` tables with added fields (`phase`, `is_active`, `value`); adds `ConversationCursor`. Queue ordering walks one conversation start-to-end before jumping to the next. Single label "active" at a time. Gemini handoff fills remaining unlabeled messages for the active label; instructor reviews low-confidence predictions.

**Tech Stack:** FastAPI + SQLModel + SQLite (backend); React 19 + Vite + TypeScript + Tailwind v4 + Vitest (frontend); Google Gemini via function-calling.

**Spec:** [`docs/superpowers/specs/2026-04-27-single-label-pivot-design.md`](../specs/2026-04-27-single-label-pivot-design.md)

---

## File Structure

**Backend (`server/python/`)**
- `models.py` — modify `LabelDefinition`, `LabelApplication`, `LabelingSession`; add `ConversationCursor`
- `database.py` — add `LOCAL_DB_PATH` env var, schema migrations for new columns
- `schemas.py` — add request/response shapes for new endpoints
- `queue_service.py` *(new)* — conversation-level next-message logic
- `decision_service.py` *(new)* — yes/no/skip + undo + readiness
- `binary_autolabel_service.py` *(new)* — Gemini binary classifier
- `main.py` — add new routes
- `tests/test_single_label_models.py` *(new)*
- `tests/test_queue_service.py` *(new)*
- `tests/test_decision_service.py` *(new)*
- `tests/test_binary_handoff.py` *(new)*
- `tests/test_single_label_routes.py` *(new)*

**Frontend (`src/`)**
- `App.tsx` — routing changes
- `types/index.ts` — add binary-decision types
- `services/api.ts` — add binary-decision helpers
- `mocks/index.ts` — add mock data for new endpoints
- `pages/LabelRunPage.tsx` *(new)*
- `pages/LabelsPage.tsx` — convert to dashboard
- `components/run/LabelHeader.tsx` *(new)*
- `components/run/ConversationContext.tsx` *(new)*
- `components/run/FocusedMessage.tsx` *(new)*
- `components/run/DecisionBar.tsx` *(new)*
- `components/run/ReadinessGauge.tsx` *(new)*
- `tests/DecisionBar.test.tsx` *(new)*
- `tests/ReadinessGauge.test.tsx` *(new)*
- `tests/LabelRunPage.test.tsx` *(new)*

---

## Task 0: Set up branch and isolated database

**Files:**
- Create: worktree at `../chatsight-single-label`
- Modify: `server/python/database.py`

- [ ] **Step 1: Create the worktree and branch**

```bash
git -C /Users/minchan/github/chatsight worktree add -b single-label-pivot ../chatsight-single-label main
cd /Users/minchan/github/chatsight-single-label
```

Expected: new directory at `../chatsight-single-label`, on branch `single-label-pivot`.

- [ ] **Step 2: Make local DB path configurable via env var**

Modify `server/python/database.py:8`:

```python
DATABASE_URL = os.environ.get("LOCAL_DB_URL", "sqlite:///./chatsight.db")
engine = create_engine(DATABASE_URL, echo=False)
```

- [ ] **Step 3: Add a `.env.local` for the worktree**

Create `.env.local` in worktree root (gitignored):

```
LOCAL_DB_URL=sqlite:///./chatsight-single.db
```

Update or document the run command:

```bash
LOCAL_DB_URL=sqlite:///./chatsight-single.db uv run uvicorn main:app --reload
```

- [ ] **Step 4: Verify backend boots with the new DB**

```bash
cd server/python && LOCAL_DB_URL=sqlite:///./chatsight-single.db uv run python -c "from database import engine; from sqlmodel import SQLModel; SQLModel.metadata.create_all(engine); print('ok')"
```

Expected: prints `ok`, creates `chatsight-single.db` in `server/python/`.

- [ ] **Step 5: Commit**

```bash
git add server/python/database.py
git commit -m "feat: configurable local DB path via LOCAL_DB_URL"
```

---

## Task 1: Extend `LabelDefinition` with phase + is_active

**Files:**
- Modify: `server/python/models.py:8-14`
- Modify: `server/python/database.py` (migration)
- Test: `server/python/tests/test_single_label_models.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_single_label_models.py`:

```python
from sqlmodel import Session, select
from models import LabelDefinition


def test_label_definition_has_phase_and_is_active(session: Session):
    label = LabelDefinition(name="Concept Question")
    session.add(label)
    session.commit()
    session.refresh(label)
    assert label.phase == "labeling"
    assert label.is_active is False


def test_only_one_label_can_be_active(session: Session):
    a = LabelDefinition(name="A", is_active=True)
    b = LabelDefinition(name="B", is_active=True)
    session.add(a)
    session.add(b)
    session.commit()
    # Both can be flagged in raw DB, but the activate service (Task 5) enforces uniqueness.
    # This test just verifies the field exists and is settable.
    rows = session.exec(select(LabelDefinition).where(LabelDefinition.is_active == True)).all()
    assert len(rows) == 2
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: FAIL — `phase` / `is_active` attributes don't exist.

- [ ] **Step 3: Add fields to `LabelDefinition`**

Modify `server/python/models.py:8-14`:

```python
class LabelDefinition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    sort_order: int = Field(default=0)
    phase: str = Field(default="labeling")  # labeling | handed_off | reviewing | complete
    is_active: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: Optional[datetime] = Field(default=None)
```

- [ ] **Step 4: Add migration in `database.py`**

Add inside `create_db_and_tables` after the existing migration block (around line 28):

```python
        if "phase" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN phase TEXT NOT NULL DEFAULT 'labeling'"))
            conn.commit()
        if "is_active" not in cols:
            conn.execute(text("ALTER TABLE labeldefinition ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
```

- [ ] **Step 5: Run tests (expect pass)**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add server/python/models.py server/python/database.py server/python/tests/test_single_label_models.py
git commit -m "feat: add phase and is_active to LabelDefinition"
```

---

## Task 2: Extend `LabelApplication` with value + unique constraint

**Files:**
- Modify: `server/python/models.py:17-24`
- Modify: `server/python/database.py`
- Test: `server/python/tests/test_single_label_models.py`

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_single_label_models.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError
from models import LabelApplication


def test_label_application_has_value(session: Session):
    label = LabelDefinition(name="X")
    session.add(label)
    session.commit()
    session.refresh(label)
    app = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    session.add(app)
    session.commit()
    session.refresh(app)
    assert app.value == "yes"


def test_unique_decision_per_label_message(session: Session):
    label = LabelDefinition(name="X")
    session.add(label)
    session.commit()
    session.refresh(label)
    a = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    b = LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="no")
    session.add(a)
    session.commit()
    session.add(b)
    with pytest.raises(IntegrityError):
        session.commit()
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: FAIL — `value` attribute missing.

- [ ] **Step 3: Add `value` field and unique constraint**

Modify `server/python/models.py:17-24`:

```python
class LabelApplication(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", "message_index", name="uq_labelapp_label_msg"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    message_index: int
    value: str = Field(default="yes")  # yes | no | skip
    applied_by: str = "human"
    confidence: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

- [ ] **Step 4: Add migration**

In `database.py`, inside `create_db_and_tables` after existing `cols_la` block:

```python
        if "value" not in cols_la:
            conn.execute(text("ALTER TABLE labelapplication ADD COLUMN value TEXT NOT NULL DEFAULT 'yes'"))
            conn.commit()
        # Note: unique constraint added on fresh DB only; existing rows on `main` are not migrated (separate DB file).
```

- [ ] **Step 5: Run tests**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add server/python/models.py server/python/database.py server/python/tests/test_single_label_models.py
git commit -m "feat: add value column and uniqueness to LabelApplication"
```

---

## Task 3: Add `ConversationCursor` model + extend `LabelingSession`

**Files:**
- Modify: `server/python/models.py:27-32`
- Add: new model `ConversationCursor`
- Test: `server/python/tests/test_single_label_models.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
from models import LabelingSession, ConversationCursor


def test_labeling_session_has_label_id_and_timestamps(session: Session):
    label = LabelDefinition(name="Y")
    session.add(label)
    session.commit()
    session.refresh(label)
    s = LabelingSession(label_id=label.id)
    session.add(s)
    session.commit()
    session.refresh(s)
    assert s.label_id == label.id
    assert s.handed_off_at is None
    assert s.closed_at is None


def test_conversation_cursor_unique_per_label_chatlog(session: Session):
    label = LabelDefinition(name="Z")
    session.add(label)
    session.commit()
    session.refresh(label)
    c = ConversationCursor(label_id=label.id, chatlog_id=42, last_message_index=3)
    session.add(c)
    session.commit()
    session.refresh(c)
    assert c.last_message_index == 3
    dup = ConversationCursor(label_id=label.id, chatlog_id=42, last_message_index=5)
    session.add(dup)
    with pytest.raises(IntegrityError):
        session.commit()
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: FAIL — `label_id` not on `LabelingSession`, `ConversationCursor` not importable.

- [ ] **Step 3: Update `LabelingSession`**

Modify `server/python/models.py:27-32`:

```python
class LabelingSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: Optional[int] = Field(default=None, foreign_key="labeldefinition.id")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime = Field(default_factory=datetime.utcnow)
    handed_off_at: Optional[datetime] = Field(default=None)
    closed_at: Optional[datetime] = Field(default=None)
    labeled_count: int = 0
```

- [ ] **Step 4: Add `ConversationCursor` model**

Append to `server/python/models.py`:

```python
class ConversationCursor(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", name="uq_cursor_label_chatlog"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id")
    chatlog_id: int
    last_message_index: int = Field(default=-1)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

- [ ] **Step 5: Add migrations for new `LabelingSession` columns**

In `database.py`:

```python
        cols_ls = [c["name"] for c in inspect(conn).get_columns("labelingsession")]
        if "label_id" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN label_id INTEGER"))
            conn.commit()
        if "handed_off_at" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN handed_off_at DATETIME"))
            conn.commit()
        if "closed_at" not in cols_ls:
            conn.execute(text("ALTER TABLE labelingsession ADD COLUMN closed_at DATETIME"))
            conn.commit()
```

- [ ] **Step 6: Run tests**

```bash
cd server/python && uv run pytest tests/test_single_label_models.py -v
```

Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add server/python/models.py server/python/database.py server/python/tests/test_single_label_models.py
git commit -m "feat: add ConversationCursor and extend LabelingSession"
```

---

## Task 4: Queue service — next message in conversation order

**Files:**
- Create: `server/python/queue_service.py`
- Test: `server/python/tests/test_queue_service.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_queue_service.py`:

```python
from sqlmodel import Session
from models import LabelDefinition, LabelApplication, MessageCache
from queue_service import next_undecided_message


def _seed_label(session: Session, name="L") -> LabelDefinition:
    label = LabelDefinition(name=name, is_active=True)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def _seed_msg(session: Session, chatlog_id: int, idx: int, text: str = "msg"):
    session.add(MessageCache(chatlog_id=chatlog_id, message_index=idx, message_text=text))
    session.commit()


def test_returns_first_message_of_first_conversation(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    _seed_msg(session, 200, 0)
    result = next_undecided_message(session, label_id=label.id)
    assert result is not None
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 0


def test_skips_decided_messages(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="yes"))
    session.commit()
    result = next_undecided_message(session, label_id=label.id)
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 1


def test_finishes_in_progress_conversation_before_starting_new_one(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    _seed_msg(session, 100, 1)
    _seed_msg(session, 200, 0)
    # 100/0 decided; 100 is in progress
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="yes"))
    session.commit()
    result = next_undecided_message(session, label_id=label.id)
    # Must finish chatlog 100 before moving to 200
    assert result["chatlog_id"] == 100
    assert result["message_index"] == 1


def test_returns_none_when_all_decided(session: Session):
    label = _seed_label(session)
    _seed_msg(session, 100, 0)
    session.add(LabelApplication(label_id=label.id, chatlog_id=100, message_index=0, value="skip"))
    session.commit()
    assert next_undecided_message(session, label_id=label.id) is None
```

- [ ] **Step 2: Run test (expect failure)**

```bash
cd server/python && uv run pytest tests/test_queue_service.py -v
```

Expected: FAIL — `queue_service` module not found.

- [ ] **Step 3: Implement `queue_service.py`**

Create `server/python/queue_service.py`:

```python
"""Queue ordering for the single-label workflow.

Walks one conversation start-to-end before jumping to the next.
Conversations with at least one decided message are continued first.
"""
from typing import Optional, Dict, Any
from sqlmodel import Session, select
from sqlalchemy import func, and_, exists
from models import MessageCache, LabelApplication


def next_undecided_message(session: Session, *, label_id: int) -> Optional[Dict[str, Any]]:
    """Return the next student message with no decision for this label.

    Ordering:
      1. In-progress conversations (some decided messages) before not-started.
      2. Within priority class, conversations ordered by chatlog_id ascending.
      3. Within a conversation, messages ordered by message_index ascending.
    """
    decided_subq = (
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
        .subquery()
    )

    has_any_decided_subq = (
        select(LabelApplication.chatlog_id)
        .where(LabelApplication.label_id == label_id)
        .distinct()
        .subquery()
    )

    # In-progress convos: have at least one decided message
    in_progress = (
        select(MessageCache)
        .where(MessageCache.chatlog_id.in_(select(has_any_decided_subq.c.chatlog_id)))
        .where(
            ~exists().where(
                and_(
                    decided_subq.c.chatlog_id == MessageCache.chatlog_id,
                    decided_subq.c.message_index == MessageCache.message_index,
                )
            )
        )
        .order_by(MessageCache.chatlog_id, MessageCache.message_index)
        .limit(1)
    )
    row = session.exec(in_progress).first()
    if row is not None:
        return {
            "chatlog_id": row.chatlog_id,
            "message_index": row.message_index,
            "message_text": row.message_text,
            "context_before": row.context_before,
            "context_after": row.context_after,
        }

    # Not-started convos: no decided messages
    not_started = (
        select(MessageCache)
        .where(~MessageCache.chatlog_id.in_(select(has_any_decided_subq.c.chatlog_id)))
        .order_by(MessageCache.chatlog_id, MessageCache.message_index)
        .limit(1)
    )
    row = session.exec(not_started).first()
    if row is None:
        return None
    return {
        "chatlog_id": row.chatlog_id,
        "message_index": row.message_index,
        "message_text": row.message_text,
        "context_before": row.context_before,
        "context_after": row.context_after,
    }


def conversation_context(session: Session, *, chatlog_id: int, up_to_message_index: int) -> list[Dict[str, Any]]:
    """Return all student messages in this conversation up to (and including)
    the given index, in order. Used to render the hybrid view's prior turns.
    """
    rows = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .where(MessageCache.message_index <= up_to_message_index)
        .order_by(MessageCache.message_index)
    ).all()
    return [
        {
            "chatlog_id": r.chatlog_id,
            "message_index": r.message_index,
            "message_text": r.message_text,
            "context_before": r.context_before,
            "context_after": r.context_after,
        }
        for r in rows
    ]
```

- [ ] **Step 4: Run tests**

```bash
cd server/python && uv run pytest tests/test_queue_service.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/python/queue_service.py server/python/tests/test_queue_service.py
git commit -m "feat: queue_service for conversation-level next-message ordering"
```

---

## Task 5: Decision service — yes/no/skip + undo + readiness + activate

**Files:**
- Create: `server/python/decision_service.py`
- Test: `server/python/tests/test_decision_service.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_decision_service.py`:

```python
import pytest
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache
from decision_service import (
    decide,
    undo_last,
    readiness,
    activate_label,
    close_label,
)


def _label(session: Session, name="L") -> LabelDefinition:
    label = LabelDefinition(name=name)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def test_activate_makes_label_active_and_deactivates_others(session: Session):
    a = _label(session, "A")
    b = _label(session, "B")
    activate_label(session, label_id=a.id)
    activate_label(session, label_id=b.id)
    session.refresh(a)
    session.refresh(b)
    assert a.is_active is False
    assert b.is_active is True


def test_decide_writes_application_with_value(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    row = session.exec(select(LabelApplication)).first()
    assert row.value == "yes"
    assert row.applied_by == "human"


def test_decide_rejects_invalid_value(session: Session):
    label = _label(session)
    with pytest.raises(ValueError):
        decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="maybe")


def test_decide_idempotent_overwrites_existing(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="no")
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].value == "no"


def test_undo_removes_most_recent_decision(session: Session):
    label = _label(session)
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=1, value="no")
    removed = undo_last(session, label_id=label.id)
    assert removed == {"chatlog_id": 1, "message_index": 1}
    rows = session.exec(select(LabelApplication)).all()
    assert len(rows) == 1
    assert rows[0].message_index == 0


def test_undo_returns_none_when_no_decisions(session: Session):
    label = _label(session)
    assert undo_last(session, label_id=label.id) is None


def test_readiness_counts(session: Session):
    label = _label(session)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="a"))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="b"))
    session.add(MessageCache(chatlog_id=2, message_index=0, message_text="c"))
    session.commit()
    decide(session, label_id=label.id, chatlog_id=1, message_index=0, value="yes")
    decide(session, label_id=label.id, chatlog_id=1, message_index=1, value="no")
    decide(session, label_id=label.id, chatlog_id=2, message_index=0, value="skip")
    r = readiness(session, label_id=label.id)
    assert r["yes_count"] == 1
    assert r["no_count"] == 1
    assert r["skip_count"] == 1
    assert r["conversations_walked"] == 2  # 1 fully done, 2 fully done (one msg)
    assert r["total_conversations"] == 2
    assert r["ready"] is True


def test_close_label_sets_phase_complete(session: Session):
    label = _label(session)
    activate_label(session, label_id=label.id)
    close_label(session, label_id=label.id)
    session.refresh(label)
    assert label.phase == "complete"
    assert label.is_active is False
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
cd server/python && uv run pytest tests/test_decision_service.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `decision_service.py`**

Create `server/python/decision_service.py`:

```python
"""Service layer for the single-label binary workflow."""
from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Session, select
from sqlalchemy import func, distinct
from models import LabelDefinition, LabelApplication, MessageCache

VALID_VALUES = {"yes", "no", "skip"}


def activate_label(session: Session, *, label_id: int) -> None:
    """Make this label active; clear is_active on all others."""
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")
    others = session.exec(
        select(LabelDefinition).where(LabelDefinition.is_active == True)  # noqa: E712
    ).all()
    for other in others:
        if other.id != label_id:
            other.is_active = False
            session.add(other)
    label.is_active = True
    if label.phase == "complete":
        label.phase = "labeling"
    session.add(label)
    session.commit()


def close_label(session: Session, *, label_id: int) -> None:
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")
    label.is_active = False
    label.phase = "complete"
    session.add(label)
    session.commit()


def decide(
    session: Session,
    *,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    value: str,
    applied_by: str = "human",
    confidence: Optional[float] = None,
) -> LabelApplication:
    if value not in VALID_VALUES:
        raise ValueError(f"value must be one of {VALID_VALUES}, got {value!r}")
    existing = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == label_id,
            LabelApplication.chatlog_id == chatlog_id,
            LabelApplication.message_index == message_index,
        )
    ).first()
    if existing is not None:
        existing.value = value
        existing.applied_by = applied_by
        existing.confidence = confidence
        existing.created_at = datetime.utcnow()
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    row = LabelApplication(
        label_id=label_id,
        chatlog_id=chatlog_id,
        message_index=message_index,
        value=value,
        applied_by=applied_by,
        confidence=confidence,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def undo_last(session: Session, *, label_id: int) -> Optional[Dict[str, int]]:
    """Remove the most recent human decision for this label. Returns the address removed, or None."""
    row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id, LabelApplication.applied_by == "human")
        .order_by(LabelApplication.created_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    addr = {"chatlog_id": row.chatlog_id, "message_index": row.message_index}
    session.delete(row)
    session.commit()
    return addr


def readiness(session: Session, *, label_id: int) -> Dict[str, Any]:
    counts = {"yes_count": 0, "no_count": 0, "skip_count": 0}
    rows = session.exec(
        select(LabelApplication.value, func.count())
        .where(LabelApplication.label_id == label_id, LabelApplication.applied_by == "human")
        .group_by(LabelApplication.value)
    ).all()
    for value, count in rows:
        counts[f"{value}_count"] = count

    total_convs = session.exec(
        select(func.count(distinct(MessageCache.chatlog_id)))
    ).one()

    # Walked = conversations where every student message has a decision
    decided_per_conv = session.exec(
        select(LabelApplication.chatlog_id, func.count())
        .where(LabelApplication.label_id == label_id)
        .group_by(LabelApplication.chatlog_id)
    ).all()
    msgs_per_conv = dict(session.exec(
        select(MessageCache.chatlog_id, func.count())
        .group_by(MessageCache.chatlog_id)
    ).all())
    walked = sum(
        1
        for cid, decided in decided_per_conv
        if msgs_per_conv.get(cid, 0) > 0 and decided >= msgs_per_conv[cid]
    )

    ready = counts["yes_count"] >= 1 and counts["no_count"] >= 1
    return {
        **counts,
        "conversations_walked": walked,
        "total_conversations": total_convs,
        "ready": ready,
    }
```

- [ ] **Step 4: Run tests**

```bash
cd server/python && uv run pytest tests/test_decision_service.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add server/python/decision_service.py server/python/tests/test_decision_service.py
git commit -m "feat: decision_service with activate/decide/undo/readiness/close"
```

---

## Task 6: Binary Gemini classifier (mocked in tests)

**Files:**
- Create: `server/python/binary_autolabel_service.py`
- Test: `server/python/tests/test_binary_handoff.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_binary_handoff.py`:

```python
from unittest.mock import patch
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache
from binary_autolabel_service import classify_binary_batch, run_handoff


def test_classify_binary_batch_calls_gemini_with_label_and_examples():
    label = {"name": "Concept Question", "description": "Asks about a concept"}
    yes_examples = ["What is a Series?"]
    no_examples = ["Run my notebook"]
    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "What is a DataFrame?"},
        {"chatlog_id": 1, "message_index": 1, "message_text": "fix my code"},
    ]
    fake_response = [
        {"index": 0, "value": "yes", "confidence": 0.92},
        {"index": 1, "value": "no", "confidence": 0.81},
    ]
    with patch("binary_autolabel_service._call_gemini", return_value=fake_response):
        result = classify_binary_batch(label=label, yes_examples=yes_examples, no_examples=no_examples, messages=messages)
    assert result == fake_response


def test_run_handoff_writes_ai_predictions_for_unlabeled(session: Session):
    label = LabelDefinition(name="L", description="d", is_active=True)
    session.add(label)
    session.commit()
    session.refresh(label)
    session.add(MessageCache(chatlog_id=1, message_index=0, message_text="x"))
    session.add(MessageCache(chatlog_id=1, message_index=1, message_text="y"))
    session.add(MessageCache(chatlog_id=2, message_index=0, message_text="z"))
    # human decision for one message
    session.add(LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, value="yes", applied_by="human"))
    session.commit()

    fake = [
        {"index": 0, "value": "no", "confidence": 0.6},
        {"index": 1, "value": "yes", "confidence": 0.95},
    ]
    with patch("binary_autolabel_service.classify_binary_batch", return_value=fake):
        n = run_handoff(session, label_id=label.id)
    assert n == 2
    ai_rows = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "ai")
    ).all()
    assert len(ai_rows) == 2

    session.refresh(label)
    assert label.phase == "handed_off"
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
cd server/python && uv run pytest tests/test_binary_handoff.py -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `binary_autolabel_service.py`**

Create `server/python/binary_autolabel_service.py`:

```python
"""Binary classifier using Gemini for the single-label workflow."""
import os
from typing import List, Dict, Any, Optional
from datetime import datetime
from google import genai
from google.genai import types
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache

_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="classify_binary",
        description="Decide yes/no for each message against a single label.",
        parameters={
            "type": "object",
            "properties": {
                "classifications": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer"},
                            "value": {"type": "string", "enum": ["yes", "no"]},
                            "confidence": {"type": "number"},
                        },
                        "required": ["index", "value", "confidence"],
                    },
                },
            },
            "required": ["classifications"],
        },
    )
])

_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are deciding, for a single label, whether each given student message "
        "fits the label or not. Reply yes/no with a 0..1 confidence."
    ),
    temperature=0,
    tools=[_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["classify_binary"],
        )
    ),
)


def _build_prompt(label: Dict[str, Any], yes_examples: List[str], no_examples: List[str], messages: List[Dict[str, Any]]) -> str:
    parts = [f"## Label\n**{label['name']}**"]
    if label.get("description"):
        parts.append(label["description"])
    parts.append("")
    if yes_examples:
        parts.append("## Yes examples")
        for e in yes_examples[:10]:
            parts.append(f'- "{e[:300]}"')
    if no_examples:
        parts.append("## No examples")
        for e in no_examples[:10]:
            parts.append(f'- "{e[:300]}"')
    parts.append("\n## Messages to classify")
    for i, m in enumerate(messages):
        parts.append(f'{i}. "{m["message_text"][:500]}"')
    parts.append('\nCall `classify_binary` with index, value ("yes"|"no"), and confidence.')
    return "\n".join(parts)


def _call_gemini(prompt: str) -> List[Dict[str, Any]]:
    resp = _client.models.generate_content(
        model="gemini-2.0-flash", contents=prompt, config=_CONFIG
    )
    for part in resp.candidates[0].content.parts:
        if part.function_call and part.function_call.name == "classify_binary":
            args = dict(part.function_call.args)
            return list(args.get("classifications", []))
    return []


def classify_binary_batch(
    *, label: Dict[str, Any], yes_examples: List[str], no_examples: List[str], messages: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    prompt = _build_prompt(label, yes_examples, no_examples, messages)
    return _call_gemini(prompt)


def _few_shot(session: Session, label_id: int, value: str, k: int = 10) -> List[str]:
    rows = session.exec(
        select(LabelApplication, MessageCache)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.value == value,
            LabelApplication.applied_by == "human",
            LabelApplication.chatlog_id == MessageCache.chatlog_id,
            LabelApplication.message_index == MessageCache.message_index,
        )
        .order_by(LabelApplication.created_at.desc())
        .limit(k)
    ).all()
    return [m.message_text for _, m in rows]


def run_handoff(session: Session, *, label_id: int, batch_size: int = 50) -> int:
    """Run Gemini batch over still-unlabeled messages for this label.

    Returns the number of AI predictions written.
    """
    label = session.get(LabelDefinition, label_id)
    if label is None:
        raise ValueError(f"label {label_id} not found")

    yes_ex = _few_shot(session, label_id, "yes")
    no_ex = _few_shot(session, label_id, "no")

    decided_keys = set(
        (la.chatlog_id, la.message_index)
        for la in session.exec(
            select(LabelApplication).where(LabelApplication.label_id == label_id)
        ).all()
    )
    all_messages = session.exec(select(MessageCache).order_by(MessageCache.chatlog_id, MessageCache.message_index)).all()
    todo = [m for m in all_messages if (m.chatlog_id, m.message_index) not in decided_keys]

    written = 0
    label_dict = {"name": label.name, "description": label.description}

    for start in range(0, len(todo), batch_size):
        batch = todo[start:start + batch_size]
        msgs = [
            {"chatlog_id": m.chatlog_id, "message_index": m.message_index, "message_text": m.message_text}
            for m in batch
        ]
        results = classify_binary_batch(label=label_dict, yes_examples=yes_ex, no_examples=no_ex, messages=msgs)
        for r in results:
            i = r["index"]
            if i < 0 or i >= len(batch):
                continue
            m = batch[i]
            session.add(LabelApplication(
                label_id=label_id,
                chatlog_id=m.chatlog_id,
                message_index=m.message_index,
                value=r["value"],
                applied_by="ai",
                confidence=float(r.get("confidence", 0.0)),
            ))
            written += 1
        session.commit()

    label.phase = "handed_off"
    label.is_active = False
    session.add(label)
    session.commit()
    return written
```

- [ ] **Step 4: Run tests**

```bash
cd server/python && uv run pytest tests/test_binary_handoff.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add server/python/binary_autolabel_service.py server/python/tests/test_binary_handoff.py
git commit -m "feat: binary_autolabel_service for per-label Gemini handoff"
```

---

## Task 7: Backend routes — schemas

**Files:**
- Modify: `server/python/schemas.py`

- [ ] **Step 1: Add new request/response shapes**

Append to `server/python/schemas.py`:

```python
# ── Single-Label Workflow ──────────────────────────────────────────

class DecideRequest(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # yes | no | skip


class NextMessageResponse(BaseModel):
    chatlog_id: Optional[int]
    message_index: Optional[int]
    message_text: Optional[str]
    context_before: Optional[str]
    context_after: Optional[str]
    conversation_context: List[QueueItemResponse]  # prior turns of this conversation
    done: bool


class ReadinessResponse(BaseModel):
    yes_count: int
    no_count: int
    skip_count: int
    conversations_walked: int
    total_conversations: int
    ready: bool


class HandoffResponse(BaseModel):
    predictions_written: int
    phase: str


class ReviewQueueItem(BaseModel):
    chatlog_id: int
    message_index: int
    message_text: str
    context_before: Optional[str]
    context_after: Optional[str]
    ai_value: str
    confidence: float


class ReviewQueueResponse(BaseModel):
    items: List[ReviewQueueItem]
    total: int


class ReviewRequest(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # yes | no


class LabelDashboardItem(BaseModel):
    id: int
    name: str
    description: Optional[str]
    phase: str
    is_active: bool
    yes_count: int
    no_count: int
    skip_count: int
    ai_count: int
```

- [ ] **Step 2: Sanity check imports**

```bash
cd server/python && uv run python -c "import schemas; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add server/python/schemas.py
git commit -m "feat: schemas for single-label endpoints"
```

---

## Task 8: Backend routes — `main.py` endpoints

**Files:**
- Modify: `server/python/main.py`
- Test: `server/python/tests/test_single_label_routes.py`

- [ ] **Step 1: Write the failing tests**

Create `server/python/tests/test_single_label_routes.py`:

```python
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlmodel import Session
from models import LabelDefinition, LabelApplication, MessageCache


def _seed(session: Session):
    label = LabelDefinition(name="Concept Question", description="asks about concept")
    session.add(label)
    session.add(MessageCache(chatlog_id=10, message_index=0, message_text="What is a Series?"))
    session.add(MessageCache(chatlog_id=10, message_index=1, message_text="fix my code"))
    session.add(MessageCache(chatlog_id=20, message_index=0, message_text="hello"))
    session.commit()
    session.refresh(label)
    return label


def test_create_and_list_labels(client: TestClient):
    r = client.post("/api/labels/binary", json={"name": "Foo", "description": "d"})
    assert r.status_code == 200
    r = client.get("/api/labels/binary")
    assert r.status_code == 200
    assert any(item["name"] == "Foo" for item in r.json())


def test_activate_close_lifecycle(client: TestClient, session: Session):
    label = _seed(session)
    r = client.post(f"/api/labels/binary/{label.id}/activate")
    assert r.status_code == 200
    session.refresh(label)
    assert label.is_active is True

    r = client.post(f"/api/labels/binary/{label.id}/close")
    assert r.status_code == 200
    session.refresh(label)
    assert label.is_active is False
    assert label.phase == "complete"


def test_next_decide_advances(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/activate")

    r = client.get(f"/api/labels/binary/{label.id}/next")
    assert r.status_code == 200
    body = r.json()
    assert body["chatlog_id"] == 10 and body["message_index"] == 0
    assert body["done"] is False
    assert len(body["conversation_context"]) == 1  # message 0 itself

    r = client.post(f"/api/labels/binary/{label.id}/decide", json={
        "chatlog_id": 10, "message_index": 0, "value": "yes",
    })
    assert r.status_code == 200
    nxt = r.json()
    assert nxt["chatlog_id"] == 10 and nxt["message_index"] == 1


def test_decide_rejects_invalid_value(client: TestClient, session: Session):
    label = _seed(session)
    r = client.post(f"/api/labels/binary/{label.id}/decide", json={
        "chatlog_id": 10, "message_index": 0, "value": "bogus",
    })
    assert r.status_code == 422 or r.status_code == 400


def test_undo_removes_last_decision(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 0, "value": "yes"})
    r = client.post(f"/api/labels/binary/{label.id}/undo")
    assert r.status_code == 200
    rows = session.exec(__import__("sqlmodel").select(LabelApplication)).all()
    assert len(rows) == 0


def test_readiness_endpoint(client: TestClient, session: Session):
    label = _seed(session)
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 0, "value": "yes"})
    client.post(f"/api/labels/binary/{label.id}/decide", json={"chatlog_id": 10, "message_index": 1, "value": "no"})
    r = client.get(f"/api/labels/binary/{label.id}/readiness")
    body = r.json()
    assert body["yes_count"] == 1
    assert body["no_count"] == 1
    assert body["ready"] is True


def test_handoff_runs_gemini_and_returns_count(client: TestClient, session: Session):
    label = _seed(session)
    fake = [
        {"index": 0, "value": "yes", "confidence": 0.5},
        {"index": 1, "value": "no", "confidence": 0.92},
        {"index": 2, "value": "no", "confidence": 0.7},
    ]
    with patch("binary_autolabel_service.classify_binary_batch", return_value=fake):
        r = client.post(f"/api/labels/binary/{label.id}/handoff")
    assert r.status_code == 200
    assert r.json()["predictions_written"] == 3


def test_review_queue_returns_low_confidence(client: TestClient, session: Session):
    label = _seed(session)
    session.add(LabelApplication(label_id=label.id, chatlog_id=10, message_index=0, value="yes", applied_by="ai", confidence=0.5))
    session.add(LabelApplication(label_id=label.id, chatlog_id=10, message_index=1, value="no", applied_by="ai", confidence=0.95))
    session.commit()
    r = client.get(f"/api/labels/binary/{label.id}/review-queue?threshold=0.75")
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["chatlog_id"] == 10 and body["items"][0]["message_index"] == 0
```

- [ ] **Step 2: Run tests (expect failure)**

```bash
cd server/python && uv run pytest tests/test_single_label_routes.py -v
```

Expected: FAIL — routes not defined.

- [ ] **Step 3: Add routes to `main.py`**

Append to `server/python/main.py` (after existing route definitions):

```python
# ── Single-Label Binary Workflow ──────────────────────────────────
from queue_service import next_undecided_message, conversation_context
from decision_service import (
    activate_label as svc_activate,
    close_label as svc_close,
    decide as svc_decide,
    undo_last as svc_undo,
    readiness as svc_readiness,
)
import binary_autolabel_service
from schemas import (
    DecideRequest, NextMessageResponse, ReadinessResponse, HandoffResponse,
    ReviewQueueItem, ReviewQueueResponse, ReviewRequest, LabelDashboardItem,
)


def _build_next_response(db: Session, label_id: int) -> NextMessageResponse:
    nxt = next_undecided_message(db, label_id=label_id)
    if nxt is None:
        return NextMessageResponse(
            chatlog_id=None, message_index=None, message_text=None,
            context_before=None, context_after=None,
            conversation_context=[], done=True,
        )
    ctx = conversation_context(db, chatlog_id=nxt["chatlog_id"], up_to_message_index=nxt["message_index"])
    return NextMessageResponse(
        chatlog_id=nxt["chatlog_id"],
        message_index=nxt["message_index"],
        message_text=nxt["message_text"],
        context_before=nxt["context_before"],
        context_after=nxt["context_after"],
        conversation_context=[QueueItemResponse(**c) for c in ctx],
        done=False,
    )


@app.post("/api/labels/binary", response_model=LabelDashboardItem)
def create_binary_label(body: CreateLabelRequest, db: Session = Depends(get_session)):
    label = LabelDefinition(name=body.name, description=body.description)
    db.add(label)
    db.commit()
    db.refresh(label)
    return LabelDashboardItem(
        id=label.id, name=label.name, description=label.description,
        phase=label.phase, is_active=label.is_active,
        yes_count=0, no_count=0, skip_count=0, ai_count=0,
    )


@app.get("/api/labels/binary", response_model=List[LabelDashboardItem])
def list_binary_labels(db: Session = Depends(get_session)):
    labels = db.exec(select(LabelDefinition).where(LabelDefinition.archived_at.is_(None))).all()
    out: List[LabelDashboardItem] = []
    for l in labels:
        counts = {"yes_count": 0, "no_count": 0, "skip_count": 0, "ai_count": 0}
        rows = db.exec(
            select(LabelApplication.value, LabelApplication.applied_by, func.count())
            .where(LabelApplication.label_id == l.id)
            .group_by(LabelApplication.value, LabelApplication.applied_by)
        ).all()
        for value, applied_by, count in rows:
            if applied_by == "ai":
                counts["ai_count"] += count
            elif value in ("yes", "no", "skip"):
                counts[f"{value}_count"] = count
        out.append(LabelDashboardItem(
            id=l.id, name=l.name, description=l.description,
            phase=l.phase, is_active=l.is_active, **counts,
        ))
    return out


@app.post("/api/labels/binary/{label_id}/activate")
def activate_endpoint(label_id: int, db: Session = Depends(get_session)):
    try:
        svc_activate(db, label_id=label_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@app.post("/api/labels/binary/{label_id}/close")
def close_endpoint(label_id: int, db: Session = Depends(get_session)):
    try:
        svc_close(db, label_id=label_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@app.get("/api/labels/binary/{label_id}/next", response_model=NextMessageResponse)
def next_endpoint(label_id: int, db: Session = Depends(get_session)):
    return _build_next_response(db, label_id)


@app.post("/api/labels/binary/{label_id}/decide", response_model=NextMessageResponse)
def decide_endpoint(label_id: int, body: DecideRequest, db: Session = Depends(get_session)):
    try:
        svc_decide(
            db,
            label_id=label_id,
            chatlog_id=body.chatlog_id,
            message_index=body.message_index,
            value=body.value,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _build_next_response(db, label_id)


@app.post("/api/labels/binary/{label_id}/undo")
def undo_endpoint(label_id: int, db: Session = Depends(get_session)):
    addr = svc_undo(db, label_id=label_id)
    return {"ok": True, "removed": addr}


@app.get("/api/labels/binary/{label_id}/readiness", response_model=ReadinessResponse)
def readiness_endpoint(label_id: int, db: Session = Depends(get_session)):
    return ReadinessResponse(**svc_readiness(db, label_id=label_id))


@app.post("/api/labels/binary/{label_id}/handoff", response_model=HandoffResponse)
def handoff_endpoint(label_id: int, db: Session = Depends(get_session)):
    n = binary_autolabel_service.run_handoff(db, label_id=label_id)
    label = db.get(LabelDefinition, label_id)
    return HandoffResponse(predictions_written=n, phase=label.phase)


@app.get("/api/labels/binary/{label_id}/review-queue", response_model=ReviewQueueResponse)
def review_queue_endpoint(
    label_id: int,
    threshold: float = Query(0.75, ge=0.0, le=1.0),
    db: Session = Depends(get_session),
):
    rows = db.exec(
        select(LabelApplication, MessageCache)
        .where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "ai",
            LabelApplication.confidence < threshold,
            LabelApplication.chatlog_id == MessageCache.chatlog_id,
            LabelApplication.message_index == MessageCache.message_index,
        )
        .order_by(LabelApplication.confidence)
    ).all()
    items = [
        ReviewQueueItem(
            chatlog_id=la.chatlog_id,
            message_index=la.message_index,
            message_text=mc.message_text,
            context_before=mc.context_before,
            context_after=mc.context_after,
            ai_value=la.value,
            confidence=la.confidence or 0.0,
        )
        for la, mc in rows
    ]
    return ReviewQueueResponse(items=items, total=len(items))


@app.post("/api/labels/binary/{label_id}/review")
def review_endpoint(label_id: int, body: ReviewRequest, db: Session = Depends(get_session)):
    if body.value not in ("yes", "no"):
        raise HTTPException(400, "value must be yes or no")
    svc_decide(
        db,
        label_id=label_id,
        chatlog_id=body.chatlog_id,
        message_index=body.message_index,
        value=body.value,
        applied_by="human",
        confidence=1.0,
    )
    return {"ok": True}
```

- [ ] **Step 4: Run tests**

```bash
cd server/python && uv run pytest tests/test_single_label_routes.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Run full backend test suite to check for regressions**

```bash
cd server/python && uv run pytest
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_label_routes.py
git commit -m "feat: HTTP routes for single-label binary workflow"
```

---

## Task 9: Frontend types and API helpers

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/api.ts`
- Modify: `src/mocks/index.ts`

- [ ] **Step 1: Add types**

Append to `src/types/index.ts`:

```typescript
export type DecisionValue = 'yes' | 'no' | 'skip'
export type LabelPhase = 'labeling' | 'handed_off' | 'reviewing' | 'complete'

export interface NextMessage {
  chatlog_id: number | null
  message_index: number | null
  message_text: string | null
  context_before: string | null
  context_after: string | null
  conversation_context: QueueItem[]
  done: boolean
}

export interface DecideRequestBody {
  chatlog_id: number
  message_index: number
  value: DecisionValue
}

export interface ReadinessState {
  yes_count: number
  no_count: number
  skip_count: number
  conversations_walked: number
  total_conversations: number
  ready: boolean
}

export interface HandoffResult {
  predictions_written: number
  phase: LabelPhase
}

export interface ReviewQueueItem {
  chatlog_id: number
  message_index: number
  message_text: string
  context_before: string | null
  context_after: string | null
  ai_value: 'yes' | 'no'
  confidence: number
}

export interface LabelDashboardItem {
  id: number
  name: string
  description: string | null
  phase: LabelPhase
  is_active: boolean
  yes_count: number
  no_count: number
  skip_count: number
  ai_count: number
}
```

- [ ] **Step 2: Add API helpers**

Append to `src/services/api.ts` (inside the `export const api = {` block, before the closing brace):

```typescript
  // ── Single-Label Binary Workflow ──────────────────────────────────
  listBinaryLabels: (): Promise<LabelDashboardItem[]> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryLabels)
             : req('/api/labels/binary'),

  createBinaryLabel: (body: CreateLabelRequest): Promise<LabelDashboardItem> =>
    USE_MOCK
      ? Promise.resolve({ id: Math.floor(Math.random() * 10000), name: body.name, description: body.description ?? null, phase: 'labeling', is_active: false, yes_count: 0, no_count: 0, skip_count: 0, ai_count: 0 })
      : req('/api/labels/binary', { method: 'POST', ...json(body) }),

  activateBinaryLabel: (id: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/activate`, { method: 'POST' }),

  closeBinaryLabel: (id: number): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/close`, { method: 'POST' }),

  getBinaryNext: (id: number): Promise<NextMessage> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryNext)
             : req(`/api/labels/binary/${id}/next`),

  decideBinary: (id: number, body: DecideRequestBody): Promise<NextMessage> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryNextAfterDecide)
             : req(`/api/labels/binary/${id}/decide`, { method: 'POST', ...json(body) }),

  undoBinary: (id: number): Promise<{ ok: boolean; removed: { chatlog_id: number; message_index: number } | null }> =>
    USE_MOCK ? Promise.resolve({ ok: true, removed: null })
             : req(`/api/labels/binary/${id}/undo`, { method: 'POST' }),

  getBinaryReadiness: (id: number): Promise<ReadinessState> =>
    USE_MOCK ? Promise.resolve(mockApi.binaryReadiness)
             : req(`/api/labels/binary/${id}/readiness`),

  binaryHandoff: (id: number): Promise<HandoffResult> =>
    USE_MOCK ? Promise.resolve({ predictions_written: 0, phase: 'handed_off' })
             : req(`/api/labels/binary/${id}/handoff`, { method: 'POST' }),

  getBinaryReviewQueue: (id: number, threshold = 0.75): Promise<{ items: ReviewQueueItem[]; total: number }> =>
    USE_MOCK ? Promise.resolve({ items: [], total: 0 })
             : req(`/api/labels/binary/${id}/review-queue?threshold=${threshold}`),

  reviewBinary: (id: number, body: { chatlog_id: number; message_index: number; value: 'yes' | 'no' }): Promise<{ ok: boolean }> =>
    USE_MOCK ? Promise.resolve({ ok: true })
             : req(`/api/labels/binary/${id}/review`, { method: 'POST', ...json(body) }),
```

Update the type imports at the top of `src/services/api.ts` to include the new types:

```typescript
import type {
  // ... existing
  LabelDashboardItem, NextMessage, DecideRequestBody, ReadinessState,
  HandoffResult, ReviewQueueItem,
} from '../types'
```

- [ ] **Step 3: Add mock data**

Add to the `mockApi` export in `src/mocks/index.ts`:

```typescript
  binaryLabels: [
    { id: 1, name: 'Concept Question', description: 'Asks about a concept', phase: 'labeling' as const, is_active: true, yes_count: 3, no_count: 2, skip_count: 0, ai_count: 0 },
    { id: 2, name: 'Code Help', description: 'Wants help with code', phase: 'complete' as const, is_active: false, yes_count: 12, no_count: 9, skip_count: 1, ai_count: 41 },
  ],
  binaryNext: {
    chatlog_id: 100,
    message_index: 2,
    message_text: 'What does .iloc do?',
    context_before: 'Tell me about pandas DataFrames.',
    context_after: null,
    conversation_context: [
      { chatlog_id: 100, message_index: 0, message_text: 'hi', context_before: null, context_after: 'Hi there!' },
      { chatlog_id: 100, message_index: 1, message_text: 'Tell me about pandas DataFrames.', context_before: null, context_after: 'A DataFrame is...' },
      { chatlog_id: 100, message_index: 2, message_text: 'What does .iloc do?', context_before: 'A DataFrame is...', context_after: null },
    ],
    done: false,
  },
  binaryNextAfterDecide: {
    chatlog_id: 100,
    message_index: 3,
    message_text: 'And .loc?',
    context_before: '.iloc selects by position.',
    context_after: null,
    conversation_context: [],
    done: false,
  },
  binaryReadiness: {
    yes_count: 3,
    no_count: 2,
    skip_count: 0,
    conversations_walked: 4,
    total_conversations: 30,
    ready: true,
  },
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/services/api.ts src/mocks/index.ts
git commit -m "feat: frontend types, API helpers, and mocks for binary workflow"
```

---

## Task 10: `DecisionBar` component (TDD with vitest)

**Files:**
- Create: `src/components/run/DecisionBar.tsx`
- Test: `src/tests/DecisionBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/DecisionBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DecisionBar } from '../components/run/DecisionBar'

describe('DecisionBar', () => {
  it('calls onDecide with yes/no/skip on button click', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    fireEvent.click(screen.getByRole('button', { name: /no/i }))
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onDecide).toHaveBeenNthCalledWith(1, 'yes')
    expect(onDecide).toHaveBeenNthCalledWith(2, 'no')
    expect(onDecide).toHaveBeenNthCalledWith(3, 'skip')
  })

  it('responds to keyboard shortcuts y/n/s', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={false} />)
    fireEvent.keyDown(window, { key: 'y' })
    fireEvent.keyDown(window, { key: 'n' })
    fireEvent.keyDown(window, { key: 's' })
    expect(onDecide).toHaveBeenCalledWith('yes')
    expect(onDecide).toHaveBeenCalledWith('no')
    expect(onDecide).toHaveBeenCalledWith('skip')
    expect(onDecide).toHaveBeenCalledTimes(3)
  })

  it('does not call onDecide when disabled', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={true} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    fireEvent.keyDown(window, { key: 'y' })
    expect(onDecide).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
npm test -- DecisionBar
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DecisionBar.tsx`**

Create `src/components/run/DecisionBar.tsx`:

```tsx
import { useEffect } from 'react'
import type { DecisionValue } from '../../types'

interface Props {
  onDecide: (value: DecisionValue) => void
  disabled: boolean
}

export function DecisionBar({ onDecide, disabled }: Props) {
  useEffect(() => {
    if (disabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'y') onDecide('yes')
      else if (e.key === 'n') onDecide('no')
      else if (e.key === 's') onDecide('skip')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDecide, disabled])

  const baseBtn = 'flex-1 px-4 py-3 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="flex gap-2 w-full">
      <button
        className={`${baseBtn} bg-emerald-600 hover:bg-emerald-500 text-white`}
        disabled={disabled}
        onClick={() => onDecide('yes')}
      >
        Yes <span className="opacity-60 text-sm">(y)</span>
      </button>
      <button
        className={`${baseBtn} bg-rose-600 hover:bg-rose-500 text-white`}
        disabled={disabled}
        onClick={() => onDecide('no')}
      >
        No <span className="opacity-60 text-sm">(n)</span>
      </button>
      <button
        className={`${baseBtn} bg-neutral-700 hover:bg-neutral-600 text-white`}
        disabled={disabled}
        onClick={() => onDecide('skip')}
      >
        Skip <span className="opacity-60 text-sm">(s)</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- DecisionBar
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/run/DecisionBar.tsx src/tests/DecisionBar.test.tsx
git commit -m "feat: DecisionBar component with keyboard shortcuts"
```

---

## Task 11: `ReadinessGauge` component

**Files:**
- Create: `src/components/run/ReadinessGauge.tsx`
- Test: `src/tests/ReadinessGauge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/ReadinessGauge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadinessGauge } from '../components/run/ReadinessGauge'

const base = { yes_count: 0, no_count: 0, skip_count: 0, conversations_walked: 0, total_conversations: 30, ready: false }

describe('ReadinessGauge', () => {
  it('shows gray tier with no decisions', () => {
    render(<ReadinessGauge state={base} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('gray')
  })

  it('shows amber when both classes have decisions but few conversations walked', () => {
    render(<ReadinessGauge state={{ ...base, yes_count: 1, no_count: 1, conversations_walked: 2, ready: true }} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('amber')
  })

  it('shows green when both classes covered and ≥ 5 conversations walked', () => {
    render(<ReadinessGauge state={{ ...base, yes_count: 3, no_count: 2, conversations_walked: 5, ready: true }} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('green')
  })
})
```

- [ ] **Step 2: Run the test (expect failure)**

```bash
npm test -- ReadinessGauge
```

Expected: FAIL.

- [ ] **Step 3: Implement `ReadinessGauge.tsx`**

Create `src/components/run/ReadinessGauge.tsx`:

```tsx
import type { ReadinessState } from '../../types'

interface Props {
  state: ReadinessState
}

export function ReadinessGauge({ state }: Props) {
  const tier =
    state.yes_count === 0 || state.no_count === 0
      ? 'gray'
      : state.conversations_walked < 5
        ? 'amber'
        : 'green'

  const color = {
    gray: 'bg-neutral-600',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
  }[tier]

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`inline-block w-3 h-3 rounded-full ${color}`} />
      <span data-testid="readiness-tier" className="hidden">{tier}</span>
      <span className="text-neutral-300">
        {state.yes_count} yes / {state.no_count} no / {state.skip_count} skip
      </span>
      <span className="text-neutral-500">·</span>
      <span className="text-neutral-300">
        {state.conversations_walked}/{state.total_conversations} convos walked
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- ReadinessGauge
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/run/ReadinessGauge.tsx src/tests/ReadinessGauge.test.tsx
git commit -m "feat: ReadinessGauge with gray/amber/green tiers"
```

---

## Task 12: `LabelHeader`, `ConversationContext`, `FocusedMessage` components

**Files:**
- Create: `src/components/run/LabelHeader.tsx`
- Create: `src/components/run/ConversationContext.tsx`
- Create: `src/components/run/FocusedMessage.tsx`

These are presentational components without complex logic; they share markdown rendering with the existing `MessageCard.tsx`.

- [ ] **Step 1: Implement `LabelHeader.tsx`**

Create `src/components/run/LabelHeader.tsx`:

```tsx
import type { LabelDashboardItem, ReadinessState } from '../../types'
import { ReadinessGauge } from './ReadinessGauge'

interface Props {
  label: LabelDashboardItem
  readiness: ReadinessState | null
  onHandoff: () => void
  handoffDisabled: boolean
  loading: boolean
}

export function LabelHeader({ label, readiness, onHandoff, handoffDisabled, loading }: Props) {
  return (
    <div className="border-b border-neutral-800 bg-neutral-900 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{label.name}</h1>
          {label.description && (
            <p className="text-neutral-400 text-sm mt-0.5">{label.description}</p>
          )}
        </div>
        <button
          onClick={onHandoff}
          disabled={handoffDisabled || loading}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {loading ? 'Running…' : 'Hand off to Gemini'}
        </button>
      </div>
      {readiness && (
        <div className="mt-3">
          <ReadinessGauge state={readiness} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement `ConversationContext.tsx`**

Create `src/components/run/ConversationContext.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { QueueItem } from '../../types'

interface Props {
  messages: QueueItem[]
  focusedIndex: number
}

export function ConversationContext({ messages, focusedIndex }: Props) {
  if (messages.length <= 1) return null
  return (
    <div className="opacity-60 space-y-3 mb-4 border-l-2 border-neutral-700 pl-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">Earlier in this conversation</div>
      {messages.slice(0, -1).map((m) => (
        <div key={`${m.chatlog_id}-${m.message_index}`} className="space-y-2">
          {m.context_before && (
            <div className="text-sm text-neutral-400">
              <span className="text-neutral-500 text-xs">tutor:</span>{' '}
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {m.context_before}
              </ReactMarkdown>
            </div>
          )}
          <div className="text-sm text-neutral-300">
            <span className="text-neutral-500 text-xs">student #{m.message_index}:</span>{' '}
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {m.message_text}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Implement `FocusedMessage.tsx`**

Create `src/components/run/FocusedMessage.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface Props {
  text: string
  contextBefore: string | null
}

export function FocusedMessage({ text, contextBefore }: Props) {
  return (
    <div className="rounded-lg border-2 border-indigo-500/50 bg-neutral-900 p-5 space-y-3 shadow-lg">
      {contextBefore && (
        <div className="text-sm text-neutral-400 border-b border-neutral-800 pb-3">
          <span className="text-neutral-500 text-xs">preceding tutor turn:</span>
          <div className="mt-1">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {contextBefore}
            </ReactMarkdown>
          </div>
        </div>
      )}
      <div>
        <span className="text-neutral-500 text-xs uppercase tracking-wide">student message under decision</span>
        <div className="mt-2 text-neutral-100 prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/run/LabelHeader.tsx src/components/run/ConversationContext.tsx src/components/run/FocusedMessage.tsx
git commit -m "feat: presentational components for the run page"
```

---

## Task 13: `LabelRunPage` and routing

**Files:**
- Create: `src/pages/LabelRunPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/tests/LabelRunPage.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `src/tests/LabelRunPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../services/api', async () => {
  const actual: any = await vi.importActual('../services/api')
  return {
    api: {
      ...actual.api,
      listBinaryLabels: vi.fn().mockResolvedValue([
        { id: 1, name: 'L', description: null, phase: 'labeling', is_active: true, yes_count: 0, no_count: 0, skip_count: 0, ai_count: 0 },
      ]),
      getBinaryNext: vi.fn().mockResolvedValue({
        chatlog_id: 5, message_index: 0,
        message_text: 'hi',
        context_before: null, context_after: null,
        conversation_context: [{ chatlog_id: 5, message_index: 0, message_text: 'hi', context_before: null, context_after: null }],
        done: false,
      }),
      decideBinary: vi.fn().mockResolvedValue({
        chatlog_id: null, message_index: null, message_text: null,
        context_before: null, context_after: null,
        conversation_context: [], done: true,
      }),
      getBinaryReadiness: vi.fn().mockResolvedValue({
        yes_count: 0, no_count: 0, skip_count: 0,
        conversations_walked: 0, total_conversations: 1, ready: false,
      }),
    },
  }
})

import { LabelRunPage } from '../pages/LabelRunPage'

describe('LabelRunPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the active label and shows the focused message', async () => {
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes><Route path="/run" element={<LabelRunPage />} /></Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument())
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('records a decision and shows the done state', async () => {
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes><Route path="/run" element={<LabelRunPage />} /></Routes>
      </MemoryRouter>
    )
    await waitFor(() => screen.getByText('hi'))
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test -- LabelRunPage
```

Expected: FAIL.

- [ ] **Step 3: Implement `LabelRunPage.tsx`**

Create `src/pages/LabelRunPage.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { LabelDashboardItem, NextMessage, ReadinessState, DecisionValue } from '../types'
import { LabelHeader } from '../components/run/LabelHeader'
import { ConversationContext } from '../components/run/ConversationContext'
import { FocusedMessage } from '../components/run/FocusedMessage'
import { DecisionBar } from '../components/run/DecisionBar'

export function LabelRunPage() {
  const navigate = useNavigate()
  const [label, setLabel] = useState<LabelDashboardItem | null>(null)
  const [next, setNext] = useState<NextMessage | null>(null)
  const [readiness, setReadiness] = useState<ReadinessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)

  const loadAll = useCallback(async (labelId: number) => {
    const [n, r] = await Promise.all([
      api.getBinaryNext(labelId),
      api.getBinaryReadiness(labelId),
    ])
    setNext(n)
    setReadiness(r)
  }, [])

  useEffect(() => {
    let cancelled = false
    api.listBinaryLabels().then((labels) => {
      if (cancelled) return
      const active = labels.find((l) => l.is_active) ?? null
      if (!active) {
        navigate('/labels')
        return
      }
      setLabel(active)
      loadAll(active.id)
    })
    return () => { cancelled = true }
  }, [loadAll, navigate])

  const onDecide = async (value: DecisionValue) => {
    if (!label || !next || next.done || busy) return
    setBusy(true)
    try {
      await api.decideBinary(label.id, {
        chatlog_id: next.chatlog_id!,
        message_index: next.message_index!,
        value,
      })
      await loadAll(label.id)
    } finally {
      setBusy(false)
    }
  }

  const onHandoff = async () => {
    if (!label) return
    setHandoffBusy(true)
    try {
      await api.binaryHandoff(label.id)
      navigate('/labels')
    } finally {
      setHandoffBusy(false)
    }
  }

  if (!label) {
    return <div className="p-6 text-neutral-400">Loading…</div>
  }

  const handoffDisabled = !readiness?.ready

  return (
    <div className="flex flex-col h-full">
      <LabelHeader
        label={label}
        readiness={readiness}
        onHandoff={onHandoff}
        handoffDisabled={handoffDisabled}
        loading={handoffBusy}
      />
      <div className="flex-1 overflow-auto px-6 py-6 max-w-3xl mx-auto w-full">
        {next?.done ? (
          <div className="text-center py-12">
            <p className="text-neutral-300 text-lg">All caught up for this label.</p>
            <p className="text-neutral-500 mt-2">Hand off to Gemini, or close the label and start a new one.</p>
          </div>
        ) : next ? (
          <>
            <ConversationContext messages={next.conversation_context} focusedIndex={next.conversation_context.length - 1} />
            <FocusedMessage text={next.message_text!} contextBefore={next.context_before} />
            <div className="mt-6">
              <DecisionBar onDecide={onDecide} disabled={busy} />
            </div>
          </>
        ) : (
          <div className="text-neutral-400">Loading next message…</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `App.tsx`**

Modify `src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navigation } from './components/Navigation'
import { LabelRunPage } from './pages/LabelRunPage'
import { HistoryPage } from './pages/HistoryPage'
import { LabelsPage } from './pages/LabelsPage'
import { AnalysisPage } from './pages/AnalysisPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
        <Navigation />
        <main className="flex-1 flex flex-col min-h-0">
          <Routes>
            <Route path="/" element={<Navigate to="/labels" replace />} />
            <Route path="/run" element={<LabelRunPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/labels" element={<LabelsPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
```

- [ ] **Step 5: Update `Navigation` to swap "Queue" for "Run"**

Modify `src/components/Navigation.tsx` — change the link `to="/queue"` to `to="/run"` and the label text to `Run`. (If the link doesn't currently exist there, add it.)

- [ ] **Step 6: Run tests**

```bash
npm test -- LabelRunPage
```

Expected: 2 passed.

- [ ] **Step 7: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/LabelRunPage.tsx src/App.tsx src/components/Navigation.tsx src/tests/LabelRunPage.test.tsx
git commit -m "feat: LabelRunPage and routing for binary workflow"
```

---

## Task 14: `LabelsPage` dashboard

**Files:**
- Modify: `src/pages/LabelsPage.tsx`

- [ ] **Step 1: Replace `LabelsPage` with the new dashboard**

Rewrite `src/pages/LabelsPage.tsx` to show a list of labels with phase badges, counts, and an action button per phase:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import type { LabelDashboardItem } from '../types'

const phaseStyles: Record<string, string> = {
  labeling: 'bg-amber-700 text-amber-100',
  handed_off: 'bg-indigo-700 text-indigo-100',
  reviewing: 'bg-violet-700 text-violet-100',
  complete: 'bg-emerald-800 text-emerald-100',
}

export function LabelsPage() {
  const navigate = useNavigate()
  const [labels, setLabels] = useState<LabelDashboardItem[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setLabels(await api.listBinaryLabels())
  }

  useEffect(() => { refresh() }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.createBinaryLabel({ name: name.trim(), description: description.trim() || undefined })
      setName('')
      setDescription('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const activate = async (id: number) => {
    await api.activateBinaryLabel(id)
    navigate('/run')
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 w-full">
      <h1 className="text-2xl font-semibold mb-6">Labels</h1>

      <form onSubmit={onCreate} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 mb-8 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">New label</h2>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Label name"
          className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2"
        />
        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (used as Gemini prompt context)"
          className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2"
        />
        <button
          type="submit" disabled={busy}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-medium"
        >Create</button>
      </form>

      <div className="space-y-3">
        {labels.map((l) => (
          <div key={l.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${phaseStyles[l.phase] ?? 'bg-neutral-700 text-neutral-200'}`}>
                  {l.phase}
                </span>
                {l.is_active && <span className="text-xs px-2 py-0.5 rounded bg-emerald-700 text-emerald-100">active</span>}
              </div>
              {l.description && <p className="text-sm text-neutral-400 mt-1">{l.description}</p>}
              <p className="text-xs text-neutral-500 mt-1">
                {l.yes_count} yes · {l.no_count} no · {l.skip_count} skip · {l.ai_count} AI
              </p>
            </div>
            <div className="flex gap-2">
              {l.phase === 'complete' ? (
                <span className="text-neutral-500 text-sm">Closed</span>
              ) : l.is_active ? (
                <button onClick={() => navigate('/run')} className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500">
                  Resume
                </button>
              ) : (
                <button onClick={() => activate(l.id)} className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600">
                  Activate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/LabelsPage.tsx
git commit -m "feat: LabelsPage dashboard for binary workflow"
```

---

## Task 15: End-to-end manual verification

- [ ] **Step 1: Mock-mode walkthrough**

```bash
VITE_USE_MOCK=true npm run dev
```

Open `http://localhost:5173` and verify:
- `/labels` shows the dashboard with two seed labels.
- Clicking "Activate" navigates to `/run`.
- The focused message renders with conversation context above it.
- Yes/No/Skip buttons advance.
- Keyboard shortcuts `y`/`n`/`s` advance.
- Readiness gauge updates.
- "Hand off to Gemini" navigates back to `/labels`.

- [ ] **Step 2: Live walkthrough**

In one terminal:

```bash
kubectl port-forward <pod> 5432:5432  # whatever the project uses
```

In another:

```bash
cd server/python && LOCAL_DB_URL=sqlite:///./chatsight-single.db PG_PASSWORD=<real> uv run uvicorn main:app --reload
```

In a third:

```bash
npm run dev
```

Open the app, create a label, walk a few conversations end-to-end, click handoff (mock or real Gemini depending on `GEMINI_API_KEY`), verify the dashboard returns and counts updated.

- [ ] **Step 3: Backend regression**

```bash
cd server/python && uv run pytest
```

Expected: all tests pass (new + pre-existing).

- [ ] **Step 4: Frontend regression**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Final commit (if cleanup needed)**

```bash
git status
git add -p   # if any tweaks
git commit -m "chore: end-to-end verification cleanup"
```

---

## Self-Review Notes

After writing this plan, the following checks were run:

**Spec coverage:**
- Workflow phases (labeling / handed_off / reviewing / complete) — Tasks 1, 5, 6, 8.
- Yes/No/Skip — Tasks 2, 5, 10.
- Conversation-level ordering — Task 4.
- Hybrid view — Tasks 12, 13.
- Readiness gauge — Tasks 5, 11.
- Handoff + Gemini binary classifier — Task 6.
- Confidence-sorted review queue — Task 8 (`/review-queue`, `/review` endpoints). **Note:** the review *UI* is intentionally deferred — the endpoint exists, but the review view itself is out of scope for v1 of this plan and will be added once a real handoff produces low-confidence rows worth reviewing. If this is unacceptable, add Task 16 to build a `LabelReviewPage` reusing `FocusedMessage` + a simplified `DecisionBar` (yes/no only).
- Discover stays as sidebar suggestion — unchanged backend; entry point on `LabelsPage` deferred to a follow-up since it's not on the critical path.
- Strictly serial active label — Task 5 (`activate_label` deactivates others).
- Worktree + fresh DB — Task 0.

**Placeholder scan:** No TBDs / TODOs / "implement later" left.

**Type consistency:**
- `value` is `"yes" | "no" | "skip"` everywhere (backend + frontend types + tests).
- `LabelDashboardItem` shape matches between Pydantic and TypeScript.
- API helper names (`getBinaryNext`, `decideBinary`, etc.) match `LabelRunPage` usage.
