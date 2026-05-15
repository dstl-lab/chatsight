# Summaries Page Revamp — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "fix the dataset" loop on `/summaries` in single-label mode — master-detail layout with a Browse tab for inspecting Gemini's verdicts and flipping wrong predictions, plus a Settings tab for label CRUD. Replace `/labels` in single-label nav.

**Architecture:** `SummariesPage` becomes mode-aware. In single-label mode it renders a new master-detail UI built from focused components under `src/components/summaries/`. Backend gains `LabelApplication.matched_pattern`/`rationale`/`flagged`/`note` plus seven new endpoints. `autolabel_service.py` is extended to capture per-message rationale during classification.

**Tech Stack:** FastAPI + SQLModel (backend), React + Vite + Tailwind v4 (frontend), `react-window` for virtualization (new dep), pytest + vitest for tests.

**Spec:** `docs/superpowers/specs/2026-05-14-summaries-page-revamp-design.md`

**Scope note:** Phase 1 is the anchor flow only. Review tab queue mode, Patterns tab interactivity, and Refine tab split/merge are Phases 2 and 3 — separate plans, not in this document.

---

## File Structure

### Backend

| File | Change |
|---|---|
| `server/python/models.py` | Extend `LabelApplication` with `matched_pattern`, `rationale`, `flagged`, `note` |
| `server/python/database.py` | Extend `_migrate_label_application` with new columns |
| `server/python/schemas.py` | Add Pydantic schemas for label detail, message list, message detail, flip, note, label update |
| `server/python/main.py` | Add 7 new endpoints under `/api/single-labels/...` |
| `server/python/autolabel_service.py` | Extend `classify_messages` tool schema with `matched_pattern` + `rationale`; persist into new columns |
| `server/python/tests/test_single_labels.py` | New test file for the new endpoints |
| `server/python/tests/test_autolabel_rationale.py` | New test file for rationale capture |

### Frontend

| File | Change |
|---|---|
| `package.json` | Add `react-window` + `@types/react-window` |
| `src/types/index.ts` | Add types for new API shapes |
| `src/services/api.ts` | Add API helpers for new endpoints |
| `src/pages/SummariesPage.tsx` | Refactor to mode-branch; keeps today's behavior in multi-label mode |
| `src/pages/summaries/SummariesPageSingle.tsx` | New — root single-label master-detail UI |
| `src/components/summaries/LabelRail.tsx` | New — left rail |
| `src/components/summaries/DetailHeader.tsx` | New — sticky header (title + ⋯ menu + stats + tabs) |
| `src/components/summaries/BrowseTab.tsx` | New — two-column Browse layout |
| `src/components/summaries/FilterBar.tsx` | New — chips + search + sort |
| `src/components/summaries/MessageList.tsx` | New — virtualized list (`react-window`) |
| `src/components/summaries/MessageListRow.tsx` | New — single row |
| `src/components/summaries/FocusedMessage.tsx` | New — right pane container |
| `src/components/summaries/ConversationContext.tsx` | New — collapsible ±N turns |
| `src/components/summaries/VerdictBlock.tsx` | New — verdict badge + pattern link + actions |
| `src/components/summaries/NoteEditor.tsx` | New — collapsible note textarea |
| `src/components/summaries/SettingsTab.tsx` | New — rename/edit/threshold/re-handoff/delete |
| `src/components/summaries/RenameModal.tsx` | New — modal for rename |
| `src/components/summaries/DeleteConfirmModal.tsx` | New — typed-name delete confirm |
| `src/App.tsx` | Redirect `/labels` → `/summaries` in single-label mode |
| `src/components/Navigation.tsx` | Drop `/labels` link in single-label mode |
| `src/tests/SummariesPage.test.tsx` | Extend with single-label tests |

---

## Section A — Backend Foundation

### Task 1: Extend `LabelApplication` model + migration

**Files:**
- Modify: `server/python/models.py`
- Modify: `server/python/database.py`
- Modify: `server/python/tests/test_handoff_flow.py` (only if it explicitly enumerates `LabelApplication` columns — most tests don't)

- [ ] **Step 1: Add the columns to the SQLModel**

Edit `server/python/models.py`, in the `LabelApplication` class, add these fields right after `ai_confidence_at_review`:

```python
    # Single-label revamp (Summaries page Phase 1): per-row metadata captured
    # during AI classification (matched_pattern, rationale) and instructor
    # post-hoc actions (flagged, note).
    matched_pattern: Optional[str] = Field(default=None)
    rationale: Optional[str] = Field(default=None)
    flagged: bool = Field(default=False)
    note: Optional[str] = Field(default=None)
```

- [ ] **Step 2: Extend the migration helper**

Edit `server/python/database.py`. Find the function `_migrate_label_application` and add (at the end, before the function returns):

```python
    if "matched_pattern" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN matched_pattern VARCHAR DEFAULT NULL"))
    if "rationale" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN rationale TEXT DEFAULT NULL"))
    if "flagged" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN flagged BOOLEAN NOT NULL DEFAULT 0"))
    if "note" not in cols:
        conn.execute(text("ALTER TABLE labelapplication ADD COLUMN note TEXT DEFAULT NULL"))
```

- [ ] **Step 3: Write a test that creates a row with the new fields**

Create `server/python/tests/test_label_application_schema.py`:

```python
from sqlmodel import Session
from models import LabelApplication, LabelDefinition


def test_label_application_carries_new_fields(test_engine):
    with Session(test_engine) as session:
        label = LabelDefinition(name="self-correction", description="catches own mistake", mode="single")
        session.add(label)
        session.commit()
        session.refresh(label)

        row = LabelApplication(
            label_id=label.id,
            chatlog_id=1,
            message_index=0,
            applied_by="ai",
            value="yes",
            confidence=0.58,
            matched_pattern="questioning own work",
            rationale="Student explicitly recognizes they misread the prompt.",
            flagged=False,
            note=None,
        )
        session.add(row)
        session.commit()
        session.refresh(row)

        assert row.matched_pattern == "questioning own work"
        assert row.rationale.startswith("Student explicitly")
        assert row.flagged is False
        assert row.note is None
```

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_label_application_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/models.py server/python/database.py server/python/tests/test_label_application_schema.py
git commit -m "feat(summaries): extend LabelApplication with matched_pattern/rationale/flagged/note"
```

---

### Task 2: Update Gemini tool schema in `autolabel_service.py`

**Files:**
- Modify: `server/python/autolabel_service.py:23-46` (the `TOOL` declaration)

- [ ] **Step 1: Write a failing test**

Create `server/python/tests/test_autolabel_rationale.py`:

```python
import json
from autolabel_service import TOOL


def test_classify_tool_schema_includes_rationale_fields():
    """The Gemini function-calling schema must request matched_pattern and rationale
    per classification so the Summaries page can render per-message interpretability."""
    decls = TOOL.function_declarations
    assert len(decls) == 1
    classify = decls[0]
    item_props = classify.parameters["properties"]["classifications"]["items"]["properties"]

    assert "matched_pattern" in item_props
    assert item_props["matched_pattern"]["type"] == "string"

    assert "rationale" in item_props
    assert item_props["rationale"]["type"] == "string"
```

- [ ] **Step 2: Run it; expect failure**

Run: `cd server/python && uv run pytest tests/test_autolabel_rationale.py -v`
Expected: FAIL — `matched_pattern` not in item_props.

- [ ] **Step 3: Extend the tool schema**

Edit `server/python/autolabel_service.py`. In the `TOOL` declaration, add two properties to the `items.properties` dict and update the `required` list:

```python
                            "matched_pattern": {
                                "type": "string",
                                "description": "Short excerpt or phrase from the label description that fired for this message.",
                            },
                            "rationale": {
                                "type": "string",
                                "description": "One-sentence reason for the classification, grounded in the message.",
                            },
                        },
                        "required": ["index", "label", "confidence", "matched_pattern", "rationale"],
```

Also update the `CONFIG` system_instruction to mention the new fields:

```python
    system_instruction=(
        "You are classifying student messages from AI tutoring conversations. "
        "You will be given label definitions with example messages, then a batch "
        "of unlabeled messages to classify. Assign exactly one label to each message. "
        "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain). "
        "For each classification, also surface a short matched_pattern excerpt (a phrase from the label description that fits this message) "
        "and a one-sentence rationale grounded in the message text."
    ),
```

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_autolabel_rationale.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/autolabel_service.py server/python/tests/test_autolabel_rationale.py
git commit -m "feat(autolabel): capture matched_pattern + rationale in Gemini classify tool"
```

---

### Task 3: Persist `matched_pattern` and `rationale` when writing AI rows

**Background:** `classify_batch` in `autolabel_service.py` returns a list of classification dicts; persistence into `LabelApplication` happens at the call sites in `main.py`. Those sites must be updated to pass the new fields through.

**Files:**
- Modify: `server/python/main.py` (the `LabelApplication(applied_by="ai", ...)` construction sites — there are ~8, identified by `grep -n "LabelApplication(" server/python/main.py`)
- Create: `server/python/tests/test_autolabel_persistence.py` (lightweight unit test against one persistence helper)

- [ ] **Step 1: Locate the AI-row construction sites**

Run: `cd server/python && grep -n "applied_by=.ai." main.py`
Expected: a handful of lines (~8) constructing `LabelApplication(..., applied_by="ai", ...)`. Note them.

- [ ] **Step 2: Write a failing test**

Create `server/python/tests/test_autolabel_persistence.py`:

```python
"""Verify that the row-construction sites in main.py pass matched_pattern
and rationale through from the classify_batch output to LabelApplication rows.

This test exercises one representative entry point. The implementer must
also audit every other AI-row construction in main.py to apply the same
two-field passthrough (see Step 4)."""

from unittest.mock import patch
from sqlmodel import Session, select
from models import LabelDefinition, LabelApplication, MessageCache


def test_autolabel_persists_matched_pattern_and_rationale(client, test_session):
    label = LabelDefinition(name="self-correction", description="catches mistakes",
                            mode="single", phase="labeling", is_active=True)
    test_session.add(label)
    test_session.add(MessageCache(chatlog_id=1, message_index=0, text="wait, I misread"))
    test_session.commit(); test_session.refresh(label)

    fake_classifications = [{
        "index": 0,
        "label": "self-correction",
        "confidence": 0.62,
        "matched_pattern": "questioning own work",
        "rationale": "Student recognizes they misread.",
    }]

    # Stub classify_batch wherever it's called from main.py
    with patch("autolabel_service.classify_batch", return_value=fake_classifications):
        # Find the AI-trigger endpoint that exercises one of the persistence sites
        # (e.g. POST /api/single-labels/{id}/handoff). Replace the URL below to
        # match whichever endpoint your codebase uses to trigger a small
        # synchronous AI classification — the goal is to walk one persistence site.
        r = client.post(f"/api/single-labels/{label.id}/handoff",
                        params={"sample_size": 1})
        assert r.status_code in (200, 202)

    row = test_session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label.id)
        .where(LabelApplication.applied_by == "ai")
    ).first()
    assert row is not None
    assert row.matched_pattern == "questioning own work"
    assert row.rationale.startswith("Student recognizes")
```

**Note for the implementer:** if the handoff path doesn't call `classify_batch` synchronously in tests (e.g., it dispatches a BackgroundTask), use a different entry point or refactor the test to call the persistence helper directly. The test goal is "one site persists matched_pattern + rationale" — adapt the trigger to whichever route does this most cleanly in your codebase.

- [ ] **Step 3: Run the test; expect failure**

Run: `cd server/python && uv run pytest tests/test_autolabel_persistence.py -v`
Expected: FAIL — fields are not yet passed through.

- [ ] **Step 4: Update every AI-row construction site in `main.py`**

For each `LabelApplication(..., applied_by="ai", ...)` construction in `main.py`, add `matched_pattern` and `rationale` sourced from the corresponding classification dict (per-call this is the iteration variable — commonly `c`, `cl`, or `classification`):

```python
LabelApplication(
    label_id=label_id,
    chatlog_id=chatlog_id,
    message_index=message_index,
    applied_by="ai",
    value=verdict,
    confidence=c["confidence"],
    matched_pattern=c.get("matched_pattern"),
    rationale=c.get("rationale"),
)
```

Use `.get("matched_pattern")` (not `[]`) so legacy/test cases without those fields don't crash.

- [ ] **Step 5: Run the test**

Run: `cd server/python && uv run pytest tests/test_autolabel_persistence.py -v`
Expected: PASS

Also run the full backend suite to catch any sites you missed:
Run: `cd server/python && uv run pytest`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/python/main.py server/python/tests/test_autolabel_persistence.py
git commit -m "feat(autolabel): persist matched_pattern + rationale on AI-classified rows"
```

---

### Task 4: Add Pydantic schemas for the new endpoints

**Files:**
- Modify: `server/python/schemas.py` (append at end)

- [ ] **Step 1: Write a smoke test that imports each schema**

Create `server/python/tests/test_summaries_schemas.py`:

```python
from schemas import (
    SingleLabelDetailResponse,
    MessageListItem,
    MessageListResponse,
    ConversationTurn,
    MessageDetailResponse,
    FlipRequest,
    NoteRequest,
    LabelUpdateRequest,
)


def test_message_list_item_minimal():
    item = MessageListItem(
        chatlog_id=1, message_index=0, text="hello", confidence=0.5,
        verdict="yes", applied_by="ai", flagged=False, has_note=False,
        notebook=None,
    )
    assert item.verdict == "yes"


def test_message_detail_includes_context_turns():
    turn = ConversationTurn(role="tutor", turn_index=5, text="try median")
    detail = MessageDetailResponse(
        chatlog_id=1, message_index=6, text="ok",
        confidence=0.62, verdict="yes", applied_by="ai",
        matched_pattern="questioning own work", rationale="...",
        flagged=False, note=None,
        context_before=[turn], context_after=[],
        notebook=None, turn_index=6, total_turns=11,
    )
    assert detail.context_before[0].role == "tutor"
```

- [ ] **Step 2: Run it; expect import failure**

Run: `cd server/python && uv run pytest tests/test_summaries_schemas.py -v`
Expected: FAIL — `ImportError`.

- [ ] **Step 3: Append the schemas to `schemas.py`**

Add at the end of `server/python/schemas.py`:

```python
# ──────────────────────────────────────────────────────────────────────────
# Summaries page (Phase 1) — single-label master-detail UI
# See docs/superpowers/specs/2026-05-14-summaries-page-revamp-design.md
# ──────────────────────────────────────────────────────────────────────────

from typing import List, Literal, Optional
from pydantic import BaseModel


class ConfidenceHistogramBin(BaseModel):
    range_lo: float
    range_hi: float
    count: int


class SingleLabelDetailResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    phase: str
    yes_count: int
    no_count: int
    review_count: int
    review_threshold: float
    agreement_vs_gold: Optional[float]  # null when gold set < 20 rows
    confidence_histogram: List[ConfidenceHistogramBin]


class MessageListItem(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    confidence: Optional[float]
    verdict: Optional[Literal["yes", "no", "review"]]
    applied_by: Optional[Literal["ai", "human"]]
    flagged: bool
    has_note: bool
    notebook: Optional[str]


class MessageListResponse(BaseModel):
    items: List[MessageListItem]
    total: int
    offset: int
    limit: int


class ConversationTurn(BaseModel):
    role: Literal["tutor", "student"]
    turn_index: int
    text: str


class MessageDetailResponse(BaseModel):
    chatlog_id: int
    message_index: int
    text: str
    confidence: Optional[float]
    verdict: Optional[Literal["yes", "no", "review"]]
    applied_by: Optional[Literal["ai", "human"]]
    matched_pattern: Optional[str]
    rationale: Optional[str]
    flagged: bool
    note: Optional[str]
    context_before: List[ConversationTurn]
    context_after: List[ConversationTurn]
    notebook: Optional[str]
    turn_index: int
    total_turns: int


class FlipRequest(BaseModel):
    verdict: Literal["yes", "no"]


class NoteRequest(BaseModel):
    text: str  # empty string deletes the note


class LabelUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    review_threshold: Optional[float] = None
```

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_summaries_schemas.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/schemas.py server/python/tests/test_summaries_schemas.py
git commit -m "feat(schemas): add single-label summaries Phase 1 request/response models"
```

---

### Task 5: `GET /api/single-labels/:id` — label detail endpoint

**Files:**
- Modify: `server/python/main.py` (add new route handler)
- Create: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_single_labels.py`:

```python
from sqlmodel import Session
from fastapi.testclient import TestClient
from models import LabelDefinition, LabelApplication


def _seed_label_with_rows(session, yes=10, no=5, review=2, human_gold=25):
    label = LabelDefinition(name="self-correction", description="catches own mistake", mode="single", phase="handed_off")
    session.add(label)
    session.commit()
    session.refresh(label)

    # AI rows
    for i in range(yes):
        session.add(LabelApplication(label_id=label.id, chatlog_id=i, message_index=0, applied_by="ai", value="yes", confidence=0.85))
    for i in range(no):
        session.add(LabelApplication(label_id=label.id, chatlog_id=1000 + i, message_index=0, applied_by="ai", value="no", confidence=0.15))
    for i in range(review):
        session.add(LabelApplication(label_id=label.id, chatlog_id=2000 + i, message_index=0, applied_by="ai", value="yes", confidence=0.55))
    # Human gold rows (disjoint chatlog ids)
    for i in range(human_gold):
        session.add(LabelApplication(label_id=label.id, chatlog_id=3000 + i, message_index=0, applied_by="human", value="yes"))
    session.commit()
    return label


def test_get_label_detail_returns_counts_and_agreement(client: TestClient, test_session: Session):
    label = _seed_label_with_rows(test_session)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == label.id
    assert body["yes_count"] >= 10
    assert body["no_count"] == 5
    assert body["review_count"] == 2
    assert isinstance(body["confidence_histogram"], list)
    assert body["agreement_vs_gold"] is not None  # gold size >= 20


def test_get_label_detail_suppresses_agreement_when_gold_too_small(client: TestClient, test_session: Session):
    label = _seed_label_with_rows(test_session, human_gold=5)
    r = client.get(f"/api/single-labels/{label.id}")
    assert r.json()["agreement_vs_gold"] is None
```

**Note:** the `client` and `test_session` fixtures should already exist in `server/python/tests/conftest.py` (this is the existing in-memory SQLite pattern). If they don't or have different names, adapt — but do not introduce a new fixture pattern.

- [ ] **Step 2: Run; expect 404**

Run: `cd server/python && uv run pytest tests/test_single_labels.py -v`
Expected: FAIL — endpoint returns 404.

- [ ] **Step 3: Add the route in `main.py`**

In `server/python/main.py`, near the other `/api/handoff-summaries` / single-label routes, add:

```python
from schemas import (
    SingleLabelDetailResponse, ConfidenceHistogramBin,
    # plus existing imports
)
from sqlalchemy import func


@app.get("/api/single-labels/{label_id}", response_model=SingleLabelDetailResponse)
def get_single_label_detail(label_id: int, session: Session = Depends(get_session)):
    label = session.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="single-label not found")

    # Verdict counts: yes/no based on `value`; review = AI verdict with confidence < review_threshold
    threshold = label.review_threshold if hasattr(label, "review_threshold") else 0.7
    rows = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == label_id)
    ).all()
    yes_count = sum(1 for r in rows if r.value == "yes" and (r.applied_by == "human" or (r.confidence or 0) >= threshold))
    no_count = sum(1 for r in rows if r.value == "no" and (r.applied_by == "human" or (r.confidence or 0) >= threshold))
    review_count = sum(1 for r in rows if r.applied_by == "ai" and (r.confidence or 0) < threshold)

    # Agreement vs gold set: among human rows that have an AI snapshot, fraction where they agree
    gold = [r for r in rows if r.applied_by == "human" and r.ai_value_at_review is not None]
    if len(gold) >= 20:
        agree = sum(1 for r in gold if r.value == r.ai_value_at_review)
        agreement = agree / len(gold)
    else:
        agreement = None

    # Confidence histogram: 10 equal-width bins over [0, 1] for AI rows only
    bins = [0] * 10
    for r in rows:
        if r.applied_by == "ai" and r.confidence is not None:
            idx = min(int(r.confidence * 10), 9)
            bins[idx] += 1
    histogram = [
        ConfidenceHistogramBin(range_lo=i / 10, range_hi=(i + 1) / 10, count=bins[i])
        for i in range(10)
    ]

    return SingleLabelDetailResponse(
        id=label.id,
        name=label.name,
        description=label.description,
        phase=label.phase,
        yes_count=yes_count,
        no_count=no_count,
        review_count=review_count,
        review_threshold=threshold,
        agreement_vs_gold=agreement,
        confidence_histogram=histogram,
    )
```

**Note:** if `LabelDefinition` does not have a `review_threshold` field yet (check `models.py`), that's a separate small addition. If absent, add it to `LabelDefinition` with a default of `0.7` *and* extend `_migrate_label_definition` to add the column. This is a precondition for the Settings tab in Task 17, so if missing, do it now (commit as a small separate change before continuing).

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_single_labels.py::test_get_label_detail_returns_counts_and_agreement tests/test_single_labels.py::test_get_label_detail_suppresses_agreement_when_gold_too_small -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): GET /api/single-labels/:id returns detail + counts + agreement"
```

---

### Task 6: `GET /api/single-labels/:id/messages` — list with filter + sort + pagination

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Append failing tests**

Add to `tests/test_single_labels.py`:

```python
def test_list_messages_default_sort_confidence_ascending(client, test_session):
    label = _seed_label_with_rows(test_session, yes=5, no=5, review=5)
    r = client.get(f"/api/single-labels/{label.id}/messages?limit=20")
    assert r.status_code == 200
    items = r.json()["items"]
    confidences = [it["confidence"] for it in items if it["confidence"] is not None]
    assert confidences == sorted(confidences)  # ascending


def test_list_messages_filter_yes(client, test_session):
    label = _seed_label_with_rows(test_session, yes=5, no=5, review=5)
    r = client.get(f"/api/single-labels/{label.id}/messages?filter=yes&limit=20")
    items = r.json()["items"]
    assert all(it["verdict"] == "yes" for it in items)


def test_list_messages_pagination(client, test_session):
    label = _seed_label_with_rows(test_session, yes=30, no=0, review=0, human_gold=0)
    r = client.get(f"/api/single-labels/{label.id}/messages?offset=10&limit=10")
    body = r.json()
    assert body["total"] >= 30
    assert body["offset"] == 10
    assert body["limit"] == 10
    assert len(body["items"]) == 10


def test_list_messages_search_substring(client, test_session):
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)
    from models import MessageCache
    test_session.add(MessageCache(chatlog_id=1, message_index=0, text="wait, I misread"))
    test_session.add(MessageCache(chatlog_id=2, message_index=0, text="can you help"))
    test_session.add(LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, applied_by="ai", value="yes", confidence=0.6))
    test_session.add(LabelApplication(label_id=label.id, chatlog_id=2, message_index=0, applied_by="ai", value="no", confidence=0.2))
    test_session.commit()
    r = client.get(f"/api/single-labels/{label.id}/messages?search=misread")
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["chatlog_id"] == 1
```

- [ ] **Step 2: Run; expect 404 or empty**

Run: `cd server/python && uv run pytest tests/test_single_labels.py -k list_messages -v`
Expected: FAIL.

- [ ] **Step 3: Add the route**

In `server/python/main.py`:

```python
from schemas import MessageListResponse, MessageListItem
from typing import Optional


@app.get("/api/single-labels/{label_id}/messages", response_model=MessageListResponse)
def list_messages(
    label_id: int,
    filter: Optional[str] = None,         # "yes" | "no" | "review" | "flagged" | "notes" | "pattern=<excerpt>"
    sort: str = "confidence_asc",         # "confidence_asc" | "confidence_desc" | "recently_flipped"
    search: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
    session: Session = Depends(get_session),
):
    label = session.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="single-label not found")

    threshold = getattr(label, "review_threshold", 0.7)

    # Bucket-classifying SQL expression used by filter=review
    def is_review(row: LabelApplication) -> bool:
        return row.applied_by == "ai" and (row.confidence or 0) < threshold

    # Join LabelApplication x MessageCache for text + notebook
    q = (
        select(LabelApplication, MessageCache)
        .join(MessageCache, (MessageCache.chatlog_id == LabelApplication.chatlog_id) & (MessageCache.message_index == LabelApplication.message_index))
        .where(LabelApplication.label_id == label_id)
    )
    if search:
        q = q.where(MessageCache.text.ilike(f"%{search}%"))

    rows = session.exec(q).all()

    # Apply filter
    if filter == "yes":
        rows = [r for r in rows if r[0].value == "yes" and not is_review(r[0])]
    elif filter == "no":
        rows = [r for r in rows if r[0].value == "no" and not is_review(r[0])]
    elif filter == "review":
        rows = [r for r in rows if is_review(r[0])]
    elif filter == "flagged":
        rows = [r for r in rows if r[0].flagged]
    elif filter == "notes":
        rows = [r for r in rows if r[0].note]
    elif filter and filter.startswith("pattern="):
        pat = filter[len("pattern="):]
        rows = [r for r in rows if r[0].matched_pattern == pat]

    # Sort
    if sort == "confidence_asc":
        rows.sort(key=lambda r: (r[0].confidence is None, r[0].confidence or 0))
    elif sort == "confidence_desc":
        rows.sort(key=lambda r: (r[0].confidence is None, -(r[0].confidence or 0)))
    elif sort == "recently_flipped":
        rows.sort(key=lambda r: r[0].created_at or datetime.min, reverse=True)

    total = len(rows)
    page = rows[offset : offset + limit]

    items = []
    for app, msg in page:
        verdict_bucket = "review" if is_review(app) else app.value
        items.append(
            MessageListItem(
                chatlog_id=app.chatlog_id,
                message_index=app.message_index,
                text=msg.text,
                confidence=app.confidence,
                verdict=verdict_bucket,
                applied_by=app.applied_by,
                flagged=app.flagged,
                has_note=bool(app.note),
                notebook=msg.notebook,
            )
        )

    return MessageListResponse(items=items, total=total, offset=offset, limit=limit)
```

- [ ] **Step 4: Run tests**

Run: `cd server/python && uv run pytest tests/test_single_labels.py -k list_messages -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): GET messages with filter/sort/search/pagination"
```

---

### Task 7: `GET /api/single-labels/:id/messages/:msg_id` — message detail with conversation context

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Append failing test**

Add to `tests/test_single_labels.py`:

```python
def test_message_detail_returns_focused_message_and_surrounding_turns(client, test_session, monkeypatch):
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)

    from models import MessageCache
    test_session.add(MessageCache(chatlog_id=42, message_index=0, text="focused student message"))
    test_session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.58,
        matched_pattern="questioning own work",
        rationale="Student explicitly recognizes a misread.",
    ))
    test_session.commit()

    # Stub the external-DB conversation fetcher to return ±1 tutor turn
    def fake_fetch_conversation(chatlog_id):
        return [
            {"role": "tutor", "turn_index": 5, "text": "Try aggfunc='median' instead."},
            {"role": "student", "turn_index": 6, "text": "focused student message"},
            {"role": "tutor", "turn_index": 7, "text": "Great — re-run and check."},
        ]
    monkeypatch.setattr("main.fetch_conversation_turns", fake_fetch_conversation)

    r = client.get(f"/api/single-labels/{label.id}/messages/42?context=1")
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "focused student message"
    assert body["matched_pattern"] == "questioning own work"
    assert len(body["context_before"]) == 1
    assert body["context_before"][0]["role"] == "tutor"
    assert len(body["context_after"]) == 1
    assert body["context_after"][0]["text"].startswith("Great")
```

- [ ] **Step 2: Run; expect 404**

Run: `cd server/python && uv run pytest tests/test_single_labels.py::test_message_detail_returns_focused_message_and_surrounding_turns -v`
Expected: FAIL.

- [ ] **Step 3: Add a `fetch_conversation_turns` helper and the endpoint**

In `server/python/main.py`, add (or extend) a helper that hits the external `events` table. If a similar helper already exists for QueuePage, reuse it; otherwise add:

```python
def fetch_conversation_turns(chatlog_id: int) -> list[dict]:
    """Return the full conversation thread for a chatlog as a list of
    {role, turn_index, text} dicts, ordered by event id."""
    with ext_engine.connect() as conn:
        from sqlalchemy import text
        rows = conn.execute(text("""
            SELECT id, event_type, payload
            FROM events
            WHERE (payload->>'conversation_id')::int IN (
                SELECT (payload->>'conversation_id')::int
                FROM events
                WHERE id = :id
                LIMIT 1
            )
            ORDER BY id
        """), {"id": chatlog_id}).fetchall()
    turns = []
    idx = 0
    for r in rows:
        payload = json.loads(r.payload) if isinstance(r.payload, str) else r.payload
        if r.event_type == "tutor_query":
            text_val = payload.get("question")
            role = "student"
        elif r.event_type == "tutor_response":
            text_val = payload.get("response")
            role = "tutor"
        else:
            continue
        if text_val:
            turns.append({"role": role, "turn_index": idx, "text": text_val})
            idx += 1
    return turns
```

**Note for implementer:** check if there's an existing helper in `main.py` or another module (likely the QueuePage uses one). If yes, reuse it. If the shape differs, write a thin adapter rather than duplicating the SQL.

Then add the endpoint:

```python
from schemas import MessageDetailResponse, ConversationTurn


@app.get("/api/single-labels/{label_id}/messages/{chatlog_id}", response_model=MessageDetailResponse)
def get_message_detail(
    label_id: int,
    chatlog_id: int,
    message_index: int = 0,
    context: str = "1",  # "1" | "2" | "3" | "full"
    session: Session = Depends(get_session),
):
    label = session.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="single-label not found")

    app_row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id)
        .where(LabelApplication.chatlog_id == chatlog_id)
        .where(LabelApplication.message_index == message_index)
    ).first()
    if not app_row:
        raise HTTPException(status_code=404, detail="no application row for that message")

    msg = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .where(MessageCache.message_index == message_index)
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="message not in cache")

    turns = fetch_conversation_turns(chatlog_id)
    # Find the focused turn by matching text + turn order
    focused_idx = next(
        (i for i, t in enumerate(turns) if t["role"] == "student" and t["text"] == msg.text),
        None,
    )
    if focused_idx is None:
        # Fall back: trust the message_index from the cache
        focused_idx = next((i for i, t in enumerate(turns) if t["role"] == "student"), 0)

    if context == "full":
        depth = len(turns)
    else:
        depth = int(context)
    before = [
        ConversationTurn(**t) for t in turns[max(0, focused_idx - depth):focused_idx]
        if t["role"] == "tutor"
    ]
    after = [
        ConversationTurn(**t) for t in turns[focused_idx + 1:focused_idx + 1 + depth]
        if t["role"] == "tutor"
    ]

    threshold = getattr(label, "review_threshold", 0.7)
    is_review = app_row.applied_by == "ai" and (app_row.confidence or 0) < threshold

    return MessageDetailResponse(
        chatlog_id=chatlog_id,
        message_index=message_index,
        text=msg.text,
        confidence=app_row.confidence,
        verdict="review" if is_review else app_row.value,
        applied_by=app_row.applied_by,
        matched_pattern=app_row.matched_pattern,
        rationale=app_row.rationale,
        flagged=app_row.flagged,
        note=app_row.note,
        context_before=before,
        context_after=after,
        notebook=msg.notebook,
        turn_index=focused_idx,
        total_turns=len(turns),
    )
```

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_single_labels.py::test_message_detail_returns_focused_message_and_surrounding_turns -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): GET message detail with ±N conversation context"
```

---

### Task 8: `PATCH /api/single-labels/:id/applications/:msg_id` — flip a verdict

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Append failing test**

```python
def test_flip_verdict_sets_applied_by_human_and_snapshots_ai(client, test_session):
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)
    test_session.add(LabelApplication(
        label_id=label.id, chatlog_id=42, message_index=0,
        applied_by="ai", value="yes", confidence=0.58,
    ))
    test_session.commit()

    r = client.patch(
        f"/api/single-labels/{label.id}/applications/42",
        params={"message_index": 0},
        json={"verdict": "no"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "no"
    assert body["applied_by"] == "human"

    # The AI snapshot is preserved
    from models import LabelApplication
    row = test_session.exec(
        select(LabelApplication).where(LabelApplication.chatlog_id == 42)
    ).one()
    assert row.ai_value_at_review == "yes"
    assert row.ai_confidence_at_review == 0.58
    assert row.value == "no"
    assert row.applied_by == "human"
```

- [ ] **Step 2: Run; expect 404**

- [ ] **Step 3: Add the endpoint**

```python
@app.patch("/api/single-labels/{label_id}/applications/{chatlog_id}", response_model=MessageListItem)
def flip_verdict(
    label_id: int,
    chatlog_id: int,
    body: FlipRequest,
    message_index: int = 0,
    session: Session = Depends(get_session),
):
    app_row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id)
        .where(LabelApplication.chatlog_id == chatlog_id)
        .where(LabelApplication.message_index == message_index)
    ).first()
    if not app_row:
        raise HTTPException(status_code=404, detail="no application row")

    # Snapshot the AI verdict if this is the first human override
    if app_row.applied_by == "ai" and app_row.ai_value_at_review is None:
        app_row.ai_value_at_review = app_row.value
        app_row.ai_confidence_at_review = app_row.confidence

    app_row.value = body.verdict
    app_row.applied_by = "human"
    session.add(app_row)
    session.commit()
    session.refresh(app_row)

    msg = session.exec(
        select(MessageCache)
        .where(MessageCache.chatlog_id == chatlog_id)
        .where(MessageCache.message_index == message_index)
    ).first()

    return MessageListItem(
        chatlog_id=chatlog_id,
        message_index=message_index,
        text=msg.text if msg else "",
        confidence=app_row.confidence,
        verdict=app_row.value,
        applied_by=app_row.applied_by,
        flagged=app_row.flagged,
        has_note=bool(app_row.note),
        notebook=msg.notebook if msg else None,
    )
```

- [ ] **Step 4: Run the test**

Run: `cd server/python && uv run pytest tests/test_single_labels.py::test_flip_verdict_sets_applied_by_human_and_snapshots_ai -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): PATCH applications/:msg flips verdict + snapshots AI value"
```

---

### Task 9: `PUT /api/single-labels/:id/applications/:msg_id/note`

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Failing test**

```python
def test_upsert_note_and_clear_note(client, test_session):
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)
    test_session.add(LabelApplication(label_id=label.id, chatlog_id=42, message_index=0, applied_by="ai", value="yes", confidence=0.5))
    test_session.commit()

    r = client.put(f"/api/single-labels/{label.id}/applications/42/note", params={"message_index": 0}, json={"text": "not really self-correction"})
    assert r.status_code == 200
    from models import LabelApplication
    row = test_session.exec(select(LabelApplication).where(LabelApplication.chatlog_id == 42)).one()
    assert row.note == "not really self-correction"

    # Empty string clears
    client.put(f"/api/single-labels/{label.id}/applications/42/note", params={"message_index": 0}, json={"text": ""})
    test_session.expire(row)
    row = test_session.exec(select(LabelApplication).where(LabelApplication.chatlog_id == 42)).one()
    assert row.note is None
```

- [ ] **Step 2: Run; expect 404**

- [ ] **Step 3: Add the endpoint**

```python
@app.put("/api/single-labels/{label_id}/applications/{chatlog_id}/note")
def upsert_note(
    label_id: int,
    chatlog_id: int,
    body: NoteRequest,
    message_index: int = 0,
    session: Session = Depends(get_session),
):
    app_row = session.exec(
        select(LabelApplication)
        .where(LabelApplication.label_id == label_id)
        .where(LabelApplication.chatlog_id == chatlog_id)
        .where(LabelApplication.message_index == message_index)
    ).first()
    if not app_row:
        raise HTTPException(status_code=404, detail="no application row")
    app_row.note = body.text or None
    session.add(app_row)
    session.commit()
    return {"ok": True}
```

- [ ] **Step 4: Run**

Run: `cd server/python && uv run pytest tests/test_single_labels.py::test_upsert_note_and_clear_note -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): PUT applications/:msg/note upserts per-message notes"
```

---

### Task 10: `PATCH /api/single-labels/:id` and `DELETE /api/single-labels/:id`

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_single_labels.py`

- [ ] **Step 1: Failing tests**

```python
def test_patch_label_updates_name_description_threshold(client, test_session):
    label = LabelDefinition(name="old", description=None, mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)
    r = client.patch(f"/api/single-labels/{label.id}", json={"name": "new", "description": "d", "review_threshold": 0.6})
    assert r.status_code == 200
    test_session.expire_all()
    refreshed = test_session.get(LabelDefinition, label.id)
    assert refreshed.name == "new"
    assert refreshed.description == "d"
    assert refreshed.review_threshold == 0.6


def test_delete_label_archives_or_removes_and_orphans_messages(client, test_session):
    label = LabelDefinition(name="x", mode="single", phase="handed_off")
    test_session.add(label); test_session.commit(); test_session.refresh(label)
    test_session.add(LabelApplication(label_id=label.id, chatlog_id=1, message_index=0, applied_by="ai", value="yes", confidence=0.5))
    test_session.commit()

    r = client.delete(f"/api/single-labels/{label.id}")
    assert r.status_code == 200
    # Existing archive behavior: label is archived (archived_at set) OR removed; applications are detached
    test_session.expire_all()
    refreshed = test_session.get(LabelDefinition, label.id)
    assert refreshed is None or refreshed.archived_at is not None
```

- [ ] **Step 2: Run; expect 404**

- [ ] **Step 3: Add the endpoints**

```python
@app.patch("/api/single-labels/{label_id}", response_model=SingleLabelDetailResponse)
def patch_label(label_id: int, body: LabelUpdateRequest, session: Session = Depends(get_session)):
    label = session.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="single-label not found")
    if body.name is not None:
        label.name = body.name
    if body.description is not None:
        label.description = body.description
    if body.review_threshold is not None:
        label.review_threshold = body.review_threshold
    session.add(label)
    session.commit()
    # Reuse get_single_label_detail to compute the response
    return get_single_label_detail(label_id, session=session)


@app.delete("/api/single-labels/{label_id}")
def delete_label(label_id: int, session: Session = Depends(get_session)):
    """Reuses the existing label archive path so deletion semantics match the
    multi-label flow (orphaned messages return to the unlabeled pool)."""
    label = session.get(LabelDefinition, label_id)
    if not label or label.mode != "single":
        raise HTTPException(status_code=404, detail="single-label not found")
    label.archived_at = datetime.utcnow()
    session.add(label)
    session.commit()
    return {"ok": True}
```

- [ ] **Step 4: Run the tests**

Run: `cd server/python && uv run pytest tests/test_single_labels.py -k "patch_label or delete_label" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py server/python/tests/test_single_labels.py
git commit -m "feat(single-labels): PATCH + DELETE endpoints for single-label CRUD"
```

---

## Section B — Frontend Scaffolding

### Task 11: Add `react-window` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install react-window @types/react-window`

- [ ] **Step 2: Verify**

Run: `npm test -- --run` (smoke check that nothing broke; tests should still pass)
Expected: same test outcomes as before.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add react-window for Summaries message-list virtualization"
```

---

### Task 12: Add TypeScript types for new API shapes

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Append types**

Add at the end of `src/types/index.ts`:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Summaries page (Phase 1) — single-label master-detail UI
// ──────────────────────────────────────────────────────────────────────────

export interface ConfidenceHistogramBin {
  range_lo: number
  range_hi: number
  count: number
}

export interface SingleLabelDetail {
  id: number
  name: string
  description: string | null
  phase: string
  yes_count: number
  no_count: number
  review_count: number
  review_threshold: number
  agreement_vs_gold: number | null
  confidence_histogram: ConfidenceHistogramBin[]
}

export type MessageVerdict = 'yes' | 'no' | 'review'

export interface MessageListItem {
  chatlog_id: number
  message_index: number
  text: string
  confidence: number | null
  verdict: MessageVerdict | null
  applied_by: 'ai' | 'human' | null
  flagged: boolean
  has_note: boolean
  notebook: string | null
}

export interface MessageListResponse {
  items: MessageListItem[]
  total: number
  offset: number
  limit: number
}

export interface ConversationTurn {
  role: 'tutor' | 'student'
  turn_index: number
  text: string
}

export interface MessageDetail {
  chatlog_id: number
  message_index: number
  text: string
  confidence: number | null
  verdict: MessageVerdict | null
  applied_by: 'ai' | 'human' | null
  matched_pattern: string | null
  rationale: string | null
  flagged: boolean
  note: string | null
  context_before: ConversationTurn[]
  context_after: ConversationTurn[]
  notebook: string | null
  turn_index: number
  total_turns: number
}

export type ContextDepth = '1' | '2' | '3' | 'full'

export type BrowseSort = 'confidence_asc' | 'confidence_desc' | 'recently_flipped'
export type BrowseFilter = 'all' | 'yes' | 'no' | 'review' | 'flagged' | 'notes' | `pattern=${string}`
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add Summaries Phase 1 API types"
```

---

### Task 13: Add API helpers in `services/api.ts`

**Files:**
- Modify: `src/services/api.ts`

- [ ] **Step 1: Append helpers**

Inside the `api` object in `src/services/api.ts`, add:

```ts
  // ── Single-label summaries (Phase 1) ────────────────────────────────────
  getSingleLabelDetail: (id: number): Promise<SingleLabelDetail> =>
    req(`/api/single-labels/${id}`),

  listSingleLabelMessages: (
    id: number,
    opts: { filter?: string; sort?: string; search?: string; offset?: number; limit?: number } = {},
  ): Promise<MessageListResponse> => {
    const params = new URLSearchParams()
    if (opts.filter) params.set('filter', opts.filter)
    if (opts.sort) params.set('sort', opts.sort)
    if (opts.search) params.set('search', opts.search)
    if (opts.offset !== undefined) params.set('offset', String(opts.offset))
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return req(`/api/single-labels/${id}/messages${qs ? '?' + qs : ''}`)
  },

  getSingleLabelMessageDetail: (
    id: number,
    chatlog_id: number,
    message_index: number,
    context: '1' | '2' | '3' | 'full' = '1',
  ): Promise<MessageDetail> =>
    req(`/api/single-labels/${id}/messages/${chatlog_id}?message_index=${message_index}&context=${context}`),

  flipSingleLabelVerdict: (
    id: number,
    chatlog_id: number,
    message_index: number,
    verdict: 'yes' | 'no',
  ): Promise<MessageListItem> =>
    req(`/api/single-labels/${id}/applications/${chatlog_id}?message_index=${message_index}`, {
      method: 'PATCH',
      body: JSON.stringify({ verdict }),
    }),

  upsertSingleLabelNote: (
    id: number,
    chatlog_id: number,
    message_index: number,
    text: string,
  ): Promise<{ ok: true }> =>
    req(`/api/single-labels/${id}/applications/${chatlog_id}/note?message_index=${message_index}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  patchSingleLabel: (
    id: number,
    patch: { name?: string; description?: string; review_threshold?: number },
  ): Promise<SingleLabelDetail> =>
    req(`/api/single-labels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteSingleLabel: (id: number): Promise<{ ok: true }> =>
    req(`/api/single-labels/${id}`, { method: 'DELETE' }),
```

Also at the top of the file, extend the imports if needed:

```ts
import type {
  // ...existing
  SingleLabelDetail, MessageListResponse, MessageListItem, MessageDetail,
} from '../types'
```

**Note on mock mode:** the existing `services/api.ts` has a mock-mode branch. For Phase 1 it's acceptable to leave new helpers without mock implementations (the new UI will only render meaningfully against a live backend). If you want mock data, add stubbed responses inside the `useMock` branch at the top of each helper.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/api.ts
git commit -m "feat(api): add Summaries Phase 1 single-label endpoints"
```

---

### Task 14: Refactor `SummariesPage.tsx` to mode-branch

**Files:**
- Modify: `src/pages/SummariesPage.tsx`
- Create: `src/pages/summaries/SummariesPageMulti.tsx`
- Create: `src/pages/summaries/SummariesPageSingle.tsx`

- [ ] **Step 1: Move today's component into `SummariesPageMulti.tsx`**

Create `src/pages/summaries/SummariesPageMulti.tsx`. Move the entire current contents of `SummariesPage.tsx` into it — rename the exported component from `SummariesPage` to `SummariesPageMulti`. Keep all helpers (`batchStateLabel`, `parseUtcIso`, etc.) in this file.

- [ ] **Step 2: Create the empty single shell**

Create `src/pages/summaries/SummariesPageSingle.tsx`:

```tsx
export function SummariesPageSingle() {
  return (
    <div className="flex-1 overflow-auto bg-canvas">
      <div className="max-w-[960px] mx-auto px-12 py-12 text-on-canvas">
        <h1 className="font-serif font-medium text-[32px] text-paper tracking-[-0.018em] m-0 mb-2">
          Summaries
        </h1>
        <p className="font-serif text-on-surface text-[14px]">
          Single-label revamp coming online…
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `SummariesPage.tsx` as the mode-branch**

Replace the contents of `src/pages/SummariesPage.tsx` with:

```tsx
import { useMode } from '../hooks/useMode'
import { SummariesPageMulti } from './summaries/SummariesPageMulti'
import { SummariesPageSingle } from './summaries/SummariesPageSingle'

export function SummariesPage() {
  const { mode } = useMode()
  return mode === 'single' ? <SummariesPageSingle /> : <SummariesPageMulti />
}
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test -- --run src/tests/SummariesPage.test.tsx`
Expected: existing batch-state tests pass (multi-label mode is the default in tests; if they don't set mode, they get the multi component).

If a test fails because it depends on multi-label behavior being the default — wrap the test render in a mode-setter:

```tsx
import { ModeProvider } from '../hooks/useMode'
// in test setup:
render(<ModeProvider initialMode="multi"><SummariesPage /></ModeProvider>)
```

(Check `useMode.ts` for the actual provider name and props.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/SummariesPage.tsx src/pages/summaries/SummariesPageMulti.tsx src/pages/summaries/SummariesPageSingle.tsx
git commit -m "refactor(summaries): mode-branch SummariesPage; keep multi-label behavior intact"
```

---

## Section C — Frontend: Rail and Header

### Task 15: Build `LabelRail`

**Files:**
- Create: `src/components/summaries/LabelRail.tsx`
- Modify: `src/pages/summaries/SummariesPageSingle.tsx`
- Create: `src/tests/summaries/LabelRail.test.tsx`

**Note on data source:** For Phase 1 the rail is populated from the existing `api.listHandoffSummaries()` helper — every classified single-label appears there with the fields we need (`label_id`, `label_name`, `description`, `phase`, counts, batch state). No new API helper is required for this task.

- [ ] **Step 1: Write the failing test**

Create `src/tests/summaries/LabelRail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { LabelRail } from '../../components/summaries/LabelRail'
import type { HandoffSummaryItem } from '../../types'

const items: HandoffSummaryItem[] = [
  // minimum-valid mock — fill in any required fields with defaults; refer to
  // src/types/index.ts for the HandoffSummaryItem shape.
  { label_id: 1, label_name: 'self-correction', description: 'catches mistakes', phase: 'handed_off',
    yes_count: 1142, no_count: 803, review_count: 91, review_threshold: 0.7,
    included: [], excluded: [], classified_count: null, classification_total: null,
    error: null, error_kind: null, batch_state: null, batch_submitted_at: null,
    batch_polled_at: null, batch_total_count: null, batch_completed_count: null },
  { label_id: 2, label_name: 'validation', description: null, phase: 'classifying',
    yes_count: 0, no_count: 0, review_count: 0, review_threshold: 0.7,
    included: [], excluded: [], classified_count: 4000, classification_total: 17416,
    error: null, error_kind: null, batch_state: 'JOB_STATE_RUNNING',
    batch_submitted_at: new Date().toISOString(), batch_polled_at: new Date().toISOString(),
    batch_total_count: null, batch_completed_count: null },
]

test('renders one row per label with the active id highlighted', () => {
  const onSelect = vi.fn()
  render(<LabelRail items={items} activeId={1} onSelect={onSelect} />)
  expect(screen.getByText('self-correction')).toBeInTheDocument()
  expect(screen.getByText('validation')).toBeInTheDocument()
  // Active row exposes data-active for test consumption
  expect(screen.getByTestId('rail-row-1')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('rail-row-2')).toHaveAttribute('data-active', 'false')
})

test('clicking a row calls onSelect with the label id', async () => {
  const onSelect = vi.fn()
  render(<LabelRail items={items} activeId={1} onSelect={onSelect} />)
  screen.getByText('validation').click()
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('classifying labels show a progress subtitle', () => {
  const onSelect = vi.fn()
  render(<LabelRail items={items} activeId={2} onSelect={onSelect} />)
  expect(screen.getByTestId('rail-row-2').textContent ?? '').toMatch(/running|%/i)
})
```

- [ ] **Step 2: Run; expect failure**

Run: `npm test -- --run src/tests/summaries/LabelRail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LabelRail`**

Create `src/components/summaries/LabelRail.tsx`:

```tsx
import type { HandoffSummaryItem } from '../../types'

interface LabelRailProps {
  items: HandoffSummaryItem[]
  activeId: number | null
  onSelect: (id: number) => void
}

function statusKind(item: HandoffSummaryItem): 'done' | 'classifying' | 'failed' | 'archived' {
  if (item.phase === 'classifying') return 'classifying'
  if (item.phase === 'failed') return 'failed'
  if (item.phase === 'archived') return 'archived'
  return 'done'
}

function subtitle(item: HandoffSummaryItem): string {
  if (item.phase === 'classifying') {
    const pct = item.classification_total
      ? Math.round(((item.classified_count ?? 0) / item.classification_total) * 100)
      : null
    return pct !== null ? `${pct}% · running` : 'running'
  }
  if (item.phase === 'failed') {
    return item.error_kind === 'rate_limited' ? '⏱ rate-limited' : '✕ failed'
  }
  const total = item.yes_count + item.no_count + item.review_count
  return `${total} · ${item.review_count} in review`
}

export function LabelRail({ items, activeId, onSelect }: LabelRailProps) {
  return (
    <aside className="w-[220px] shrink-0 border-r border-edge bg-canvas overflow-y-auto p-3">
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-faint mb-2 px-1.5">
        Labels · {items.length}
      </div>
      {items.map((item) => {
        const isActive = item.label_id === activeId
        const kind = statusKind(item)
        return (
          <button
            key={item.label_id}
            data-testid={`rail-row-${item.label_id}`}
            data-active={String(isActive)}
            onClick={() => onSelect(item.label_id)}
            className={`w-full text-left p-2.5 rounded-md mb-0.5 transition-colors ${
              isActive ? 'bg-elevated' : 'hover:bg-surface'
            }`}
          >
            <div className="text-paper text-[13px] flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full inline-block ${
                  kind === 'classifying' ? 'bg-ochre animate-pulse'
                  : kind === 'failed' ? 'bg-brick'
                  : kind === 'archived' ? 'bg-stone'
                  : 'bg-moss'
                }`}
              />
              {item.label_name}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">{subtitle(item)}</div>
          </button>
        )
      })}
    </aside>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- --run src/tests/summaries/LabelRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into `SummariesPageSingle`**

Update `src/pages/summaries/SummariesPageSingle.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { LabelRail } from '../../components/summaries/LabelRail'
import { api } from '../../services/api'
import type { HandoffSummaryItem } from '../../types'

export function SummariesPageSingle() {
  const [items, setItems] = useState<HandoffSummaryItem[]>([])
  const [activeId, setActiveId] = useState<number | null>(
    () => Number(localStorage.getItem('summaries.active_label_id')) || null,
  )

  useEffect(() => {
    api.listHandoffSummaries().then(setItems)
  }, [])

  useEffect(() => {
    if (activeId !== null) localStorage.setItem('summaries.active_label_id', String(activeId))
  }, [activeId])

  return (
    <div className="flex-1 flex bg-canvas min-h-0">
      <LabelRail items={items} activeId={activeId} onSelect={setActiveId} />
      <div className="flex-1 flex flex-col min-w-0 items-center justify-center text-muted">
        {activeId ? `selected label ${activeId}` : 'select a label to begin'}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/summaries/LabelRail.tsx src/pages/summaries/SummariesPageSingle.tsx src/tests/summaries/LabelRail.test.tsx
git commit -m "feat(summaries): LabelRail + active-label state in single-mode shell"
```

---

### Task 16: Build `DetailHeader` (title, ⋯ menu, stats, tabs)

**Files:**
- Create: `src/components/summaries/DetailHeader.tsx`
- Create: `src/tests/summaries/DetailHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/summaries/DetailHeader.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { DetailHeader } from '../../components/summaries/DetailHeader'
import type { SingleLabelDetail } from '../../types'

const detail: SingleLabelDetail = {
  id: 1, name: 'self-correction', description: 'catches mistakes', phase: 'handed_off',
  yes_count: 1142, no_count: 803, review_count: 91, review_threshold: 0.7,
  agreement_vs_gold: 0.87,
  confidence_histogram: Array.from({ length: 10 }, (_, i) => ({ range_lo: i / 10, range_hi: (i + 1) / 10, count: i * 10 })),
}

test('renders title, description, and verdict counts', () => {
  const onTabChange = vi.fn()
  render(<DetailHeader detail={detail} activeTab="browse" onTabChange={onTabChange} onMenuAction={vi.fn()} />)
  expect(screen.getByText('self-correction')).toBeInTheDocument()
  expect(screen.getByText(/catches mistakes/)).toBeInTheDocument()
  expect(screen.getByText('1142')).toBeInTheDocument()
  expect(screen.getByText('803')).toBeInTheDocument()
  expect(screen.getByText('91')).toBeInTheDocument()
})

test('tab strip emits onTabChange on click', () => {
  const onTabChange = vi.fn()
  render(<DetailHeader detail={detail} activeTab="browse" onTabChange={onTabChange} onMenuAction={vi.fn()} />)
  fireEvent.click(screen.getByText(/^Settings$/i))
  expect(onTabChange).toHaveBeenCalledWith('settings')
})

test('agreement metric is shown when present and suppressed when null', () => {
  const { rerender } = render(
    <DetailHeader detail={detail} activeTab="browse" onTabChange={vi.fn()} onMenuAction={vi.fn()} />,
  )
  expect(screen.getByTitle(/agreement/i)).toBeInTheDocument()
  rerender(
    <DetailHeader detail={{ ...detail, agreement_vs_gold: null }} activeTab="browse" onTabChange={vi.fn()} onMenuAction={vi.fn()} />,
  )
  expect(screen.queryByTitle(/agreement/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement `DetailHeader`**

Create `src/components/summaries/DetailHeader.tsx`:

```tsx
import type { SingleLabelDetail } from '../../types'

export type SummariesTab = 'browse' | 'settings'  // Phase 1 ships two tabs

interface DetailHeaderProps {
  detail: SingleLabelDetail
  activeTab: SummariesTab
  onTabChange: (tab: SummariesTab) => void
  onMenuAction: (action: 'rename' | 'edit' | 'rehandoff' | 'delete') => void
}

export function DetailHeader({ detail, activeTab, onTabChange, onMenuAction }: DetailHeaderProps) {
  const agreementTitle =
    detail.agreement_vs_gold !== null
      ? `Confidence distribution · agreement vs gold set: ${Math.round(detail.agreement_vs_gold * 100)}%`
      : undefined

  return (
    <div className="border-b border-edge px-7 pt-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-serif font-medium text-[26px] text-paper tracking-[-0.012em] truncate">{detail.name}</div>
          {detail.description && (
            <div className="font-serif italic text-[13px] text-muted mt-0.5 truncate">{detail.description}</div>
          )}
        </div>
        <details className="relative">
          <summary className="list-none cursor-pointer font-mono text-[10.5px] tracking-[0.12em] uppercase text-muted border border-edge rounded-sm px-2 py-1 hover:text-paper">⋯</summary>
          <div className="absolute right-0 mt-1 bg-canvas border border-edge rounded-sm shadow-lg p-1 z-10 w-48 font-mono text-[11px] tracking-[0.08em] uppercase">
            <button onClick={() => onMenuAction('rename')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Rename</button>
            <button onClick={() => onMenuAction('edit')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Edit description</button>
            <button onClick={() => onMenuAction('rehandoff')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Re-handoff</button>
            <button onClick={() => onMenuAction('delete')} className="block w-full text-left px-3 py-1.5 hover:bg-surface text-brick">Delete</button>
          </div>
        </details>
      </div>

      <div className="flex items-center gap-6 py-3.5 font-mono text-[11px]">
        <span><span className="text-moss text-[14px]">{detail.yes_count}</span> <span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">yes</span></span>
        <span><span className="text-brick text-[14px]">{detail.no_count}</span> <span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">no</span></span>
        <span><span className="text-ochre text-[14px]">{detail.review_count}</span> <span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">review</span></span>
        {agreementTitle && (
          <span title={agreementTitle} className="text-faint cursor-help">ⓘ</span>
        )}
      </div>

      <div className="flex gap-0 -mb-px">
        {(['browse', 'settings'] as SummariesTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`py-3 mr-6 font-mono text-[11px] tracking-[0.14em] uppercase border-b-2 ${
              activeTab === tab ? 'text-paper border-ochre' : 'text-muted border-transparent hover:text-on-canvas'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run src/tests/summaries/DetailHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/DetailHeader.tsx src/tests/summaries/DetailHeader.test.tsx
git commit -m "feat(summaries): DetailHeader with stats strip, ⋯ menu, tab strip"
```

---

## Section D — Browse tab

### Task 17: Build `FilterBar`

**Files:**
- Create: `src/components/summaries/FilterBar.tsx`
- Create: `src/tests/summaries/FilterBar.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/tests/summaries/FilterBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { FilterBar } from '../../components/summaries/FilterBar'

test('renders the four essential chips + "+ more"', () => {
  render(<FilterBar filter="all" sort="confidence_asc" search="" onChange={vi.fn()} />)
  expect(screen.getByText('All')).toBeInTheDocument()
  expect(screen.getByText('YES')).toBeInTheDocument()
  expect(screen.getByText('NO')).toBeInTheDocument()
  expect(screen.getByText('Review')).toBeInTheDocument()
  expect(screen.getByText(/\+ more/i)).toBeInTheDocument()
})

test('clicking YES chip emits onChange with filter=yes', () => {
  const onChange = vi.fn()
  render(<FilterBar filter="all" sort="confidence_asc" search="" onChange={onChange} />)
  fireEvent.click(screen.getByText('YES'))
  expect(onChange).toHaveBeenCalledWith({ filter: 'yes' })
})

test('search input emits onChange with new value', () => {
  const onChange = vi.fn()
  render(<FilterBar filter="all" sort="confidence_asc" search="" onChange={onChange} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'misread' } })
  expect(onChange).toHaveBeenCalledWith({ search: 'misread' })
})
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement**

Create `src/components/summaries/FilterBar.tsx`:

```tsx
import type { BrowseFilter, BrowseSort } from '../../types'

interface FilterBarProps {
  filter: BrowseFilter
  sort: BrowseSort
  search: string
  onChange: (patch: Partial<{ filter: BrowseFilter; sort: BrowseSort; search: string }>) => void
}

const CHIPS: { id: BrowseFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'yes', label: 'YES' },
  { id: 'no', label: 'NO' },
  { id: 'review', label: 'Review' },
]

export function FilterBar({ filter, sort, search, onChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-b border-edge-subtle">
      {CHIPS.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange({ filter: c.id })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-[10px] cursor-pointer ${
            filter === c.id ? 'bg-elevated border-ochre-dim text-paper' : 'border-edge text-on-surface hover:text-paper'
          }`}
        >
          {c.label}
        </button>
      ))}
      <button className="inline-flex items-center px-2.5 py-1 rounded-full border border-edge border-dashed font-mono text-[10px] text-muted hover:text-paper">
        + more
      </button>
      <input
        type="text"
        placeholder="search messages…"
        value={search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-paper font-serif italic text-[13px] px-1.5"
      />
      <select
        value={sort}
        onChange={(e) => onChange({ sort: e.target.value as BrowseSort })}
        className="font-mono text-[10px] text-muted bg-canvas border border-edge rounded-sm px-1.5 py-1"
      >
        <option value="confidence_asc">conf ↑</option>
        <option value="confidence_desc">conf ↓</option>
        <option value="recently_flipped">recent flips</option>
      </select>
    </div>
  )
}
```

- [ ] **Step 4: Run**

Run: `npm test -- --run src/tests/summaries/FilterBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/FilterBar.tsx src/tests/summaries/FilterBar.test.tsx
git commit -m "feat(summaries): FilterBar with chips + search + sort"
```

---

### Task 18: Build `MessageListRow` and virtualized `MessageList`

**Files:**
- Create: `src/components/summaries/MessageListRow.tsx`
- Create: `src/components/summaries/MessageList.tsx`
- Create: `src/tests/summaries/MessageList.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/tests/summaries/MessageList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { MessageList } from '../../components/summaries/MessageList'
import type { MessageListItem } from '../../types'

const items: MessageListItem[] = [
  { chatlog_id: 1, message_index: 0, text: 'wait, I think I misread', confidence: 0.58, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
  { chatlog_id: 2, message_index: 0, text: 'never mind the typo on line 4', confidence: 0.78, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
]

test('renders one row per item with confidence color-coded by verdict', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} />)
  expect(screen.getByText(/misread/)).toBeInTheDocument()
  expect(screen.getByText(/never mind/)).toBeInTheDocument()
})

test('clicking a row emits onSelect with chatlog_id and message_index', () => {
  const onSelect = vi.fn()
  render(<MessageList items={items} activeKey={null} onSelect={onSelect} />)
  fireEvent.click(screen.getByText(/never mind/))
  expect(onSelect).toHaveBeenCalledWith({ chatlog_id: 2, message_index: 0 })
})
```

**Note on `react-window`:** for tests, `react-window` renders only the rows visible in the (jsdom-default) viewport — usually enough to find all items in small lists. If tests can't find a row, set the list's `height` to a large value via test prop (e.g. `height={2000}`).

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement `MessageListRow`**

Create `src/components/summaries/MessageListRow.tsx`:

```tsx
import type { MessageListItem } from '../../types'

interface MessageListRowProps {
  item: MessageListItem
  active: boolean
  onSelect: () => void
}

function confColor(v: MessageListItem['verdict']): string {
  if (v === 'yes') return 'text-moss'
  if (v === 'no') return 'text-brick'
  return 'text-ochre'  // review
}

export function MessageListRow({ item, active, onSelect }: MessageListRowProps) {
  return (
    <div
      onClick={onSelect}
      className={`grid grid-cols-[38px_1fr] items-center gap-2.5 px-5 py-2 cursor-pointer ${
        active ? 'bg-elevated border-l-2 border-ochre pl-[18px]' : 'hover:bg-surface'
      }`}
    >
      <span className={`font-mono text-[11px] text-right tabular-nums ${confColor(item.verdict)}`}>
        {item.confidence !== null ? item.confidence.toFixed(2) : '—'}
      </span>
      <span className="text-paper text-[13.5px] truncate font-serif">
        {item.flagged && <span className="text-brick mr-1">⚑</span>}
        {item.text}
        {item.has_note && <span className="inline-block w-1 h-1 rounded-full bg-ochre ml-1.5 align-middle" />}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Implement `MessageList` with `react-window`**

Create `src/components/summaries/MessageList.tsx`:

```tsx
import { FixedSizeList as List } from 'react-window'
import type { MessageListItem } from '../../types'
import { MessageListRow } from './MessageListRow'

interface MessageListProps {
  items: MessageListItem[]
  activeKey: { chatlog_id: number; message_index: number } | null
  onSelect: (key: { chatlog_id: number; message_index: number }) => void
  height?: number
}

const ROW_HEIGHT = 36

export function MessageList({ items, activeKey, onSelect, height = 600 }: MessageListProps) {
  return (
    <List
      height={height}
      width="100%"
      itemCount={items.length}
      itemSize={ROW_HEIGHT}
    >
      {({ index, style }) => {
        const item = items[index]
        const isActive = activeKey?.chatlog_id === item.chatlog_id && activeKey?.message_index === item.message_index
        return (
          <div style={style}>
            <MessageListRow item={item} active={isActive} onSelect={() => onSelect({ chatlog_id: item.chatlog_id, message_index: item.message_index })} />
          </div>
        )
      }}
    </List>
  )
}
```

- [ ] **Step 5: Run the test**

Run: `npm test -- --run src/tests/summaries/MessageList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/summaries/MessageList.tsx src/components/summaries/MessageListRow.tsx src/tests/summaries/MessageList.test.tsx
git commit -m "feat(summaries): MessageList virtualized with react-window"
```

---

### Task 19: Build `ConversationContext`

**Files:**
- Create: `src/components/summaries/ConversationContext.tsx`
- Create: `src/tests/summaries/ConversationContext.test.tsx`

- [ ] **Step 1: Failing test**

Create `src/tests/summaries/ConversationContext.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ConversationContext } from '../../components/summaries/ConversationContext'
import type { ConversationTurn } from '../../types'

const before: ConversationTurn[] = [{ role: 'tutor', turn_index: 5, text: 'try aggfunc=median' }]
const after: ConversationTurn[] = [{ role: 'tutor', turn_index: 7, text: 'great — re-run' }]

test('renders collapsed before and after bars by default', () => {
  render(
    <ConversationContext
      before={before}
      after={after}
      focusedText="wait, I misread"
      focusedTurnIndex={6}
      totalTurns={11}
    />,
  )
  expect(screen.getByText(/tutor turn before/i)).toBeInTheDocument()
  expect(screen.getByText(/tutor turn after/i)).toBeInTheDocument()
  expect(screen.getByText(/wait, I misread/)).toBeInTheDocument()
  expect(screen.queryByText(/try aggfunc/)).not.toBeInTheDocument()
})

test('clicking the before bar expands it to show the turn text', () => {
  render(
    <ConversationContext
      before={before}
      after={after}
      focusedText="wait, I misread"
      focusedTurnIndex={6}
      totalTurns={11}
    />,
  )
  fireEvent.click(screen.getByText(/tutor turn before/i))
  expect(screen.getByText(/try aggfunc/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement**

Create `src/components/summaries/ConversationContext.tsx`:

```tsx
import { useState } from 'react'
import type { ConversationTurn } from '../../types'

interface ConversationContextProps {
  before: ConversationTurn[]
  after: ConversationTurn[]
  focusedText: string
  focusedTurnIndex: number
  totalTurns: number
}

export function ConversationContext({ before, after, focusedText, focusedTurnIndex, totalTurns }: ConversationContextProps) {
  const [beforeOpen, setBeforeOpen] = useState(false)
  const [afterOpen, setAfterOpen] = useState(false)

  return (
    <div>
      <div className="font-mono text-[11px] text-muted mb-2.5">
        turn {focusedTurnIndex + 1} of {totalTurns}
      </div>

      {before.length > 0 && (
        <button
          onClick={() => setBeforeOpen(!beforeOpen)}
          className="w-full text-left px-3 py-2 rounded-sm bg-surface hover:bg-elevated font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1 flex justify-between"
        >
          <span>▾ {before.length} tutor turn{before.length === 1 ? '' : 's'} before</span>
          <span className="opacity-60">{beforeOpen ? 'collapse' : 'expand'}</span>
        </button>
      )}
      {beforeOpen && before.map((t) => (
        <div key={t.turn_index} className="pl-3.5 border-l-2 border-edge italic text-muted text-[13.5px] leading-[1.55] py-2">
          {t.text}
        </div>
      ))}

      <div className="border-l-[3px] border-ochre bg-[rgba(228,181,59,0.06)] pl-3.5 pr-3 py-3 my-1.5 -ml-3.5">
        <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-ochre">● student · turn {focusedTurnIndex + 1}</div>
        <div className="text-paper text-[19px] leading-[1.55] mt-1.5 font-serif">{focusedText}</div>
      </div>

      {after.length > 0 && (
        <button
          onClick={() => setAfterOpen(!afterOpen)}
          className="w-full text-left px-3 py-2 rounded-sm bg-surface hover:bg-elevated font-mono text-[10px] tracking-[0.12em] uppercase text-muted mt-1 flex justify-between"
        >
          <span>▾ {after.length} tutor turn{after.length === 1 ? '' : 's'} after</span>
          <span className="opacity-60">{afterOpen ? 'collapse' : 'expand'}</span>
        </button>
      )}
      {afterOpen && after.map((t) => (
        <div key={t.turn_index} className="pl-3.5 border-l-2 border-edge italic text-muted text-[13.5px] leading-[1.55] py-2">
          {t.text}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run**

Run: `npm test -- --run src/tests/summaries/ConversationContext.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/ConversationContext.tsx src/tests/summaries/ConversationContext.test.tsx
git commit -m "feat(summaries): ConversationContext collapsible before/after bars"
```

---

### Task 20: Build `VerdictBlock`

**Files:**
- Create: `src/components/summaries/VerdictBlock.tsx`
- Create: `src/tests/summaries/VerdictBlock.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { VerdictBlock } from '../../components/summaries/VerdictBlock'

test('renders verdict badge, pattern, and action buttons', () => {
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern="questioning own work" rationale="Student misread the prompt."
      nearThreshold
      onAccept={vi.fn()} onFlip={vi.fn()} onFlag={vi.fn()}
    />
  )
  expect(screen.getByText('YES')).toBeInTheDocument()
  expect(screen.getByText(/questioning own work/)).toBeInTheDocument()
  expect(screen.getByText(/✓ accept/i)).toBeInTheDocument()
  expect(screen.getByText(/↺ flip/i)).toBeInTheDocument()
})

test('rationale is hidden by default and shown when "why" is clicked', () => {
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern="x" rationale="this is the rationale"
      nearThreshold={false}
      onAccept={vi.fn()} onFlip={vi.fn()} onFlag={vi.fn()}
    />
  )
  expect(screen.queryByText(/this is the rationale/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText(/why/i))
  expect(screen.getByText(/this is the rationale/)).toBeInTheDocument()
})

test('flip button calls onFlip with the opposite verdict', () => {
  const onFlip = vi.fn()
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern={null} rationale={null}
      nearThreshold={false}
      onAccept={vi.fn()} onFlip={onFlip} onFlag={vi.fn()}
    />
  )
  fireEvent.click(screen.getByText(/flip/i))
  expect(onFlip).toHaveBeenCalledWith('no')
})
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement**

Create `src/components/summaries/VerdictBlock.tsx`:

```tsx
import { useState } from 'react'
import type { MessageVerdict } from '../../types'

interface VerdictBlockProps {
  verdict: MessageVerdict | null
  confidence: number | null
  appliedBy: 'ai' | 'human' | null
  matchedPattern: string | null
  rationale: string | null
  nearThreshold: boolean
  onAccept: () => void
  onFlip: (newVerdict: 'yes' | 'no') => void
  onFlag: () => void
}

function badgeStyles(v: MessageVerdict | null) {
  if (v === 'yes') return 'bg-[rgba(143,168,118,0.10)] text-moss border-moss-dim'
  if (v === 'no') return 'bg-[rgba(187,92,66,0.10)] text-brick border-brick-dim'
  return 'bg-[rgba(228,181,59,0.10)] text-ochre border-ochre-dim'
}

export function VerdictBlock({ verdict, confidence, appliedBy, matchedPattern, rationale, nearThreshold, onAccept, onFlip, onFlag }: VerdictBlockProps) {
  const [whyOpen, setWhyOpen] = useState(false)
  const oppositeVerdict: 'yes' | 'no' = verdict === 'yes' ? 'no' : 'yes'

  return (
    <div className="mt-4 p-3.5 bg-canvas border border-edge rounded-sm">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-sm border font-mono text-[11px] ${badgeStyles(verdict)}`}>
          <strong>{verdict?.toUpperCase()}</strong>
          {confidence !== null && <span className="text-paper">· {confidence.toFixed(2)}</span>}
        </span>
        {matchedPattern && (
          <span className="text-ochre text-[12.5px] underline decoration-dotted underline-offset-[3px] cursor-pointer">"{matchedPattern}"</span>
        )}
        {nearThreshold && (
          <span className="font-mono text-[10.5px] text-faint">near threshold</span>
        )}
        {rationale && (
          <button onClick={() => setWhyOpen(!whyOpen)} className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-muted hover:text-ochre">
            why {whyOpen ? '▴' : '▾'}
          </button>
        )}
      </div>
      {whyOpen && rationale && (
        <div className="mt-2.5 italic font-serif text-[13.5px] text-on-surface leading-[1.55]">
          "{rationale}"
        </div>
      )}
      <div className="mt-3 flex gap-1.5 flex-wrap">
        <button onClick={onAccept} className="px-3 py-1.5 rounded-sm bg-moss-dim border border-moss text-paper font-mono text-[10px] tracking-[0.08em] uppercase">✓ accept</button>
        <button onClick={() => onFlip(oppositeVerdict)} className="px-3 py-1.5 rounded-sm border border-edge text-on-surface font-mono text-[10px] tracking-[0.08em] uppercase hover:text-paper hover:border-paper">↺ flip</button>
        <button onClick={onFlag} className="px-3 py-1.5 rounded-sm border border-ochre-dim text-ochre font-mono text-[10px] tracking-[0.08em] uppercase">⚑ flag</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run**

Run: `npm test -- --run src/tests/summaries/VerdictBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/VerdictBlock.tsx src/tests/summaries/VerdictBlock.test.tsx
git commit -m "feat(summaries): VerdictBlock with badge, pattern link, why toggle, actions"
```

---

### Task 21: Build `NoteEditor`

**Files:**
- Create: `src/components/summaries/NoteEditor.tsx`
- Create: `src/tests/summaries/NoteEditor.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { NoteEditor } from '../../components/summaries/NoteEditor'

test('shows "+ add note" chip when no note', () => {
  render(<NoteEditor note={null} onSave={vi.fn()} />)
  expect(screen.getByText(/\+ add note/i)).toBeInTheDocument()
})

test('shows the note text when present and saves on blur', () => {
  const onSave = vi.fn()
  render(<NoteEditor note="initial text" onSave={onSave} />)
  const textarea = screen.getByDisplayValue('initial text') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'new text' } })
  fireEvent.blur(textarea)
  expect(onSave).toHaveBeenCalledWith('new text')
})

test('clicking "+ add note" expands an empty textarea', () => {
  render(<NoteEditor note={null} onSave={vi.fn()} />)
  fireEvent.click(screen.getByText(/\+ add note/i))
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run; expect failure**

- [ ] **Step 3: Implement**

Create `src/components/summaries/NoteEditor.tsx`:

```tsx
import { useState, useEffect } from 'react'

interface NoteEditorProps {
  note: string | null
  onSave: (text: string) => void
}

export function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [open, setOpen] = useState(note !== null)
  const [draft, setDraft] = useState(note ?? '')

  useEffect(() => {
    setOpen(note !== null)
    setDraft(note ?? '')
  }, [note])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3.5 inline-block px-2.5 py-1.5 border border-dashed border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-muted hover:text-paper"
      >
        + add note
      </button>
    )
  }

  return (
    <div className="mt-3.5">
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-faint mb-2">your note (saves on blur)</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
        placeholder="e.g. 'this is more like prompt-rereading than self-correction'…"
        className="w-full min-h-[56px] bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[13.5px] leading-[1.5] focus:border-ochre-dim focus:outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 4: Run**

Run: `npm test -- --run src/tests/summaries/NoteEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/NoteEditor.tsx src/tests/summaries/NoteEditor.test.tsx
git commit -m "feat(summaries): NoteEditor collapsible per-message note textarea"
```

---

### Task 22: Build `FocusedMessage` and `BrowseTab` (assembly)

**Files:**
- Create: `src/components/summaries/FocusedMessage.tsx`
- Create: `src/components/summaries/BrowseTab.tsx`
- Create: `src/tests/summaries/BrowseTab.test.tsx`

- [ ] **Step 1: Implement `FocusedMessage` (assembly only — already tested via its parts)**

Create `src/components/summaries/FocusedMessage.tsx`:

```tsx
import { ConversationContext } from './ConversationContext'
import { VerdictBlock } from './VerdictBlock'
import { NoteEditor } from './NoteEditor'
import type { MessageDetail } from '../../types'

interface FocusedMessageProps {
  detail: MessageDetail
  reviewThreshold: number
  onAccept: () => void
  onFlip: (verdict: 'yes' | 'no') => void
  onFlag: () => void
  onSaveNote: (text: string) => void
}

export function FocusedMessage({ detail, reviewThreshold, onAccept, onFlip, onFlag, onSaveNote }: FocusedMessageProps) {
  const nearThreshold =
    detail.applied_by === 'ai' &&
    detail.confidence !== null &&
    Math.abs(detail.confidence - reviewThreshold) < 0.1

  return (
    <div className="px-7 py-5 bg-bg-warm overflow-y-auto flex-1">
      <div className="font-mono text-[11px] text-muted mb-2">
        chatlog #{detail.chatlog_id}{detail.notebook ? ` · ${detail.notebook}` : ''}
      </div>
      <ConversationContext
        before={detail.context_before}
        after={detail.context_after}
        focusedText={detail.text}
        focusedTurnIndex={detail.turn_index}
        totalTurns={detail.total_turns}
      />
      <VerdictBlock
        verdict={detail.verdict}
        confidence={detail.confidence}
        appliedBy={detail.applied_by}
        matchedPattern={detail.matched_pattern}
        rationale={detail.rationale}
        nearThreshold={nearThreshold}
        onAccept={onAccept}
        onFlip={onFlip}
        onFlag={onFlag}
      />
      <NoteEditor note={detail.note} onSave={onSaveNote} />
    </div>
  )
}
```

- [ ] **Step 2: Implement `BrowseTab` (data + state wiring)**

Create `src/components/summaries/BrowseTab.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../services/api'
import { FilterBar } from './FilterBar'
import { MessageList } from './MessageList'
import { FocusedMessage } from './FocusedMessage'
import type {
  BrowseFilter, BrowseSort, ContextDepth,
  MessageListItem, MessageDetail, SingleLabelDetail,
} from '../../types'

interface BrowseTabProps {
  label: SingleLabelDetail
  onLabelChanged: () => void  // re-fetch after a flip changes counts
}

export function BrowseTab({ label, onLabelChanged }: BrowseTabProps) {
  const [filter, setFilter] = useState<BrowseFilter>(
    () => (localStorage.getItem('summaries.browse.filter') as BrowseFilter) || 'all',
  )
  const [sort, setSort] = useState<BrowseSort>(
    () => (localStorage.getItem('summaries.browse.sort') as BrowseSort) || 'confidence_asc',
  )
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MessageListItem[]>([])
  const [activeKey, setActiveKey] = useState<{ chatlog_id: number; message_index: number } | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const contextDepth = (localStorage.getItem('summaries.context_depth') as ContextDepth) || '1'

  // Fetch list whenever filter/sort/search change
  useEffect(() => {
    api.listSingleLabelMessages(label.id, {
      filter: filter === 'all' ? undefined : filter,
      sort, search: search || undefined, limit: 200,
    }).then((r) => setItems(r.items))
    localStorage.setItem('summaries.browse.filter', filter)
    localStorage.setItem('summaries.browse.sort', sort)
  }, [label.id, filter, sort, search])

  // Fetch detail on activeKey change
  useEffect(() => {
    if (!activeKey) { setDetail(null); return }
    api.getSingleLabelMessageDetail(
      label.id, activeKey.chatlog_id, activeKey.message_index, contextDepth,
    ).then(setDetail)
  }, [label.id, activeKey, contextDepth])

  const flip = useCallback(async (verdict: 'yes' | 'no') => {
    if (!activeKey || !detail) return
    // Optimistic update: update the row in the list and the detail panel
    const prev = detail
    setDetail({ ...detail, verdict, applied_by: 'human' })
    setItems((cur) =>
      cur.map((it) =>
        it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
          ? { ...it, verdict, applied_by: 'human' }
          : it,
      ),
    )
    try {
      await api.flipSingleLabelVerdict(label.id, activeKey.chatlog_id, activeKey.message_index, verdict)
      onLabelChanged()
    } catch (e) {
      setDetail(prev)
      setItems((cur) =>
        cur.map((it) =>
          it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
            ? { ...it, verdict: prev.verdict, applied_by: prev.applied_by }
            : it,
        ),
      )
    }
  }, [activeKey, detail, label.id, onLabelChanged])

  const accept = useCallback(() => {
    if (!detail?.verdict || detail.verdict === 'review') return
    flip(detail.verdict as 'yes' | 'no')
  }, [detail, flip])

  const saveNote = useCallback(async (text: string) => {
    if (!activeKey) return
    await api.upsertSingleLabelNote(label.id, activeKey.chatlog_id, activeKey.message_index, text)
    setItems((cur) =>
      cur.map((it) =>
        it.chatlog_id === activeKey.chatlog_id && it.message_index === activeKey.message_index
          ? { ...it, has_note: !!text }
          : it,
      ),
    )
  }, [activeKey, label.id])

  return (
    <div className="flex-1 grid grid-cols-[5fr_6fr] min-h-0">
      <div className="flex flex-col border-r border-edge min-h-0">
        <FilterBar filter={filter} sort={sort} search={search} onChange={(p) => {
          if (p.filter !== undefined) setFilter(p.filter)
          if (p.sort !== undefined) setSort(p.sort)
          if (p.search !== undefined) setSearch(p.search)
        }} />
        <div className="flex-1 min-h-0">
          <MessageList items={items} activeKey={activeKey} onSelect={setActiveKey} />
        </div>
      </div>
      <div className="flex flex-col min-h-0">
        {detail ? (
          <FocusedMessage
            detail={detail}
            reviewThreshold={label.review_threshold}
            onAccept={accept}
            onFlip={flip}
            onFlag={() => {/* Phase 2 */}}
            onSaveNote={saveNote}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            select a message →
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write a focused integration test**

Create `src/tests/summaries/BrowseTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { BrowseTab } from '../../components/summaries/BrowseTab'
import type { SingleLabelDetail, MessageListResponse, MessageDetail } from '../../types'

const detailLabel: SingleLabelDetail = {
  id: 1, name: 'self-correction', description: null, phase: 'handed_off',
  yes_count: 2, no_count: 1, review_count: 0, review_threshold: 0.7,
  agreement_vs_gold: null, confidence_histogram: [],
}

const list: MessageListResponse = {
  items: [
    { chatlog_id: 1, message_index: 0, text: 'first message', confidence: 0.5, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
    { chatlog_id: 2, message_index: 0, text: 'second message', confidence: 0.8, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
  ],
  total: 2, offset: 0, limit: 200,
}

const msgDetail: MessageDetail = {
  chatlog_id: 1, message_index: 0, text: 'first message',
  confidence: 0.5, verdict: 'yes', applied_by: 'ai',
  matched_pattern: 'pattern', rationale: 'rationale',
  flagged: false, note: null,
  context_before: [], context_after: [],
  notebook: null, turn_index: 0, total_turns: 1,
}

const { mockListMessages, mockGetDetail, mockFlip } = vi.hoisted(() => ({
  mockListMessages: vi.fn(),
  mockGetDetail: vi.fn(),
  mockFlip: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  api: {
    listSingleLabelMessages: mockListMessages,
    getSingleLabelMessageDetail: mockGetDetail,
    flipSingleLabelVerdict: mockFlip,
    upsertSingleLabelNote: vi.fn(),
  },
}))

beforeEach(() => {
  mockListMessages.mockResolvedValue(list)
  mockGetDetail.mockResolvedValue(msgDetail)
  mockFlip.mockResolvedValue({ ...list.items[0], verdict: 'no', applied_by: 'human' })
})

test('renders messages then loads detail on click', async () => {
  render(<BrowseTab label={detailLabel} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('first message')).toBeInTheDocument())
  fireEvent.click(screen.getByText('first message'))
  await waitFor(() => expect(screen.getByText(/YES/i)).toBeInTheDocument())
})

test('flip is optimistic and rolls back on failure', async () => {
  mockFlip.mockRejectedValueOnce(new Error('boom'))
  const onChanged = vi.fn()
  render(<BrowseTab label={detailLabel} onLabelChanged={onChanged} />)
  await waitFor(() => expect(screen.getByText('first message')).toBeInTheDocument())
  fireEvent.click(screen.getByText('first message'))
  await waitFor(() => expect(screen.getByText(/YES/i)).toBeInTheDocument())
  fireEvent.click(screen.getByText(/flip/i))
  // After failure, the verdict reverts to YES
  await waitFor(() => expect(screen.getByText(/YES/i)).toBeInTheDocument())
  expect(onChanged).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Run**

Run: `npm test -- --run src/tests/summaries/BrowseTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/summaries/FocusedMessage.tsx src/components/summaries/BrowseTab.tsx src/tests/summaries/BrowseTab.test.tsx
git commit -m "feat(summaries): BrowseTab assembly with optimistic flip + rollback"
```

---

### Task 23: Wire `BrowseTab` into `SummariesPageSingle`

**Files:**
- Modify: `src/pages/summaries/SummariesPageSingle.tsx`

- [ ] **Step 1: Update the page to fetch label detail and render Browse**

Replace the contents of `src/pages/summaries/SummariesPageSingle.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { LabelRail } from '../../components/summaries/LabelRail'
import { DetailHeader, type SummariesTab } from '../../components/summaries/DetailHeader'
import { BrowseTab } from '../../components/summaries/BrowseTab'
import { api } from '../../services/api'
import type { HandoffSummaryItem, SingleLabelDetail } from '../../types'

export function SummariesPageSingle() {
  const [items, setItems] = useState<HandoffSummaryItem[]>([])
  const [activeId, setActiveId] = useState<number | null>(
    () => Number(localStorage.getItem('summaries.active_label_id')) || null,
  )
  const [detail, setDetail] = useState<SingleLabelDetail | null>(null)
  const [tab, setTab] = useState<SummariesTab>('browse')

  const refreshList = useCallback(() => {
    api.listHandoffSummaries().then(setItems)
  }, [])

  const refreshDetail = useCallback(() => {
    if (activeId === null) { setDetail(null); return }
    api.getSingleLabelDetail(activeId).then(setDetail)
  }, [activeId])

  useEffect(() => { refreshList() }, [refreshList])
  useEffect(() => { refreshDetail() }, [refreshDetail])
  useEffect(() => {
    if (activeId !== null) localStorage.setItem('summaries.active_label_id', String(activeId))
  }, [activeId])

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface">
        <div className="text-center max-w-md">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">no labels yet</div>
          <div className="font-serif text-[15px]">Head to <a href="/run" className="text-ochre underline">Run</a> to create your first label.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex bg-canvas min-h-0">
      <LabelRail items={items} activeId={activeId} onSelect={(id) => { setActiveId(id); setTab('browse') }} />
      <section className="flex-1 flex flex-col min-w-0">
        {detail ? (
          <>
            <DetailHeader
              detail={detail}
              activeTab={tab}
              onTabChange={setTab}
              onMenuAction={() => {/* Task 24 */}}
            />
            {tab === 'browse' && (
              <BrowseTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
            )}
            {tab === 'settings' && (
              <div className="flex-1 flex items-center justify-center text-muted">Settings tab — Task 24</div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            select a label →
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verify existing tests pass**

Run: `npm test -- --run`
Expected: all tests pass (existing SummariesPage tests use multi-label mode, others are component-level).

- [ ] **Step 3: Smoke-test in the browser**

Run: `npm run dev`
Open `http://localhost:5173/summaries` with single-label mode active.
Verify:
- Rail shows labels
- Clicking a label shows the detail header with counts
- Browse tab shows the message list sorted by confidence ascending
- Clicking a row shows the focused message with verdict and rationale (rationale hidden behind "why")
- Clicking "↺ flip" updates the row optimistically and persists

- [ ] **Step 4: Commit**

```bash
git add src/pages/summaries/SummariesPageSingle.tsx
git commit -m "feat(summaries): wire rail + header + BrowseTab in single-mode page"
```

---

## Section E — Settings tab + CRUD

### Task 24: Build `RenameModal`, `DeleteConfirmModal`, `SettingsTab`

**Files:**
- Create: `src/components/summaries/RenameModal.tsx`
- Create: `src/components/summaries/DeleteConfirmModal.tsx`
- Create: `src/components/summaries/SettingsTab.tsx`
- Modify: `src/pages/summaries/SummariesPageSingle.tsx` (wire menu actions + Settings tab)

- [ ] **Step 1: Implement `RenameModal`**

Create `src/components/summaries/RenameModal.tsx`:

```tsx
import { useState } from 'react'

interface RenameModalProps {
  initialName: string
  initialDescription: string | null
  onSave: (name: string, description: string) => void
  onCancel: () => void
}

export function RenameModal({ initialName, initialDescription, onSave, onCancel }: RenameModalProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')

  return (
    <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
      <div className="bg-modal-deep border border-edge rounded-md p-6 w-[480px] max-w-[90vw]">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-3">Edit label</div>
        <label className="block mb-3">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1.5">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[15px]"
          />
        </label>
        <label className="block mb-4">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1.5">Description</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[13.5px]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper">Cancel</button>
          <button onClick={() => onSave(name, description)} className="px-3 py-1.5 bg-ochre-dim border border-ochre text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase">Save</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement `DeleteConfirmModal`**

Create `src/components/summaries/DeleteConfirmModal.tsx`:

```tsx
import { useState } from 'react'

interface DeleteConfirmModalProps {
  labelName: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ labelName, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [typed, setTyped] = useState('')
  const canDelete = typed === labelName

  return (
    <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
      <div className="bg-modal-deep border border-brick-dim rounded-md p-6 w-[480px] max-w-[90vw]">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-brick mb-3">Delete label</div>
        <p className="font-serif text-[14px] text-on-canvas mb-3 leading-[1.55]">
          This archives the label and returns its messages to the unlabeled pool.
          Type <span className="font-mono text-brick">{labelName}</span> to confirm.
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-mono text-[13px] mb-4"
          placeholder={labelName}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!canDelete}
            className="px-3 py-1.5 bg-brick-dim border border-brick text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement `SettingsTab` and wire menu actions**

Create `src/components/summaries/SettingsTab.tsx`:

```tsx
import { useState } from 'react'
import type { SingleLabelDetail } from '../../types'

interface SettingsTabProps {
  detail: SingleLabelDetail
  onRehandoff: () => Promise<void>
  onSaveThreshold: (value: number) => Promise<void>
}

export function SettingsTab({ detail, onRehandoff, onSaveThreshold }: SettingsTabProps) {
  const [threshold, setThreshold] = useState(detail.review_threshold)
  const [saving, setSaving] = useState(false)

  return (
    <div className="px-7 py-6 overflow-y-auto flex-1">
      <div className="max-w-[640px]">
        <h3 className="font-serif font-medium text-[18px] text-paper mb-1">Review threshold</h3>
        <p className="font-serif text-[13.5px] text-on-surface mb-3 leading-[1.55]">
          Predictions with AI confidence below this value land in the Review bucket. Lowering it shrinks Review; raising it grows it.
        </p>
        <div className="flex items-center gap-3 mb-2">
          <input
            type="range"
            min="0.50" max="0.95" step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-[13px] text-paper tabular-nums w-12">{threshold.toFixed(2)}</span>
        </div>
        <button
          onClick={async () => { setSaving(true); try { await onSaveThreshold(threshold) } finally { setSaving(false) } }}
          disabled={saving || threshold === detail.review_threshold}
          className="px-3 py-1.5 bg-ochre-dim border border-ochre text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save & re-bucket'}
        </button>

        <hr className="my-7 border-edge-subtle" />

        <h3 className="font-serif font-medium text-[18px] text-paper mb-1">Re-handoff</h3>
        <p className="font-serif text-[13.5px] text-on-surface mb-3 leading-[1.55]">
          Send the current label definition back to Gemini for a fresh classification. Useful after editing the description.
        </p>
        <button
          onClick={onRehandoff}
          className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper"
        >
          ↺ Re-handoff full label
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire everything into the page**

Update `src/pages/summaries/SummariesPageSingle.tsx`:

Replace the section that renders the tab content with:

```tsx
{tab === 'browse' && (
  <BrowseTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
)}
{tab === 'settings' && (
  <SettingsTab
    detail={detail}
    onRehandoff={async () => {
      // Reuse existing handoff endpoint (the spec defers full re-handoff plumbing
      // to existing /api/single-labels/:id/handoff). If the existing endpoint
      // requires confirmation, surface a confirm() dialog here.
      if (!confirm('Re-handoff this label to Gemini?')) return
      await api.handoffSingleLabel(detail.id)
      refreshList(); refreshDetail()
    }}
    onSaveThreshold={async (v) => {
      await api.patchSingleLabel(detail.id, { review_threshold: v })
      refreshDetail()
    }}
  />
)}
```

Update the menu-action handler `onMenuAction={(action) => ...}` to open the appropriate modal:

```tsx
const [renameOpen, setRenameOpen] = useState(false)
const [deleteOpen, setDeleteOpen] = useState(false)

// in the JSX:
onMenuAction={(action) => {
  if (action === 'rename' || action === 'edit') setRenameOpen(true)
  else if (action === 'delete') setDeleteOpen(true)
  else if (action === 'rehandoff') {
    if (!confirm('Re-handoff this label to Gemini?')) return
    api.handoffSingleLabel(detail.id).then(() => { refreshList(); refreshDetail() })
  }
}}

// render modals at the end of the section
{renameOpen && detail && (
  <RenameModal
    initialName={detail.name}
    initialDescription={detail.description}
    onSave={async (name, description) => {
      await api.patchSingleLabel(detail.id, { name, description })
      setRenameOpen(false)
      refreshList(); refreshDetail()
    }}
    onCancel={() => setRenameOpen(false)}
  />
)}
{deleteOpen && detail && (
  <DeleteConfirmModal
    labelName={detail.name}
    onConfirm={async () => {
      await api.deleteSingleLabel(detail.id)
      setDeleteOpen(false)
      setActiveId(null)
      refreshList()
    }}
    onCancel={() => setDeleteOpen(false)}
  />
)}
```

Add the corresponding imports at the top:

```tsx
import { SettingsTab } from '../../components/summaries/SettingsTab'
import { RenameModal } from '../../components/summaries/RenameModal'
import { DeleteConfirmModal } from '../../components/summaries/DeleteConfirmModal'
```

- [ ] **Step 5: Verify**

Run: `npm test -- --run`
Then: `npm run dev` and confirm in the browser:
- Settings tab loads the threshold slider
- Saving threshold updates the counts (Review bucket changes)
- Rename modal updates the name + description
- Delete confirmation requires typing the label name

- [ ] **Step 6: Commit**

```bash
git add src/components/summaries/SettingsTab.tsx src/components/summaries/RenameModal.tsx src/components/summaries/DeleteConfirmModal.tsx src/pages/summaries/SummariesPageSingle.tsx
git commit -m "feat(summaries): SettingsTab with threshold + re-handoff; rename/delete modals"
```

---

## Section F — Navigation + Routing

### Task 25: Drop `/labels` from single-label nav and add redirect

**Files:**
- Modify: `src/components/Navigation.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update nav**

In `src/components/Navigation.tsx`, change the `links` definition to drop `/labels` from the single-label list:

```tsx
const links =
  mode === 'single'
    ? [
        labelingLink,
        { to: '/assignments', label: 'Assignments' },
        { to: '/summaries', label: 'Summaries' },
        { to: '/analysis', label: 'Analysis' },
      ]
    : [
        labelingLink,
        { to: '/history', label: 'History' },
        { to: '/labels', label: 'Labels' },
        { to: '/assignments', label: 'Assignments' },
        { to: '/summaries', label: 'Summaries' },
        { to: '/analysis', label: 'Analysis' },
      ]
```

- [ ] **Step 2: Add redirect in `App.tsx`**

In `src/App.tsx`, find the `/labels` route and wrap it in a mode-aware redirect:

```tsx
import { useMode } from './hooks/useMode'
import { Navigate } from 'react-router-dom'

function LabelsRouteGuard() {
  const { mode } = useMode()
  if (mode === 'single') return <Navigate to="/summaries" replace />
  return <LabelsPage />
}

// In the <Routes>, replace:
<Route path="/labels" element={<LabelsPage />} />
// with:
<Route path="/labels" element={<LabelsRouteGuard />} />
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`
- In single-label mode: `/labels` redirects to `/summaries`; nav doesn't show `/labels` link.
- In multi-label mode: `/labels` shows `LabelsPage`; nav shows `/labels` link.

- [ ] **Step 4: Commit**

```bash
git add src/components/Navigation.tsx src/App.tsx
git commit -m "feat(routing): drop /labels from single-label nav + redirect to /summaries"
```

---

## Section G — Polish

### Task 26: Loading skeletons and error toasts

**Files:**
- Modify: `src/pages/summaries/SummariesPageSingle.tsx`
- Modify: `src/components/summaries/BrowseTab.tsx`

- [ ] **Step 1: Add a simple loading state**

In `SummariesPageSingle.tsx`, add a `loading` state for the initial label-list fetch:

```tsx
const [loading, setLoading] = useState(true)

useEffect(() => {
  api.listHandoffSummaries().then((s) => { setItems(s); setLoading(false) })
}, [])

if (loading) {
  return (
    <div className="flex-1 flex items-center justify-center text-faint font-mono text-[10px] tracking-[0.18em] uppercase animate-pulse">
      Loading…
    </div>
  )
}
```

- [ ] **Step 2: Add error toast for the flip rollback path in `BrowseTab.tsx`**

Inside the `catch` block of `flip`, before rolling back, add a transient toast. The codebase likely has a toast pattern (search for `toast` in `src/components/`). If not, use a simple state-based banner:

```tsx
const [error, setError] = useState<string | null>(null)
// ...
} catch (e) {
  setError('Flip failed — retry?')
  setTimeout(() => setError(null), 4000)
  setDetail(prev)
  // ...
}
// In the JSX, near the verdict block:
{error && <div className="absolute bottom-4 right-4 bg-brick-dim border border-brick text-paper px-3 py-2 rounded-sm font-mono text-[11px]">{error}</div>}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev` and force a network failure (DevTools → offline) before clicking flip. Verify the toast appears and verdict reverts.

- [ ] **Step 4: Commit**

```bash
git add src/pages/summaries/SummariesPageSingle.tsx src/components/summaries/BrowseTab.tsx
git commit -m "feat(summaries): loading skeleton + flip-failure error toast"
```

---

### Task 27: Run the full test suite + manual QA

- [ ] **Step 1: Run all tests**

Run: `npm test -- --run` and `cd server/python && uv run pytest`
Expected: all green.

- [ ] **Step 2: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual QA pass**

Run: `npm run dev` and `cd server/python && uv run uvicorn main:app --reload`
- Walk through the flows in `docs/superpowers/specs/2026-05-14-summaries-page-revamp-design.md` Section 5.2 (Browse) and 5.6 (Settings).
- Confirm:
  - Master-detail rail and detail header render the right data
  - Browse list sorted by confidence ascending by default
  - Clicking a row shows the focused message with ±1 tutor turn each side
  - `why ▾` toggles rationale
  - `↺ flip` flips optimistically and persists; counts in the header strip and rail update
  - `+ add note` opens an editor, blur saves
  - Settings tab threshold slider updates counts after Save & re-bucket
  - Rename modal updates the title + description
  - Delete modal requires typed name and removes the label from the rail
  - `/labels` URL in single-label mode redirects to `/summaries`

- [ ] **Step 4: Commit any small fixups**

```bash
# If anything needs adjustment from QA
git add ...
git commit -m "fix(summaries): <specific fix>"
```

---

## Self-Review

The plan covers each Phase 1 capability from the spec:

- Master-detail layout + rail → Task 15
- Detail header (stats strip, agreement tooltip, ⋯ menu, tabs) → Task 16
- Browse tab (filters, sort, search, virtualized list, conversation context, verdict block, optimistic flip, note) → Tasks 17–23
- Settings tab (rename, edit description, delete, threshold, re-handoff) → Task 24
- `LabelApplication` schema + `autolabel_service` rationale capture → Tasks 1–3
- New API endpoints (label detail, list, detail, flip, note, PATCH, DELETE) → Tasks 5–10
- Mode awareness + routing → Tasks 14, 25
- Tests on both sides → present in every task
- Loading + error UX → Task 26
- Final QA → Task 27

Deferred (correctly, per the spec):
- Review tab queue mode → Phase 2
- Patterns tab interactivity → Phase 2
- Refine tab split/merge → Phase 3
- Flag column / bulk flip → Phase 2

The plan touches both backend and frontend in tight, individually-tested slices. Each task ends with a focused commit. No placeholders or "TBD" steps.
