# Sample Handoff (Dev) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `sample_size` query parameter to `POST /api/single-labels/{id}/handoff` so a developer can run handoff against a random N-sized subset of pending messages (instead of all of them) for end-to-end pipeline smoke-testing.

**Architecture:** One query parameter on the existing handoff route, threaded through `_classify_in_background` to `_do_classification`, where it slices `pending` via `random.sample(...)` immediately after that list is computed. All other logic (parallel/batch routing, AI row writes, summary generation, phase transitions) is untouched.

**Tech Stack:** FastAPI, Pydantic, Python's stdlib `random`, pytest, SQLModel.

**User preference (do not commit):** This user reviews and commits code themselves. Each task ends with a **Pause for user review** step instead of `git commit` — do not commit on their behalf. After the user reviews, they may either commit or ask for changes.

---

## File map

- Modify `server/python/main.py`:
  - Add `import random` to the top-of-file imports.
  - `handoff_single_label` (~line 3136) — accept optional `sample_size: Optional[int]` query param, validate, forward to bg task.
  - `_classify_in_background` (~line 3098) — accept optional `sample_size`, forward to `_do_classification`.
  - `_do_classification` (~line 2789) — accept optional `sample_size`, slice `pending` after it's computed.
- Modify `server/python/tests/test_handoff_flow.py` — add 4 new tests covering rejection, sampling, clamping, and `classification_total`.

No frontend, schema, or migration changes.

---

### Task 1: Validate `sample_size` query parameter

The endpoint must reject `sample_size <= 0` with HTTP 400 before doing any DB writes or kicking off the background task. Positive values pass through; absent values keep existing behavior.

**Files:**
- Modify: `server/python/main.py` (`handoff_single_label`)
- Test: `server/python/tests/test_handoff_flow.py` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `server/python/tests/test_handoff_flow.py`:

```python
def test_handoff_rejects_zero_sample_size(client, session):
    """sample_size must be a positive int — zero is rejected before any work starts."""
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    r = client.post(f"/api/single-labels/{a['id']}/handoff?sample_size=0")
    assert r.status_code == 400
    # Label should still be in 'labeling' phase (not flipped to 'classifying')
    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.phase == "labeling"


def test_handoff_rejects_negative_sample_size(client, session):
    _seed(session)
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    r = client.post(f"/api/single-labels/{a['id']}/handoff?sample_size=-5")
    assert r.status_code == 400
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `server/python/`:

```
uv run pytest tests/test_handoff_flow.py::test_handoff_rejects_zero_sample_size tests/test_handoff_flow.py::test_handoff_rejects_negative_sample_size -v
```

Expected: both FAIL. Likely shape: status code returned is 200 (existing handoff happily ignores the unknown param) instead of 400.

- [ ] **Step 3: Add the validation to `handoff_single_label`**

In `server/python/main.py`, locate the handler (currently around line 3136). It looks like:

```python
@app.post("/api/single-labels/{label_id}/handoff", response_model=HandoffResponse)
def handoff_single_label(
    label_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
```

Replace that signature with the version that accepts `sample_size`, and add the validation as the first line of the body:

```python
@app.post("/api/single-labels/{label_id}/handoff", response_model=HandoffResponse)
def handoff_single_label(
    label_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
    sample_size: Optional[int] = None,
):
    """Hand off a label to Gemini in the background. Returns immediately with
    the next-active label info — the actual classification runs after response.

    `sample_size` (dev smoke-test): when set to a positive int, classification
    runs against a random sample of pending messages of that size instead of
    the full pending set. Rejected with HTTP 400 if <= 0. No upper cap — values
    larger than `len(pending)` clamp to all of pending.

    Behavior:
    - Active label moves to phase = 'classifying' (deactivated)
    - Next queued label (if any) auto-activates and moves to phase = 'labeling'
    - Background task runs Gemini classification + summary; on success sets phase
      to 'handed_off' and stores summary_json
    - The classifying label appears on /api/handoff-summaries with empty patterns
      until the background task completes."""
    if sample_size is not None and sample_size <= 0:
        raise HTTPException(
            status_code=400,
            detail="sample_size must be a positive integer when provided",
        )
    label = db.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="Single-label not found")
    if label.phase == "classifying":
        raise HTTPException(status_code=409, detail="Already classifying")
    # ... (rest of body unchanged)
```

The `Optional` is already imported at the top of the file (line 7). Do not modify the body below the validation — Task 2 will plumb `sample_size` through to the bg task.

- [ ] **Step 4: Run the validation tests to verify they pass**

```
uv run pytest tests/test_handoff_flow.py::test_handoff_rejects_zero_sample_size tests/test_handoff_flow.py::test_handoff_rejects_negative_sample_size -v
```

Expected: both PASS.

- [ ] **Step 5: Run the existing handoff tests to verify nothing regressed**

```
uv run pytest tests/test_handoff_flow.py -v
```

Expected: all tests pass (the validation only fires when `sample_size` is explicitly provided, so omitting it preserves prior behavior).

- [ ] **Step 6: Pause for user review**

Stop here. Show the user the diff for `main.py` and the new tests. Do not commit. Wait for the user to review, possibly commit themselves, and confirm before proceeding to Task 2.

---

### Task 2: Slice `pending` to a random sample of size N

Plumb `sample_size` from the endpoint through `_classify_in_background` into `_do_classification`, where the actual sampling happens. After this task, `POST /handoff?sample_size=400` actually classifies only 400 random pending messages.

**Files:**
- Modify: `server/python/main.py` (top-of-file imports, `handoff_single_label`'s `bg.add_task` call, `_classify_in_background`, `_do_classification`)
- Test: `server/python/tests/test_handoff_flow.py` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `server/python/tests/test_handoff_flow.py`:

```python
def test_sample_size_caps_pending_to_n(client, session):
    """With sample_size set, only that many AI rows are written and
    classification_total reflects the sample size, not the full pending set."""
    _seed(session, conversations=5, per_conv=4)  # 20 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label, sample_size=8)

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 8

    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.classification_total == 8
    assert fresh.classified_count == 8


def test_sample_size_above_pending_uses_all(client, session):
    """sample_size > len(pending) clamps to all of pending."""
    _seed(session, conversations=2, per_conv=3)  # 6 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label, sample_size=400)

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 6  # all of pending, clamped from 400


def test_sample_size_omitted_classifies_all_pending(client, session):
    """Regression check: when sample_size is None, behavior is identical to before."""
    _seed(session, conversations=3, per_conv=4)  # 12 cached messages
    a = client.post("/api/single-labels", json={"name": "help"}).json()
    client.post(f"/api/single-labels/{a['id']}/activate")

    def fake_classify(label_name, label_description, yes_examples, no_examples, messages):
        return [
            {"index": i, "value": "yes", "confidence": 0.9}
            for i in range(len(messages))
        ]

    def fake_summary(label_name, label_description, yes_messages, no_messages):
        return {"included": [], "excluded": []}

    label = session.get(LabelDefinition, a["id"])
    with patch("binary_autolabel_service.classify_binary", side_effect=fake_classify), \
         patch("binary_autolabel_service.summarize_batch", side_effect=fake_summary):
        main._do_classification(session, label)  # no sample_size

    ai_rows = session.exec(
        select(LabelApplication).where(
            LabelApplication.label_id == a["id"],
            LabelApplication.applied_by == "ai",
        )
    ).all()
    assert len(ai_rows) == 12

    fresh = session.get(LabelDefinition, a["id"])
    assert fresh.classification_total == 12
```

- [ ] **Step 2: Run the tests to verify they fail**

```
uv run pytest tests/test_handoff_flow.py::test_sample_size_caps_pending_to_n tests/test_handoff_flow.py::test_sample_size_above_pending_uses_all tests/test_handoff_flow.py::test_sample_size_omitted_classifies_all_pending -v
```

Expected: the first two FAIL because `_do_classification` doesn't accept `sample_size` — likely a `TypeError: _do_classification() got an unexpected keyword argument 'sample_size'`. The third (`omitted` case) should already PASS, since it doesn't pass `sample_size`. That's fine — we want it to keep passing after Step 3.

- [ ] **Step 3: Add `random` import, update three signatures, and apply sampling**

Three edits in `server/python/main.py`:

**Edit 3a:** Add `import random` to the top-of-file imports. After line 8 (`import csv`), insert `import random`. Final imports block in that region looks like:

```python
import csv
import os
import io
import logging
import random
import tempfile
import threading
import time
```

**Edit 3b:** In `_do_classification` (currently around line 2789), update the signature and add the sampling block. The current signature is:

```python
def _do_classification(db: Session, label: LabelDefinition) -> None:
```

Change it to:

```python
def _do_classification(
    db: Session,
    label: LabelDefinition,
    sample_size: Optional[int] = None,
) -> None:
```

Update the docstring (replace the existing first paragraph with):

```python
    """Classify pending messages for `label` and emit a summary. Routes large jobs
    (> BATCH_THRESHOLD) to the Gemini Batch API and small jobs to a parallel
    synchronous path (ThreadPoolExecutor over chunks). Both paths share the
    pre/post bookkeeping below: collect pending + few-shot examples, write AI
    rows + progress, then summarize and flip phase to 'handed_off'.

    `sample_size` (dev smoke-test): when set, `pending` is reduced to
    `random.sample(pending, min(sample_size, len(pending)))` immediately after
    it is computed. All downstream logic — chunk size, parallel/batch routing,
    `classification_total`, summary — operates on the sampled subset."""
```

Then add the sampling block. Find this section (the lines that follow the `pending = ...` list comprehension):

```python
    cached = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index, MessageCache.message_text)
    ).all()
    pending = [(c, i, t) for (c, i, t) in cached if (c, i) not in decided_keys]

    yes_examples_rows = db.exec(
```

Insert the sampling block between `pending = [...]` and `yes_examples_rows = ...`:

```python
    cached = db.exec(
        select(MessageCache.chatlog_id, MessageCache.message_index, MessageCache.message_text)
    ).all()
    pending = [(c, i, t) for (c, i, t) in cached if (c, i) not in decided_keys]

    if sample_size is not None:
        pending = random.sample(pending, min(sample_size, len(pending)))

    yes_examples_rows = db.exec(
```

**Edit 3c:** Update `_classify_in_background` (around line 3098) to thread `sample_size` through. Current signature:

```python
def _classify_in_background(label_id: int) -> None:
```

Change to:

```python
def _classify_in_background(label_id: int, sample_size: Optional[int] = None) -> None:
```

Inside the body, change the existing call from:

```python
            _do_classification(db, label)
```

to:

```python
            _do_classification(db, label, sample_size=sample_size)
```

**Edit 3d:** Update the `bg.add_task(...)` call in `handoff_single_label`. The current call is:

```python
    bg.add_task(_classify_in_background, label_id)
```

Change to:

```python
    bg.add_task(_classify_in_background, label_id, sample_size)
```

(`BackgroundTasks.add_task` forwards positional args, so this is a clean pass-through.)

- [ ] **Step 4: Run the new tests to verify they pass**

```
uv run pytest tests/test_handoff_flow.py::test_sample_size_caps_pending_to_n tests/test_handoff_flow.py::test_sample_size_above_pending_uses_all tests/test_handoff_flow.py::test_sample_size_omitted_classifies_all_pending -v
```

Expected: all three PASS.

- [ ] **Step 5: Run the full backend test suite to verify no regressions**

```
uv run pytest -v
```

Expected: 158 passed, 0 failed. (155 baseline pre-feature + 2 from Task 1 + 3 from Task 2 minus any redundancy = ~160. The exact count isn't load-bearing — all green is what matters.)

- [ ] **Step 6: Manual smoke-test from the running backend** (optional but recommended)

Confirm the user has a label with sufficient pending messages. With the backend running on `:8000`:

```
curl -X POST 'http://localhost:8000/api/single-labels/<LABEL_ID>/handoff?sample_size=400'
```

Expected: HTTP 200 with `HandoffResponse` body. Watch `/summaries` in the browser — within ~5–30s the card should advance from 0/400 to 400/400 and flip to `handed_off`. Verify in the DB:

```
sqlite3 chatsight.db 'SELECT classification_total, classified_count, phase FROM labeldefinition WHERE id=<LABEL_ID>'
```

Expected: `400|400|handed_off`. If the user prefers to skip this manual step (e.g., they're still debugging the rate-limit situation), the test suite is sufficient verification.

- [ ] **Step 7: Pause for user review**

Stop here. Show the user the diff for `main.py` and the new tests. Do not commit. The user reviews, optionally commits, and signs off before the plan is considered complete.

---

## Self-review notes

- **Spec coverage:** every numbered item in the spec's Design / Wiring / Tests sections maps to a step. Validation → Task 1. Threading + sampling + `classification_total` semantics → Task 2 Edit 3b–3d. Test cases enumerated in the spec → all four covered (zero, negative, omitted, clamping). The "exactly N rows" case is `test_sample_size_caps_pending_to_n`.
- **Placeholder scan:** no TBD / TODO / "appropriate validation" handwaving. Every code block is complete and copy-pasteable.
- **Type / signature consistency:** `sample_size: Optional[int] = None` is used consistently across `handoff_single_label`, `_classify_in_background`, and `_do_classification`. The `Optional` import already exists in `main.py` (verified in line 7's import block).
- **No-commit preference:** every Task ends with "Pause for user review" (Steps 6 and 7 respectively), explicitly forbidding commits. The header restates this so a downstream agent that reads tasks out of order still sees the constraint.
