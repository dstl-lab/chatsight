# Context-Aware Embeddings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bare-student-text embeddings in `concept_service.py` and the assist-flank lookup with conversation-pair embeddings ("Tutor: ...\nStudent: ...") so meaning depends on context, not surface form.

**Architecture:** `embed_messages` builds pair text from each message dict's optional `context_before`, sends that to Gemini's embedding API (unchanged), and stores under a bumped `model_version = "gemini-embedding-001:pair-v1"`. The single caller in `main.py` adds the context field to its message dicts; the cluster-naming prompt shows Gemini the pair format; `assist_service._build_cache` adds a one-line filter so old + new vectors are never mixed. `MessageCache.context_before` already exists (`models.py:135`) — no schema changes.

**Tech Stack:** Python 3, FastAPI, SQLModel, pytest, Gemini API (`gemini-embedding-001` for embeddings, `gemini-2.0-flash` for cluster naming), scikit-learn KMeans.

**Spec:** `docs/superpowers/specs/2026-05-15-context-aware-embeddings-design.md`

**User preference:** This codebase user reviews and commits changes themselves. Tasks end with a "stop for user review" step instead of `git commit`. Group related task output before stopping so the user can review and commit at a natural breakpoint.

---

## File Structure

### Modified

| File | Change |
|------|--------|
| `server/python/concept_service.py` | Split `EMBED_MODEL` into `EMBED_API_MODEL` (call signature) + `EMBED_MODEL` (cache key); new `_build_pair_text` helper; `embed_messages` uses helper; `_build_discovery_prompt` shows pair format. |
| `server/python/main.py` | Single message-dict assembly at line 2043-2047 adds `context_before` field. |
| `server/python/assist_service.py` | `_build_cache` filters by `model_version == EMBED_MODEL`. |
| `server/python/tests/test_concept_service.py` | New tests for pair-text helper, pair-format embedding call, cache-key bump, and pair-format in discovery prompt. Existing tests left intact (they exercise the no-context fallback). |
| `server/python/tests/test_assist_service.py` | New test verifying the model_version filter excludes stale-key vectors. |

### Unchanged
- `server/python/models.py` — `MessageCache.context_before` already exists.
- `server/python/database.py` — no migration needed.
- All frontend code.

### New
- None.

---

## Task 1: `_build_pair_text` helper

**Files:**
- Modify: `server/python/concept_service.py` (add the helper at module scope, just above `def embed_messages`)
- Modify: `server/python/tests/test_concept_service.py` (add unit tests for the helper)

- [ ] **Step 1: Write the failing tests**

Append to `server/python/tests/test_concept_service.py`:

```python
def test_pair_text_with_context():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": "Did that solve it?",
    })
    assert out == "Tutor: Did that solve it?\nStudent: yes"


def test_pair_text_without_context():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": None,
    })
    assert out == "[Conversation start]\nStudent: yes"


def test_pair_text_treats_empty_context_as_missing():
    from concept_service import _build_pair_text
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": "",
    })
    assert out == "[Conversation start]\nStudent: yes"


def test_pair_text_truncates_long_context():
    from concept_service import _build_pair_text, CONTEXT_CHAR_LIMIT
    long_ctx = "A" * 800 + "tail-marker"
    out = _build_pair_text({
        "message_text": "yes",
        "context_before": long_ctx,
    })
    # Truncation keeps the LAST CONTEXT_CHAR_LIMIT chars (where the prompt usually lives).
    assert "tail-marker" in out
    assert out.startswith("Tutor: ")
    # The Tutor segment should be exactly CONTEXT_CHAR_LIMIT chars.
    tutor_line = out.split("\n")[0]  # "Tutor: <ctx>"
    assert len(tutor_line) - len("Tutor: ") == CONTEXT_CHAR_LIMIT


def test_pair_text_handles_missing_context_key():
    """If the caller dict lacks `context_before` entirely (legacy path), fall back gracefully."""
    from concept_service import _build_pair_text
    out = _build_pair_text({"message_text": "hello"})
    assert out == "[Conversation start]\nStudent: hello"
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd server/python && uv run pytest tests/test_concept_service.py::test_pair_text_with_context tests/test_concept_service.py::test_pair_text_without_context tests/test_concept_service.py::test_pair_text_treats_empty_context_as_missing tests/test_concept_service.py::test_pair_text_truncates_long_context tests/test_concept_service.py::test_pair_text_handles_missing_context_key -v
```

Expected: 5 tests FAIL with `ImportError: cannot import name '_build_pair_text' from 'concept_service'` (and `CONTEXT_CHAR_LIMIT`).

- [ ] **Step 3: Implement the helper**

In `server/python/concept_service.py`, add this immediately after the existing `EMBED_BATCH_SIZE = 100` constant (and before the `def embed_messages` declaration):

```python
CONTEXT_CHAR_LIMIT = 500


def _build_pair_text(msg: Dict[str, Any]) -> str:
    """Build the text that gets embedded for one student message.

    Pair format:
        Tutor: <last CONTEXT_CHAR_LIMIT chars of preceding tutor turn>
        Student: <message_text>

    When there is no preceding tutor turn (first student message in a conversation,
    or context not provided by the caller), fall back to a consistent prefix that
    keeps the embedding distribution roughly aligned with the pair format:

        [Conversation start]
        Student: <message_text>
    """
    student = msg["message_text"]
    ctx = msg.get("context_before")
    if not ctx:
        return f"[Conversation start]\nStudent: {student}"
    truncated = ctx[-CONTEXT_CHAR_LIMIT:] if len(ctx) > CONTEXT_CHAR_LIMIT else ctx
    return f"Tutor: {truncated}\nStudent: {student}"
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd server/python && uv run pytest tests/test_concept_service.py -v
```

Expected: All 5 new tests PASS plus the 3 existing concept_service tests still PASS (8 total).

- [ ] **Step 5: Stop for user review**

Surface: "Task 1 done — `_build_pair_text` helper added with 5 unit tests, existing concept_service tests still pass. Continue?"

---

## Task 2: Wire `embed_messages` to use the helper + bump cache key

**Files:**
- Modify: `server/python/concept_service.py` — split `EMBED_MODEL` into two constants; route `embed_messages` through `_build_pair_text`; ensure cached rows under the OLD key are not consulted under the NEW key.
- Modify: `server/python/tests/test_concept_service.py` — new tests for the pair-format embedding call, the new cache key, and old-key-not-reused.

- [ ] **Step 1: Write the failing tests**

Append to `server/python/tests/test_concept_service.py`:

```python
@patch("concept_service.client")
def test_embed_messages_sends_pair_text_to_api(mock_client, session):
    """The string passed to the embedding API must be the pair format, not the bare student text."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    from concept_service import embed_messages

    messages = [
        {
            "chatlog_id": 1,
            "message_index": 0,
            "message_text": "yes",
            "context_before": "Did that solve it?",
        },
    ]
    embed_messages(messages, session)

    # The API was called once. Inspect the contents argument.
    call = mock_client.models.embed_content.call_args
    assert call is not None
    contents = call.kwargs["contents"]
    assert contents == ["Tutor: Did that solve it?\nStudent: yes"]


@patch("concept_service.client")
def test_embed_messages_uses_new_model_version_as_cache_key(mock_client, session):
    """Cached MessageEmbedding rows must use the bumped model_version (not the raw API model)."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    from concept_service import embed_messages, EMBED_MODEL

    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "hi", "context_before": "Hello."},
    ]
    embed_messages(messages, session)

    cached = session.exec(select(MessageEmbedding)).all()
    assert len(cached) == 1
    assert cached[0].model_version == EMBED_MODEL
    assert EMBED_MODEL == "gemini-embedding-001:pair-v1"


@patch("concept_service.client")
def test_embed_messages_does_not_reuse_old_key_cache(mock_client, session):
    """A pre-existing row stored under the OLD model_version must NOT short-circuit the new flow."""
    mock_client.models.embed_content.side_effect = (
        lambda **kwargs: _fake_embed_result(kwargs["contents"])
    )

    # Pre-seed a stale-key row.
    session.add(MessageEmbedding(
        chatlog_id=1,
        message_index=0,
        embedding=np.zeros(3072, dtype=np.float32).tobytes(),
        model_version="gemini-embedding-001",  # old key
    ))
    session.commit()

    from concept_service import embed_messages, EMBED_MODEL

    messages = [
        {"chatlog_id": 1, "message_index": 0, "message_text": "hi", "context_before": "Hello."},
    ]
    embed_messages(messages, session)

    # API was called (cache miss under new key).
    assert mock_client.models.embed_content.called

    # We now have two rows: the stale-key row (preserved) and a new-key row.
    rows = session.exec(select(MessageEmbedding)).all()
    versions = sorted(r.model_version for r in rows)
    assert versions == ["gemini-embedding-001", EMBED_MODEL]
```

- [ ] **Step 2: Run new tests to verify they fail**

```
cd server/python && uv run pytest tests/test_concept_service.py::test_embed_messages_sends_pair_text_to_api tests/test_concept_service.py::test_embed_messages_uses_new_model_version_as_cache_key tests/test_concept_service.py::test_embed_messages_does_not_reuse_old_key_cache -v
```

Expected: 3 tests FAIL — either ImportError on `EMBED_MODEL` (still the old string), or assertion failure on the contents being bare text.

- [ ] **Step 3: Update `EMBED_MODEL` constants in `server/python/concept_service.py`**

Find (around line 15):

```python
EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 3072
EMBED_BATCH_SIZE = 100  # Gemini API limit per call
```

Replace with:

```python
EMBED_API_MODEL = "gemini-embedding-001"  # passed to the Gemini API
EMBED_MODEL = "gemini-embedding-001:pair-v1"  # stored as MessageEmbedding.model_version (cache key)
EMBED_DIM = 3072
EMBED_BATCH_SIZE = 100  # Gemini API limit per call
```

- [ ] **Step 4: Route `embed_messages` through the new helper + use the new API constant**

In `server/python/concept_service.py`, find the body of `embed_messages` (around line 20). Locate this block:

```python
        result = client.models.embed_content(
            model=EMBED_MODEL,
            contents=texts,
        )
```

Replace with:

```python
        result = client.models.embed_content(
            model=EMBED_API_MODEL,
            contents=texts,
        )
```

And find this block earlier in the function:

```python
        texts = [messages[i]["message_text"] for i in batch_idx]
```

Replace with:

```python
        texts = [_build_pair_text(messages[i]) for i in batch_idx]
```

The cache write block (around line 62) already stores `model_version=EMBED_MODEL` — that line stays as-is, and now correctly stores the bumped key.

- [ ] **Step 5: Find and update the other `EMBED_MODEL` use inside the function (cache lookup)**

Find this block in `embed_messages` (around line 33-38):

```python
        cached = db.exec(
            select(MessageEmbedding).where(
                MessageEmbedding.chatlog_id == msg["chatlog_id"],
                MessageEmbedding.message_index == msg["message_index"],
                MessageEmbedding.model_version == EMBED_MODEL,
            )
        ).first()
```

This is already correct — `EMBED_MODEL` is now the new pair-v1 string, so the lookup will correctly miss the old-key rows. No change needed; just verify by re-reading.

- [ ] **Step 6: Find and update other call sites of the embedding API in this file**

Two other places in `concept_service.py` call `client.models.embed_content` with `EMBED_MODEL`:

Around line 193 (in `_deduplicate_concepts`):

```python
    result = client.models.embed_content(model=EMBED_MODEL, contents=texts)
```

Around line 281 (in `discover_concepts`, embedding label texts):

```python
        label_embed_result = client.models.embed_content(
            model=EMBED_MODEL,
            contents=label_texts,
        )
```

Both of these embed concept/label strings, not student messages — they do not interact with the `MessageEmbedding` cache. But they pass `model=EMBED_MODEL` to the Gemini API, which after Step 3 is the cache-key string `"gemini-embedding-001:pair-v1"` — NOT a valid Gemini model name. **Both must be updated** to use `EMBED_API_MODEL`:

```python
    result = client.models.embed_content(model=EMBED_API_MODEL, contents=texts)
```

and

```python
        label_embed_result = client.models.embed_content(
            model=EMBED_API_MODEL,
            contents=label_texts,
        )
```

- [ ] **Step 7: Run the full concept_service test suite to verify everything still passes**

```
cd server/python && uv run pytest tests/test_concept_service.py -v
```

Expected: All tests pass (existing 3 + 5 helper tests from Task 1 + 3 new wiring tests = 11 total).

- [ ] **Step 8: Stop for user review**

Surface: "Task 2 done — `embed_messages` builds pair text, cache key bumped to `gemini-embedding-001:pair-v1`, three other API call sites in the same file updated to use the renamed `EMBED_API_MODEL`. 11 tests in test_concept_service.py all pass. Continue?"

---

## Task 3: Update `_build_discovery_prompt` to show pair format

**Files:**
- Modify: `server/python/concept_service.py` — change the sample-rendering loop inside `_build_discovery_prompt` to show context-aware lines.
- Modify: `server/python/tests/test_concept_service.py` — new test for the prompt content.

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_concept_service.py`:

```python
def test_discovery_prompt_includes_tutor_context_when_present():
    from concept_service import _build_discovery_prompt

    samples_by_cluster = {
        0: [
            {
                "message_text": "yes",
                "context_before": "Did that solve it?",
            },
            {
                "message_text": "?",
                "context_before": "What would go in the blank to make this statement true?",
            },
        ],
    }
    prompt = _build_discovery_prompt(samples_by_cluster, existing_labels=[], rejected_names=[])

    # When context is present, the prompt shows BOTH tutor and student turns.
    assert "Tutor asked:" in prompt
    assert "Student replied:" in prompt
    assert "Did that solve it?" in prompt
    assert "What would go in the blank to make this statement true?" in prompt


def test_discovery_prompt_handles_missing_context():
    from concept_service import _build_discovery_prompt

    samples_by_cluster = {
        0: [
            {"message_text": "hello", "context_before": None},
        ],
    }
    prompt = _build_discovery_prompt(samples_by_cluster, existing_labels=[], rejected_names=[])

    # When no context, the prompt marks this as the start of the conversation.
    assert "(start of conversation)" in prompt
    assert "hello" in prompt
    # The "Tutor asked:" prefix must NOT appear for this sample.
    # (There may be other samples in other clusters that legitimately have it, but here there's just one sample.)
    assert "Tutor asked:" not in prompt
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd server/python && uv run pytest tests/test_concept_service.py::test_discovery_prompt_includes_tutor_context_when_present tests/test_concept_service.py::test_discovery_prompt_handles_missing_context -v
```

Expected: 2 tests FAIL — the current prompt only shows bare student text.

- [ ] **Step 3: Update `_build_discovery_prompt`**

In `server/python/concept_service.py`, find the sample-rendering loop (around line 152-157):

```python
    for cluster_id, samples in samples_by_cluster.items():
        parts.append(f"### Cluster {cluster_id}")
        for s in samples:
            text = s["message_text"][:300]
            parts.append(f'- "{text}"')
        parts.append("")
```

Replace with:

```python
    for cluster_id, samples in samples_by_cluster.items():
        parts.append(f"### Cluster {cluster_id}")
        for s in samples:
            text = s["message_text"][:300]
            ctx = (s.get("context_before") or "").strip()
            if ctx:
                # Show last 200 chars of tutor context (where the prompt usually is)
                # to keep the discovery prompt size manageable across N×K samples.
                ctx_short = (ctx[-200:] if len(ctx) > 200 else ctx).replace("\n", " ")
                parts.append(f'- Tutor asked: "{ctx_short}"')
                parts.append(f'  Student replied: "{text}"')
            else:
                parts.append(f'- (start of conversation) Student: "{text}"')
        parts.append("")
```

- [ ] **Step 4: Run the prompt tests to verify they pass**

```
cd server/python && uv run pytest tests/test_concept_service.py -v
```

Expected: All 13 tests in test_concept_service.py pass (the 11 from Task 1+2 + the 2 new ones).

- [ ] **Step 5: Stop for user review**

Surface: "Task 3 done — `_build_discovery_prompt` shows tutor context when present and a (start of conversation) marker otherwise. 13 tests pass. Continue?"

---

## Task 4: Update `discover_concepts` caller in `main.py` to include `context_before`

**Files:**
- Modify: `server/python/main.py` — add `context_before` field to the message dicts assembled at line 2043-2047.

There is no test added in this task — the change is a single field added to a dict literal, and the upstream behavior is verified by Task 2's test of `embed_messages`. If the user wants integration coverage, the existing `test_discover_concepts_returns_candidates` test in `test_concept_service.py` already passes the new field path through (with `context_before=None` via `.get()`), so the integration is implicitly covered.

- [ ] **Step 1: Locate the caller**

Open `server/python/main.py` and find the block around line 2040-2047 (inside the `_discover_run` background task):

```python
            all_messages = []
            for mc in db.exec(select(MessageCache)).all():
                key = (mc.chatlog_id, mc.message_index)
                if key not in labeled_keys:
                    all_messages.append({
                        "chatlog_id": mc.chatlog_id,
                        "message_index": mc.message_index,
                        "message_text": mc.message_text,
                    })
```

- [ ] **Step 2: Add `context_before` to the dict**

Replace the inner block with:

```python
            all_messages = []
            for mc in db.exec(select(MessageCache)).all():
                key = (mc.chatlog_id, mc.message_index)
                if key not in labeled_keys:
                    all_messages.append({
                        "chatlog_id": mc.chatlog_id,
                        "message_index": mc.message_index,
                        "message_text": mc.message_text,
                        "context_before": mc.context_before,
                    })
```

That is the only change. `MessageCache.context_before` is `Optional[str]` and already populated at startup.

- [ ] **Step 3: Run the full backend test suite to confirm nothing breaks**

```
cd server/python && uv run pytest -v
```

Expected: All tests pass (the existing main.py tests do not exercise the discovery background task directly; the field addition is benign).

- [ ] **Step 4: Stop for user review**

Surface: "Task 4 done — `main.py:2043` now passes `context_before` into the discover_concepts message dicts. Full backend test suite passes. Continue?"

---

## Task 5: Add `model_version` filter in `assist_service._build_cache`

**Files:**
- Modify: `server/python/assist_service.py` — import `EMBED_MODEL` from `concept_service`; add `.where(MessageEmbedding.model_version == EMBED_MODEL)` to the `_build_cache` query.
- Modify: `server/python/tests/test_assist_service.py` — new test verifying old-key rows are excluded.

- [ ] **Step 1: Write the failing test**

Append to `server/python/tests/test_assist_service.py`:

```python
def test_build_cache_filters_by_current_model_version(session):
    """When MessageEmbedding contains rows from both the old (bare-text) and new
    (pair-format) model_versions, _build_cache must load ONLY the new ones.
    Otherwise the assist matrix mixes vectors of incompatible semantics."""
    from concept_service import EMBED_MODEL
    from assist_service import _build_cache

    # Pre-seed two rows: one OLD-key, one NEW-key, both at the same (chatlog_id, message_index).
    session.add(MessageEmbedding(
        chatlog_id=42,
        message_index=0,
        embedding=_emb([1.0, 0.0]),
        model_version="gemini-embedding-001",  # OLD
    ))
    session.add(MessageEmbedding(
        chatlog_id=42,
        message_index=0,
        embedding=_emb([0.0, 1.0]),
        model_version=EMBED_MODEL,  # NEW
    ))
    # Add a second NEW-key row at a different key so the matrix has > 1 vector.
    session.add(MessageEmbedding(
        chatlog_id=99,
        message_index=0,
        embedding=_emb([1.0, 1.0]),
        model_version=EMBED_MODEL,
    ))
    session.commit()

    cache = _build_cache(session, fingerprint=(0, 0, 0))

    # Only the NEW-key vectors should be loaded.
    assert cache["matrix"] is not None
    assert cache["matrix"].shape[0] == 2  # two NEW rows, not three
    keys = set(cache["keys_idx"].keys())
    assert keys == {(42, 0), (99, 0)}

    # Verify (42, 0)'s vector is the NEW one ([0, 1] normalized), not the OLD one ([1, 0]).
    idx = cache["keys_idx"][(42, 0)]
    vec = cache["matrix"][idx]
    # Normalized [0, 1] is just [0, 1]. Normalized [1, 0] is [1, 0]. So vec[1] should be ~1.0.
    assert vec[1] > 0.99
    assert vec[0] < 0.01
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd server/python && uv run pytest tests/test_assist_service.py::test_build_cache_filters_by_current_model_version -v
```

Expected: FAIL — current `_build_cache` loads ALL rows regardless of `model_version`, so the matrix has 3 vectors and (42, 0) might point to either the OLD or NEW one depending on insertion order.

- [ ] **Step 3: Add the import and the filter to `_build_cache`**

In `server/python/assist_service.py`, near the existing imports at the top of the file, add:

```python
from concept_service import EMBED_MODEL
```

Find `_build_cache` (around line 18-25):

```python
def _build_cache(db: Session, fingerprint: tuple[int, int, int]) -> dict:
    rows = db.exec(
        select(
            MessageEmbedding.chatlog_id,
            MessageEmbedding.message_index,
            MessageEmbedding.embedding,
        )
    ).all()
```

Replace with:

```python
def _build_cache(db: Session, fingerprint: tuple[int, int, int]) -> dict:
    rows = db.exec(
        select(
            MessageEmbedding.chatlog_id,
            MessageEmbedding.message_index,
            MessageEmbedding.embedding,
        )
        .where(MessageEmbedding.model_version == EMBED_MODEL)
    ).all()
```

- [ ] **Step 4: Update the fingerprint query to match (so cache invalidation is consistent)**

Find `_embedding_fingerprint` (around line 40-50 in `assist_service.py`):

```python
def _embedding_fingerprint(db: Session) -> tuple[int, int, int]:
    """A cheap signal that detects inserts, deletes, and in-place re-embeds.
    (count, max_id, sum_id) — pure-count was insufficient because re-embedding
    an existing (chatlog_id, message_index) does not change the row count, but
    does change which rows we are now serving."""
    row = db.exec(
        select(
            func.count(MessageEmbedding.id),
            func.coalesce(func.max(MessageEmbedding.id), 0),
            func.coalesce(func.sum(MessageEmbedding.id), 0),
```

After the `select(...)` call, add a `.where(MessageEmbedding.model_version == EMBED_MODEL)` to the chain so the fingerprint reflects ONLY the new-key rows. The exact location depends on the surrounding `).one()`. Read the function fully, then add the `.where(...)` on the existing query (it likely has a `.first()` or `.one()` at the end; insert the `.where()` before it).

The full updated function should look like:

```python
def _embedding_fingerprint(db: Session) -> tuple[int, int, int]:
    """A cheap signal that detects inserts, deletes, and in-place re-embeds.
    (count, max_id, sum_id) — pure-count was insufficient because re-embedding
    an existing (chatlog_id, message_index) does not change the row count, but
    does change which rows we are now serving."""
    row = db.exec(
        select(
            func.count(MessageEmbedding.id),
            func.coalesce(func.max(MessageEmbedding.id), 0),
            func.coalesce(func.sum(MessageEmbedding.id), 0),
        )
        .where(MessageEmbedding.model_version == EMBED_MODEL)
    ).one()
    return (int(row[0]), int(row[1]), int(row[2]))
```

(If the existing function body differs from what's shown above, preserve the existing logic and add only the `.where(...)` call.)

- [ ] **Step 5: Run the assist_service test suite to verify everything passes**

```
cd server/python && uv run pytest tests/test_assist_service.py -v
```

Expected: All existing assist_service tests pass AND the new filter test passes.

**Watch for**: the existing test `test_nearest_neighbors_returns_top_k_by_cosine` and friends seed `MessageEmbedding` rows WITHOUT specifying `model_version` — meaning they use the default value from `models.py:150` which is `"gemini-embedding-001"` (the OLD key). After Step 3, those rows will be filtered out and the existing tests will FAIL.

If they fail, the fix is to update `_seed_message` (in test_assist_service.py around line 26-37) to explicitly set `model_version=EMBED_MODEL`:

```python
def _seed_message(session, chatlog_id, message_index, text, vec):
    from concept_service import EMBED_MODEL
    session.add(MessageCache(
        chatlog_id=chatlog_id,
        message_index=message_index,
        message_text=text,
    ))
    session.add(MessageEmbedding(
        chatlog_id=chatlog_id,
        message_index=message_index,
        embedding=_emb(vec),
        model_version=EMBED_MODEL,
    ))
    session.commit()
```

After updating the seeder, re-run the suite; all assist tests should pass.

- [ ] **Step 6: Run the full backend test suite to confirm no regressions**

```
cd server/python && uv run pytest -v
```

Expected: All tests pass.

- [ ] **Step 7: Stop for user review**

Surface: "Task 5 done — `assist_service._build_cache` and `_embedding_fingerprint` filter by `model_version == EMBED_MODEL`, test seeder updated, all backend tests pass. Continue to final smoke?"

---

## Task 6: End-to-end manual smoke (user action — cannot dispatch)

This task is manual and cannot be performed by a subagent.

- [ ] **Step 1: Start the stack**

```
npm run dev:all
```

- [ ] **Step 2: Trigger concept discovery via the existing UI path**

In single-label or multi-label mode, find the Discover affordance (`src/components/queue/DiscoverSection.tsx` or related; the trigger is via the `/api/concepts/discover` endpoint).

- [ ] **Step 3: Verify cluster names reflect context**

After discovery completes:
- Compare cluster names to what you got before (recall the screenshot showing `validation` clusters mixing surface-form `?` and `yes` responses).
- Names should describe semantically meaningful patterns ("students asking for clarification on fill-in-the-blank prompts") rather than surface forms ("short responses").
- Open a cluster's messages and confirm they actually share a pedagogical pattern, not just a surface form.

- [ ] **Step 4: Verify the assist flank on /run**

Walk to a label run (`/run`) where a focused short-text message appears (`?`, `yes`, `ok`).
- Confirm the "your closest prior decisions" sidebar surfaces priors that are context-similar (priors that were responses to similar tutor prompts), not just bare-text similar.
- Specifically test the scenario from the spec's motivating screenshot: a `?` response to a fill-in-the-blank tutor prompt should surface confusion-like priors, NOT validation-shaped priors like "did i do this right".

- [ ] **Step 5: If A doesn't work — escalate to C**

Apply the criteria from `docs/superpowers/specs/2026-05-15-context-aware-embeddings-design.md` §10:
- `validation` clusters still mix `?` with `did i do this right`?
- Assist neighbors for known-confusion `?` still return validation priors with > 0.7 cosine?
- Instructor feels clusters/flank are still noisy?

If any of these are true, the next move is option **C (LLM-summarized context)**. That requires a new spec, not a fix to this one. Surface to me with what you observed and we'll write the C spec.

- [ ] **Step 6: Final state**

If A worked: commit PRs 1–5 (Tasks 1–5) at your preferred granularity. The full extraction is done.

If A didn't work: keep the working tree, surface to me, and we move to spec C with concrete evidence of where A fell short.

---

## Definition of done

- [ ] `_build_pair_text` helper exists in `concept_service.py` with 5 unit tests passing.
- [ ] `embed_messages` produces vectors from pair text (or the no-context fallback) and stores them with `model_version = "gemini-embedding-001:pair-v1"`.
- [ ] `_build_discovery_prompt` shows Gemini the pair format for cluster naming.
- [ ] `main.py:2043` passes `context_before` into the discovery message dicts.
- [ ] `assist_service._build_cache` and `_embedding_fingerprint` filter by the new `model_version`.
- [ ] All backend tests pass.
- [ ] Manual smoke (Task 6) confirms cluster names and assist neighbors are context-aware.
- [ ] Spec §10 escalation criteria checked; if A doesn't deliver, surface to write spec C.
