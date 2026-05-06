# /run UI: Calibration Anchor + Threshold-Free Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side `AssistFlank` to `/run` that shows the instructor's 3 closest prior labeled decisions for the focused message (italic-quoted, no AI prediction layer), backed by cached Gemini embeddings; replace the daunting `X / 17,470` progress display with a no-denominator `X labels · Y yes · Z no` count.

**Architecture:** A new `LabelPrediction` table caches per-message nearest-neighbors lists. A new `assist_service.py` module computes those neighbors via cosine similarity over the existing `MessageEmbedding` rows. Rebuild is lazy and infrequent — triggered on `/next` when the per-label human label count diverges by ≥5 from the cached `model_version`. A new `GET /api/single-labels/{id}/assist` endpoint serves the cached neighbors to the frontend. The new `AssistFlank` React component renders into a 320-px right column in `LabelRunPage`, beside the existing `ThreadView`.

**Tech Stack:** FastAPI, SQLModel, NumPy (cosine similarity over `np.frombuffer`-decoded `MessageEmbedding.embedding` bytes), pytest. React 19, TypeScript, Tailwind v4 with the warm-flow palette already defined in `src/index.css`. Vitest + React Testing Library.

**User preference (do not commit):** This user reviews and commits code themselves. Each task ends with a **Pause for user review** step instead of `git commit` — do not commit on their behalf. After the user reviews, they may either commit or ask for changes.

**Source spec:** `docs/superpowers/specs/2026-05-05-run-ui-balance-design.md`

---

## File map

**Backend (`server/python/`):**

- Create `assist_service.py` — `nearest_neighbors(...)`, `rebuild_cache_if_stale(...)`, `get_cached_neighbors(...)`. ~120 lines.
- Modify `models.py` — add `LabelPrediction` SQLModel class.
- Modify `schemas.py` — add `AssistNeighbor` and `AssistResponse` Pydantic models.
- Modify `main.py` — add `/api/single-labels/{id}/assist` route; plumb `rebuild_cache_if_stale` call into the existing `get_next_focused` (around line 2725).
- Create `tests/test_assist_service.py`, `tests/test_assist_endpoint.py`, `tests/test_assist_rebuild_trigger.py`.

**Frontend (`src/`):**

- Create `components/run/AssistFlank.tsx` — ~80 lines.
- Modify `components/run/StripBar.tsx` — replace progress pill markup.
- Modify `pages/LabelRunPage.tsx` — wrap `ThreadView` in two-column grid, fetch assist on focus changes.
- Modify `services/api.ts` — add `getAssist(...)` method + mock data.
- Modify `types/index.ts` — add `AssistNeighbor` and `AssistResponse` interfaces.
- Create `tests/AssistFlank.test.tsx`.

No frontend visual specifics are placeholders — the spec at `docs/superpowers/specs/2026-05-05-run-ui-balance-design.md` and the mockup at `.superpowers/brainstorm/44165-1778041685/content/assist-flank-v2.html` lock the exact CSS classes, padding, fonts, and colors. The implementer should mirror the mockup using the existing semantic tokens (`bg-canvas`, `text-faint`, `text-on-surface`, `text-moss`, `text-brick`, etc.) defined in `src/index.css`.

---

### Task 1: LabelPrediction model + Pydantic schemas

The persistent cache for per-message neighbor lists, plus the API response shape the frontend will consume.

**Files:**
- Modify: `server/python/models.py`
- Modify: `server/python/schemas.py`

- [ ] **Step 1: Write the failing test for the model**

Create `server/python/tests/test_label_prediction_model.py`:

```python
"""Verify the LabelPrediction model is registered and round-trips correctly."""
import json
from sqlmodel import select

from models import LabelDefinition, LabelPrediction


def test_label_prediction_inserts_and_reads(session):
    label = LabelDefinition(name="seeking answer", mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)

    neighbors = [
        {"chatlog_id": 1, "message_index": 0, "value": "yes", "similarity": 0.84, "message_text": "i'm stuck"},
        {"chatlog_id": 2, "message_index": 1, "value": "no", "similarity": 0.71, "message_text": "what is variance"},
    ]
    pred = LabelPrediction(
        label_id=label.id,
        chatlog_id=10,
        message_index=2,
        nearest_neighbors=json.dumps(neighbors),
        model_version=12,
    )
    session.add(pred)
    session.commit()

    fresh = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label.id)
    ).first()
    assert fresh is not None
    assert fresh.chatlog_id == 10
    assert fresh.message_index == 2
    assert fresh.model_version == 12
    decoded = json.loads(fresh.nearest_neighbors)
    assert len(decoded) == 2
    assert decoded[0]["value"] == "yes"


def test_label_prediction_unique_per_message(session):
    label = LabelDefinition(name="x", mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)

    a = LabelPrediction(label_id=label.id, chatlog_id=1, message_index=0,
                        nearest_neighbors="[]", model_version=1)
    session.add(a)
    session.commit()

    b = LabelPrediction(label_id=label.id, chatlog_id=1, message_index=0,
                        nearest_neighbors="[]", model_version=2)
    session.add(b)
    import sqlalchemy.exc
    try:
        session.commit()
        raise AssertionError("expected unique constraint violation")
    except sqlalchemy.exc.IntegrityError:
        session.rollback()
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd server/python && uv run pytest tests/test_label_prediction_model.py -v
```

Expected: FAIL with `ImportError: cannot import name 'LabelPrediction' from 'models'`.

- [ ] **Step 3: Add the LabelPrediction model**

In `server/python/models.py`, add this class near the other label-related tables (after `LabelApplication`):

```python
class LabelPrediction(SQLModel, table=True):
    """Cached nearest-neighbor results for a label's unlabeled messages.
    Rebuilt lazily by assist_service when the human label count diverges
    from the stored model_version by >= 5."""
    __table_args__ = (
        UniqueConstraint("label_id", "chatlog_id", "message_index"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    label_id: int = Field(foreign_key="labeldefinition.id", index=True)
    chatlog_id: int = Field(index=True)
    message_index: int
    nearest_neighbors: str  # JSON-encoded list of AssistNeighbor dicts
    model_version: int  # = human_label_count at the time of build
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

`UniqueConstraint`, `Optional`, `Field`, `datetime`, and `SQLModel` should already be imported at the top of `models.py`. Add any that are missing.

- [ ] **Step 4: Run the model test**

```
uv run pytest tests/test_label_prediction_model.py -v
```

Expected: both tests PASS. The `SQLModel.metadata.create_all(engine)` call in the test fixtures will pick up the new table automatically.

- [ ] **Step 5: Add the Pydantic schemas**

In `server/python/schemas.py`, add (in the same section as other response schemas, e.g. near `ReviewItemResponse`):

```python
class AssistNeighbor(BaseModel):
    chatlog_id: int
    message_index: int
    value: str  # "yes" | "no"
    similarity: float
    message_text: str


class AssistResponse(BaseModel):
    neighbors: List[AssistNeighbor]
```

`BaseModel` and `List` should already be imported.

- [ ] **Step 6: Verify nothing broke in the full backend suite**

```
uv run pytest -q
```

Expected: previous-baseline test count + 2 new tests, all pass.

- [ ] **Step 7: Pause for user review**

Stop here. Show the user the diff for `models.py`, `schemas.py`, and the new test file. Do not commit.

---

### Task 2: `assist_service.nearest_neighbors` core function

The cosine-similarity top-k function. Pure computation over `MessageEmbedding` rows. No DB writes, no API.

**Files:**
- Create: `server/python/assist_service.py`
- Create: `server/python/tests/test_assist_service.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_assist_service.py`:

```python
"""Unit tests for assist_service.nearest_neighbors."""
import numpy as np

import assist_service
from models import (
    LabelDefinition,
    LabelApplication,
    MessageCache,
    MessageEmbedding,
)


def _emb(values):
    """Encode a list of floats as the bytes shape MessageEmbedding stores."""
    return np.array(values, dtype=np.float32).tobytes()


def _seed_label(session, name="L"):
    label = LabelDefinition(name=name, mode="single")
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def _seed_message(session, chatlog_id, message_index, text, vec):
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text,
    ))
    session.add(MessageEmbedding(
        chatlog_id=chatlog_id,
        message_index=message_index,
        embedding=_emb(vec),
    ))
    session.commit()


def _seed_decision(session, label_id, chatlog_id, message_index, value):
    session.add(LabelApplication(
        label_id=label_id,
        chatlog_id=chatlog_id,
        message_index=message_index,
        applied_by="human",
        value=value,
    ))
    session.commit()


def test_nearest_neighbors_returns_top_k_by_cosine(session):
    label = _seed_label(session)
    # Focused message: vector pointing in [1, 0]
    _seed_message(session, 100, 0, "i'm stuck on q3", [1.0, 0.0])
    # Three already-labeled messages, by descending similarity to focused
    _seed_message(session, 200, 0, "i'm stuck on q4",  [0.99, 0.14])
    _seed_message(session, 201, 0, "how do i solve",   [0.80, 0.60])
    _seed_message(session, 202, 0, "why does numpy",   [0.0,  1.0])
    _seed_decision(session, label.id, 200, 0, "yes")
    _seed_decision(session, label.id, 201, 0, "yes")
    _seed_decision(session, label.id, 202, 0, "no")

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=2
    )
    assert len(out) == 2
    assert out[0]["chatlog_id"] == 200
    assert out[0]["value"] == "yes"
    assert out[0]["message_text"] == "i'm stuck on q4"
    assert 0.99 < out[0]["similarity"] <= 1.0
    assert out[1]["chatlog_id"] == 201


def test_nearest_neighbors_returns_empty_when_no_labeled(session):
    label = _seed_label(session)
    _seed_message(session, 100, 0, "x", [1.0, 0.0])
    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    assert out == []


def test_nearest_neighbors_returns_empty_when_no_focused_embedding(session):
    label = _seed_label(session)
    # Labeled message has an embedding; focused does not.
    _seed_message(session, 200, 0, "labeled", [1.0, 0.0])
    _seed_decision(session, label.id, 200, 0, "yes")
    # Focused message has only a MessageCache, no MessageEmbedding.
    session.add(MessageCache(chatlog_id=100, message_index=0, message_text="focused"))
    session.commit()

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    assert out == []


def test_nearest_neighbors_excludes_skips(session):
    label = _seed_label(session)
    _seed_message(session, 100, 0, "focused", [1.0, 0.0])
    _seed_message(session, 200, 0, "skipped", [0.95, 0.31])
    _seed_message(session, 201, 0, "yes",     [0.30, 0.95])
    session.add(LabelApplication(
        label_id=label.id, chatlog_id=200, message_index=0,
        applied_by="human", value="skip",
    ))
    _seed_decision(session, label.id, 201, 0, "yes")
    session.commit()

    out = assist_service.nearest_neighbors(
        session, label_id=label.id, chatlog_id=100, message_index=0, k=3
    )
    # The skipped message would have been the top similarity, but must be excluded.
    assert len(out) == 1
    assert out[0]["chatlog_id"] == 201
```

- [ ] **Step 2: Run to verify failure**

```
uv run pytest tests/test_assist_service.py -v
```

Expected: all four FAIL with `ModuleNotFoundError: No module named 'assist_service'`.

- [ ] **Step 3: Implement `assist_service.nearest_neighbors`**

Create `server/python/assist_service.py`:

```python
"""Local-ML assist for /run: cosine-nearest labeled neighbors over cached embeddings.
No external API calls, no fitted classifier — just retrieval over MessageEmbedding."""
from __future__ import annotations

import numpy as np
from sqlmodel import Session, select

from models import (
    LabelApplication,
    MessageCache,
    MessageEmbedding,
)


def _decode(emb_bytes: bytes) -> np.ndarray:
    return np.frombuffer(emb_bytes, dtype=np.float32)


def nearest_neighbors(
    db: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    k: int = 3,
) -> list[dict]:
    """Return up to k cosine-nearest labeled neighbors of the given message.
    Each result: {chatlog_id, message_index, value, similarity, message_text}.
    Returns [] if the focused message has no cached embedding or there are no
    labeled neighbors. Skip-decisions are excluded — only yes/no count."""
    focused_emb_row = db.exec(
        select(MessageEmbedding).where(
            MessageEmbedding.chatlog_id == chatlog_id,
            MessageEmbedding.message_index == message_index,
        )
    ).first()
    if not focused_emb_row:
        return []
    focused = _decode(focused_emb_row.embedding)
    focused_norm = float(np.linalg.norm(focused))
    if focused_norm == 0.0:
        return []

    apps = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.value,
        ).where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
    ).all()
    if not apps:
        return []

    candidates: list[dict] = []
    for cid, midx, value in apps:
        emb_row = db.exec(
            select(MessageEmbedding).where(
                MessageEmbedding.chatlog_id == cid,
                MessageEmbedding.message_index == midx,
            )
        ).first()
        if not emb_row:
            continue
        v = _decode(emb_row.embedding)
        denom = focused_norm * float(np.linalg.norm(v))
        if denom == 0.0:
            continue
        sim = float(np.dot(focused, v) / denom)
        candidates.append({
            "chatlog_id": cid,
            "message_index": midx,
            "value": value,
            "similarity": sim,
        })

    candidates.sort(key=lambda c: c["similarity"], reverse=True)
    top = candidates[:k]

    for c in top:
        msg = db.exec(
            select(MessageCache).where(
                MessageCache.chatlog_id == c["chatlog_id"],
                MessageCache.message_index == c["message_index"],
            )
        ).first()
        c["message_text"] = msg.message_text if msg else ""

    return top
```

- [ ] **Step 4: Run the assist_service tests**

```
uv run pytest tests/test_assist_service.py -v
```

Expected: all four PASS.

- [ ] **Step 5: Run the full backend suite**

```
uv run pytest -q
```

Expected: prior count + 4 new = all pass.

- [ ] **Step 6: Pause for user review**

Stop. Show the diff for `assist_service.py` and the new test file. Do not commit.

---

### Task 3: Cache rebuild + lazy trigger via `/next`

Add `rebuild_cache_if_stale` to `assist_service`, plumb the call into `get_next_focused`. After this task, every call to `/api/single-labels/{id}/next` checks the per-label cache and rebuilds it if `human_label_count` has diverged by ≥5 from the stored `model_version`.

**Files:**
- Modify: `server/python/assist_service.py`
- Modify: `server/python/main.py` (the existing `get_next_focused` route, around line 2725)
- Create: `server/python/tests/test_assist_rebuild_trigger.py`

- [ ] **Step 1: Write the rebuild trigger test**

Create `server/python/tests/test_assist_rebuild_trigger.py`:

```python
"""End-to-end test: /next triggers cache rebuild after enough new labels."""
import json

from sqlmodel import select

from models import LabelDefinition, LabelPrediction, MessageCache, MessageEmbedding, LabelApplication
import numpy as np


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_corpus(session, n=10):
    """n cached messages with simple 2D embeddings, all in the same conversation."""
    for i in range(n):
        # Spread the embeddings across [1,0]→[0,1] so cosine similarity ranks
        # neighbors by closeness to whatever message is queried.
        angle = (i / max(n - 1, 1)) * (np.pi / 2)
        vec = [float(np.cos(angle)), float(np.sin(angle))]
        session.add(MessageCache(
            chatlog_id=300, message_index=i, message_text=f"msg {i}",
        ))
        session.add(MessageEmbedding(
            chatlog_id=300, message_index=i, embedding=_emb(vec),
        ))
    session.commit()


def _make_active_label(client):
    label = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{label['id']}/activate")
    return label


def _decide(client, label_id, chatlog_id, message_index, value):
    return client.post(
        f"/api/single-labels/{label_id}/decide",
        json={"chatlog_id": chatlog_id, "message_index": message_index, "value": value},
    )


def test_rebuild_fires_after_five_new_labels(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    # No predictions yet — never built.
    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert rows == []

    # Make 5 yes/no decisions. The 5th /decide → /next call should trigger a rebuild.
    for i in range(5):
        _decide(client, label["id"], 300, i, "yes" if i % 2 == 0 else "no")

    # Trigger /next explicitly — even if /decide already advances, /next is the rebuild gate.
    client.get(f"/api/single-labels/{label['id']}/next")

    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    # 10 messages, 5 labeled → 5 unlabeled → 5 rows.
    assert len(rows) == 5
    # Every row carries the current model_version (= human label count = 5).
    assert all(r.model_version == 5 for r in rows)
    # Each row's neighbor JSON parses and is non-empty (since labeled set is non-empty).
    for r in rows:
        decoded = json.loads(r.nearest_neighbors)
        assert len(decoded) >= 1
        assert "value" in decoded[0]
        assert "similarity" in decoded[0]


def test_no_rebuild_below_threshold(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    # Only 2 decisions — below the 5-label rebuild threshold.
    _decide(client, label["id"], 300, 0, "yes")
    _decide(client, label["id"], 300, 1, "no")
    client.get(f"/api/single-labels/{label['id']}/next")

    rows = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert rows == []


def test_rebuild_wipes_old_rows(client, session):
    _seed_corpus(session, n=10)
    label = _make_active_label(client)

    for i in range(5):
        _decide(client, label["id"], 300, i, "yes")
    client.get(f"/api/single-labels/{label['id']}/next")

    first_count = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert len(first_count) == 5

    # 5 more decisions → label count = 10. /next should wipe and rebuild with 0 unlabeled left.
    # Wait — after 10 decisions, all messages are labeled, pending = []. So 0 prediction rows.
    for i in range(5, 10):
        _decide(client, label["id"], 300, i, "no")
    client.get(f"/api/single-labels/{label['id']}/next")

    second = session.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label["id"])
    ).all()
    assert second == []  # nothing to predict on; cache wiped + nothing rebuilt
```

- [ ] **Step 2: Run tests to verify failure**

```
uv run pytest tests/test_assist_rebuild_trigger.py -v
```

Expected: all three FAIL — predictions table empty after `/next` calls because no rebuild logic exists.

- [ ] **Step 3: Add `rebuild_cache_if_stale` and `get_cached_neighbors` to assist_service**

Append to `server/python/assist_service.py`:

```python
import json as _json

from models import LabelDefinition, LabelPrediction


REBUILD_DIVERGENCE = 5


def _human_label_count(db: Session, label_id: int) -> int:
    apps = db.exec(
        select(LabelApplication.value).where(
            LabelApplication.label_id == label_id,
            LabelApplication.applied_by == "human",
            LabelApplication.value.in_(["yes", "no"]),  # noqa: comparator
        )
    ).all()
    return len(apps)


def _latest_model_version(db: Session, label_id: int) -> int | None:
    row = db.exec(
        select(LabelPrediction.model_version)
        .where(LabelPrediction.label_id == label_id)
        .limit(1)
    ).first()
    return row if row is not None else None


def rebuild_cache_if_stale(db: Session, label_id: int) -> bool:
    """If the per-label human-label count has diverged from the cached
    model_version by >= REBUILD_DIVERGENCE (or no cache exists), wipe and
    rebuild the LabelPrediction rows for this label. Returns True if a
    rebuild ran."""
    current = _human_label_count(db, label_id)
    cached = _latest_model_version(db, label_id)

    if cached is None and current < REBUILD_DIVERGENCE:
        # Below the cold-start threshold, no cache yet — leave it.
        return False
    if cached is not None and (current - cached) < REBUILD_DIVERGENCE:
        return False

    # Wipe existing rows for this label.
    existing = db.exec(
        select(LabelPrediction).where(LabelPrediction.label_id == label_id)
    ).all()
    for row in existing:
        db.delete(row)
    db.commit()

    # Compute pending = cached messages minus already-labeled ones.
    decided = set(db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .where(LabelApplication.label_id == label_id)
    ).all())
    cached_msgs = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index)
    ).all()
    pending = [(c, i) for (c, i) in cached_msgs if (c, i) not in decided]

    for cid, midx in pending:
        neighbors = nearest_neighbors(db, label_id, cid, midx, k=3)
        db.add(LabelPrediction(
            label_id=label_id,
            chatlog_id=cid,
            message_index=midx,
            nearest_neighbors=_json.dumps(neighbors),
            model_version=current,
        ))
    db.commit()
    return True


def get_cached_neighbors(
    db: Session, label_id: int, chatlog_id: int, message_index: int
) -> list[dict]:
    """Return the cached neighbors for a (label, message), or [] if no cache row."""
    row = db.exec(
        select(LabelPrediction).where(
            LabelPrediction.label_id == label_id,
            LabelPrediction.chatlog_id == chatlog_id,
            LabelPrediction.message_index == message_index,
        )
    ).first()
    if not row:
        return []
    try:
        return list(_json.loads(row.nearest_neighbors))
    except (ValueError, TypeError):
        return []
```

- [ ] **Step 4: Plumb the rebuild call into `get_next_focused`**

In `server/python/main.py`, locate `get_next_focused` (the existing route around line 2725, decorated `@app.get("/api/single-labels/{label_id}/next", ...)`). Add the rebuild call as the first thing the handler does, after pulling the label:

```python
@app.get("/api/single-labels/{label_id}/next", response_model=Optional[FocusedMessageResponse])
def get_next_focused(
    label_id: int,
    assignment_id: Optional[int] = None,
    db: Session = Depends(get_session),
):
    """Walk the next focused message for the active labeling label.
    Also opportunistically rebuilds the assist cache if it has gone stale."""
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")

    # Lazy assist-cache rebuild. Cheap when not stale (one count + one row read).
    import assist_service
    assist_service.rebuild_cache_if_stale(db, label_id)

    # ... (rest of the existing handler body — DO NOT CHANGE)
```

If the existing handler doesn't follow this exact prologue, place the `rebuild_cache_if_stale(db, label_id)` call as the first statement after the label is loaded and validated, before any queue / next-message logic. Do not modify any other behavior.

`import assist_service` can either be moved to the top of `main.py` with the other imports for cleanliness; the task does not require it.

- [ ] **Step 5: Run the rebuild trigger tests**

```
uv run pytest tests/test_assist_rebuild_trigger.py -v
```

Expected: all three PASS.

- [ ] **Step 6: Run the full backend suite**

```
uv run pytest -q
```

Expected: full suite still green. The rebuild call is a no-op when the divergence threshold isn't crossed, so existing tests with small label counts remain unaffected.

- [ ] **Step 7: Pause for user review**

Stop. Show the diff for `assist_service.py`, `main.py`, and the new test file. Do not commit.

---

### Task 4: `/assist` endpoint

Surface the cached neighbors to the frontend.

**Files:**
- Modify: `server/python/main.py` (add new route)
- Create: `server/python/tests/test_assist_endpoint.py`

- [ ] **Step 1: Write the failing endpoint tests**

Create `server/python/tests/test_assist_endpoint.py`:

```python
"""Integration tests for GET /api/single-labels/{id}/assist."""
import json

import numpy as np
from sqlmodel import select

from models import LabelDefinition, LabelApplication, LabelPrediction, MessageCache, MessageEmbedding


def _emb(values):
    return np.array(values, dtype=np.float32).tobytes()


def _seed_label(session, name="L"):
    label = LabelDefinition(name=name, mode="single", is_active=True, phase="labeling")
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


def test_assist_endpoint_returns_cached_neighbors(client, session):
    label = _seed_label(session)
    # Seed a single LabelPrediction row for the focused (200, 0) message.
    neighbors = [
        {"chatlog_id": 100, "message_index": 0, "value": "yes",
         "similarity": 0.91, "message_text": "i'm stuck on q3"},
        {"chatlog_id": 101, "message_index": 0, "value": "no",
         "similarity": 0.62, "message_text": "what is variance"},
    ]
    session.add(LabelPrediction(
        label_id=label.id,
        chatlog_id=200,
        message_index=0,
        nearest_neighbors=json.dumps(neighbors),
        model_version=10,
    ))
    session.commit()

    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 200, "message_index": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert "neighbors" in body
    assert len(body["neighbors"]) == 2
    assert body["neighbors"][0]["chatlog_id"] == 100
    assert body["neighbors"][0]["value"] == "yes"
    assert body["neighbors"][0]["similarity"] == 0.91


def test_assist_endpoint_returns_empty_when_no_cache(client, session):
    label = _seed_label(session)
    r = client.get(
        f"/api/single-labels/{label.id}/assist",
        params={"chatlog_id": 999, "message_index": 0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body == {"neighbors": []}


def test_assist_endpoint_404_for_unknown_label(client, session):
    r = client.get(
        "/api/single-labels/99999/assist",
        params={"chatlog_id": 1, "message_index": 0},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```
uv run pytest tests/test_assist_endpoint.py -v
```

Expected: all three FAIL with 404 (route doesn't exist yet) on every call.

- [ ] **Step 3: Add the `/assist` route**

In `server/python/main.py`, near the other `/api/single-labels/...` routes (e.g., right after `/api/single-labels/{label_id}/next` which lives around line 2725), add:

```python
@app.get("/api/single-labels/{label_id}/assist", response_model=AssistResponse)
def get_assist(
    label_id: int,
    chatlog_id: int,
    message_index: int,
    db: Session = Depends(get_session),
):
    """Return cached nearest-neighbor decisions for the focused message.
    The cache is built lazily by /next; if there is no row, returns []."""
    import assist_service
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")

    neighbors = assist_service.get_cached_neighbors(
        db, label_id, chatlog_id, message_index
    )
    return AssistResponse(
        neighbors=[AssistNeighbor(**n) for n in neighbors]
    )
```

Add `AssistResponse, AssistNeighbor` to the existing `from schemas import (...)` import block at the top of `main.py`.

- [ ] **Step 4: Run the endpoint tests**

```
uv run pytest tests/test_assist_endpoint.py -v
```

Expected: all three PASS.

- [ ] **Step 5: Run the full backend suite**

```
uv run pytest -q
```

Expected: green.

- [ ] **Step 6: Pause for user review**

Stop. Show the diff for `main.py` and the new test file. Do not commit.

---

### Task 5: Frontend types + API client + AssistFlank component

The visual component plus its data layer. No integration into `LabelRunPage` yet — just the unit-testable component with mocks.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/api.ts`
- Create: `src/components/run/AssistFlank.tsx`
- Create: `src/tests/AssistFlank.test.tsx`

- [ ] **Step 1: Add types**

In `src/types/index.ts`, append:

```typescript
export interface AssistNeighbor {
  chatlog_id: number
  message_index: number
  value: 'yes' | 'no'
  similarity: number
  message_text: string
}

export interface AssistResponse {
  neighbors: AssistNeighbor[]
}
```

- [ ] **Step 2: Add API client method with mock**

In `src/services/api.ts`, near the other single-label methods (e.g., next to `handoffSingleLabel`), add:

```typescript
  getAssist: (
    labelId: number,
    chatlogId: number,
    messageIndex: number,
  ): Promise<AssistResponse> =>
    USE_MOCK
      ? Promise.resolve({
          neighbors: [
            { chatlog_id: 100, message_index: 0, value: 'yes',
              similarity: 0.84,
              message_text: "i'm stuck on q3, can you walk me through how to compute the standard deviation" },
            { chatlog_id: 101, message_index: 0, value: 'yes',
              similarity: 0.79,
              message_text: 'how do i actually solve part 2 — i tried mean(arr) but the autograder says wrong' },
            { chatlog_id: 102, message_index: 0, value: 'no',
              similarity: 0.71,
              message_text: 'why does numpy default to dividing by n instead of n minus 1' },
          ],
        })
      : req(
          `/api/single-labels/${labelId}/assist?chatlog_id=${chatlogId}&message_index=${messageIndex}`,
        ),
```

Add `AssistResponse` to the `import type { ... }` block at the top of `api.ts`.

- [ ] **Step 3: Write the failing component test**

Create `src/tests/AssistFlank.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AssistFlank } from '../components/run/AssistFlank'
import type { AssistNeighbor } from '../types'

const NEIGHBORS: AssistNeighbor[] = [
  { chatlog_id: 1, message_index: 0, value: 'yes', similarity: 0.84,
    message_text: "i'm stuck on q3" },
  { chatlog_id: 2, message_index: 0, value: 'no', similarity: 0.71,
    message_text: 'why does numpy default to n' },
]

describe('AssistFlank', () => {
  it('renders the empty state when neighbors is empty', () => {
    render(<AssistFlank neighbors={[]} />)
    expect(screen.getByText(/will appear here as you label/i)).toBeInTheDocument()
    // Header shouldn't appear in the empty state.
    expect(screen.queryByText(/your closest prior decisions/i)).toBeNull()
  })

  it('renders the header and one entry per neighbor', () => {
    render(<AssistFlank neighbors={NEIGHBORS} />)
    expect(screen.getByText(/your closest prior decisions/i)).toBeInTheDocument()
    expect(screen.getByText(/i'm stuck on q3/)).toBeInTheDocument()
    expect(screen.getByText(/why does numpy default to n/)).toBeInTheDocument()
    // Verdict text is uppercase YES / NO from CSS, but the underlying text reads "yes"/"no"
    const yesTags = screen.getAllByText('yes')
    const noTags = screen.getAllByText('no')
    expect(yesTags.length).toBeGreaterThan(0)
    expect(noTags.length).toBeGreaterThan(0)
  })

  it('renders similarity scores', () => {
    render(<AssistFlank neighbors={NEIGHBORS} />)
    expect(screen.getByText(/sim 0.84/)).toBeInTheDocument()
    expect(screen.getByText(/sim 0.71/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify failure**

```
npm test -- AssistFlank.test.tsx
```

Expected: FAIL with `Cannot find module '../components/run/AssistFlank'`.

- [ ] **Step 5: Implement AssistFlank**

Create `src/components/run/AssistFlank.tsx`:

```tsx
import type { AssistNeighbor } from '../../types'

interface AssistFlankProps {
  neighbors: AssistNeighbor[]
}

/**
 * Right-side calibration flank for /run. Shows the instructor's k closest
 * already-labeled decisions for the focused message. No confidence chip,
 * no thresholds — pure retrieval evidence.
 */
export function AssistFlank({ neighbors }: AssistFlankProps) {
  if (neighbors.length === 0) {
    return (
      <div className="bg-canvas overflow-y-auto px-7 pt-16 pb-7 flex flex-col">
        <p className="font-serif italic text-[15px] leading-[1.55] text-muted max-w-[240px]">
          Your closest prior decisions will appear here as you label.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-canvas overflow-y-auto px-7 pt-9 pb-7 flex flex-col gap-2">
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-faint mb-4">
        your closest prior decisions
      </div>
      <div className="flex flex-col gap-[18px]">
        {neighbors.map((n) => (
          <NeighborRow key={`${n.chatlog_id}-${n.message_index}`} n={n} />
        ))}
      </div>
    </div>
  )
}

function NeighborRow({ n }: { n: AssistNeighbor }) {
  const isYes = n.value === 'yes'
  const dotColor = isYes ? 'bg-moss' : 'bg-brick'
  const verdictColor = isYes ? 'text-moss' : 'text-brick'
  const hoverBorder = isYes ? 'hover:border-l-moss-dim' : 'hover:border-l-brick-dim'

  return (
    <div
      className={`px-3 py-2 cursor-pointer border-l-2 border-transparent ${hoverBorder} hover:bg-white/[.015] transition-all duration-150 flex flex-col gap-2`}
    >
      <div className="inline-flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] uppercase">
        <span className={`w-[5px] h-[5px] rounded-full ${dotColor}`} />
        <span className={verdictColor}>{n.value}</span>
        <span className="text-faint opacity-60">·</span>
        <span className="text-faint tracking-[0.06em]">sim {n.similarity.toFixed(2)}</span>
      </div>
      <div className="font-serif italic text-[15px] leading-[1.5] text-on-surface line-clamp-2 before:content-['\"'] before:opacity-40 before:mr-px after:content-['\"'] after:opacity-40 after:ml-px">
        {n.message_text}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the component tests**

```
npm test -- AssistFlank.test.tsx
```

Expected: all three PASS.

- [ ] **Step 7: Run the full frontend suite + tsc**

```
npm test
```
Expected: all tests pass.

```
npx tsc --noEmit
```
Expected: silent.

- [ ] **Step 8: Pause for user review**

Stop. Show the diffs for `types/index.ts`, `services/api.ts`, the new `AssistFlank.tsx`, and the test file. Do not commit.

---

### Task 6: Wire AssistFlank into LabelRunPage + StripBar progress format

Final integration. Wraps `ThreadView` in a two-column grid, fetches assist neighbors on focus changes, and replaces the `count / total` pill in `StripBar` with the no-denominator format.

**Files:**
- Modify: `src/pages/LabelRunPage.tsx`
- Modify: `src/components/run/StripBar.tsx`

- [ ] **Step 1: Update StripBar to the no-denominator count format**

Open `src/components/run/StripBar.tsx`. Find the existing progress pill (the `<button>` with `label.yes_count + label.no_count + label.skip_count`):

```tsx
      <button className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors">
        <span className="text-on-surface">{label.yes_count + label.no_count + label.skip_count}</span>
        <span className="opacity-50">/</span>
        <span>{label.total_conversations * 3 || 35}</span>
      </button>
```

Replace it with:

```tsx
      <span className="inline-flex items-baseline gap-1.5 px-[11px] py-[5px] font-mono text-[11px] tracking-[0.04em] text-muted">
        <span className="text-on-surface">{label.yes_count + label.no_count}</span>
        <span className="opacity-50 text-[11px]">labels</span>
        <span className="opacity-40 mx-1.5">·</span>
        <span className="text-moss">{label.yes_count}</span>
        <span className="text-faint text-[9px] tracking-[0.14em] uppercase">yes</span>
        <span className="opacity-40 mx-1.5">·</span>
        <span className="text-brick">{label.no_count}</span>
        <span className="text-faint text-[9px] tracking-[0.14em] uppercase">no</span>
      </span>
```

The total-conversation denominator is gone. Skips are no longer counted in the progress total — they're a queue-management concept and don't represent labeling progress.

- [ ] **Step 2: Update existing StripBar tests if any reference the old format**

```
grep -rn "yes_count + label.no_count + label.skip_count\|total_conversations \* 3" src/tests src/pages src/components
```

Update any reference that asserted the old `count / total` text or counted skips into the labels total. If there are none, this step is a no-op.

- [ ] **Step 3: Wire AssistFlank into LabelRunPage**

In `src/pages/LabelRunPage.tsx`, three changes.

**3a.** Import `AssistFlank` and add the assist-neighbors state:

Near the top of the file (with other imports), add:

```tsx
import { AssistFlank } from '../components/run/AssistFlank'
import type { AssistNeighbor } from '../types'
```

In the component body (after the existing `useState` calls for `activeLabel`, `focused`, etc.), add:

```tsx
  const [assistNeighbors, setAssistNeighbors] = useState<AssistNeighbor[]>([])
```

**3b.** Fetch assist on focus changes:

Find or add a `useEffect` that runs whenever `activeLabel?.id` or `focused?.chatlog_id` / `focused?.focus_index` change. Add (or extend an existing focus-change effect with) this body:

```tsx
  useEffect(() => {
    if (!activeLabel || !focused) {
      setAssistNeighbors([])
      return
    }
    let cancelled = false
    api.getAssist(
      activeLabel.id,
      focused.chatlog_id,
      focused.thread[focused.focus_index].message_index,
    ).then((res) => {
      if (!cancelled) setAssistNeighbors(res.neighbors)
    })
    return () => { cancelled = true }
  }, [activeLabel?.id, focused?.chatlog_id, focused?.focus_index])
```

**3c.** Wrap `ThreadView` in the two-column grid in BOTH the labeling-phase return and the reviewing-phase return.

Find the labeling-phase JSX (around line 358 — the section that renders `ThreadView` for the focused message). The current structure is:

```tsx
      <ThreadView thread={focused.thread} focusIndex={focused.focus_index} />
```

Replace with:

```tsx
      <div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
        <ThreadView thread={focused.thread} focusIndex={focused.focus_index} />
        <AssistFlank neighbors={assistNeighbors} />
      </div>
```

Find the reviewing-phase JSX (around line 308 — the section under `if (reviewQueue && ...)`. The current structure includes:

```tsx
        <ThreadView
          thread={[{ message_index: 0, role: 'student', text: item.text }]}
          focusIndex={0}
        />
```

Replace with:

```tsx
        <div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
          <ThreadView
            thread={[{ message_index: 0, role: 'student', text: item.text }]}
            focusIndex={0}
          />
          <AssistFlank neighbors={assistNeighbors} />
        </div>
```

The reviewing-phase grid rows already exist on the parent — wrapping in a sub-grid here is fine; if it interferes with parent flex/grid, change the parent's `grid-template-rows` line to add a column track. The implementer should verify against the running app.

- [ ] **Step 4: Type-check + run all frontend tests**

```
npx tsc --noEmit
```
Expected: silent.

```
npm test
```
Expected: all tests pass (existing + the AssistFlank tests from Task 5).

- [ ] **Step 5: Quick visual smoke test (no automated test)**

With `npm run dev` running and `VITE_USE_MOCK=true` (or the backend up), navigate to `/run`. Confirm visually:

- The AssistFlank renders on the right side at ~320px width.
- The "your closest prior decisions" header is visible (or, with no neighbors, the italic empty-state line appears).
- Neighbor entries show the dot + verdict + sim score row, then the italic-quoted text.
- The StripBar progress reads `<num> labels · <yes> yes · <no> no` with no denominator.
- The mockup file at `.superpowers/brainstorm/44165-1778041685/content/assist-flank-v2.html` is the visual reference for what the implemented page should look like.

- [ ] **Step 6: Pause for user review**

Stop. Show the diff for `LabelRunPage.tsx` and `StripBar.tsx`. Do not commit. The user reviews, may visually compare to the mockup, and signs off.

---

## Self-review notes

- **Spec coverage:** every spec section maps to tasks. `LabelPrediction` table → Task 1. `assist_service.nearest_neighbors` → Task 2. Cache rebuild logic + `/next` trigger → Task 3. `/assist` endpoint → Task 4. AssistFlank component (with empty + populated states) → Task 5. StripBar progress format + LabelRunPage integration → Task 6.
- **Tests requested by spec:** `test_assist_service.py` (Task 2 — top-k cosine, no labeled set, missing focused embedding, skip-exclusion), `test_assist_rebuild_trigger.py` (Task 3 — fires after 5, doesn't fire below, wipes old rows), `test_assist_endpoint.py` (Task 4 — happy path, empty cache, 404), `AssistFlank.test.tsx` (Task 5 — empty state, populated state, similarity rendering).
- **Placeholder scan:** no TBD/TODO. Every code block is complete and copy-pasteable. Step 2 of Task 6 is conditional ("if there are none, no-op") — that's a real branch, not vague handwaving.
- **Type / signature consistency:** `AssistNeighbor` shape (`{chatlog_id, message_index, value, similarity, message_text}`) is used identically in: backend dict (Task 2), JSON-encoded `LabelPrediction.nearest_neighbors` (Task 3), Pydantic `AssistNeighbor` (Task 1), TS type (Task 5), API mock (Task 5), test fixtures (all tasks). No drift.
- **No-commit preference:** every task closes with "Pause for user review" and an explicit "Do not commit." The header restates this so a downstream agent that reads tasks out of order still sees the constraint.
- **Out of scope deferred items from spec are NOT in tasks:** uncertainty queue ordering, label propagation pre-pass, mobile drawer collapse, label definition surface, kNN→LR upgrade — none of these have tasks here, matching the spec's Future Work section.
