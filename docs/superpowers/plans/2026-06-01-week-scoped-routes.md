# Week-Scoped Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-lock `/queue` (multi-label) to DSC 10 Winter-2026 Week 3 (Lab 1 + HW 1) and `/run` (single-label) to Week 8 (Lab 5 + HW 5), server-side, including the Gemini handoff classification.

**Architecture:** A single source-of-truth module `study_scope.py` defines per-week assignment-name sets and reuses `assignment_service._canonical_name` to decide whether a `MessageCache.notebook` is in scope. Scope is keyed on label **mode** (multi → Week 3, single → Week 8) because `next_message_for_label` is shared. Enforcement is unconditional and ignores any client `assignment_id`.

**Tech Stack:** FastAPI + SQLModel + SQLite (backend), pytest, React + TypeScript + Vite (frontend).

---

## File Structure

- **Create** `server/python/study_scope.py` — scope constants + predicate helpers. One responsibility: "is this notebook in the locked week?".
- **Create** `server/python/tests/test_study_scope.py` — unit + route tests.
- **Modify** `server/python/queue_service.py` — scope `next_message_for_label` by mode.
- **Modify** `server/python/decision_service.py` — scope `compute_readiness` denominator.
- **Modify** `server/python/main.py` — scope `/api/queue`, `/api/queue/stats`, `/api/queue/position`, and `_do_classification`.
- **Modify** `src/components/run/StripBar.tsx` — replace assignment picker with a fixed-scope label.
- **Modify** `src/pages/QueuePage.tsx` — add a fixed-scope banner.

---

## Task 1: `study_scope` module

**Files:**
- Create: `server/python/study_scope.py`
- Test: `server/python/tests/test_study_scope.py`

- [ ] **Step 1: Write the failing test**

```python
# server/python/tests/test_study_scope.py
import study_scope


def test_queue_scope_matches_week3_lab_and_hw():
    assert study_scope.notebook_in_scope("lab1.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("lab01.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("hw01.ipynb", study_scope.QUEUE_SCOPE)
    assert study_scope.notebook_in_scope("hw1.ipynb", study_scope.QUEUE_SCOPE)


def test_run_scope_matches_week8_lab_and_hw():
    assert study_scope.notebook_in_scope("lab5.ipynb", study_scope.RUN_SCOPE)
    assert study_scope.notebook_in_scope("hw05.ipynb", study_scope.RUN_SCOPE)


def test_out_of_scope_and_none():
    assert not study_scope.notebook_in_scope("lab2.ipynb", study_scope.QUEUE_SCOPE)
    assert not study_scope.notebook_in_scope("lab15.ipynb", study_scope.QUEUE_SCOPE)
    assert not study_scope.notebook_in_scope("lab1.ipynb", study_scope.RUN_SCOPE)
    assert not study_scope.notebook_in_scope(None, study_scope.QUEUE_SCOPE)


def test_scope_for_mode():
    assert study_scope.scope_for_mode("single") == study_scope.RUN_SCOPE
    assert study_scope.scope_for_mode("multi") == study_scope.QUEUE_SCOPE
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'study_scope'`.

- [ ] **Step 3: Write minimal implementation**

```python
# server/python/study_scope.py
"""Study fixture: hard-locked per-week assignment scopes for the user study.

`/queue` (multi-label) is locked to DSC 10 Winter-2026 Week 3 (Lab 1 + HW 1);
`/run` (single-label) is locked to Week 8 (Lab 5 + HW 5). Scope is expressed in
canonical assignment names (the same vocabulary as assignment_service) so it does
not depend on AssignmentMapping rows existing. Weeks come from
https://dsc-courses.github.io/dsc10-2026-wi/ (cross-checked vs
data/milestones/dsc10_wi26.json).
"""
from typing import Optional

from sqlmodel import Session, select

from assignment_service import _canonical_name
from models import MessageCache

QUEUE_SCOPE = {"Lab 1", "Homework 1"}   # Week 3 — multi-label
RUN_SCOPE = {"Lab 5", "Homework 5"}     # Week 8 — single-label


def scope_for_mode(mode: str) -> set[str]:
    """Single-label runs are Week 8; everything else (multi/onboarding) is Week 3."""
    return RUN_SCOPE if mode == "single" else QUEUE_SCOPE


def notebook_in_scope(notebook: Optional[str], names: set[str]) -> bool:
    return notebook is not None and _canonical_name(notebook) in names


def in_scope_keys(session: Session, names: set[str]) -> set[tuple[int, int]]:
    """(chatlog_id, message_index) pairs whose notebook canonicalizes into `names`."""
    rows = session.exec(
        select(
            MessageCache.chatlog_id,
            MessageCache.message_index,
            MessageCache.notebook,
        )
    ).all()
    return {
        (cid, midx)
        for cid, midx, nb in rows
        if notebook_in_scope(nb, names)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/python/study_scope.py server/python/tests/test_study_scope.py
git commit -m "feat: study_scope module locking weeks to assignment-name sets"
```

---

## Task 2: Scope the multi-label `/queue` endpoints (Week 3)

**Files:**
- Modify: `server/python/main.py` (`get_queue`, `get_queue_stats`, `get_queue_position`)
- Test: `server/python/tests/test_study_scope.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_study_scope.py`. This uses the existing test fixture pattern (see `server/python/tests/conftest.py`): `client` is a `TestClient` over the app with an in-memory DB and a `session` fixture for seeding.

```python
from models import MessageCache


def _seed(session, chatlog_id, message_index, notebook):
    session.add(MessageCache(
        chatlog_id=chatlog_id, message_index=message_index,
        message_text=f"msg {chatlog_id}.{message_index}", notebook=notebook,
    ))
    session.commit()


def test_queue_returns_only_week3(client, session):
    _seed(session, 1, 0, "lab1.ipynb")   # in scope (Week 3)
    _seed(session, 2, 0, "lab5.ipynb")   # out of scope (Week 8)
    _seed(session, 3, 0, "lab2.ipynb")   # out of scope
    resp = client.get("/api/queue?limit=50")
    assert resp.status_code == 200
    ids = {row["chatlog_id"] for row in resp.json()}
    assert ids == {1}


def test_queue_stats_counts_only_week3(client, session):
    _seed(session, 1, 0, "lab1.ipynb")
    _seed(session, 2, 0, "hw1.ipynb")
    _seed(session, 3, 0, "lab5.ipynb")
    stats = client.get("/api/queue/stats").json()
    assert stats["total_messages"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -k queue -v`
Expected: FAIL — `test_queue_returns_only_week3` sees `{1, 2, 3}`; `total_messages` is 3.

- [ ] **Step 3: Implement — scope `get_queue` candidates**

In `server/python/main.py`, add the import near the other service imports (next to `import assignment_service`):

```python
import study_scope
```

In `get_queue`, replace the candidate-building block:

```python
    # Query from cache instead of external DB CTE
    all_cached = db.exec(select(MessageCache)).all()

    candidates = [
        c for c in all_cached
        if (c.chatlog_id, c.message_index) not in excluded
    ]
```

with:

```python
    # Query from cache instead of external DB CTE. Study lock: Week 3 only.
    all_cached = db.exec(select(MessageCache)).all()

    candidates = [
        c for c in all_cached
        if (c.chatlog_id, c.message_index) not in excluded
        and study_scope.notebook_in_scope(c.notebook, study_scope.QUEUE_SCOPE)
    ]
```

- [ ] **Step 4: Implement — scope `get_queue_stats`**

Replace the body of `get_queue_stats` with an in-scope-keyed version:

```python
@app.get("/api/queue/stats")
def get_queue_stats(db: Session = Depends(get_session)):
    in_scope = study_scope.in_scope_keys(db, study_scope.QUEUE_SCOPE)
    labeled_pairs = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
        .where(LabelDefinition.archived_at == None)  # noqa: E711
        .where(_is_multi_application())
        .distinct()
    ).all()
    skipped_pairs = db.exec(
        select(SkippedMessage.chatlog_id, SkippedMessage.message_index)
    ).all()
    labeled_count = len({(c, i) for c, i in labeled_pairs} & in_scope)
    skipped_count = len({(c, i) for c, i in skipped_pairs} & in_scope)
    return {
        "total_messages": len(in_scope),
        "labeled_count": labeled_count,
        "skipped_count": skipped_count,
    }
```

- [ ] **Step 5: Implement — scope `get_queue_position`**

Replace the body of `get_queue_position` with:

```python
@app.get("/api/queue/position")
def get_queue_position(db: Session = Depends(get_session)):
    in_scope = study_scope.in_scope_keys(db, study_scope.QUEUE_SCOPE)
    labeled_pairs = db.exec(
        select(LabelApplication.chatlog_id, LabelApplication.message_index)
        .join(LabelDefinition, LabelApplication.label_id == LabelDefinition.id)
        .where(LabelDefinition.archived_at == None)  # noqa: E711
        .where(_is_multi_application())
        .distinct()
    ).all()
    skipped_pairs = db.exec(
        select(SkippedMessage.chatlog_id, SkippedMessage.message_index)
    ).all()
    labeled_count = len({(c, i) for c, i in labeled_pairs} & in_scope)
    skipped_count = len({(c, i) for c, i in skipped_pairs} & in_scope)
    total = len(in_scope)
    total_remaining = max(0, total - labeled_count - skipped_count)
    position = labeled_count + skipped_count + 1
    return {"position": position, "total_remaining": total_remaining}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -v`
Expected: PASS (all, including the two new queue tests).

- [ ] **Step 7: Commit**

```bash
git add server/python/main.py server/python/tests/test_study_scope.py
git commit -m "feat: lock /queue endpoints to Week 3 (Lab 1 + HW 1)"
```

---

## Task 3: Scope single-label `next_message_for_label` (Week 8)

**Files:**
- Modify: `server/python/queue_service.py` (`next_message_for_label`)
- Test: `server/python/tests/test_study_scope.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_study_scope.py`:

```python
import queue_service
from models import LabelDefinition


def test_run_next_returns_only_week8(session):
    # Seed an in-scope (Week 8) and an out-of-scope conversation.
    _seed(session, 10, 0, "lab5.ipynb")   # Week 8 — in scope for single mode
    _seed(session, 11, 0, "lab1.ipynb")   # Week 3 — out of scope for single mode
    label = LabelDefinition(name="needs help", mode="single", phase="labeling")
    session.add(label)
    session.commit()

    picks = set()
    for _ in range(10):
        payload = queue_service.next_message_for_label(session, label.id)
        if payload:
            picks.add(payload["chatlog_id"])
    assert picks <= {10}
    assert 11 not in picks
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_study_scope.py::test_run_next_returns_only_week8 -v`
Expected: FAIL — conversation 11 is also picked.

- [ ] **Step 3: Implement — filter `cache_rows` by mode scope**

In `server/python/queue_service.py`, add the import at the top (with the other local imports):

```python
import study_scope
```

In `next_message_for_label`, find the cache query block:

```python
    if assignment_id is not None:
        cache_q = cache_q.where(MessageCache.assignment_id == assignment_id)
    cache_rows = session.exec(cache_q).all()
```

Replace it with (note: `cache_rows` columns are `(_id, cid, midx, text, notebook, assign)` — `notebook` is index 4):

```python
    if assignment_id is not None:
        cache_q = cache_q.where(MessageCache.assignment_id == assignment_id)
    cache_rows = session.exec(cache_q).all()

    # Study lock: restrict to the week tied to this label's mode
    # (single -> Week 8, multi/onboarding -> Week 3). Unconditional; the
    # client assignment_id filter above only narrows further.
    _label = session.get(LabelDefinition, label_id)
    _scope = study_scope.scope_for_mode(_label.mode if _label else "multi")
    cache_rows = [
        row for row in cache_rows
        if study_scope.notebook_in_scope(row[4], _scope)
    ]
```

(`LabelDefinition` is already imported in `queue_service.py`; confirm with `grep "LabelDefinition" server/python/queue_service.py` — it is used later in the same function.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_study_scope.py::test_run_next_returns_only_week8 -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/python/queue_service.py server/python/tests/test_study_scope.py
git commit -m "feat: scope single-label /run selection to Week 8 by mode"
```

---

## Task 4: Scope readiness denominator + handoff classification (Week 8)

**Files:**
- Modify: `server/python/decision_service.py` (`compute_readiness`)
- Modify: `server/python/main.py` (`_do_classification`)
- Test: `server/python/tests/test_study_scope.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_study_scope.py`:

```python
import decision_service


def test_readiness_total_convs_scoped_to_week8(session):
    _seed(session, 20, 0, "lab5.ipynb")   # Week 8
    _seed(session, 21, 0, "lab1.ipynb")   # Week 3
    _seed(session, 22, 0, "lab2.ipynb")   # other
    label = LabelDefinition(name="x", mode="single", phase="labeling")
    session.add(label)
    session.commit()
    state = decision_service.compute_readiness(session, label.id)
    assert state["total_conversations"] == 1


def test_classification_pending_excludes_out_of_scope(session, monkeypatch):
    import main
    _seed(session, 30, 0, "lab5.ipynb")   # Week 8 — should be classified
    _seed(session, 31, 0, "lab1.ipynb")   # Week 3 — must be skipped
    label = LabelDefinition(name="y", mode="single", phase="labeling",
                            review_threshold=0.5)
    session.add(label)
    session.commit()

    captured = {}

    def fake_parallel(db, label, pending, yes_examples, no_examples):
        captured["pending"] = pending
        return {"yes": 0, "no": 0, "skip": 0, "errors": 0}

    monkeypatch.setattr(main, "_classify_in_parallel", fake_parallel)
    # Force the inline parallel path (small job) by keeping pending tiny.
    main._do_classification(session, label)
    keys = {(c, i) for (c, i, _t) in captured["pending"]}
    assert (30, 0) in keys
    assert (31, 0) not in keys
```

NOTE: `_classify_in_parallel`'s real signature must be confirmed before writing the `fake_parallel` stub — open `server/python/main.py` at `def _classify_in_parallel(` and match its parameters exactly. If the small-job path calls a differently named function, stub that one instead. Adjust the stub signature to match; the assertion on `captured["pending"]` is the invariant that matters.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -k "readiness or classification" -v`
Expected: FAIL — `total_conversations` is 3; classification pending includes `(31, 0)`.

- [ ] **Step 3: Implement — scope `compute_readiness`**

In `server/python/decision_service.py`, add the import at the top:

```python
import study_scope
```

Find:

```python
    total_convs = session.exec(
        select(MessageCache.chatlog_id).distinct()
    ).all()
    total_convs_count = len(total_convs)
```

Replace with:

```python
    # Study lock: single-label runs are Week 8 — count only in-scope convs.
    label = session.get(LabelDefinition, label_id)
    scope = study_scope.scope_for_mode(label.mode if label else "single")
    in_scope = study_scope.in_scope_keys(session, scope)
    total_convs_count = len({cid for cid, _ in in_scope})
```

(`LabelDefinition` and `MessageCache` are already imported in `decision_service.py`; verify with `grep "^from models" server/python/decision_service.py`.)

- [ ] **Step 4: Implement — scope `_do_classification`**

In `server/python/main.py` (`study_scope` already imported in Task 2), find in `_do_classification`:

```python
    cached = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index, MessageCache.message_text)
    ).all()
    pending = [(c, i, t) for (c, i, t) in cached if (c, i) not in decided_keys]
```

Replace with:

```python
    cached = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index, MessageCache.message_text)
    ).all()
    # Study lock: only classify the week this label's mode is scoped to
    # (single -> Week 8). Keeps Gemini handoff bounded and fast.
    scope = study_scope.scope_for_mode(label.mode)
    in_scope = study_scope.in_scope_keys(db, scope)
    pending = [
        (c, i, t) for (c, i, t) in cached
        if (c, i) not in decided_keys and (c, i) in in_scope
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server/python && uv run pytest tests/test_study_scope.py -v`
Expected: PASS (all).

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd server/python && uv run pytest`
Expected: PASS. If pre-existing unrelated tests assume the full corpus appears in `/queue` or `/run`, note them — they may need a scope-aware seed, but do not loosen the lock to make them pass without confirming with the spec.

- [ ] **Step 7: Commit**

```bash
git add server/python/decision_service.py server/python/main.py server/python/tests/test_study_scope.py
git commit -m "feat: bound readiness + Gemini handoff classification to Week 8"
```

---

## Task 5: Frontend — replace assignment pickers with fixed-scope labels

**Files:**
- Modify: `src/components/run/StripBar.tsx`
- Modify: `src/pages/QueuePage.tsx`

- [ ] **Step 1: Replace the `/run` assignment picker with a scope label**

In `src/components/run/StripBar.tsx`, find the `AssignmentPicker` usage:

```tsx
            <AssignmentPicker
              assignments={assignments}
              unmapped={unmapped}
              selectedId={selectedAssignmentId}
              onSelect={onSelectAssignment}
            />
```

Replace with a static label (the server ignores `assignment_id` now):

```tsx
            <span className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
              <span className="text-[9px] tracking-[0.06em] uppercase text-faint">scope</span>
              <span className="text-fg">Week 8 — Lab 5 &amp; HW 5</span>
            </span>
```

Leave the `AssignmentPicker` import in place only if still referenced elsewhere; if it becomes unused, remove the import to keep the type-check clean.

- [ ] **Step 2: Add a fixed-scope banner to `/queue`**

In `src/pages/QueuePage.tsx`, locate the top of the page's main returned JSX (the outermost container that holds the queue header). Add, as the first child inside that container:

```tsx
      <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-[11px] text-neutral-300">
        <span className="text-[9px] uppercase tracking-[0.06em] text-neutral-500">scope</span>
        <span>Week 3 — Lab 1 &amp; HW 1</span>
      </div>
```

(Place it where it reads naturally above the message card; match the surrounding indentation.)

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors. Then `npm run build` — expected: success.

- [ ] **Step 4: Run frontend tests (no regressions)**

Run: `npm test`
Expected: PASS. If a StripBar test asserts the assignment picker is rendered, update it to assert the scope label instead.

- [ ] **Step 5: Commit**

```bash
git add src/components/run/StripBar.tsx src/pages/QueuePage.tsx
git commit -m "feat: show fixed week-scope label, drop assignment picker on locked routes"
```

---

## Final verification

- [ ] `cd server/python && uv run pytest` — all pass.
- [ ] `npx tsc --noEmit && npm test` — all pass.
- [ ] Manual smoke (optional, needs DB tunnel): start backend + frontend, confirm `/queue` shows only Lab 1 / HW 1 messages and `/run` shows only Lab 5 / HW 5, and that triggering handoff classifies only Week 8.
