# Multi-label Auto-labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-label queue auto-labeling assign zero, one, or many labels per message (above a confidence threshold), while leaving the label-split flow on its existing exactly-one-label behavior.

**Architecture:** Add an opt-in `multi_select` flag to `autolabel_service.classify_batch` that swaps in a multi-label system instruction and prompt wording. The general auto-label flow (`main._run_autolabel`) calls it with `multi_select=True` and filters returned labels by a global env-configurable confidence threshold before persisting. The label-split flow (`main._run_label_split` region near line 1290) keeps the default `multi_select=False` and is left untouched.

**Tech Stack:** Python, FastAPI, SQLModel, Google `gemini-2.5-flash` (function calling), pytest with in-memory SQLite.

---

## Background for the implementer

- `server/python/autolabel_service.py` builds a `classify_messages` Gemini tool and a single `CONFIG` (a `types.GenerateContentConfig`) whose `system_instruction` currently says *"Assign exactly one label to each message."* `classify_batch(label_definitions, examples_by_label, messages)` returns a flat `list[{index, label, confidence}]`.
- `server/python/main.py` calls `classify_batch` from two background functions:
  - `_run_autolabel()` (~line 1364) — the **general** multi-label auto-label flow. Its consumer loop (~lines 1477-1505) writes one `LabelApplication(applied_by="ai", confidence=...)` per returned row, with a dedup check per `(label_id, chatlog_id, message_index)`. **This is the flow we are changing.**
  - `_run_label_split(...)` region (~line 1290) — splits one label into two sub-labels; each message must go to **exactly one** new bucket. **Leave this on `multi_select=False`; do not add a threshold gate here.**
- Tests live in `server/python/tests/`. They mock `autolabel_service.classify_batch` and call `main._run_autolabel()` directly. See `tests/test_autolabel_fixes.py` for the exact pattern (`_make_label`, `_seed_msg`, `monkeypatch.setattr(autolabel_service, "classify_batch", fake)`, `monkeypatch.setattr(main, "engine", engine)`).
- Run a single test: `cd server/python && uv run pytest tests/test_<file>.py::test_<name> -v`.
- Importing `main` requires `GEMINI_API_KEY` and `PG_PASSWORD`; `conftest.py` sets a dummy `PG_PASSWORD`, and `GEMINI_API_KEY` resolves from `.env`/shell. If pytest fails at import with a missing key, set a dummy: `GEMINI_API_KEY=x uv run pytest ...`.

## File Structure

- Modify: `server/python/autolabel_service.py` — add `MULTILABEL_THRESHOLD` constant, two system-instruction configs, and `multi_select` params on `build_prompt` + `classify_batch`.
- Modify: `server/python/main.py` — `_run_autolabel` calls `classify_batch(..., multi_select=True)` and applies the threshold gate in its consumer loop. (`_run_label_split` region: no change.)
- Create: `server/python/tests/test_multilabel_autolabel.py` — unit tests for the service-level config selection and the `_run_autolabel` consumer behavior.

---

## Task 1: Add the threshold constant and multi-select config in `autolabel_service.py`

**Files:**
- Modify: `server/python/autolabel_service.py:48-63` (CONFIG block) and `:15`
- Test: `server/python/tests/test_multilabel_autolabel.py`

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_multilabel_autolabel.py`:

```python
"""Tests for multi-label auto-labeling (multi_select + confidence threshold)."""
from datetime import datetime
from unittest.mock import patch

import autolabel_service


def test_multilabel_threshold_default_is_half(monkeypatch):
    monkeypatch.delenv("CHATSIGHT_MULTILABEL_THRESHOLD", raising=False)
    # Re-read the env the same way the module does at import.
    import importlib
    importlib.reload(autolabel_service)
    assert autolabel_service.MULTILABEL_THRESHOLD == 0.5


def test_multilabel_threshold_env_override(monkeypatch):
    monkeypatch.setenv("CHATSIGHT_MULTILABEL_THRESHOLD", "0.3")
    import importlib
    importlib.reload(autolabel_service)
    assert autolabel_service.MULTILABEL_THRESHOLD == 0.3
    # Restore default so later tests are not affected by the reloaded module.
    monkeypatch.delenv("CHATSIGHT_MULTILABEL_THRESHOLD", raising=False)
    importlib.reload(autolabel_service)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py -v`
Expected: FAIL with `AttributeError: module 'autolabel_service' has no attribute 'MULTILABEL_THRESHOLD'`

- [ ] **Step 3: Add the constant and a multi-select config**

In `server/python/autolabel_service.py`, just after the `client = genai.Client(...)` line (~line 15), add:

```python
MULTILABEL_THRESHOLD = float(os.environ.get("CHATSIGHT_MULTILABEL_THRESHOLD", "0.5"))
```

Then replace the existing single `CONFIG` (lines ~48-63) with two configs that share the tool but differ in system instruction:

```python
_SINGLE_SELECT_INSTRUCTION = (
    "You are classifying student messages from AI tutoring conversations. "
    "You will be given label definitions with example messages, then a batch "
    "of unlabeled messages to classify. Assign exactly one label to each message. "
    "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain)."
)

_MULTI_SELECT_INSTRUCTION = (
    "You are classifying student messages from AI tutoring conversations. "
    "You will be given label definitions with example messages, then a batch "
    "of unlabeled messages to classify. Assign EVERY label that applies to a "
    "message — a message may match several labels, exactly one, or none. Emit a "
    "SEPARATE classification entry for each applicable label, reusing the same "
    "index for every label that applies to that message. If a message matches no "
    "label, emit no entry for it. "
    "Use the label names exactly as provided. Rate your confidence from 0.0 (very uncertain) to 1.0 (very certain)."
)


def _make_config(system_instruction: str) -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0,
        tools=[TOOL],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode="ANY",
                allowed_function_names=["classify_messages"],
            )
        ),
    )


CONFIG = _make_config(_SINGLE_SELECT_INSTRUCTION)            # default / split flow
MULTI_SELECT_CONFIG = _make_config(_MULTI_SELECT_INSTRUCTION)  # general auto-label
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py -v`
Expected: PASS (both threshold tests)

- [ ] **Step 5: Commit**

```bash
git add server/python/autolabel_service.py server/python/tests/test_multilabel_autolabel.py
git commit -m "feat(autolabel): add MULTILABEL_THRESHOLD + multi-select Gemini config"
```

---

## Task 2: Thread `multi_select` through `build_prompt` and `classify_batch`

**Files:**
- Modify: `server/python/autolabel_service.py:66-92` (`build_prompt`), `:95-137` (`classify_batch`), `:23-46` (tool item description)
- Test: `server/python/tests/test_multilabel_autolabel.py`

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_multilabel_autolabel.py`:

```python
def test_build_prompt_multi_select_wording():
    label_defs = [{"name": "confused", "description": "student is confused"}]
    messages = [{"message_text": "I don't get it", "message_index": 0, "chatlog_id": 1}]
    single = autolabel_service.build_prompt(label_defs, {}, messages, multi_select=False)
    multi = autolabel_service.build_prompt(label_defs, {}, messages, multi_select=True)
    assert "each message" in single
    # Multi prompt must tell the model multiple/zero labels are allowed.
    assert "all that apply" in multi.lower() or "every label" in multi.lower()


def test_classify_batch_uses_multi_config(monkeypatch):
    captured = {}

    class _FakeFn:
        name = "classify_messages"
        args = {"classifications": [{"index": 0, "label": "confused", "confidence": 0.9}]}

    class _FakePart:
        function_call = _FakeFn()

    class _FakeContent:
        parts = [_FakePart()]

    class _FakeCandidate:
        content = _FakeContent()

    class _FakeResp:
        candidates = [_FakeCandidate()]

    def fake_generate(model, contents, config):
        captured["config"] = config
        return _FakeResp()

    monkeypatch.setattr(autolabel_service.client.models, "generate_content", fake_generate)

    label_defs = [{"name": "confused", "description": ""}]
    messages = [{"message_text": "huh", "message_index": 0, "chatlog_id": 1}]

    autolabel_service.classify_batch(label_defs, {}, messages, multi_select=True)
    assert captured["config"] is autolabel_service.MULTI_SELECT_CONFIG

    autolabel_service.classify_batch(label_defs, {}, messages, multi_select=False)
    assert captured["config"] is autolabel_service.CONFIG
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py -k "multi_select or multi_config" -v`
Expected: FAIL with `TypeError: build_prompt() got an unexpected keyword argument 'multi_select'`

- [ ] **Step 3: Add the parameters**

In `build_prompt` (line ~66), change the signature and the closing instruction:

```python
def build_prompt(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
    multi_select: bool = False,
) -> str:
```

Replace the closing `parts.append(...)` block (lines ~88-91) with:

```python
    if multi_select:
        parts.append(
            "Call `classify_messages` with one entry per (message, applicable label). "
            "Assign all that apply: a message may get several labels, one, or none. "
            "Reuse the same index for each label that applies to that message; omit "
            "messages that match no label. Use label names exactly as defined above."
        )
    else:
        parts.append(
            "Call `classify_messages` with the index and label for each message. "
            "Use label names exactly as defined above."
        )
    return "\n".join(parts)
```

In `classify_batch` (line ~95), change the signature, prompt call, and config selection:

```python
def classify_batch(
    label_definitions: List[Dict[str, Any]],
    examples_by_label: Dict[str, List[str]],
    messages: List[Dict[str, Any]],
    multi_select: bool = False,
) -> List[Dict[str, Any]]:
    """Classify a batch of messages. Returns list of {index, label, confidence}.

    When multi_select is True the model may return multiple entries per index
    (one per applicable label) or none; otherwise exactly one label per message.
    """
    prompt = build_prompt(label_definitions, examples_by_label, messages, multi_select)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=MULTI_SELECT_CONFIG if multi_select else CONFIG,
    )
```

(Leave the rest of `classify_batch`'s response-parsing body unchanged.)

Also update the `classifications` item description in `TOOL` (line ~30-41) to note repeats are allowed, by changing the `index` field description to:

```python
                            "index": {"type": "integer", "description": "Index in the input messages array. The same index may appear in multiple entries when several labels apply."},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py -v`
Expected: PASS (all tests so far)

- [ ] **Step 5: Run the existing autolabel test to confirm no regression**

Run: `cd server/python && uv run pytest tests/test_autolabel_fixes.py -v`
Expected: PASS (the existing `fake_classify(label_defs, examples_by_label, messages)` mocks still work because `multi_select` is keyword-only-with-default at the call site; `main` will pass it as a keyword in Task 3).

- [ ] **Step 6: Commit**

```bash
git add server/python/autolabel_service.py server/python/tests/test_multilabel_autolabel.py
git commit -m "feat(autolabel): thread multi_select through build_prompt + classify_batch"
```

---

## Task 3: Make `_run_autolabel` multi-select and gate by confidence

**Files:**
- Modify: `server/python/main.py:1467` (classify_batch call) and `:1477-1505` (consumer loop)
- Test: `server/python/tests/test_multilabel_autolabel.py`

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_multilabel_autolabel.py`:

```python
from sqlmodel import select
import main
import autolabel_service as _als
from models import LabelApplication, LabelDefinition, MessageCache


def _make_label(session, name):
    lbl = LabelDefinition(name=name, mode="multi", archived_at=None)
    session.add(lbl)
    session.commit()
    session.refresh(lbl)
    return lbl


def _seed_msg(session, chatlog_id, message_index, notebook, text):
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text,
        notebook=notebook,
    ))
    session.commit()


def test_run_autolabel_applies_multiple_labels_and_gates(session, engine, monkeypatch):
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(_als, "MULTILABEL_THRESHOLD", 0.5)

    a = _make_label(session, "label-a")
    b = _make_label(session, "label-b")
    c = _make_label(session, "label-c")
    _seed_msg(session, 1, 0, "lab01.ipynb", "msg one")
    _seed_msg(session, 2, 0, "lab01.ipynb", "msg two")

    multi_select_seen = {}

    def fake_classify(label_defs, examples_by_label, messages, multi_select=False):
        multi_select_seen["value"] = multi_select
        # message index 0 -> two labels above threshold + one below; index 1 -> none
        return [
            {"index": 0, "label": "label-a", "confidence": 0.9},
            {"index": 0, "label": "label-b", "confidence": 0.8},
            {"index": 0, "label": "label-c", "confidence": 0.2},  # below threshold
        ]

    monkeypatch.setattr(_als, "classify_batch", fake_classify)
    main._run_autolabel()

    assert multi_select_seen["value"] is True, "general autolabel must call with multi_select=True"

    ai_apps = session.exec(
        select(LabelApplication).where(LabelApplication.applied_by == "ai")
    ).all()
    by_label = {app.label_id for app in ai_apps}
    assert a.id in by_label, "label-a (0.9) should be applied"
    assert b.id in by_label, "label-b (0.8) should be applied"
    assert c.id not in by_label, "label-c (0.2) below threshold must NOT be applied"
    # Message index 1 got no entries -> stays unlabeled.
    assert all(app.chatlog_id == 1 for app in ai_apps), "only message 1 should be labeled"
    assert main._autolabel_status["error"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py::test_run_autolabel_applies_multiple_labels_and_gates -v`
Expected: FAIL — either `multi_select` is `False` (assert fails) or `label-c` is persisted because no gate exists.

- [ ] **Step 3: Update the call site**

In `server/python/main.py` line ~1467, change:

```python
                results = classify_batch(label_defs, examples_by_label, batch)
```

to:

```python
                results = classify_batch(label_defs, examples_by_label, batch, multi_select=True)
```

- [ ] **Step 4: Add the confidence gate in the consumer loop**

In `_run_autolabel`'s consumer loop, replace the existing persist block (lines ~1492-1504) — the `if not existing:` body — with a version that clamps and gates before writing:

```python
                    if not existing:
                        conf = r.get("confidence")
                        if isinstance(conf, (int, float)):
                            conf = max(0.0, min(1.0, float(conf)))
                        else:
                            conf = None
                        # Multi-select gate: only persist labels the model is
                        # confident enough about. Missing/non-numeric confidence
                        # is treated as below threshold (not persisted).
                        if conf is None or conf < autolabel_service.MULTILABEL_THRESHOLD:
                            continue
                        db.add(LabelApplication(
                            label_id=label_map[label_name],
                            chatlog_id=msg["chatlog_id"],
                            message_index=msg["message_index"],
                            applied_by="ai",
                            confidence=conf,
                        ))
```

Confirm `autolabel_service` is imported in `main.py`. The function uses `from autolabel_service import classify_batch` locally (line ~1366); add a module-level reference at the top of `_run_autolabel`'s body so the constant resolves:

```python
    from autolabel_service import classify_batch
    import autolabel_service
```

(The `import autolabel_service` line lets `autolabel_service.MULTILABEL_THRESHOLD` resolve and lets tests monkeypatch it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py::test_run_autolabel_applies_multiple_labels_and_gates -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/python/main.py server/python/tests/test_multilabel_autolabel.py
git commit -m "feat(autolabel): multi-select general autolabel with confidence gate"
```

---

## Task 4: Confirm the split flow is unchanged

**Files:**
- Test: `server/python/tests/test_multilabel_autolabel.py`
- Reference only (no change): `server/python/main.py:~1290-1345`

- [ ] **Step 1: Write a guard test**

Append to `server/python/tests/test_multilabel_autolabel.py`:

```python
import inspect


def test_split_flow_calls_classify_batch_single_select():
    """The label-split background function must NOT pass multi_select=True;
    splits are a 1-of-2 partition and must keep exactly-one-label semantics."""
    src = inspect.getsource(main)
    # Find the split function body region and assert it does not opt into multi_select.
    # The general flow is the only multi_select=True call site.
    assert src.count("multi_select=True") == 1, (
        "Exactly one call site (the general autolabel) should pass multi_select=True"
    )
```

- [ ] **Step 2: Run the test**

Run: `cd server/python && uv run pytest tests/test_multilabel_autolabel.py::test_split_flow_calls_classify_batch_single_select -v`
Expected: PASS (only `_run_autolabel` opts in; the split flow uses the default).

- [ ] **Step 3: Commit**

```bash
git add server/python/tests/test_multilabel_autolabel.py
git commit -m "test(autolabel): guard split flow stays single-select"
```

---

## Task 5: Full suite + docs

**Files:**
- Modify: `CLAUDE.md` (Required environment section — add the new optional env var)

- [ ] **Step 1: Run the entire backend test suite**

Run: `cd server/python && uv run pytest`
Expected: PASS (all tests, including the new file and `test_autolabel_fixes.py`).

- [ ] **Step 2: Document the env var**

In `CLAUDE.md`, find the `## Required environment` bullet list (it ends with the `EXT_DB_URL` line: `- Optional: \`EXT_DB_URL\` overrides the default PostgreSQL connection string`). Add a new optional bullet directly after it:

```
- Optional: `CHATSIGHT_MULTILABEL_THRESHOLD` — minimum AI confidence (0.0–1.0, default 0.5) for a multi-label auto-label to be persisted in queue mode. Lower it (e.g. 0.3) if auto-labeling is too sparse.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document CHATSIGHT_MULTILABEL_THRESHOLD"
```

---

## Notes / risks

- **Module reload in Task 1 tests:** `importlib.reload(autolabel_service)` re-runs the module, which reconstructs the Gemini `client`. This is fine in tests (a dummy key is set), but the two reload tests must restore the default at the end (the second test does). Keep these two tests self-contained; do not let them run after the `_run_autolabel` test in a way that leaves a reloaded module — they are ordered first in the file.
- **`autolabel_service.MULTILABEL_THRESHOLD` is read at import.** Tests that need a specific threshold should `monkeypatch.setattr(autolabel_service, "MULTILABEL_THRESHOLD", X)` (as Task 3 does) rather than setting the env var, to avoid reload churn.
- The split flow (`_run_label_split`) is intentionally untouched; Task 4 is a regression guard, not a behavior change.
