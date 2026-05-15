# Context-aware embeddings — design spec

**Date:** 2026-05-15
**Branch:** to be created from `main` or `summaries-revamp` when implementation starts
**Owner:** @m1nce
**Status:** Draft — pending user approval

---

## 1. Motivation

`server/python/concept_service.py:51` embeds the bare student message text:

```python
texts = [messages[i]["message_text"] for i in batch_idx]
```

For messages whose meaning is **entirely defined by what they're responding to** — `"?"`, `"yes"`, `"ok"`, `"i think 4"`, `"did i"` — this produces vectors that collapse together regardless of label. A `"?"` that means "confusion at a fill-in-the-blank prompt" embeds identically to a `"?"` that means "I don't understand your explanation, please rephrase" and a `"?"` that means "wait, are you asking me?". Two consequences:

1. **`/run` assist-flank misleads.** The "your closest prior decisions" sidebar (powered by cosine NN over `MessageEmbedding` via `assist_service.py`) for a focused `"?"` surfaces priors like `"did i do this right"` and `"how does my code look now?"` — all marked YES for the `validation` label — because they're all "short student messages" by embedding similarity. The instructor sees three prior YESes and is implicitly nudged toward YES, but the focused `"?"` is *not* validation in context (the prior tutor turn was a content question, not a self-check prompt).

2. **`/summaries` concept clusters mix labels.** `discover_concepts` (concept_service.py:209) clusters bare-text embeddings, so clusters group by surface form ("all `?`s", "all short affirmations") rather than by pedagogically meaningful pattern. Cluster names produced by `_build_discovery_prompt` reflect that surface grouping.

Both surfaces share the same `MessageEmbedding` cache. Fixing the embedding strategy fixes both.

---

## 2. Approach

Replace bare-text embedding with **conversation-pair embedding**: each student message is embedded together with its immediately-preceding tutor turn, prefixed by speaker labels to give the embedding model role structure.

**Embedded text format** (the string passed to Gemini's `embed_content`):

```
Tutor: {context_before truncated to last 500 chars}
Student: {message_text}
```

When `context_before` is absent (first student turn in a conversation, or missing in cache), embed the student message alone with a `[Conversation start]\nStudent: {message_text}` prefix so the format is still consistent.

This is option **A** from the brainstorming discussion. Options B (windowed multi-turn) and D (per-label context recipe) are out of scope. Option **C (LLM-summarized context)** is documented in §10 as the next escalation if A's clusters still mix labels in measurable ways.

---

## 3. Scope

**In scope:**
- Modify `embed_messages` (concept_service.py) to accept context and build the pair text.
- Bump the embedding cache version so stale single-message vectors are not reused.
- Update `discover_concepts` to fetch `context_before` from `MessageCache` and pass it in.
- Update `_build_discovery_prompt` so the cluster-naming prompt shows Gemini the pair format too.
- Tests: `test_concept_service.py` updated to cover the new pair format and cache key.

**In scope (continued):**
- A one-line filter addition in `assist_service.py:21` to scope the loaded matrix to the new `model_version`, so old + new vectors are never mixed in the same cosine matrix during the transition. This is consistency-of-cache, not a redesign of ranking logic.

**Out of scope (deliberate):**
- `binary_autolabel_service.py` — the classifier reads textual prompts, not embeddings, so its fix is separate (a related-but-distinct spec).
- Re-embedding live production cache as a backfill job — the new cache key will simply re-embed on demand. A separate one-shot script can be added later if eager re-embed is wanted.
- `MessageCache` schema changes — `context_before` already exists at `main.py:97-101` and is populated at cache build time.
- Multi-turn context windows (option B) — single previous tutor turn is the v1 commitment.
- Per-label context recipes (option D).
- Changing how the assist sidebar ranks or displays neighbors — only the filter on which vectors get loaded changes; the ranking algorithm is untouched.

---

## 4. Where the context comes from

`MessageCache.context_before` (defined in `models.py:135`) is populated at cache-build time by the SQL at `main.py:97-101`:

```sql
(SELECT e2.payload->>'response' FROM events e2
 WHERE e2.payload->>'conversation_id' = s.conv_id
   AND e2.event_type = 'tutor_response' AND e2.id < s.id
 ORDER BY e2.id DESC LIMIT 1) AS context_before
```

So the immediately-preceding tutor turn is already available in local SQLite for every cached student message. No external DB query is needed at embed time. **`embed_messages` does not need to fetch context itself** — the caller (`discover_concepts`) reads it from `MessageCache` and passes it in alongside `message_text`.

---

## 5. API changes

### `embed_messages` (concept_service.py)

**Before:**
```python
def embed_messages(messages: List[Dict[str, Any]], db: Session) -> np.ndarray:
    # ...
    texts = [messages[i]["message_text"] for i in batch_idx]
```

Each message dict required keys: `chatlog_id`, `message_index`, `message_text`.

**After:**
```python
def embed_messages(messages: List[Dict[str, Any]], db: Session) -> np.ndarray:
    # ...
    texts = [_build_pair_text(messages[i]) for i in batch_idx]
```

Each message dict requires keys: `chatlog_id`, `message_index`, `message_text`. New optional key: `context_before: Optional[str]`. If absent or `None`, treated as "first turn".

### New private helper

```python
CONTEXT_CHAR_LIMIT = 500  # last 500 chars of tutor context — the question the student is responding to

def _build_pair_text(msg: Dict[str, Any]) -> str:
    """Build the text that gets embedded for one student message.

    Format:
        Tutor: <last 500 chars of preceding tutor turn>
        Student: <message_text>

    If no preceding tutor turn exists (first student message in a conversation),
    fall back to:
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

`CONTEXT_CHAR_LIMIT = 500` is chosen so the tutor context fits in a few sentences (~80-100 words) — enough for the actual question or prompt without diluting the student's signal. The last N chars (not first N) is correct because the question is usually at the end of a tutor turn.

### Cache invalidation

Bump the `EMBED_MODEL` constant:

```python
EMBED_MODEL = "gemini-embedding-001:pair-v1"
```

The actual model called via `client.models.embed_content` stays `"gemini-embedding-001"`:

```python
EMBED_API_MODEL = "gemini-embedding-001"  # what Gemini accepts
EMBED_MODEL = "gemini-embedding-001:pair-v1"  # what we store as model_version (cache key)
# ...
result = client.models.embed_content(model=EMBED_API_MODEL, contents=texts)
```

This way, old cached rows (where `model_version = "gemini-embedding-001"`) remain untouched on disk but are never matched by the new lookup. New rows are written under the new model_version. On-disk size grows during the transition; a cleanup query can drop the old rows once the new ones are warm:

```sql
DELETE FROM messageembedding WHERE model_version = 'gemini-embedding-001';
```

This deletion is **not** part of v1 — leaving the old rows is safe and allows rollback by reverting `EMBED_MODEL` if A doesn't pan out.

### `discover_concepts` caller update

`discover_concepts` is invoked from `main.py:1906` and similar sites (`grep -n "discover_concepts" server/python/`). Wherever the caller builds the `messages: List[Dict]` list, it should join `MessageCache.context_before` into each dict.

If the caller already queries `MessageCache` for `message_text`, adding `MessageCache.context_before` to the SELECT is a one-line change. If the caller assembles the dict from a different source, it should look up `MessageCache.context_before` by `(chatlog_id, message_index)` before calling.

### `_build_discovery_prompt` update

The function (`concept_service.py:129`) currently shows Gemini bare student-text samples (line 154-156):

```python
for s in samples:
    text = s["message_text"][:300]
    parts.append(f'- "{text}"')
```

Update to show the pair format so Gemini sees the context when naming clusters:

```python
for s in samples:
    ctx = (s.get("context_before") or "").strip()
    if ctx:
        ctx_short = (ctx[-200:] if len(ctx) > 200 else ctx).replace("\n", " ")
        text = s["message_text"][:300]
        parts.append(f"- Tutor asked: \"{ctx_short}\"")
        parts.append(f"  Student replied: \"{text}\"")
    else:
        text = s["message_text"][:300]
        parts.append(f'- (start of conversation) Student: "{text}"')
```

Limit context to last 200 chars in the prompt (shorter than the embedding limit) to keep the prompt size manageable across N samples × K clusters.

---

## 6. Behavior on edge cases

| Case | Handling |
|------|----------|
| First student turn in a conversation (no `context_before`) | Fall back to `[Conversation start]\nStudent: {text}` format. Same key shape, no special path downstream. |
| `context_before` exists but is empty string | Treated as missing (`not ctx` is true). Same fallback path. |
| Very long tutor turn (e.g., a multi-paragraph explanation) | Truncated to last 500 chars before pair text is built. Loses early context but preserves the immediate prompt the student is responding to. |
| Very long student turn (rare; usually short) | No truncation. Gemini embeds up to 8K tokens; even a 2K-char student response is well within budget. |
| Multiple `tutor_response` events between two student turns | `MessageCache.context_before` already picks the most recent one (`ORDER BY id DESC LIMIT 1` in the SQL). No change needed. |
| `MessageCache` row missing entirely | Caller treats this as "no context available" and falls back. Should not happen during normal operation since cache is built at startup. |

---

## 7. Testing

### Unit tests (`server/python/tests/test_concept_service.py`)

1. **`test_pair_text_with_context`**: `_build_pair_text({"message_text": "yes", "context_before": "Did that solve it?"})` returns `"Tutor: Did that solve it?\nStudent: yes"`.
2. **`test_pair_text_without_context`**: same with `context_before=None` returns `"[Conversation start]\nStudent: yes"`.
3. **`test_pair_text_truncates_long_context`**: tutor context of 2000 chars is truncated to last 500.
4. **`test_embed_messages_uses_pair_text`**: mock `client.models.embed_content`, call `embed_messages` with a message dict that has `context_before`, assert the `contents` arg to `embed_content` is `["Tutor: ...\nStudent: ..."]`, not the bare text.
5. **`test_cache_key_uses_new_model_version`**: after embedding, the `MessageEmbedding` row's `model_version` is `"gemini-embedding-001:pair-v1"`.
6. **`test_old_cached_embedding_not_reused`**: pre-seed `MessageEmbedding` with `model_version="gemini-embedding-001"` (old key). Call `embed_messages` — must call `embed_content` (cache miss under new key) and write a new row.

### Spot-check (not automated — manual verification by user)

After implementation, run `discover_concepts` on the live data. Compare:
- Cluster names before vs after (qualitative — do they describe semantically meaningful patterns now?).
- A handful of known-bare-text examples (`?`, `yes`, `ok`) — their assist-flank nearest neighbors should now reflect context-aware similarity.

This is the empirical signal for "did A work". §10 below describes what "didn't work" looks like.

---

## 8. Migration / rollout

1. Land the code change (cache key bump means existing on-disk vectors are not consulted).
2. First request to `discover_concepts` or the assist-flank rebuild path will re-embed messages under the new key. With a typical sample size (a few hundred messages), this completes in seconds to a minute and costs a fraction of a cent.
3. (Optional, deferred) Drop the old rows: `DELETE FROM messageembedding WHERE model_version = 'gemini-embedding-001';`
4. Rollback path: revert `EMBED_MODEL` to `"gemini-embedding-001"`. The old rows are still on disk and lookups hit them again.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Tutor context overwhelms student signal (long tutor turn, short student turn) | 500-char trailing truncation. If still problematic, escalate to **C** (LLM-summarized context, §10). |
| Cache double-storage during transition | Acceptable for v1. Deletion of old rows is a one-line SQL when desired. |
| `_build_discovery_prompt` token budget exceeded for many clusters × many samples | Context limited to 200 chars in the prompt (shorter than the embedding limit of 500). For 8 clusters × 5 samples × ~200 chars context + 300 chars student, total is ~5K chars ≈ 1.3K tokens for cluster bodies. Well within budget. |
| Behavioral surprise in `/run` assist flank during the first session post-deploy | The neighbors will change — that's the point. Worth noting in a release-notes line for the instructor. Not a correctness issue. |
| Future caller of `embed_messages` forgets to pass `context_before` | `context_before` is optional and falls back gracefully. No crash, just degraded similarity for that caller. Acceptable. |

---

## 10. Escalation path: option C

If after deploying A, clusters and assist-flank neighbors are still measurably wrong on the labels that motivated this change (`validation`, `cooperation`), escalate to **option C: LLM-summarized context**.

**Criteria for "A didn't work"** (any one is sufficient):
- The `validation` clusters from `discover_concepts` still group `"?"`s from confusion contexts with `"did i do this right"`s — measurable by spot-check on a 20-message sample.
- Assist-flank neighbors for a known-confusion `"?"` still return validation-shaped priors with > 0.7 cosine — measurable by manual probe.
- Instructor reports the flank/clusters feel similarly noisy to before.

**Option C sketch** (for context; not a spec):
- Before embedding, ask Gemini-Flash to produce a one-sentence "what is the student doing here, in context" summary that synthesizes the surrounding turns.
- Embed the summary instead of the pair text.
- Cost: one extra Gemini call per message (cached the same way), ~$0.0001 per call at current rates.
- Risk: Gemini hallucinations in the summary propagate to embedding space.

C is documented here so the path forward is clear. It is NOT implemented in v1.

---

## 11. File map

### Modified
- `server/python/concept_service.py` — new `_build_pair_text` helper; `embed_messages` uses it; `EMBED_MODEL` renamed and split (`EMBED_API_MODEL` + `EMBED_MODEL`); `discover_concepts` passes `context_before` into the message dicts when assembling them; `_build_discovery_prompt` shows pair format.
- Caller(s) of `discover_concepts` in `main.py` — include `MessageCache.context_before` when assembling the message list passed to the function.
- `server/python/tests/test_concept_service.py` — new tests (§7), existing tests updated where they assert on the embedded text format.

### Modified (cross-module, one-line addition)
- `server/python/assist_service.py:19-25` — `_build_cache` currently selects all `MessageEmbedding` rows with no filter. Add a `.where(MessageEmbedding.model_version == EMBED_MODEL)` to ensure the cosine matrix only contains vectors built under the new pair-v1 strategy. Import `EMBED_MODEL` from `concept_service` (or define a shared constant). Without this filter, the assist matrix would mix old bare-text vectors with new pair vectors after rollout, producing incoherent neighbor results until the old rows are deleted.

### New
- None — no new files, no schema changes.

---

## 12. Success criteria

1. `embed_messages` produces vectors built from `"Tutor: ...\nStudent: ..."` (or the no-context fallback) pair text.
2. `MessageEmbedding` rows produced after the change have `model_version = "gemini-embedding-001:pair-v1"`.
3. `discover_concepts` end-to-end runs without error using the new pipeline on a small live sample.
4. Cluster names produced for a labeled sample (e.g., `validation`) describe meaningful patterns rather than surface forms — qualitative judgment by the user during manual spot-check.
5. The `/run` assist flank for a focused `"?"` returns context-similar priors (priors that were also short responses to fill-in-the-blank or content questions), not the highest-cosine bare-text matches.
6. Test suite green; `npx tsc --noEmit` unchanged (this is a Python-only change).
