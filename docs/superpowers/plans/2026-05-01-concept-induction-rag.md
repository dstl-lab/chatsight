# Concept Induction RAG Rework — Implementation Plan

> **For agentic workers:** This plan is executed iteratively in the main session per user preference (no subagent dispatch). Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit policy:** Claude does NOT run `git commit` or `git add`. Each phase ends with a **STOP** — pause for the user to review the diff and commit themselves. Suggested commit messages are noted at each STOP.

**Goal:** Replace the KMeans-based concept induction feature with a RAG-style discovery pipeline that proposes broad multi-label-friendly categories (Mode A) and surfaces label co-occurrence patterns (Mode B), gated by an on-demand "ripeness" badge.

**Architecture:** Three pure modules — retrieval, generation, orchestration — backed by two SQLModel tables (extended `ConceptCandidate`, new `DiscoveryRun`). KMeans is removed from the discovery path entirely; granularity bias is fixed at retrieval via residual-set max-min diversity selection.

**Tech Stack:** FastAPI + SQLModel + SQLite (backend), React 19 + Vite + TypeScript + Tailwind v4 (frontend), Google `gemini-2.0-flash` (function calling) + `gemini-embedding-001` (embeddings), `pytest` (backend tests), `vitest` + React Testing Library (frontend tests).

**Spec:** `docs/superpowers/specs/2026-05-01-concept-induction-rag-design.md`

---

## Phase 1 — Schema + DB scaffold

### Task 1.1: Add `DiscoveryRun` model

**Files:**
- Modify: `server/python/models.py` (add new class at end)

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_models.py` (create file if missing; if it exists, append):

```python
from datetime import datetime
from sqlmodel import Session
from models import DiscoveryRun


def test_discovery_run_can_be_created(db_session: Session):
    run = DiscoveryRun(
        query_kind="broad_label",
        trigger="manual",
        pool_size_at_trigger=42,
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    assert run.id is not None
    assert run.started_at is not None
    assert run.completed_at is None
    assert run.n_candidates == 0
    assert run.error is None
    assert run.drift_value_at_trigger is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server/python && uv run pytest tests/test_models.py::test_discovery_run_can_be_created -v
```
Expected: `ImportError: cannot import name 'DiscoveryRun' from 'models'` or similar.

- [ ] **Step 3: Add the model**

Append to `server/python/models.py`:

```python
class DiscoveryRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    query_kind: str  # "broad_label" | "co_occurrence"
    trigger: str     # "manual" | "badge"
    drift_value_at_trigger: Optional[float] = None
    pool_size_at_trigger: int
    n_candidates: int = 0
    error: Optional[str] = None
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server/python && uv run pytest tests/test_models.py::test_discovery_run_can_be_created -v
```
Expected: `1 passed`.

---

### Task 1.2: Extend `ConceptCandidate` with new columns

**Files:**
- Modify: `server/python/models.py:74-83` (the `ConceptCandidate` class)
- Modify: `server/python/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_models.py`:

```python
from models import ConceptCandidate, DiscoveryRun, LabelDefinition


def test_concept_candidate_has_new_fields(db_session: Session):
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=10
    )
    db_session.add(run)
    db_session.commit()

    label = LabelDefinition(name="example")
    db_session.add(label)
    db_session.commit()

    cc = ConceptCandidate(
        name="curiosity",
        description="student expressing curiosity",
        example_messages="[]",
        source_run_id="legacy",
        kind="broad_label",
        discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id": 1, "message_index": 0}]',
        created_label_id=label.id,
        decision="accept",
    )
    db_session.add(cc)
    db_session.commit()
    db_session.refresh(cc)
    assert cc.kind == "broad_label"
    assert cc.discovery_run_id == run.id
    assert cc.created_label_id == label.id
    assert cc.decision == "accept"
    assert cc.co_occurrence_label_ids is None
    assert cc.co_occurrence_count is None


def test_concept_candidate_legacy_fields_still_work(db_session: Session):
    cc = ConceptCandidate(
        name="legacy",
        description="legacy candidate without new fields",
        example_messages="[]",
        source_run_id="oldrun123",
    )
    db_session.add(cc)
    db_session.commit()
    db_session.refresh(cc)
    assert cc.kind == "broad_label"  # default
    assert cc.discovery_run_id is None
    assert cc.status == "pending"  # legacy column intact
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_models.py::test_concept_candidate_has_new_fields -v
```
Expected: `AttributeError` or `TypeError` on `kind`/`discovery_run_id`.

- [ ] **Step 3: Extend the model**

Replace the `ConceptCandidate` class in `server/python/models.py` with:

```python
class ConceptCandidate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str
    example_messages: str  # JSON string (legacy column, retained)

    # Legacy fields — retained for backwards compat with old rows
    status: str = "pending"  # pending | accepted | rejected (legacy)
    source_run_id: str       # legacy string-keyed run id
    similar_to: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # New RAG-discovery fields
    kind: str = "broad_label"  # "broad_label" | "co_occurrence"
    discovery_run_id: Optional[int] = Field(
        default=None, foreign_key="discoveryrun.id"
    )
    shown_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decision: Optional[str] = None  # accept | reject | dismiss | suggest_merge | note
    created_label_id: Optional[int] = Field(
        default=None, foreign_key="labeldefinition.id"
    )
    evidence_message_ids: Optional[str] = None  # JSON list of {chatlog_id, message_index}
    co_occurrence_label_ids: Optional[str] = None  # JSON [int, int]
    co_occurrence_count: Optional[int] = None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_models.py -v
```
Expected: all tests pass.

---

### Task 1.3: Add migration for existing SQLite databases

**Files:**
- Modify: `server/python/main.py` (find the existing startup migration block; if there isn't one yet, add one in the FastAPI lifespan or `@app.on_event("startup")` handler)
- Test: `server/python/tests/test_migration.py` (new)

The existing `chatsight.db` files in dev environments do not have the new columns; `SQLModel.metadata.create_all` will only add new tables, not new columns to existing tables. Add `ALTER TABLE` statements that no-op when columns already exist.

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_migration.py`:

```python
import sqlite3
import pytest
from migrate import ensure_concept_candidate_columns


def test_migration_adds_missing_columns(tmp_path):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE conceptcandidate (
            id INTEGER PRIMARY KEY,
            name TEXT,
            description TEXT,
            example_messages TEXT,
            status TEXT,
            source_run_id TEXT,
            similar_to TEXT,
            created_at TEXT
        )
    """)
    conn.commit()

    ensure_concept_candidate_columns(conn)

    cols = [row[1] for row in conn.execute("PRAGMA table_info(conceptcandidate)")]
    for required in [
        "kind", "discovery_run_id", "shown_at", "decided_at",
        "decision", "created_label_id", "evidence_message_ids",
        "co_occurrence_label_ids", "co_occurrence_count",
    ]:
        assert required in cols, f"missing column: {required}"


def test_migration_is_idempotent(tmp_path):
    db_path = tmp_path / "fresh.db"
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE conceptcandidate (
            id INTEGER PRIMARY KEY,
            name TEXT,
            kind TEXT
        )
    """)
    conn.commit()
    ensure_concept_candidate_columns(conn)
    ensure_concept_candidate_columns(conn)  # second call must not error
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_migration.py -v
```
Expected: `ModuleNotFoundError: No module named 'migrate'`.

- [ ] **Step 3: Create the migration helper**

Create `server/python/migrate.py`:

```python
"""Idempotent SQLite column-add migrations for schema evolution.

SQLModel.metadata.create_all() creates new tables but never alters
existing tables. This module adds new columns when they're missing.
"""
import sqlite3
from typing import Iterable

CONCEPT_CANDIDATE_NEW_COLUMNS: list[tuple[str, str]] = [
    ("kind", "TEXT DEFAULT 'broad_label'"),
    ("discovery_run_id", "INTEGER"),
    ("shown_at", "DATETIME"),
    ("decided_at", "DATETIME"),
    ("decision", "TEXT"),
    ("created_label_id", "INTEGER"),
    ("evidence_message_ids", "TEXT"),
    ("co_occurrence_label_ids", "TEXT"),
    ("co_occurrence_count", "INTEGER"),
]


def _existing_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _add_columns_if_missing(
    conn: sqlite3.Connection, table: str, new_cols: Iterable[tuple[str, str]]
) -> None:
    existing = _existing_columns(conn, table)
    for name, ddl in new_cols:
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
    conn.commit()


def ensure_concept_candidate_columns(conn: sqlite3.Connection) -> None:
    _add_columns_if_missing(conn, "conceptcandidate", CONCEPT_CANDIDATE_NEW_COLUMNS)


def run_all_migrations(conn: sqlite3.Connection) -> None:
    """Entry point called at app startup."""
    ensure_concept_candidate_columns(conn)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_migration.py -v
```
Expected: `2 passed`.

- [ ] **Step 5: Wire migration into app startup**

In `server/python/main.py`, find the startup section where `SQLModel.metadata.create_all(engine)` is called. Immediately after it, add:

```python
import sqlite3
from migrate import run_all_migrations

# Apply column-level migrations to existing tables
with sqlite3.connect("chatsight.db") as conn:
    run_all_migrations(conn)
```

(Use the same DB path the rest of the file uses; if it's referenced via a constant, use that constant.)

- [ ] **Step 6: Run the full backend test suite**

```bash
cd server/python && uv run pytest -v
```
Expected: all tests pass; no regressions.

---

### STOP — Phase 1 review

Pause for user review and commit. Suggested commit message:

```
feat: schema for RAG-style concept discovery

Adds DiscoveryRun table and extends ConceptCandidate with
kind, discovery_run_id, evidence_message_ids, decision,
created_label_id, and co-occurrence fields. Includes
idempotent SQLite column-add migration for existing dbs.
```

---

## Phase 2 — Retrieval module

### Task 2.1: `select_diverse` — max-min farthest-point sampling

**Files:**
- Create: `server/python/concept_retrieval.py`
- Test: `server/python/tests/test_concept_retrieval.py` (new)

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_concept_retrieval.py`:

```python
import numpy as np
import pytest
from concept_retrieval import select_diverse


def test_select_diverse_returns_k_indices():
    rng = np.random.default_rng(0)
    vectors = rng.normal(size=(20, 8)).astype(np.float32)
    chosen = select_diverse(vectors, k=5)
    assert len(chosen) == 5
    assert len(set(chosen)) == 5  # no duplicates
    assert all(0 <= i < 20 for i in chosen)


def test_select_diverse_picks_far_apart_points():
    # Three tight clusters; k=3 should pick one from each.
    centers = np.array([[10.0, 0], [-10.0, 0], [0, 10.0]], dtype=np.float32)
    points = np.vstack([
        centers + np.random.RandomState(i).normal(scale=0.01, size=(5, 2))
        for i in range(3)
    ]).astype(np.float32)
    chosen = select_diverse(points, k=3)
    chosen_pts = points[chosen]
    # All three picked points should be far from each other (>5 apart)
    for i in range(3):
        for j in range(i + 1, 3):
            d = np.linalg.norm(chosen_pts[i] - chosen_pts[j])
            assert d > 5, f"chosen points {i} and {j} are too close: {d}"


def test_select_diverse_handles_k_geq_n():
    vectors = np.eye(3, dtype=np.float32)
    chosen = select_diverse(vectors, k=5)
    # Cannot select more than n; returns all unique indices.
    assert sorted(chosen) == [0, 1, 2]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py -v
```
Expected: `ModuleNotFoundError: No module named 'concept_retrieval'`.

- [ ] **Step 3: Implement `select_diverse`**

Create `server/python/concept_retrieval.py`:

```python
"""Pure retrieval primitives for concept discovery.

No Gemini calls here except deterministic embeddings.
No DB writes; only DB reads.
"""
from __future__ import annotations
from typing import Any, Optional, TypedDict
import json
import numpy as np
from sqlmodel import Session, select, func

from models import (
    LabelApplication,
    LabelDefinition,
    MessageCache,
    MessageEmbedding,
)
from concept_service import EMBED_MODEL  # reuse existing constant


class Message(TypedDict):
    chatlog_id: int
    message_index: int
    message_text: str


class CoOccurrencePair(TypedDict):
    label_a_id: int
    label_b_id: int
    label_a_name: str
    label_b_name: str
    count: int
    example_message_ids: list[dict[str, int]]


def select_diverse(vectors: np.ndarray, k: int) -> list[int]:
    """Greedy max-min farthest-point sampling. No clustering.

    Seed with index 0, then iteratively add the index whose minimum
    distance to already-selected vectors is the largest. Returns
    indices in selection order. If k >= len(vectors), returns all
    indices in selection order.
    """
    n = len(vectors)
    if n == 0:
        return []
    k = min(k, n)
    chosen = [0]
    # Precompute squared distances from each point to the current set
    min_dists = np.linalg.norm(vectors - vectors[0], axis=1)
    while len(chosen) < k:
        next_idx = int(np.argmax(min_dists))
        chosen.append(next_idx)
        new_dists = np.linalg.norm(vectors - vectors[next_idx], axis=1)
        min_dists = np.minimum(min_dists, new_dists)
        # Prevent re-selecting same index
        min_dists[next_idx] = -1.0
    return chosen
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py -v
```
Expected: `3 passed`.

---

### Task 2.2: `thinly_labeled_pool`

**Files:**
- Modify: `server/python/concept_retrieval.py`
- Modify: `server/python/tests/test_concept_retrieval.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_retrieval.py`:

```python
from datetime import datetime
from sqlmodel import Session
from models import (
    MessageCache, LabelDefinition, LabelApplication,
)
from concept_retrieval import thinly_labeled_pool


def test_thinly_labeled_pool_excludes_human_labeled(db_session: Session):
    # Two messages: one human-labeled, one with only AI label, one unlabeled.
    for i, text in enumerate(["a", "b", "c"]):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=text,
            user_email="u@x", created_at=datetime.utcnow(),
        ))
    label = LabelDefinition(name="L1")
    db_session.add(label)
    db_session.commit()

    # Message 0: human-applied (excluded)
    db_session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label.id,
        applied_by="human", confidence=None,
    ))
    # Message 1: AI-applied only (still in pool)
    db_session.add(LabelApplication(
        chatlog_id=1, message_index=1, label_id=label.id,
        applied_by="ai", confidence=0.5,
    ))
    db_session.commit()

    pool = thinly_labeled_pool(db_session)
    keys = {(m["chatlog_id"], m["message_index"]) for m in pool}
    assert (1, 0) not in keys      # human-labeled — excluded
    assert (1, 1) in keys          # AI-only — included
    assert (1, 2) in keys          # unlabeled — included
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py::test_thinly_labeled_pool_excludes_human_labeled -v
```
Expected: `ImportError: cannot import name 'thinly_labeled_pool'`.

- [ ] **Step 3: Implement `thinly_labeled_pool`**

Append to `server/python/concept_retrieval.py`:

```python
def thinly_labeled_pool(db: Session) -> list[Message]:
    """Mode A corpus: messages with NO human LabelApplications.

    AI-only applications do not count as labeled — discovery's purpose
    is to find what instructor intent doesn't yet cover.
    """
    # Collect (chatlog_id, message_index) keys of messages with human labels
    human_labeled = set(
        (chatlog_id, message_index)
        for chatlog_id, message_index in db.exec(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.applied_by == "human")
            .distinct()
        ).all()
    )

    rows = db.exec(
        select(
            MessageCache.chatlog_id,
            MessageCache.message_index,
            MessageCache.message_text,
        )
    ).all()

    return [
        {
            "chatlog_id": chatlog_id,
            "message_index": message_index,
            "message_text": message_text,
        }
        for chatlog_id, message_index, message_text in rows
        if (chatlog_id, message_index) not in human_labeled
    ]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py::test_thinly_labeled_pool_excludes_human_labeled -v
```
Expected: `1 passed`.

---

### Task 2.3: `retrieve_residual` — coverage-targeted retrieval

**Files:**
- Modify: `server/python/concept_retrieval.py`
- Modify: `server/python/tests/test_concept_retrieval.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_retrieval.py`:

```python
from concept_retrieval import retrieve_residual


def test_retrieve_residual_filters_high_similarity_messages(db_session, monkeypatch):
    """Messages whose embedding is close to an existing label are filtered out.
       Stub the embedding fetch path to return controlled vectors."""
    # Build 5 cached messages
    for i in range(5):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"msg{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    label = LabelDefinition(name="LX", description="thing")
    db_session.add(label)
    db_session.commit()

    # Stub: messages 0,1 are very close to label embedding;
    #       messages 2,3,4 are far. With threshold 0.55,
    #       residual = {2, 3, 4}.
    msg_vecs = np.array([
        [1, 0, 0, 0],   # cos = 1.0 vs label
        [0.9, 0.1, 0, 0],
        [0, 1, 0, 0],   # cos = 0 vs label
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ], dtype=np.float32)
    label_vecs = np.array([[1, 0, 0, 0]], dtype=np.float32)

    def fake_embed_messages(messages, db):
        return msg_vecs[: len(messages)]

    def fake_embed_labels(labels, db):
        return label_vecs

    monkeypatch.setattr("concept_retrieval._embed_messages", fake_embed_messages)
    monkeypatch.setattr("concept_retrieval._embed_label_definitions", fake_embed_labels)

    residual = retrieve_residual(db_session, threshold=0.55, target_size=10)
    keys = sorted((m["chatlog_id"], m["message_index"]) for m in residual)
    assert keys == [(1, 2), (1, 3), (1, 4)]


def test_retrieve_residual_caps_at_target_size(db_session, monkeypatch):
    for i in range(20):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"msg{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    db_session.commit()

    msg_vecs = np.eye(20, dtype=np.float32)
    monkeypatch.setattr("concept_retrieval._embed_messages",
                        lambda m, db: msg_vecs[: len(m)])
    # No labels → no label_vecs → all messages pass residual filter
    monkeypatch.setattr("concept_retrieval._embed_label_definitions",
                        lambda l, db: np.zeros((0, 20), dtype=np.float32))

    residual = retrieve_residual(db_session, threshold=0.55, target_size=5)
    assert len(residual) == 5
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py -v -k retrieve_residual
```
Expected: import errors.

- [ ] **Step 3: Implement `retrieve_residual`**

Append to `server/python/concept_retrieval.py`:

```python
def _normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
    return vectors / norms


def _embed_messages(messages: list[Message], db: Session) -> np.ndarray:
    """Wrapper around the existing embed_messages helper.

    Imported lazily to avoid a circular import with concept_service.
    """
    from concept_service import embed_messages
    return embed_messages(messages, db)


def _embed_label_definitions(
    labels: list[LabelDefinition], db: Session
) -> np.ndarray:
    """Embed `name: description` strings for each active label.

    These are NOT cached in MessageEmbedding (different content type);
    we just call the embedding API directly. Cheap because label
    counts are small.
    """
    if not labels:
        return np.zeros((0, 0), dtype=np.float32)
    from concept_service import client
    texts = [
        f"{l.name}: {l.description or ''}".strip()
        for l in labels
    ]
    result = client.models.embed_content(model=EMBED_MODEL, contents=texts)
    return np.array([e.values for e in result.embeddings], dtype=np.float32)


def retrieve_residual(
    db: Session,
    threshold: float = 0.55,
    target_size: int = 80,
) -> list[Message]:
    """Mode A retrieval. Score each pool message by max cosine sim to
    any active LabelDefinition embedding; keep messages whose max sim
    is below `threshold`. Run max-min diversity selection on the
    residual to pick `target_size` messages spanning it.
    """
    pool = thinly_labeled_pool(db)
    if len(pool) == 0:
        return []

    msg_vecs = _embed_messages(pool, db)

    active_labels = list(
        db.exec(
            select(LabelDefinition).where(LabelDefinition.archived_at == None)  # noqa: E711
        ).all()
    )
    label_vecs = _embed_label_definitions(active_labels, db)

    if label_vecs.size == 0:
        residual_indices = list(range(len(pool)))
    else:
        msg_normed = _normalize(msg_vecs)
        label_normed = _normalize(label_vecs)
        sim = msg_normed @ label_normed.T  # shape (n_msgs, n_labels)
        max_sim = sim.max(axis=1)
        residual_indices = [i for i, s in enumerate(max_sim) if s < threshold]

    if not residual_indices:
        return []

    residual_vecs = msg_vecs[residual_indices]
    diverse_local = select_diverse(residual_vecs, k=target_size)
    chosen = [residual_indices[i] for i in diverse_local]
    return [pool[i] for i in chosen]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py -v
```
Expected: all retrieval tests pass.

---

### Task 2.4: `retrieve_co_occurrence`

**Files:**
- Modify: `server/python/concept_retrieval.py`
- Modify: `server/python/tests/test_concept_retrieval.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_retrieval.py`:

```python
from concept_retrieval import retrieve_co_occurrence


def test_retrieve_co_occurrence_finds_frequent_pairs(db_session):
    # Two labels co-occur on 3 messages; min_count=2 → pair returned.
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    label_c = LabelDefinition(name="C")
    db_session.add_all([label_a, label_b, label_c])
    db_session.commit()

    for i in range(3):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"m{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
        db_session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_a.id,
            applied_by="human",
        ))
        db_session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_b.id,
            applied_by="human",
        ))
    # Single C label, no co-occurrence partner above threshold
    db_session.add(MessageCache(
        chatlog_id=1, message_index=99, message_text="lonely",
        user_email="u", created_at=datetime.utcnow(),
    ))
    db_session.add(LabelApplication(
        chatlog_id=1, message_index=99, label_id=label_c.id,
        applied_by="human",
    ))
    db_session.commit()

    pairs = retrieve_co_occurrence(db_session, min_count=2)
    pair_keys = {tuple(sorted([p["label_a_id"], p["label_b_id"]])): p
                 for p in pairs}
    expected_pair = tuple(sorted([label_a.id, label_b.id]))
    assert expected_pair in pair_keys
    assert pair_keys[expected_pair]["count"] == 3
    assert len(pair_keys[expected_pair]["example_message_ids"]) >= 1


def test_retrieve_co_occurrence_ignores_ai_labels(db_session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    db_session.add_all([label_a, label_b])
    db_session.commit()
    db_session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label_a.id,
        applied_by="ai", confidence=0.7,
    ))
    db_session.add(LabelApplication(
        chatlog_id=1, message_index=0, label_id=label_b.id,
        applied_by="human",
    ))
    db_session.commit()
    pairs = retrieve_co_occurrence(db_session, min_count=1)
    assert pairs == []  # mixed human+ai pair not counted
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py::test_retrieve_co_occurrence_finds_frequent_pairs tests/test_concept_retrieval.py::test_retrieve_co_occurrence_ignores_ai_labels -v
```
Expected: import error.

- [ ] **Step 3: Implement `retrieve_co_occurrence`**

Append to `server/python/concept_retrieval.py`:

```python
def retrieve_co_occurrence(
    db: Session, min_count: int = 8,
) -> list[CoOccurrencePair]:
    """Mode B retrieval. Find pairs of (human-applied) labels that
    co-occur on >= min_count messages. Returns pair rows with example
    message keys.
    """
    # Build (chatlog_id, message_index) -> set of human label_ids
    rows = db.exec(
        select(
            LabelApplication.chatlog_id,
            LabelApplication.message_index,
            LabelApplication.label_id,
        ).where(LabelApplication.applied_by == "human")
    ).all()

    by_msg: dict[tuple[int, int], set[int]] = {}
    for chatlog_id, message_index, label_id in rows:
        key = (chatlog_id, message_index)
        by_msg.setdefault(key, set()).add(label_id)

    # Count unordered pairs
    pair_counts: dict[tuple[int, int], int] = {}
    pair_examples: dict[tuple[int, int], list[dict[str, int]]] = {}
    for msg_key, label_ids in by_msg.items():
        ids = sorted(label_ids)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                pk = (ids[i], ids[j])
                pair_counts[pk] = pair_counts.get(pk, 0) + 1
                pair_examples.setdefault(pk, []).append(
                    {"chatlog_id": msg_key[0], "message_index": msg_key[1]}
                )

    # Pull active label names
    active = {
        l.id: l.name
        for l in db.exec(
            select(LabelDefinition).where(LabelDefinition.archived_at == None)  # noqa: E711
        ).all()
    }

    out: list[CoOccurrencePair] = []
    for (a_id, b_id), count in pair_counts.items():
        if count < min_count:
            continue
        if a_id not in active or b_id not in active:
            continue
        out.append({
            "label_a_id": a_id,
            "label_b_id": b_id,
            "label_a_name": active[a_id],
            "label_b_name": active[b_id],
            "count": count,
            "example_message_ids": pair_examples[(a_id, b_id)][:5],
        })
    out.sort(key=lambda p: p["count"], reverse=True)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_retrieval.py -v
```
Expected: all retrieval tests pass.

---

### STOP — Phase 2 review

Pause for user review and commit. Suggested commit message:

```
feat: retrieval primitives for concept discovery

Adds concept_retrieval.py with select_diverse (max-min
farthest-point sampling), thinly_labeled_pool,
retrieve_residual (Mode A), and retrieve_co_occurrence
(Mode B). Pure NumPy + SQL; no clustering on the
discovery path.
```

---

## Phase 3 — Generation module + orchestrator

### Task 3.1: Mode A — `generate_broad_labels`

**Files:**
- Create: `server/python/concept_generation.py`
- Test: `server/python/tests/test_concept_generation.py` (new)

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_concept_generation.py`:

```python
from unittest.mock import MagicMock
from concept_generation import (
    generate_broad_labels, BROAD_LABEL_TOOL,
)


def test_generate_broad_labels_calls_gemini_with_breadth_constraints(monkeypatch):
    """Verify the prompt explicitly instructs the model to produce broad,
       multi-label-friendly proposals."""
    captured = {}

    fake_response = MagicMock()
    fake_part = MagicMock()
    fake_part.function_call.name = "suggest_broad_labels"
    fake_part.function_call.args = {
        "concepts": [
            {
                "name": "metacognition",
                "description": "students reflecting on their own learning",
                "evidence_message_indices": [0, 3],
            }
        ]
    }
    fake_response.candidates = [MagicMock()]
    fake_response.candidates[0].content.parts = [fake_part]

    fake_client = MagicMock()
    fake_client.models.generate_content = MagicMock(return_value=fake_response)

    def capture(*args, **kwargs):
        captured["prompt"] = kwargs.get("contents") or args[1]
        return fake_response

    fake_client.models.generate_content.side_effect = capture
    monkeypatch.setattr("concept_generation.client", fake_client)

    retrieved = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "I'm not sure if I get this"},
        {"chatlog_id": 1, "message_index": 1, "message_text": "code didn't run"},
        {"chatlog_id": 1, "message_index": 2, "message_text": "what does .loc do"},
        {"chatlog_id": 1, "message_index": 3, "message_text": "am I doing this right"},
    ]
    drafts = generate_broad_labels(retrieved, existing_labels=[], rejected_names=[])

    assert len(drafts) == 1
    assert drafts[0]["name"] == "metacognition"
    # evidence resolved back to chatlog_id/message_index
    assert {"chatlog_id": 1, "message_index": 0} in drafts[0]["evidence_message_ids"]
    assert {"chatlog_id": 1, "message_index": 3} in drafts[0]["evidence_message_ids"]

    # Prompt must include the breadth constraint
    prompt = captured["prompt"]
    assert "co-apply" in prompt.lower() or "combine" in prompt.lower()
    assert "broad" in prompt.lower()


def test_broad_label_tool_schema_shape():
    decl = BROAD_LABEL_TOOL.function_declarations[0]
    assert decl.name == "suggest_broad_labels"
    props = decl.parameters["properties"]["concepts"]["items"]["properties"]
    assert "name" in props
    assert "description" in props
    assert "evidence_message_indices" in props
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_generation.py -v
```
Expected: import error.

- [ ] **Step 3: Implement `generate_broad_labels`**

Create `server/python/concept_generation.py`:

```python
"""Gemini prompt + tool schemas for RAG-style concept discovery."""
from __future__ import annotations
import os
from typing import Any, TypedDict
from google import genai
from google.genai import types


client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))


class ConceptDraft(TypedDict, total=False):
    kind: str  # "broad_label" | "co_occurrence"
    name: str
    description: str
    evidence_message_ids: list[dict[str, int]]
    co_occurrence_label_ids: list[int]
    co_occurrence_count: int
    suggested_resolution: str  # for co_occurrence: "make_label" | "merge" | "independent"


# ── Mode A: broad-label discovery ──────────────────────────────────

BROAD_LABEL_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="suggest_broad_labels",
        description="Propose broad, multi-label-friendly categories.",
        parameters={
            "type": "object",
            "properties": {
                "concepts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "description": {"type": "string"},
                            "evidence_message_indices": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "0-indexed positions in the input list",
                            },
                        },
                        "required": ["name", "description", "evidence_message_indices"],
                    },
                },
            },
            "required": ["concepts"],
        },
    )
])

BROAD_LABEL_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are an education researcher analyzing student-AI tutoring "
        "conversations. The instructor labels messages with multiple BROAD "
        "labels per message — labels are designed to combine, not to be "
        "mutually exclusive. Your job is to find broad themes the schema "
        "doesn't yet cover."
    ),
    temperature=0,
    tools=[BROAD_LABEL_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["suggest_broad_labels"],
        )
    ),
)


def _build_broad_label_prompt(
    retrieved: list[dict[str, Any]],
    existing_labels: list[dict[str, str]],
    rejected_names: list[str],
) -> str:
    parts: list[str] = []
    parts.append("## Existing Labels (already in use — do NOT re-suggest)")
    parts.append("These labels reflect the instructor's style and granularity.")
    for l in existing_labels:
        desc = f" — {l.get('description','')}" if l.get("description") else ""
        parts.append(f"- **{l['name']}**{desc}")

    if rejected_names:
        parts.append("\n## Previously Rejected (do NOT suggest)")
        for name in rejected_names:
            parts.append(f"- {name}")

    parts.append("\n## Candidate Messages")
    parts.append(
        "These messages were retrieved as the SCHEMA'S BLIND SPOT — they "
        "are deliberately diverse, NOT a tight cluster. Any single narrow "
        "label cannot span this set."
    )
    parts.append("")
    for i, m in enumerate(retrieved):
        text = m["message_text"][:400]
        parts.append(f"{i}. \"{text}\"")

    parts.append("")
    parts.append("## Task")
    parts.append(
        "Propose BROAD label categories. A useful proposal here:\n"
        "- covers AT LEAST ~15% of the candidate messages above\n"
        "- is meant to CO-APPLY with existing labels, not replace them\n"
        "- is distinct from existing labels (different concept, not just a rename)\n"
        "- is named in the SAME style as existing labels (look at their format)\n\n"
        "Do NOT propose narrow sub-categories. If a concept would only fit "
        "one or two messages, skip it. Quality over quantity. It is fine to "
        "return zero proposals if the retrieved set has no broad theme.\n\n"
        "Reference each proposal's evidence by the 0-indexed message numbers "
        "above. Call `suggest_broad_labels` with your proposals."
    )
    return "\n".join(parts)


def generate_broad_labels(
    retrieved: list[dict[str, Any]],
    existing_labels: list[dict[str, str]],
    rejected_names: list[str],
) -> list[ConceptDraft]:
    """Single Gemini call. Returns drafts with evidence resolved back to
    {chatlog_id, message_index} pairs (not the prompt-local indices)."""
    if not retrieved:
        return []
    prompt = _build_broad_label_prompt(retrieved, existing_labels, rejected_names)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=BROAD_LABEL_CONFIG,
    )

    raw_concepts: list[dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        if getattr(part, "function_call", None) and \
                part.function_call.name == "suggest_broad_labels":
            args = dict(part.function_call.args)
            raw_concepts = list(args.get("concepts", []))
            break

    drafts: list[ConceptDraft] = []
    for c in raw_concepts:
        evidence_ids: list[dict[str, int]] = []
        for idx in c.get("evidence_message_indices", []) or []:
            try:
                idx_int = int(idx)
            except (TypeError, ValueError):
                continue
            if 0 <= idx_int < len(retrieved):
                m = retrieved[idx_int]
                evidence_ids.append({
                    "chatlog_id": m["chatlog_id"],
                    "message_index": m["message_index"],
                })
        drafts.append({
            "kind": "broad_label",
            "name": c["name"],
            "description": c["description"],
            "evidence_message_ids": evidence_ids,
        })
    return drafts
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_generation.py -v
```
Expected: `2 passed`.

---

### Task 3.2: Mode B — `generate_co_occurrence_concepts`

**Files:**
- Modify: `server/python/concept_generation.py`
- Modify: `server/python/tests/test_concept_generation.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_generation.py`:

```python
from concept_generation import (
    generate_co_occurrence_concepts, CO_OCCURRENCE_TOOL,
)


def test_generate_co_occurrence_returns_drafts(monkeypatch):
    fake_response = MagicMock()
    fake_part = MagicMock()
    fake_part.function_call.name = "evaluate_co_occurrence"
    fake_part.function_call.args = {
        "evaluations": [
            {
                "label_a_id": 1, "label_b_id": 2,
                "name": "stuck on code",
                "description": "students who cannot run their code and feel stuck",
                "suggested_resolution": "make_label",
            }
        ]
    }
    fake_response.candidates = [MagicMock()]
    fake_response.candidates[0].content.parts = [fake_part]

    fake_client = MagicMock()
    fake_client.models.generate_content = MagicMock(return_value=fake_response)
    monkeypatch.setattr("concept_generation.client", fake_client)

    pairs = [{
        "label_a_id": 1, "label_b_id": 2,
        "label_a_name": "code help", "label_b_name": "confused",
        "count": 12,
        "example_message_ids": [{"chatlog_id": 1, "message_index": 0}],
    }]
    drafts = generate_co_occurrence_concepts(pairs, existing_labels=[])

    assert len(drafts) == 1
    assert drafts[0]["kind"] == "co_occurrence"
    assert drafts[0]["co_occurrence_label_ids"] == [1, 2]
    assert drafts[0]["co_occurrence_count"] == 12
    assert drafts[0]["suggested_resolution"] == "make_label"


def test_co_occurrence_tool_schema_shape():
    decl = CO_OCCURRENCE_TOOL.function_declarations[0]
    assert decl.name == "evaluate_co_occurrence"
    props = decl.parameters["properties"]["evaluations"]["items"]["properties"]
    assert {"label_a_id", "label_b_id", "suggested_resolution"} <= set(props)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_generation.py -v -k co_occurrence
```
Expected: import error.

- [ ] **Step 3: Implement `generate_co_occurrence_concepts`**

Append to `server/python/concept_generation.py`:

```python
# ── Mode B: co-occurrence evaluation ───────────────────────────────

CO_OCCURRENCE_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="evaluate_co_occurrence",
        description="Evaluate whether co-occurring label pairs deserve a combined label, a merge, or are independent.",
        parameters={
            "type": "object",
            "properties": {
                "evaluations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label_a_id": {"type": "integer"},
                            "label_b_id": {"type": "integer"},
                            "name": {"type": "string", "description": "If suggested_resolution=='make_label', the proposed combo name; else empty."},
                            "description": {"type": "string"},
                            "suggested_resolution": {
                                "type": "string",
                                "enum": ["make_label", "merge", "independent"],
                            },
                        },
                        "required": ["label_a_id", "label_b_id", "suggested_resolution"],
                    },
                },
            },
            "required": ["evaluations"],
        },
    )
])

CO_OCCURRENCE_CONFIG = types.GenerateContentConfig(
    system_instruction=(
        "You are evaluating whether pairs of labels that frequently "
        "co-occur represent (a) a coherent THIRD concept worth its own "
        "label, (b) essentially the same thing under two names "
        "(merge candidates), or (c) two genuinely independent things "
        "that just happen to overlap. Be conservative — most pairs are "
        "independent."
    ),
    temperature=0,
    tools=[CO_OCCURRENCE_TOOL],
    tool_config=types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode="ANY",
            allowed_function_names=["evaluate_co_occurrence"],
        )
    ),
)


def _build_co_occurrence_prompt(
    pairs: list[dict[str, Any]],
    existing_labels: list[dict[str, str]],
) -> str:
    parts: list[str] = []
    parts.append("## Existing Labels in the Schema")
    for l in existing_labels:
        desc = f" — {l.get('description','')}" if l.get("description") else ""
        parts.append(f"- (id={l.get('id','?')}) **{l['name']}**{desc}")

    parts.append("\n## Frequently Co-occurring Label Pairs")
    for p in pairs:
        parts.append(
            f"- **{p['label_a_name']}** + **{p['label_b_name']}** "
            f"co-occur on {p['count']} messages "
            f"(label_a_id={p['label_a_id']}, label_b_id={p['label_b_id']})"
        )

    parts.append("\n## Task")
    parts.append(
        "For each pair, decide one of:\n"
        "- `make_label`: the combination is a coherent third concept "
        "worth its own broad label (rare; only when the combination "
        "captures something neither label captures alone)\n"
        "- `merge`: the two labels are nearly synonymous; keeping both "
        "fragments the schema\n"
        "- `independent`: the pair is just two real things that often "
        "appear in the same message — no schema action needed\n\n"
        "Default to `independent`. Only suggest `make_label` if you can "
        "name the combined concept in the same style as existing labels. "
        "Call `evaluate_co_occurrence` with one entry per pair."
    )
    return "\n".join(parts)


def generate_co_occurrence_concepts(
    pairs: list[dict[str, Any]],
    existing_labels: list[dict[str, Any]],
) -> list[ConceptDraft]:
    """Single Gemini call across all pairs."""
    if not pairs:
        return []
    prompt = _build_co_occurrence_prompt(pairs, existing_labels)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=CO_OCCURRENCE_CONFIG,
    )

    raw: list[dict[str, Any]] = []
    for part in response.candidates[0].content.parts:
        if getattr(part, "function_call", None) and \
                part.function_call.name == "evaluate_co_occurrence":
            args = dict(part.function_call.args)
            raw = list(args.get("evaluations", []))
            break

    pair_lookup = {
        tuple(sorted([p["label_a_id"], p["label_b_id"]])): p for p in pairs
    }

    drafts: list[ConceptDraft] = []
    for ev in raw:
        try:
            a, b = int(ev["label_a_id"]), int(ev["label_b_id"])
        except (KeyError, TypeError, ValueError):
            continue
        key = tuple(sorted([a, b]))
        src = pair_lookup.get(key)
        if not src:
            continue
        name = ev.get("name") or f"{src['label_a_name']}+{src['label_b_name']}"
        drafts.append({
            "kind": "co_occurrence",
            "name": name,
            "description": ev.get("description") or "",
            "co_occurrence_label_ids": [a, b],
            "co_occurrence_count": src["count"],
            "suggested_resolution": ev.get("suggested_resolution", "independent"),
            "evidence_message_ids": src.get("example_message_ids", []),
        })
    return drafts
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_generation.py -v
```
Expected: all generation tests pass.

---

### Task 3.3: Rewrite `concept_service.discover()` as the orchestrator

**Files:**
- Modify: `server/python/concept_service.py:209-326` (replace `discover_concepts`)
- Test: `server/python/tests/test_concept_service.py` (new or modify)

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_concept_service.py`:

```python
from unittest.mock import patch
from datetime import datetime
from sqlmodel import Session, select
from models import (
    DiscoveryRun, ConceptCandidate, MessageCache,
    LabelDefinition, LabelApplication,
)
from concept_service import discover


def test_discover_broad_label_creates_run_and_candidates(db_session: Session):
    for i in range(10):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"msg{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    db_session.commit()

    fake_retrieved = [
        {"chatlog_id": 1, "message_index": i, "message_text": f"msg{i}"}
        for i in range(5)
    ]
    fake_drafts = [{
        "kind": "broad_label",
        "name": "curious",
        "description": "students expressing curiosity",
        "evidence_message_ids": [{"chatlog_id": 1, "message_index": 0}],
    }]

    with patch("concept_service.retrieve_residual", return_value=fake_retrieved), \
         patch("concept_service.generate_broad_labels", return_value=fake_drafts):
        run = discover(db_session, query_kind="broad_label", trigger="manual")

    assert run.id is not None
    assert run.completed_at is not None
    assert run.error is None
    assert run.n_candidates == 1
    assert run.pool_size_at_trigger == 10  # all messages are unlabeled

    candidates = db_session.exec(
        select(ConceptCandidate).where(
            ConceptCandidate.discovery_run_id == run.id
        )
    ).all()
    assert len(candidates) == 1
    assert candidates[0].kind == "broad_label"
    assert candidates[0].name == "curious"


def test_discover_records_error_on_failure(db_session: Session):
    with patch(
        "concept_service.retrieve_residual",
        side_effect=RuntimeError("boom"),
    ):
        run = discover(db_session, query_kind="broad_label", trigger="manual")
    assert run.error == "boom"
    assert run.completed_at is not None
    assert run.n_candidates == 0


def test_discover_co_occurrence_path(db_session: Session):
    label_a = LabelDefinition(name="A")
    label_b = LabelDefinition(name="B")
    db_session.add_all([label_a, label_b])
    db_session.commit()
    for i in range(2):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"m{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
        db_session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_a.id,
            applied_by="human",
        ))
        db_session.add(LabelApplication(
            chatlog_id=1, message_index=i, label_id=label_b.id,
            applied_by="human",
        ))
    db_session.commit()

    fake_drafts = [{
        "kind": "co_occurrence", "name": "combo",
        "description": "A+B together",
        "co_occurrence_label_ids": [label_a.id, label_b.id],
        "co_occurrence_count": 2,
        "suggested_resolution": "independent",
        "evidence_message_ids": [],
    }]

    with patch("concept_service.generate_co_occurrence_concepts",
               return_value=fake_drafts):
        run = discover(db_session, query_kind="co_occurrence",
                       trigger="manual", min_count=1)

    assert run.query_kind == "co_occurrence"
    assert run.n_candidates == 1
    cc = db_session.exec(
        select(ConceptCandidate).where(
            ConceptCandidate.discovery_run_id == run.id
        )
    ).one()
    assert cc.kind == "co_occurrence"
    assert cc.co_occurrence_count == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_service.py -v
```
Expected: import errors / function-signature mismatches.

- [ ] **Step 3: Rewrite `concept_service.py`**

Open `server/python/concept_service.py`. **Delete** the existing `SUGGEST_TOOL`, `SUGGEST_CONFIG`, `_build_discovery_prompt`, `_deduplicate_concepts`, and `discover_concepts` functions (lines ~74-326). Keep `embed_messages`, the `client`, and the `EMBED_MODEL`/`EMBED_DIM`/`EMBED_BATCH_SIZE` constants.

Append the new orchestrator at the end of the file:

```python
import json
from datetime import datetime
from typing import Optional
from concept_retrieval import (
    retrieve_residual, retrieve_co_occurrence,
)
from concept_generation import (
    generate_broad_labels, generate_co_occurrence_concepts,
)
from models import (
    DiscoveryRun, ConceptCandidate, LabelDefinition,
    LabelApplication,
)


def _read_recalibration_due(db: Session) -> bool:
    """Returns True if the PR #36 recalibration system says drift is up.
    Implemented as: a non-null `RecalibrationEvent`-driven signal
    indicates `GET /api/session/recalibration` would currently surface
    a recalibration message. Cheap to compute directly here without
    going through the route layer."""
    # Use the existing helper to avoid duplication.
    from main import _compute_recalibration_interval
    from models import RecalibrationEvent, LabelingSession
    session_row = db.exec(
        select(LabelingSession).order_by(LabelingSession.id.desc())
    ).first()
    if not session_row:
        return False
    events = list(db.exec(
        select(RecalibrationEvent).order_by(RecalibrationEvent.id.asc())
    ).all())
    interval = _compute_recalibration_interval(events)
    cutoff = events[-1].created_at if events else session_row.started_at
    labeled_since = db.exec(
        select(func.count()).select_from(
            select(LabelApplication.chatlog_id, LabelApplication.message_index)
            .where(LabelApplication.applied_by == "human")
            .where(LabelApplication.created_at > cutoff)
            .distinct()
            .subquery()
        )
    ).one()
    return labeled_since >= interval


def _persist_drafts(
    drafts: list[dict], run: DiscoveryRun, db: Session,
) -> list[ConceptCandidate]:
    out: list[ConceptCandidate] = []
    for d in drafts:
        cc = ConceptCandidate(
            name=d["name"],
            description=d.get("description", ""),
            example_messages=json.dumps(
                [{"excerpt": ""}]  # legacy column kept populated
            ),
            source_run_id=str(run.id),  # legacy column populated for compat
            kind=d["kind"],
            discovery_run_id=run.id,
            evidence_message_ids=(
                json.dumps(d["evidence_message_ids"])
                if d.get("evidence_message_ids") is not None else None
            ),
            co_occurrence_label_ids=(
                json.dumps(d["co_occurrence_label_ids"])
                if d.get("co_occurrence_label_ids") is not None else None
            ),
            co_occurrence_count=d.get("co_occurrence_count"),
        )
        db.add(cc)
        out.append(cc)
    db.commit()
    for cc in out:
        db.refresh(cc)
    return out


def discover(
    db: Session,
    query_kind: str,
    trigger: str,
    *,
    threshold: float = 0.55,
    target_size: int = 80,
    min_count: int = 8,
) -> DiscoveryRun:
    """Orchestrates one discovery run end-to-end.
    Always finalizes the run (sets completed_at and either n_candidates
    or error)."""
    run = DiscoveryRun(
        query_kind=query_kind,
        trigger=trigger,
        pool_size_at_trigger=0,  # filled in below
        drift_value_at_trigger=None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        # Compute drift signal once (Mode B doesn't really care, but keep it consistent)
        try:
            run.drift_value_at_trigger = (
                1.0 if _read_recalibration_due(db) else 0.0
            )
        except Exception:
            run.drift_value_at_trigger = None

        if query_kind == "broad_label":
            retrieved = retrieve_residual(
                db, threshold=threshold, target_size=target_size,
            )
            run.pool_size_at_trigger = len(retrieved)
            existing = [
                {"name": l.name, "description": l.description or "", "id": l.id}
                for l in db.exec(
                    select(LabelDefinition).where(
                        LabelDefinition.archived_at == None  # noqa: E711
                    )
                ).all()
            ]
            rejected = [
                cc.name for cc in db.exec(
                    select(ConceptCandidate).where(
                        ConceptCandidate.decision == "reject"
                    )
                ).all()
            ]
            drafts = generate_broad_labels(retrieved, existing, rejected)
        elif query_kind == "co_occurrence":
            pairs = retrieve_co_occurrence(db, min_count=min_count)
            run.pool_size_at_trigger = len(pairs)
            existing = [
                {"name": l.name, "description": l.description or "", "id": l.id}
                for l in db.exec(
                    select(LabelDefinition).where(
                        LabelDefinition.archived_at == None  # noqa: E711
                    )
                ).all()
            ]
            drafts = generate_co_occurrence_concepts(pairs, existing)
        else:
            raise ValueError(f"unknown query_kind: {query_kind}")

        candidates = _persist_drafts(drafts, run, db)
        run.n_candidates = len(candidates)
    except Exception as e:
        run.error = str(e)
    finally:
        run.completed_at = datetime.utcnow()
        db.add(run)
        db.commit()
        db.refresh(run)
    return run
```

- [ ] **Step 4: Run all backend tests**

```bash
cd server/python && uv run pytest -v
```
Expected: all tests pass; no regressions in unrelated suites.

---

### Task 3.4: `accept_broad_label` — auto-create label and AI-apply

**Files:**
- Modify: `server/python/concept_service.py`
- Modify: `server/python/tests/test_concept_service.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_service.py`:

```python
from concept_service import accept_broad_label


def test_accept_broad_label_creates_label_and_ai_applies(db_session):
    # Set up: cached messages and a candidate referencing them.
    for i in range(3):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"m{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=3,
    )
    db_session.add(run)
    db_session.commit()

    cc = ConceptCandidate(
        name="metacognition",
        description="reflection on own learning",
        example_messages="[]",
        source_run_id=str(run.id),
        kind="broad_label",
        discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id":1,"message_index":0},{"chatlog_id":1,"message_index":2}]',
    )
    db_session.add(cc)
    db_session.commit()

    result = accept_broad_label(cc.id, db_session)

    assert result.created_label_id is not None
    assert result.applied_count == 2

    db_session.refresh(cc)
    assert cc.decision == "accept"
    assert cc.decided_at is not None
    assert cc.created_label_id == result.created_label_id

    # The two evidence messages now carry an AI label.
    apps = db_session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == result.created_label_id
        )
    ).all()
    assert len(apps) == 2
    assert all(a.applied_by == "ai" for a in apps)
    assert all(a.confidence == 0.6 for a in apps)


def test_accept_broad_label_rejects_co_occurrence_kind(db_session):
    run = DiscoveryRun(
        query_kind="co_occurrence", trigger="manual", pool_size_at_trigger=0,
    )
    db_session.add(run); db_session.commit()
    cc = ConceptCandidate(
        name="x+y", description="", example_messages="[]",
        source_run_id=str(run.id),
        kind="co_occurrence", discovery_run_id=run.id,
    )
    db_session.add(cc); db_session.commit()
    with pytest.raises(ValueError, match="kind"):
        accept_broad_label(cc.id, db_session)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_service.py -v -k accept_broad_label
```
Expected: import error.

- [ ] **Step 3: Implement `accept_broad_label`**

Append to `server/python/concept_service.py`:

```python
from dataclasses import dataclass


@dataclass
class AcceptResult:
    candidate_id: int
    created_label_id: int
    applied_count: int


def accept_broad_label(candidate_id: int, db: Session) -> AcceptResult:
    """Mode A acceptance:
    1. Create a LabelDefinition from the candidate.
    2. Auto-apply it to evidence messages with applied_by='ai',
       confidence=0.6.
    3. Set candidate.decision='accept', decided_at, created_label_id.
    """
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise ValueError(f"candidate {candidate_id} not found")
    if cc.kind != "broad_label":
        raise ValueError(
            f"accept_broad_label requires kind='broad_label', got '{cc.kind}'"
        )
    if cc.decision in ("accept", "dismiss", "reject"):
        raise ValueError(f"candidate {candidate_id} already decided: {cc.decision}")

    new_label = LabelDefinition(name=cc.name, description=cc.description or None)
    db.add(new_label)
    db.commit()
    db.refresh(new_label)

    evidence: list[dict] = []
    if cc.evidence_message_ids:
        try:
            evidence = json.loads(cc.evidence_message_ids)
        except (TypeError, ValueError):
            evidence = []

    applied = 0
    for ev in evidence:
        try:
            chatlog_id = int(ev["chatlog_id"])
            message_index = int(ev["message_index"])
        except (KeyError, TypeError, ValueError):
            continue
        db.add(LabelApplication(
            chatlog_id=chatlog_id,
            message_index=message_index,
            label_id=new_label.id,
            applied_by="ai",
            confidence=0.6,
        ))
        applied += 1

    cc.decision = "accept"
    cc.decided_at = datetime.utcnow()
    cc.created_label_id = new_label.id
    cc.status = "accepted"  # legacy column for backwards compat
    db.add(cc)
    db.commit()

    return AcceptResult(
        candidate_id=cc.id,
        created_label_id=new_label.id,
        applied_count=applied,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_service.py -v
```
Expected: all `concept_service` tests pass.

---

### Task 3.5: `is_discovery_ripe`

**Files:**
- Modify: `server/python/concept_service.py`
- Modify: `server/python/tests/test_concept_service.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_service.py`:

```python
from concept_service import is_discovery_ripe


def test_is_discovery_ripe_returns_signal_dict(db_session):
    # Empty DB → not ripe (pool too small, no recalibration).
    sig = is_discovery_ripe(db_session, min_pool=5)
    assert sig["ripe"] is False
    assert "pool_size" in sig
    assert "drift_value" in sig
    assert "reasons" in sig
    assert "pool_below_threshold" in sig["reasons"]


def test_is_discovery_ripe_when_pool_large_and_recal_due(db_session, monkeypatch):
    # Stub recalibration check to True; ensure pool >= min_pool.
    for i in range(10):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"m{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    db_session.commit()
    monkeypatch.setattr(
        "concept_service._read_recalibration_due", lambda db: True
    )
    sig = is_discovery_ripe(db_session, min_pool=5)
    assert sig["ripe"] is True
    assert sig["drift_value"] == 1.0
    assert sig["pool_size"] >= 5
    assert sig["reasons"] == ["ok"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_service.py -v -k discovery_ripe
```
Expected: import error.

- [ ] **Step 3: Implement `is_discovery_ripe`**

Append to `server/python/concept_service.py`:

```python
def is_discovery_ripe(db: Session, min_pool: int = 30) -> dict:
    """Returns a JSON-friendly ripeness signal. Cheap; safe to poll."""
    from concept_retrieval import thinly_labeled_pool
    pool = thinly_labeled_pool(db)
    pool_size = len(pool)

    drift_due = False
    drift_value: Optional[float] = None
    try:
        drift_due = _read_recalibration_due(db)
        drift_value = 1.0 if drift_due else 0.0
    except Exception:
        drift_value = None

    reasons: list[str] = []
    if pool_size < min_pool:
        reasons.append("pool_below_threshold")
    if not drift_due:
        reasons.append("drift_low")
    ripe = pool_size >= min_pool and drift_due

    if ripe:
        reasons = ["ok"]
    return {
        "ripe": ripe,
        "pool_size": pool_size,
        "drift_value": drift_value,
        "reasons": reasons,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_service.py -v
```
Expected: all pass.

---

### STOP — Phase 3 review

Pause for user review and commit. Suggested commit message:

```
feat: RAG-style discovery orchestrator

Adds concept_generation.py (broad-label + co-occurrence
prompts), rewrites concept_service.discover() as a thin
orchestrator over retrieve→generate, adds
accept_broad_label and is_discovery_ripe. Removes the
KMeans-based discover_concepts path.
```

---

## Phase 4 — API endpoints

### Task 4.1: Modify `POST /api/concepts/discover` to accept query_kind/trigger

**Files:**
- Modify: `server/python/main.py:1659-1707` (the `_run_discover`/`start_discover` block)
- Modify: `server/python/schemas.py` (extend `DiscoverConceptsResponse` and add request schema if not present)
- Test: `server/python/tests/test_concept_api.py` (new)

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_concept_api.py`:

```python
from fastapi.testclient import TestClient
from sqlmodel import Session
from datetime import datetime
from models import (
    DiscoveryRun, ConceptCandidate, MessageCache,
    LabelDefinition, LabelApplication,
)


def test_post_discover_accepts_query_kind_and_trigger(client: TestClient):
    resp = client.post("/api/concepts/discover", json={
        "query_kind": "broad_label", "trigger": "manual",
    })
    # Either accepts (returns run_id) or rejects with 409 if a run is
    # already in progress; both are valid here. Reject 422 (schema fail).
    assert resp.status_code in (200, 409)
    if resp.status_code == 200:
        body = resp.json()
        assert "run_id" in body
        assert body.get("status") == "running"


def test_post_discover_rejects_unknown_query_kind(client: TestClient):
    resp = client.post("/api/concepts/discover", json={
        "query_kind": "made_up", "trigger": "manual",
    })
    assert resp.status_code == 422


def test_post_discover_rejects_unknown_trigger(client: TestClient):
    resp = client.post("/api/concepts/discover", json={
        "query_kind": "broad_label", "trigger": "cosmic_ray",
    })
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k post_discover
```
Expected: failures because the route still takes the old shape (no body, query param `limit`).

- [ ] **Step 3: Update schemas**

Open `server/python/schemas.py`. Add (or replace) these definitions:

```python
from typing import Literal
from pydantic import BaseModel


class StartDiscoverRequest(BaseModel):
    query_kind: Literal["broad_label", "co_occurrence"]
    trigger: Literal["manual", "badge"] = "manual"


class DiscoverConceptsResponse(BaseModel):
    run_id: int | str
    status: str  # "running"
```

- [ ] **Step 4: Update the route**

In `server/python/main.py`, replace the `_discover_status`/`_run_discover`/`start_discover` block (around `main.py:1659-1707`) with:

```python
_discover_status: dict = {
    "running": False, "run_id": None, "error": None, "query_kind": None,
}


def _run_discover(query_kind: str, trigger: str):
    """Background task: dispatches to concept_service.discover()."""
    from concept_service import discover
    global _discover_status
    try:
        with Session(engine) as db:
            run = discover(db, query_kind=query_kind, trigger=trigger)
            _discover_status = {
                "running": False,
                "run_id": run.id,
                "error": run.error,
                "query_kind": query_kind,
            }
    except Exception as e:
        _discover_status = {
            "running": False,
            "run_id": _discover_status.get("run_id"),
            "error": str(e),
            "query_kind": query_kind,
        }


@app.post("/api/concepts/discover", response_model=DiscoverConceptsResponse)
def start_discover(req: StartDiscoverRequest):
    global _discover_status
    if _discover_status["running"]:
        raise HTTPException(status_code=409,
                            detail="Concept discovery already in progress")
    _discover_status = {
        "running": True, "run_id": None, "error": None,
        "query_kind": req.query_kind,
    }
    thread = threading.Thread(
        target=_run_discover, args=(req.query_kind, req.trigger), daemon=True,
    )
    thread.start()
    return DiscoverConceptsResponse(run_id="starting", status="running")
```

(Add `from schemas import StartDiscoverRequest, DiscoverConceptsResponse` if not already imported.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k post_discover
```
Expected: all three tests pass.

---

### Task 4.2: `GET /api/concepts/ripe`

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/schemas.py`
- Modify: `server/python/tests/test_concept_api.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_api.py`:

```python
def test_get_ripe_returns_signal(client):
    resp = client.get("/api/concepts/ripe")
    assert resp.status_code == 200
    body = resp.json()
    assert "ripe" in body
    assert "pool_size" in body
    assert "drift_value" in body
    assert "reasons" in body
    assert isinstance(body["reasons"], list)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server/python && uv run pytest tests/test_concept_api.py::test_get_ripe_returns_signal -v
```
Expected: 404.

- [ ] **Step 3: Add the schema**

Append to `server/python/schemas.py`:

```python
class RipeSignalResponse(BaseModel):
    ripe: bool
    pool_size: int
    drift_value: float | None
    reasons: list[str]
```

- [ ] **Step 4: Add the route**

In `server/python/main.py`, near the other `/api/concepts/*` routes:

```python
from concept_service import is_discovery_ripe


@app.get("/api/concepts/ripe", response_model=RipeSignalResponse)
def get_concept_ripe(db: Session = Depends(get_session)):
    return is_discovery_ripe(db)
```

(Add `RipeSignalResponse` to the schemas import if not already.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server/python && uv run pytest tests/test_concept_api.py::test_get_ripe_returns_signal -v
```
Expected: pass.

---

### Task 4.3: `POST /api/concepts/candidates/{id}/accept`

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/schemas.py`
- Modify: `server/python/tests/test_concept_api.py`

- [ ] **Step 1: Write the failing test**

Add to `server/python/tests/test_concept_api.py`:

```python
def test_post_accept_creates_label_and_applies(client, db_session):
    # Seed cached messages and a candidate.
    for i in range(2):
        db_session.add(MessageCache(
            chatlog_id=1, message_index=i, message_text=f"m{i}",
            user_email="u", created_at=datetime.utcnow(),
        ))
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=2,
    )
    db_session.add(run); db_session.commit()
    cc = ConceptCandidate(
        name="curious", description="curious students",
        example_messages="[]", source_run_id=str(run.id),
        kind="broad_label", discovery_run_id=run.id,
        evidence_message_ids='[{"chatlog_id":1,"message_index":0}]',
    )
    db_session.add(cc); db_session.commit()

    resp = client.post(f"/api/concepts/candidates/{cc.id}/accept", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["candidate_id"] == cc.id
    assert body["created_label_id"] is not None
    assert body["applied_count"] == 1


def test_post_accept_404_for_unknown_candidate(client):
    resp = client.post("/api/concepts/candidates/99999/accept", json={})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k post_accept
```
Expected: 404 / not implemented.

- [ ] **Step 3: Add the schema**

Append to `server/python/schemas.py`:

```python
class AcceptCandidateResponse(BaseModel):
    candidate_id: int
    created_label_id: int
    applied_count: int
```

- [ ] **Step 4: Add the route**

In `server/python/main.py`:

```python
from concept_service import accept_broad_label


@app.post(
    "/api/concepts/candidates/{candidate_id}/accept",
    response_model=AcceptCandidateResponse,
)
def post_accept_candidate(candidate_id: int,
                          db: Session = Depends(get_session)):
    try:
        result = accept_broad_label(candidate_id, db)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return AcceptCandidateResponse(
        candidate_id=result.candidate_id,
        created_label_id=result.created_label_id,
        applied_count=result.applied_count,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k post_accept
```
Expected: pass.

---

### Task 4.4: `POST /api/concepts/candidates/{id}/dismiss`, `/note`, `/make-label`, `/suggest-merge`

These four routes share a similar shape. Implement them together.

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/schemas.py`
- Modify: `server/python/tests/test_concept_api.py`

- [ ] **Step 1: Write failing tests**

Add to `server/python/tests/test_concept_api.py`:

```python
def test_post_dismiss_sets_decision(client, db_session):
    cc = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
    )
    db_session.add(cc); db_session.commit()
    resp = client.post(f"/api/concepts/candidates/{cc.id}/dismiss",
                       json={"reason": "too narrow"})
    assert resp.status_code == 200
    db_session.refresh(cc)
    assert cc.decision == "dismiss"
    assert cc.decided_at is not None


def test_post_note_only_for_co_occurrence(client, db_session):
    cc_co = ConceptCandidate(
        name="A+B", description="", example_messages="[]",
        source_run_id="r", kind="co_occurrence",
        co_occurrence_label_ids="[1,2]", co_occurrence_count=5,
    )
    cc_broad = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
    )
    db_session.add_all([cc_co, cc_broad]); db_session.commit()

    resp_ok = client.post(f"/api/concepts/candidates/{cc_co.id}/note", json={})
    assert resp_ok.status_code == 200

    resp_bad = client.post(f"/api/concepts/candidates/{cc_broad.id}/note", json={})
    assert resp_bad.status_code == 400


def test_post_make_label_creates_label(client, db_session):
    cc = ConceptCandidate(
        name="A+B", description="combo", example_messages="[]",
        source_run_id="r", kind="co_occurrence",
        co_occurrence_label_ids="[1,2]", co_occurrence_count=5,
    )
    db_session.add(cc); db_session.commit()

    resp = client.post(f"/api/concepts/candidates/{cc.id}/make-label", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["created_label_id"] is not None

    label = db_session.exec(
        select(LabelDefinition).where(LabelDefinition.id == body["created_label_id"])
    ).one()
    assert label.name == "A+B"
    # No auto-apply: no LabelApplications for this label.
    apps = db_session.exec(
        select(LabelApplication).where(LabelApplication.label_id == label.id)
    ).all()
    assert apps == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k "dismiss or note or make_label"
```

- [ ] **Step 3: Add helper functions in `concept_service.py`**

Append to `server/python/concept_service.py`:

```python
def dismiss_candidate(
    candidate_id: int, db: Session, reason: Optional[str] = None,
) -> ConceptCandidate:
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise ValueError(f"candidate {candidate_id} not found")
    cc.decision = "dismiss"
    cc.decided_at = datetime.utcnow()
    cc.status = "rejected"  # legacy
    db.add(cc); db.commit(); db.refresh(cc)
    return cc


def note_candidate(candidate_id: int, db: Session) -> ConceptCandidate:
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise ValueError(f"candidate {candidate_id} not found")
    if cc.kind != "co_occurrence":
        raise ValueError("note_candidate requires kind='co_occurrence'")
    cc.decision = "note"
    cc.decided_at = datetime.utcnow()
    db.add(cc); db.commit(); db.refresh(cc)
    return cc


def make_label_from_co_occurrence(
    candidate_id: int, db: Session,
) -> AcceptResult:
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise ValueError(f"candidate {candidate_id} not found")
    if cc.kind != "co_occurrence":
        raise ValueError("make_label_from_co_occurrence requires kind='co_occurrence'")
    new_label = LabelDefinition(name=cc.name, description=cc.description or None)
    db.add(new_label); db.commit(); db.refresh(new_label)
    cc.decision = "accept"
    cc.decided_at = datetime.utcnow()
    cc.created_label_id = new_label.id
    cc.status = "accepted"
    db.add(cc); db.commit()
    return AcceptResult(
        candidate_id=cc.id,
        created_label_id=new_label.id,
        applied_count=0,  # no auto-apply for Mode B
    )
```

(`suggest-merge` reuses the existing label-archive flow on the backend; it's wired in the route, not a new service function.)

- [ ] **Step 4: Add schemas**

Append to `server/python/schemas.py`:

```python
class DismissRequest(BaseModel):
    reason: str | None = None


class GenericOk(BaseModel):
    ok: bool = True


class MakeLabelResponse(BaseModel):
    candidate_id: int
    created_label_id: int


class SuggestMergeRequest(BaseModel):
    archive_label_id: int
    keep_label_id: int


class SuggestMergeResponse(BaseModel):
    archived_label_id: int
    kept_label_id: int
    retagged_count: int
```

- [ ] **Step 5: Add the routes**

In `server/python/main.py`, near the accept route. **For `/suggest-merge`, reuse whatever the existing label-archive endpoint internally does.** Search `main.py` for `archived_at = ` or `archive` to find the existing helper; if it lives in a function, call it directly. If it is only a route, factor a small helper (call it `_archive_and_retag_label`) in `main.py` — this is the only refactor permitted in this phase.

```python
from concept_service import (
    dismiss_candidate, note_candidate, make_label_from_co_occurrence,
)


@app.post(
    "/api/concepts/candidates/{candidate_id}/dismiss",
    response_model=GenericOk,
)
def post_dismiss(
    candidate_id: int, req: DismissRequest,
    db: Session = Depends(get_session),
):
    try:
        dismiss_candidate(candidate_id, db, reason=req.reason)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return GenericOk()


@app.post(
    "/api/concepts/candidates/{candidate_id}/note",
    response_model=GenericOk,
)
def post_note(candidate_id: int, db: Session = Depends(get_session)):
    try:
        note_candidate(candidate_id, db)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return GenericOk()


@app.post(
    "/api/concepts/candidates/{candidate_id}/make-label",
    response_model=MakeLabelResponse,
)
def post_make_label(candidate_id: int, db: Session = Depends(get_session)):
    try:
        result = make_label_from_co_occurrence(candidate_id, db)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    return MakeLabelResponse(
        candidate_id=result.candidate_id,
        created_label_id=result.created_label_id,
    )


@app.post(
    "/api/concepts/candidates/{candidate_id}/suggest-merge",
    response_model=SuggestMergeResponse,
)
def post_suggest_merge(
    candidate_id: int,
    req: SuggestMergeRequest,
    db: Session = Depends(get_session),
):
    cc = db.get(ConceptCandidate, candidate_id)
    if cc is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    if cc.kind != "co_occurrence":
        raise HTTPException(
            status_code=400,
            detail="suggest-merge requires kind='co_occurrence'",
        )
    # Reuse existing archive-and-retag logic. Replace this stub with a
    # direct call to the existing helper found via the search above.
    retagged_count = _archive_and_retag_label(
        archive_label_id=req.archive_label_id,
        keep_label_id=req.keep_label_id,
        db=db,
    )
    cc.decision = "suggest_merge"
    cc.decided_at = datetime.utcnow()
    db.add(cc); db.commit()
    return SuggestMergeResponse(
        archived_label_id=req.archive_label_id,
        kept_label_id=req.keep_label_id,
        retagged_count=retagged_count,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v
```
Expected: all dismiss/note/make-label tests pass.

---

### Task 4.5: `GET /api/concepts/runs` and extend `GET /api/concepts/candidates`

**Files:**
- Modify: `server/python/main.py:1710-1729` (existing `/candidates` route)
- Modify: `server/python/schemas.py`
- Modify: `server/python/tests/test_concept_api.py`

- [ ] **Step 1: Write failing tests**

Add to `server/python/tests/test_concept_api.py`:

```python
def test_get_candidates_includes_new_fields(client, db_session):
    cc = ConceptCandidate(
        name="x", description="", example_messages="[]",
        source_run_id="r", kind="broad_label",
        evidence_message_ids='[{"chatlog_id":1,"message_index":0}]',
    )
    db_session.add(cc); db_session.commit()
    resp = client.get("/api/concepts/candidates")
    assert resp.status_code == 200
    rows = resp.json()
    target = next(r for r in rows if r["id"] == cc.id)
    assert target["kind"] == "broad_label"
    assert target["evidence_message_ids"] == [
        {"chatlog_id": 1, "message_index": 0}
    ]
    assert target.get("co_occurrence_label_ids") in (None, [])
    assert "decision" in target


def test_get_candidates_filters_by_kind_and_run_id(client, db_session):
    run = DiscoveryRun(
        query_kind="broad_label", trigger="manual", pool_size_at_trigger=0,
    )
    db_session.add(run); db_session.commit()
    cc1 = ConceptCandidate(name="a", description="", example_messages="[]",
                            source_run_id=str(run.id), kind="broad_label",
                            discovery_run_id=run.id)
    cc2 = ConceptCandidate(name="b", description="", example_messages="[]",
                            source_run_id=str(run.id), kind="co_occurrence",
                            discovery_run_id=run.id)
    db_session.add_all([cc1, cc2]); db_session.commit()

    resp = client.get(f"/api/concepts/candidates?run_id={run.id}&kind=broad_label")
    rows = resp.json()
    ids = {r["id"] for r in rows}
    assert cc1.id in ids and cc2.id not in ids


def test_get_runs_returns_recent(client, db_session):
    for k in ("broad_label", "co_occurrence"):
        db_session.add(DiscoveryRun(
            query_kind=k, trigger="manual", pool_size_at_trigger=0,
        ))
    db_session.commit()
    resp = client.get("/api/concepts/runs?limit=5")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 2
    assert all("query_kind" in r and "trigger" in r for r in rows)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v -k "candidates_includes_new or filters_by_kind or get_runs"
```

- [ ] **Step 3: Update schemas**

In `server/python/schemas.py`, replace the existing `ConceptCandidateResponse` (search for the class) with:

```python
class ConceptCandidateResponse(BaseModel):
    id: int
    name: str
    description: str
    example_messages: list[dict]
    status: str
    source_run_id: str
    similar_to: str | None = None
    created_at: str
    # New
    kind: str = "broad_label"
    discovery_run_id: int | None = None
    decision: str | None = None
    created_label_id: int | None = None
    evidence_message_ids: list[dict] | None = None
    co_occurrence_label_ids: list[int] | None = None
    co_occurrence_count: int | None = None


class DiscoveryRunResponse(BaseModel):
    id: int
    started_at: str
    completed_at: str | None = None
    query_kind: str
    trigger: str
    drift_value_at_trigger: float | None = None
    pool_size_at_trigger: int
    n_candidates: int
    error: str | None = None
```

- [ ] **Step 4: Update the `/candidates` route and add `/runs`**

Replace the existing `/api/concepts/candidates` GET route in `main.py:1710-1729` with:

```python
@app.get("/api/concepts/candidates", response_model=List[ConceptCandidateResponse])
def get_candidates(
    run_id: int | None = None,
    kind: str | None = None,
    decision: str | None = None,
    db: Session = Depends(get_session),
):
    q = select(ConceptCandidate)
    if run_id is not None:
        q = q.where(ConceptCandidate.discovery_run_id == run_id)
    if kind is not None:
        q = q.where(ConceptCandidate.kind == kind)
    if decision is not None:
        q = q.where(ConceptCandidate.decision == decision)
    rows = db.exec(q.order_by(ConceptCandidate.id.desc())).all()

    out: list[ConceptCandidateResponse] = []
    for cc in rows:
        out.append(ConceptCandidateResponse(
            id=cc.id,
            name=cc.name,
            description=cc.description or "",
            example_messages=(
                json.loads(cc.example_messages) if cc.example_messages else []
            ),
            status=cc.status,
            source_run_id=cc.source_run_id,
            similar_to=cc.similar_to,
            created_at=cc.created_at.isoformat(),
            kind=cc.kind,
            discovery_run_id=cc.discovery_run_id,
            decision=cc.decision,
            created_label_id=cc.created_label_id,
            evidence_message_ids=(
                json.loads(cc.evidence_message_ids)
                if cc.evidence_message_ids else None
            ),
            co_occurrence_label_ids=(
                json.loads(cc.co_occurrence_label_ids)
                if cc.co_occurrence_label_ids else None
            ),
            co_occurrence_count=cc.co_occurrence_count,
        ))
    return out


@app.get("/api/concepts/runs", response_model=List[DiscoveryRunResponse])
def get_runs(limit: int = 20, db: Session = Depends(get_session)):
    rows = db.exec(
        select(DiscoveryRun).order_by(DiscoveryRun.id.desc()).limit(limit)
    ).all()
    return [
        DiscoveryRunResponse(
            id=r.id,
            started_at=r.started_at.isoformat(),
            completed_at=r.completed_at.isoformat() if r.completed_at else None,
            query_kind=r.query_kind,
            trigger=r.trigger,
            drift_value_at_trigger=r.drift_value_at_trigger,
            pool_size_at_trigger=r.pool_size_at_trigger,
            n_candidates=r.n_candidates,
            error=r.error,
        )
        for r in rows
    ]
```

(Add `import json` at the top of the file if it isn't there. Add the new schemas to the imports.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server/python && uv run pytest tests/test_concept_api.py -v
```
Expected: all `/candidates` and `/runs` tests pass.

- [ ] **Step 6: Run the full backend suite**

```bash
cd server/python && uv run pytest -v
```
Expected: no regressions across all backend tests.

---

### STOP — Phase 4 review

Pause for user review and commit. Suggested commit message:

```
feat: concept discovery API endpoints

Adds POST /discover (mode-aware), GET /ripe, POST
/accept, /dismiss, /note, /make-label, /suggest-merge,
GET /runs. Extends GET /candidates with kind/run_id/
decision filters and new field projection.
```

---

## Phase 5 — Frontend mode picker + candidate cards

### Task 5.1: Update TypeScript types

**Files:**
- Modify: `src/types/index.ts:163-172`

- [ ] **Step 1: Replace the `ConceptCandidate` interface**

Open `src/types/index.ts`. Replace the existing `ConceptCandidate` interface with:

```ts
export type ConceptCandidateKind = 'broad_label' | 'co_occurrence'

export type ConceptDecision =
  | 'accept' | 'reject' | 'dismiss' | 'suggest_merge' | 'note'

export interface ConceptCandidate {
  id: number
  name: string
  description: string
  example_messages: { excerpt: string; chatlog_id?: number; message_index?: number }[]
  status: 'pending' | 'accepted' | 'rejected'
  source_run_id: string
  similar_to: string | null
  created_at: string
  // New RAG-discovery fields
  kind: ConceptCandidateKind
  discovery_run_id?: number | null
  decision?: ConceptDecision | null
  created_label_id?: number | null
  evidence_message_ids?: { chatlog_id: number; message_index: number }[] | null
  co_occurrence_label_ids?: [number, number] | null
  co_occurrence_count?: number | null
}

export interface RipeSignal {
  ripe: boolean
  pool_size: number
  drift_value: number | null
  reasons: string[]
}

export interface DiscoveryRun {
  id: number
  started_at: string
  completed_at: string | null
  query_kind: ConceptCandidateKind
  trigger: 'manual' | 'badge'
  drift_value_at_trigger: number | null
  pool_size_at_trigger: number
  n_candidates: number
  error: string | null
}
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```
Expected: pass (existing usages of `ConceptCandidate` still satisfied because new fields are optional).

---

### Task 5.2: Update `src/services/api.ts` with new endpoints

**Files:**
- Modify: `src/services/api.ts:115-130`

- [ ] **Step 1: Add type imports at the top of the file**

Open `src/services/api.ts`. Add (or extend) the type imports at the top of the file:

```ts
import type {
  ConceptCandidate, RipeSignal, DiscoveryRun, ConceptCandidateKind,
} from '../types'
```

- [ ] **Step 2: Replace existing concept-related methods on the `api` object**

Replace the existing `discoverConcepts`, `getCandidates`, `updateCandidate`, and `getEmbedStatus` methods (around lines 115-130) with the methods below. Keep the surrounding `api` object scaffolding intact:

```ts
discoverConcepts: (
  query_kind: ConceptCandidateKind,
  trigger: 'manual' | 'badge' = 'manual',
): Promise<{ run_id: number | string; status: string }> =>
  USE_MOCK
    ? mocks.discoverConcepts(query_kind, trigger)
    : req('/api/concepts/discover', {
        method: 'POST',
        ...json({ query_kind, trigger }),
      }),

getConceptCandidates: (
  filters: { run_id?: number; kind?: ConceptCandidateKind; decision?: string } = {},
): Promise<ConceptCandidate[]> => {
  const params = new URLSearchParams()
  if (filters.run_id != null) params.set('run_id', String(filters.run_id))
  if (filters.kind) params.set('kind', filters.kind)
  if (filters.decision) params.set('decision', filters.decision)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return USE_MOCK
    ? mocks.getConceptCandidates(filters)
    : req(`/api/concepts/candidates${qs}`)
},

getConceptRipe: (): Promise<RipeSignal> =>
  USE_MOCK ? mocks.getConceptRipe() : req('/api/concepts/ripe'),

acceptConceptCandidate: (
  id: number,
): Promise<{ candidate_id: number; created_label_id: number; applied_count: number }> =>
  USE_MOCK
    ? mocks.acceptConceptCandidate(id)
    : req(`/api/concepts/candidates/${id}/accept`, {
        method: 'POST',
        ...json({}),
      }),

dismissConceptCandidate: (
  id: number, reason?: string,
): Promise<{ ok: true }> =>
  USE_MOCK
    ? mocks.dismissConceptCandidate(id, reason)
    : req(`/api/concepts/candidates/${id}/dismiss`, {
        method: 'POST',
        ...json({ reason }),
      }),

noteConceptCandidate: (id: number): Promise<{ ok: true }> =>
  USE_MOCK
    ? mocks.noteConceptCandidate(id)
    : req(`/api/concepts/candidates/${id}/note`, {
        method: 'POST', ...json({}),
      }),

makeLabelFromCandidate: (
  id: number,
): Promise<{ candidate_id: number; created_label_id: number }> =>
  USE_MOCK
    ? mocks.makeLabelFromCandidate(id)
    : req(`/api/concepts/candidates/${id}/make-label`, {
        method: 'POST', ...json({}),
      }),

suggestMergeFromCandidate: (
  id: number, archive_label_id: number, keep_label_id: number,
): Promise<{ archived_label_id: number; kept_label_id: number; retagged_count: number }> =>
  USE_MOCK
    ? mocks.suggestMergeFromCandidate(id, archive_label_id, keep_label_id)
    : req(`/api/concepts/candidates/${id}/suggest-merge`, {
        method: 'POST',
        ...json({ archive_label_id, keep_label_id }),
      }),

getDiscoveryRuns: (limit = 20): Promise<DiscoveryRun[]> =>
  USE_MOCK ? mocks.getDiscoveryRuns(limit) : req(`/api/concepts/runs?limit=${limit}`),
```

(Remove the legacy `discoverConcepts(limit)` overload and the legacy `getCandidates`/`updateCandidate`/`getEmbedStatus` references that no longer compile. Where existing callers use them, port the call sites to the new method names.)

- [ ] **Step 3: Find and update call sites**

```bash
grep -rn "discoverConcepts\|getCandidates\|updateCandidate\|getEmbedStatus" src/ --include="*.ts" --include="*.tsx"
```

Update each call site to use the new method names and signatures. The expected callers are inside `src/components/queue/DiscoverSection.tsx` and `src/components/queue/DiscoverModal.tsx` (handled in Task 5.4 and Task 5.5).

- [ ] **Step 4: Run type-check**

```bash
npx tsc --noEmit
```
Expected: pass after call-site updates in 5.4/5.5; if errors remain in DiscoverSection/DiscoverModal, defer those fixes to those tasks.

---

### Task 5.3: Update mocks

**Files:**
- Modify: `src/mocks/index.ts`

- [ ] **Step 1: Add mock implementations**

Open `src/mocks/index.ts`. Add (or replace) functions:

```ts
import type {
  ConceptCandidate, RipeSignal, DiscoveryRun, ConceptCandidateKind,
} from '../types'

const mockBroadCandidate: ConceptCandidate = {
  id: 1001,
  name: 'metacognition',
  description: 'students reflecting on their own learning process',
  example_messages: [
    { excerpt: "I'm not sure I get this", chatlog_id: 1, message_index: 0 },
    { excerpt: "am I doing this right?",  chatlog_id: 1, message_index: 3 },
  ],
  status: 'pending',
  source_run_id: '42',
  similar_to: null,
  created_at: new Date().toISOString(),
  kind: 'broad_label',
  discovery_run_id: 42,
  decision: null,
  evidence_message_ids: [
    { chatlog_id: 1, message_index: 0 },
    { chatlog_id: 1, message_index: 3 },
  ],
  co_occurrence_label_ids: null,
  co_occurrence_count: null,
}

const mockCoOccurCandidate: ConceptCandidate = {
  id: 1002,
  name: 'code help + confused',
  description: 'students asking about code while signaling confusion',
  example_messages: [],
  status: 'pending',
  source_run_id: '43',
  similar_to: null,
  created_at: new Date().toISOString(),
  kind: 'co_occurrence',
  discovery_run_id: 43,
  decision: null,
  evidence_message_ids: null,
  co_occurrence_label_ids: [10, 12],
  co_occurrence_count: 14,
}

export const discoverConcepts = async (
  _kind: ConceptCandidateKind, _trigger: 'manual' | 'badge',
) => ({ run_id: 42, status: 'running' })

export const getConceptCandidates = async (
  filters: { kind?: ConceptCandidateKind } = {},
): Promise<ConceptCandidate[]> => {
  const all = [mockBroadCandidate, mockCoOccurCandidate]
  return filters.kind ? all.filter(c => c.kind === filters.kind) : all
}

export const getConceptRipe = async (): Promise<RipeSignal> => ({
  ripe: true, pool_size: 87, drift_value: 1.0, reasons: ['ok'],
})

export const acceptConceptCandidate = async (id: number) =>
  ({ candidate_id: id, created_label_id: 999, applied_count: 2 })

export const dismissConceptCandidate = async (_id: number, _reason?: string) =>
  ({ ok: true as const })

export const noteConceptCandidate = async (_id: number) =>
  ({ ok: true as const })

export const makeLabelFromCandidate = async (id: number) =>
  ({ candidate_id: id, created_label_id: 998 })

export const suggestMergeFromCandidate = async (
  _id: number, archive: number, keep: number,
) => ({ archived_label_id: archive, kept_label_id: keep, retagged_count: 14 })

export const getDiscoveryRuns = async (_limit: number): Promise<DiscoveryRun[]> => ([
  {
    id: 42, started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    query_kind: 'broad_label', trigger: 'manual',
    drift_value_at_trigger: 1.0, pool_size_at_trigger: 87,
    n_candidates: 3, error: null,
  },
])
```

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

---

### Task 5.4: Update `DiscoverSection` with mode picker + ripeness pills

**Files:**
- Modify: `src/components/queue/DiscoverSection.tsx`
- Test: `src/components/queue/DiscoverSection.test.tsx` (new or modify)

- [ ] **Step 1: Read the current component**

```bash
cat src/components/queue/DiscoverSection.tsx
```
Note the existing structure: which props it takes, what state it owns, where it's rendered from.

- [ ] **Step 2: Write a failing test**

Create or extend `src/components/queue/DiscoverSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DiscoverSection } from './DiscoverSection'

vi.mock('../../services/api', () => ({
  api: {
    getConceptRipe: vi.fn().mockResolvedValue({
      ripe: true, pool_size: 87, drift_value: 1.0, reasons: ['ok'],
    }),
    discoverConcepts: vi.fn().mockResolvedValue({ run_id: 1, status: 'running' }),
  },
}))

describe('DiscoverSection', () => {
  it('renders both mode buttons when corpus has multi-labeled messages', () => {
    render(<DiscoverSection multiLabeledCount={5} />)
    expect(screen.getByRole('button', { name: /find missing labels/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /find label patterns/i })).toBeInTheDocument()
  })

  it('hides Mode B button when no multi-labeled messages exist', () => {
    render(<DiscoverSection multiLabeledCount={0} />)
    expect(screen.queryByRole('button', { name: /find label patterns/i }))
      .not.toBeInTheDocument()
  })

  it('calls discoverConcepts with broad_label when Mode A clicked', async () => {
    const { api } = await import('../../services/api')
    render(<DiscoverSection multiLabeledCount={5} />)
    await userEvent.click(screen.getByRole('button', { name: /find missing labels/i }))
    expect(api.discoverConcepts).toHaveBeenCalledWith('broad_label', 'manual')
  })
})
```

- [ ] **Step 3: Run test to verify failure**

```bash
npm test -- DiscoverSection
```

- [ ] **Step 4: Implement the component**

Replace the body of `DiscoverSection.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import type { RipeSignal, ConceptCandidateKind } from '../../types'

type Props = {
  multiLabeledCount: number
  onRunStarted?: (kind: ConceptCandidateKind) => void
}

export function DiscoverSection({ multiLabeledCount, onRunStarted }: Props) {
  const [ripe, setRipe] = useState<RipeSignal | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const sig = await api.getConceptRipe()
        if (!cancelled) setRipe(sig)
      } catch {/* ignore polling errors */}
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const fire = async (kind: ConceptCandidateKind) => {
    if (busy) return
    setBusy(true)
    try {
      await api.discoverConcepts(kind, 'manual')
      onRunStarted?.(kind)
    } finally {
      setBusy(false)
    }
  }

  const ripeForAny = ripe?.ripe === true

  return (
    <section aria-label="discover" className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fire('broad_label')}
          className="rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-700"
        >
          Find missing labels
          {ripeForAny && (
            <span
              aria-label="discovery is ripe"
              title={
                ripe ? `${ripe.pool_size} unlabeled messages • drift ${ripe.drift_value ?? '–'}` : ''
              }
              className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald-400"
            />
          )}
        </button>

        {multiLabeledCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => fire('co_occurrence')}
            className="rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 hover:bg-neutral-700"
          >
            Find label patterns
          </button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- DiscoverSection
```

- [ ] **Step 6: Update existing usages**

```bash
grep -rn "DiscoverSection" src/ --include="*.tsx" --include="*.ts"
```

If callers pass props that no longer exist, update them to pass `multiLabeledCount` (which can be derived from existing label-count data on the queue page; pass `0` as a temporary value if the count isn't readily available — refining is part of Task 6.1).

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

---

### Task 5.5: Update `DiscoverModal` with kind-discriminated cards

**Files:**
- Modify: `src/components/queue/DiscoverModal.tsx`
- Test: `src/components/queue/DiscoverModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create or extend `src/components/queue/DiscoverModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DiscoverModal } from './DiscoverModal'
import type { ConceptCandidate } from '../../types'

const broad: ConceptCandidate = {
  id: 1, name: 'metacognition',
  description: 'students reflecting on learning',
  example_messages: [{ excerpt: 'am I doing this right?' }],
  status: 'pending', source_run_id: '1', similar_to: null,
  created_at: '', kind: 'broad_label',
  evidence_message_ids: [{ chatlog_id: 1, message_index: 0 }],
}

const coOccur: ConceptCandidate = {
  id: 2, name: 'code+confused',
  description: 'overlap pattern',
  example_messages: [], status: 'pending',
  source_run_id: '1', similar_to: null,
  created_at: '', kind: 'co_occurrence',
  co_occurrence_label_ids: [10, 12], co_occurrence_count: 14,
}

vi.mock('../../services/api', () => ({
  api: {
    acceptConceptCandidate: vi.fn().mockResolvedValue({
      candidate_id: 1, created_label_id: 999, applied_count: 1,
    }),
    dismissConceptCandidate: vi.fn().mockResolvedValue({ ok: true }),
    noteConceptCandidate: vi.fn().mockResolvedValue({ ok: true }),
    makeLabelFromCandidate: vi.fn().mockResolvedValue({
      candidate_id: 2, created_label_id: 998,
    }),
  },
}))

describe('DiscoverModal', () => {
  it('renders Accept & apply button on broad_label cards', () => {
    render(<DiscoverModal candidates={[broad]} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /accept & apply/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /make a combo label/i }))
      .not.toBeInTheDocument()
  })

  it('renders combo-label / merge / note buttons on co_occurrence cards', () => {
    render(<DiscoverModal candidates={[coOccur]} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /make a combo label/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /suggest merge/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /note only/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept & apply/i })).not.toBeInTheDocument()
  })

  it('calls acceptConceptCandidate when Accept & apply is clicked', async () => {
    const { api } = await import('../../services/api')
    render(<DiscoverModal candidates={[broad]} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /accept & apply/i }))
    expect(api.acceptConceptCandidate).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- DiscoverModal
```

- [ ] **Step 3: Implement the modal**

Replace the body of `DiscoverModal.tsx` with:

```tsx
import { useState } from 'react'
import { api } from '../../services/api'
import type { ConceptCandidate } from '../../types'

type Props = {
  candidates: ConceptCandidate[]
  onClose: () => void
  onCandidateChanged?: () => void
}

export function DiscoverModal({ candidates, onClose, onCandidateChanged }: Props) {
  return (
    <div role="dialog" aria-modal="true"
         className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="max-h-[80vh] w-[680px] overflow-y-auto rounded-lg bg-neutral-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">Discovery results</h2>
          <button type="button" onClick={onClose}
                  className="text-neutral-400 hover:text-neutral-200">×</button>
        </div>
        <div className="flex flex-col gap-3">
          {candidates.map(c =>
            c.kind === 'broad_label' ? (
              <BroadLabelCard key={c.id} c={c} onChanged={onCandidateChanged} />
            ) : (
              <CoOccurrenceCard key={c.id} c={c} onChanged={onCandidateChanged} />
            )
          )}
        </div>
      </div>
    </div>
  )
}

function BroadLabelCard({
  c, onChanged,
}: { c: ConceptCandidate; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const accept = async () => {
    setBusy(true)
    try {
      const r = await api.acceptConceptCandidate(c.id)
      setToast(`Created '${c.name}' and applied to ${r.applied_count} messages as AI labels.`)
      onChanged?.()
    } finally { setBusy(false) }
  }
  const dismiss = async () => {
    setBusy(true)
    try { await api.dismissConceptCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }

  return (
    <article className="rounded border border-neutral-800 bg-neutral-950 p-3">
      <header className="mb-1">
        <h3 className="text-base font-medium text-neutral-100">{c.name}</h3>
        <p className="text-sm text-neutral-400">{c.description}</p>
      </header>
      {c.example_messages.length > 0 && (
        <ul className="mb-2 list-disc pl-5 text-sm text-neutral-300">
          {c.example_messages.slice(0, 5).map((ex, i) =>
            <li key={i}>"{ex.excerpt || ''}"</li>
          )}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={accept}
                className="rounded bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-600">
          Accept & apply
        </button>
        <button type="button" disabled={busy} onClick={dismiss}
                className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
          Dismiss
        </button>
      </div>
      {toast && <p className="mt-2 text-xs text-emerald-400">{toast}</p>}
      <footer className="mt-2 text-xs text-neutral-500">
        run #{c.discovery_run_id ?? '?'} • {c.kind}
      </footer>
    </article>
  )
}

function CoOccurrenceCard({
  c, onChanged,
}: { c: ConceptCandidate; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const ids = c.co_occurrence_label_ids ?? [0, 0]
  const count = c.co_occurrence_count ?? 0

  const note = async () => {
    setBusy(true)
    try { await api.noteConceptCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const makeLabel = async () => {
    setBusy(true)
    try { await api.makeLabelFromCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const dismiss = async () => {
    setBusy(true)
    try { await api.dismissConceptCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const suggestMerge = async () => {
    // Minimal v1 UX: archive the lower id, keep the higher.
    const [a, b] = ids
    if (!a || !b) return
    const archive = Math.min(a, b)
    const keep = Math.max(a, b)
    setBusy(true)
    try {
      await api.suggestMergeFromCandidate(c.id, archive, keep)
      onChanged?.()
    } finally { setBusy(false) }
  }

  return (
    <article className="rounded border border-neutral-800 bg-neutral-950 p-3">
      <header className="mb-1">
        <h3 className="text-base font-medium text-neutral-100">
          Pattern: <span className="font-normal">{c.name}</span>
        </h3>
        <p className="text-sm text-neutral-400">
          Labels {ids[0]} + {ids[1]} co-occur on {count} messages
        </p>
        {c.description && <p className="mt-1 text-sm text-neutral-400">{c.description}</p>}
      </header>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={makeLabel}
                className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">
          Make a combo label
        </button>
        <button type="button" disabled={busy} onClick={suggestMerge}
                className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">
          Suggest merge
        </button>
        <button type="button" disabled={busy} onClick={note}
                className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-700">
          Note only
        </button>
        <button type="button" disabled={busy} onClick={dismiss}
                className="rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
          Dismiss
        </button>
      </div>
      <footer className="mt-2 text-xs text-neutral-500">
        run #{c.discovery_run_id ?? '?'} • {c.kind}
      </footer>
    </article>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- DiscoverModal
```
Expected: all card-kind tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

---

### STOP — Phase 5 review

Pause for user review and commit. Suggested commit message:

```
feat: mode-aware discover UI with ripeness signal

Adds two-mode picker (broad labels / label patterns) on
DiscoverSection, kind-discriminated cards on DiscoverModal,
ripeness polling, and updated TypeScript types and mocks.
```

---

## Phase 6 — Polling badge + cleanup

### Task 6.1: Wire ripeness polling into the queue page

**Files:**
- Modify: `src/pages/QueuePage.tsx` (where `DiscoverSection` is rendered)

- [ ] **Step 1: Compute `multiLabeledCount` on the queue page**

Search QueuePage for where label-count data is loaded:

```bash
grep -n "labels\|labelDefinitions\|labelApplications" src/pages/QueuePage.tsx | head -20
```

If a count of "messages with ≥2 human labels" isn't already computed, derive it from the queue's existing label-application data, or expose it from the existing API helper. If not easily derivable, add a small `multi_labeled_count` field to the relevant existing endpoint (preferred), or fall back to passing `0` and adding a TODO note in the spec's Open Risks section.

- [ ] **Step 2: Pass `multiLabeledCount` to DiscoverSection**

```tsx
<DiscoverSection
  multiLabeledCount={multiLabeledCount}
  onRunStarted={() => setShowDiscoverModal(true)}
/>
```

- [ ] **Step 3: Confirm cleanup-on-unmount**

The `useEffect` polling interval inside `DiscoverSection` (Task 5.4) already returns a cleanup that clears the interval. Verify by mounting and unmounting:

```bash
npm test -- DiscoverSection
```

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit && npm run build
```

---

### Task 6.2: Remove dead code from the old KMeans path

**Files:**
- Modify: `server/python/concept_service.py` (verify deletions from Phase 3 are complete)
- Modify: `server/python/main.py` (remove the legacy `/api/concepts/embed-status` if it's truly unused; otherwise leave it)
- Modify: `src/services/api.ts` (remove the legacy `getEmbedStatus` if no callers remain)

- [ ] **Step 1: Confirm no callers of removed names**

```bash
grep -rn "_run_discover\b\|discover_concepts\b\|SUGGEST_TOOL\b\|_build_discovery_prompt\b\|_deduplicate_concepts\b" server/python/
```
Expected: no hits in non-test, non-deleted code. (Tests for the new path use different names.)

- [ ] **Step 2: Remove unused frontend helpers**

```bash
grep -rn "getEmbedStatus\|getCandidates\b" src/ --include="*.ts" --include="*.tsx"
```
Remove any remaining references to the legacy names. Keep `embed_messages` in `concept_service.py` — it's still used by retrieval.

- [ ] **Step 3: Verify all tests pass**

```bash
cd server/python && uv run pytest -v
```

```bash
npm test
```

```bash
npm run build
```

---

### Task 6.3: End-to-end manual test

**Files:** none (manual)

- [ ] **Step 1: Start the backend**

```bash
cd server/python && uv run uvicorn main:app --reload
```

- [ ] **Step 2: Start the frontend**

```bash
npm run dev
```

- [ ] **Step 3: Mode A walkthrough**

1. Apply ~30 human labels to messages so the residual pool is meaningful.
2. Open the Discover section. Confirm the **"Find missing labels"** button is visible. If recalibration is due (PR #36), confirm the green dot lights up.
3. Click **Find missing labels**. Wait for the run to complete.
4. Open the modal. Confirm at least one broad-label card appears with `Accept & apply` / `Dismiss` buttons (NOT the co-occurrence buttons).
5. Click `Accept & apply`. Confirm the toast: *"Created 'X' and applied to N messages as AI labels."*
6. Return to the queue. Confirm the new label is in the legend.
7. Walk to one of the AI-applied messages. Confirm the label is shown with the AI provenance, and that toggling it off works (revertibility).

- [ ] **Step 4: Mode B walkthrough**

1. Confirm there are messages with ≥2 human labels in the corpus. If not, label a few accordingly.
2. Open the Discover section. Confirm the **"Find label patterns"** button is visible.
3. Click it. After the run, open the modal.
4. Confirm a co-occurrence card appears with `Make a combo label` / `Suggest merge` / `Note only` / `Dismiss` (NOT the `Accept & apply` button).
5. Click `Make a combo label`. Confirm a new label appears in the legend (no auto-apply expected).
6. Click `Note only` on a different card. Confirm it disappears from the modal but no schema change occurs.

- [ ] **Step 5: Verify instrumentation**

```bash
sqlite3 server/python/chatsight.db "SELECT id, query_kind, trigger, n_candidates, drift_value_at_trigger, pool_size_at_trigger FROM discoveryrun ORDER BY id DESC LIMIT 5;"
```

```bash
sqlite3 server/python/chatsight.db "SELECT id, kind, decision, created_label_id, name FROM conceptcandidate ORDER BY id DESC LIMIT 10;"
```

Expected: rows for both runs, decisions populated for the candidates you acted on, `created_label_id` set on accepted candidates.

---

### STOP — Phase 6 review

Pause for user review and commit. Suggested commit message:

```
feat: discovery ripeness badge + cleanup

Wires ripeness polling on QueuePage with cleanup-on-unmount,
removes dead KMeans-related code and unused legacy helpers,
end-to-end verifies both Mode A and Mode B flows.
```

---

## Out of scope reminder

The following are explicitly deferred per the spec; do NOT implement in this rollout:

- Replacing the legacy `status` and `source_run_id` columns on `ConceptCandidate`
- Promoting the badge to an auto-trigger
- Mode C (missing-axes query)
- The "confirm-each" Variant C acceptance UX
- A discovery-health UI panel
