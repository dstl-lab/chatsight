# /run UI: Calibration Anchor + Threshold-Free Progress — Design

**Date:** 2026-05-05
**Status:** Approved, ready for implementation planning
**Scope:** Frontend (`/run` page) + small backend service for nearest-neighbor caching. Single-label binary mode only.

## Motivation

Two complaints with the current `/run` page surfaced through brainstorming:

1. **Empty space on left and right of the 760-px reading column.** On wide monitors, the conversation thread is centered with hundreds of pixels of dead space on either side.
2. **The "X / 17,470" progress display is daunting.** Instructors interpret the denominator as "I have to label all of these," when the product story is that AI does the bulk classification at handoff. The big number lies about the actual workload.

A deeper review surfaced more deficiencies — invisible label definitions, no view of one's own past decisions during labeling, AI rationale-per-message would require runtime Gemini calls that hit rate limits — but the redesign deliberately limits scope to two changes that address (1) and (2) directly without re-architecting the workflow.

## Goal

Add a calm, calibration-focused right flank that shows the instructor their own closest prior decisions for the focused message, drawing on cached Gemini embeddings, with no AI prediction layer. Replace the daunting fractional progress display with a simple count + class breakdown.

The flank is a memory aid for the instructor's own pattern, not an AI classifier surface. There is no confidence percentage, no model versioning visible, no "AI says..." narrative.

## Non-goals

- **No real-time Gemini calls during labeling.** All in-flow inference uses pre-cached embeddings only. The Gemini handoff path stays unchanged.
- **No uncertainty-based queue reordering.** Was considered (Section 3 in brainstorming) and dropped because the queue is conversation-walked for context-coherence reasons; reordering messages by uncertainty would break that. We accept that the marginal benefit at typical labeling volumes (15–40 messages) doesn't justify the architectural complexity.
- **No fitted classifier (logistic regression, SetFit, etc.) in the UI.** Considered and dropped because at typical labeling volumes the prediction would be unreliable, and showing a calibrated probability that the model can't actually deliver would be confidence theater.
- **No threshold gates.** No "20 labels needed to unlock assist." The flank populates from the first label onward; below that it shows a quiet one-line invitation.
- **No changes to the multi-label flow, `concept_service.py`, the Gemini handoff path, or any non-`/run` pages.**

## Design

### Backend: `assist_service.py` + `LabelPrediction` table

A new module `server/python/assist_service.py` provides one operation:

```python
def nearest_neighbors(
    db: Session,
    label_id: int,
    chatlog_id: int,
    message_index: int,
    k: int = 3,
) -> List[Dict[str, Any]]:
    """Return up to k labeled-message neighbors for the given message,
    ranked by cosine similarity over cached MessageEmbedding rows. Each
    entry: {chatlog_id, message_index, value, similarity, message_text}."""
```

A new SQLModel table `LabelPrediction` materializes results for fast retrieval on `/next`:

| column                | type          | notes                                                  |
|-----------------------|---------------|--------------------------------------------------------|
| `id`                  | int (pk)      | autoincrement                                          |
| `label_id`            | int (fk)      | references `LabelDefinition.id`                        |
| `chatlog_id`          | int           | the unlabeled message's conversation                   |
| `message_index`       | int           | the unlabeled message's index in conversation         |
| `nearest_neighbors`   | JSON          | list of `{chatlog_id, message_index, value, similarity, message_text}` (length 0–3) |
| `model_version`       | int           | incremented on each cache rebuild                      |
| `updated_at`          | datetime      |                                                        |

Index: `(label_id, chatlog_id, message_index)` unique. Used both for upserts and for `/next` lookup.

### Cache rebuild trigger

Lazy and infrequent. On every call to `/api/single-labels/{id}/next`:

1. Compare the label's current `human_label_count` (yes + no decisions, excluding skips) against the most recent `model_version` row for this label.
2. If `human_label_count - model_version >= 5` or no rows exist for this label, trigger a rebuild.
3. Rebuild path:
   - Wipe `LabelPrediction` rows for this `label_id`.
   - Compute pending = unlabeled messages for this label.
   - Compute labeled set = (chatlog_id, message_index, value, message_text, embedding) for human-decided messages with cached embeddings.
   - For each pending message with a cached embedding, find the top-3 cosine neighbors among the labeled set and insert a `LabelPrediction` row.
   - Set `model_version = human_label_count`.
4. Return the next focused message as before; the flank will read its `LabelPrediction` row separately.

For 17,000 messages with 30 labeled examples and 3072-dim embeddings, the rebuild runs in well under a second using NumPy cosine operations on the cached embeddings already in `MessageEmbedding`. Rebuild cost is amortized across the next 5+ `/next` calls.

If a pending message has no cached embedding (rare; populated lazily by `concept_service.py`), it gets a `LabelPrediction` row with `nearest_neighbors=[]`. The flank will render the empty state for that message.

### New endpoint: `/api/single-labels/{id}/assist?chatlog_id=X&message_index=Y`

Returns the `nearest_neighbors` JSON for the given message. Frontend calls this when the focused message changes (after each decision or undo, or on page mount).

Alternative considered: include `nearest_neighbors` in the existing `/next` response payload. Rejected because the assist refresh is independent of advancing the queue (e.g., on first load, on undo) and bundling them couples concerns. The dedicated endpoint is also trivially cacheable per `(label_id, chatlog_id, message_index, model_version)` if we ever add browser-side caching.

### Frontend: `AssistFlank` component

New component at `src/components/run/AssistFlank.tsx`. Renders into a 320-px right column in `LabelRunPage.tsx`'s body grid, sibling to `ThreadView`.

Visual specification (matches the high-fidelity mockup at `.superpowers/brainstorm/.../content/assist-flank-v2.html`):

- **Container**: 320px wide, full height of body, `bg-canvas` (no separate raised surface), padding `28px 28px 28px`. On viewports below 1100px, collapsed via a header drawer toggle (deferred — initial implementation can let it overflow).
- **Header**: small mono uppercase label, `font-mono text-[9px] tracking-[0.18em] text-faint`, reads `your closest prior decisions`. Margin-bottom 16px.
- **Neighbor list**: column of up to 3 entries, gap 18px between entries.
- **Per-neighbor entry**:
  - Tag row: dot (5×5px, moss for yes / brick for no), uppercase verdict in moss/brick, faint `·`, `sim 0.84` in muted mono.
  - Quote text: italic Source Serif 4 at 15px, line-height 1.5, `text-on-surface` color, wrapped in opacity-0.4 quote marks.
  - Padding `8px 12px 10px`. Left border 2px transparent → moss-dim/brick-dim on hover. Hover background a 1.5% white overlay.
  - Click behavior, v1: no-op. The citation excerpt (truncated to ~2 lines via `line-clamp-2`) is the affordance; clicking does not navigate. Avoids breaking the instructor's current labeling flow with a context switch. (v2 could open a modal showing the neighbor's full conversation, but that is out of scope for this redesign.)
- **Empty state (0 labeled messages with embeddings yet)**: padding-top bumped to 64px, quiet italic Source Serif 4 line at 15px reading "Your closest prior decisions will appear here as you label." No progress bar, no count, no "X to go." Just a soft invitation.
- **Partial state (1–2 neighbors exist)**: render as many as exist; no padding for the missing slots. The list is intentionally short rather than padded with placeholders.

The flank renders identically in the labeling-phase and reviewing-phase grids. (Reviewing phase = the low-confidence Gemini batch review, where the same neighbor evidence remains useful.) Both call sites in `LabelRunPage.tsx` get the new component.

### StripBar progress display change

The current `count / total` pill in `src/components/run/StripBar.tsx` becomes a no-denominator format with class breakdown:

```
{label.yes_count + label.no_count} labels · {label.yes_count} yes · {label.no_count} no
```

- Number is `font-mono text-[11px]` in `text-on-surface` for the count and `text-moss` / `text-brick` for the yes/no breakdown. Labels (`labels`, `yes`, `no`) are smaller (`text-[9px]`) uppercase mono in `text-faint`.
- Skips are not surfaced in the strip — they appear in the assignment dropdown / queue management, not as part of the labeling-progress narrative. Exact rendering of skips can be revisited later.
- Hover reveals nothing extra. Click target reserved for a future "show summary" interaction but not wired in this redesign.

### Layout grid update in `LabelRunPage.tsx`

The body grid changes from a single column (`ThreadView` only) to a two-column grid (`ThreadView | AssistFlank`):

```tsx
<div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
  <ThreadView ... />
  <AssistFlank labelId={...} chatlogId={...} messageIndex={...} />
</div>
```

This change applies in both the labeling and reviewing branches of `LabelRunPage.tsx`. The `DecisionDock` / `ReviewDock` continue to span full width below.

## Tests

Backend (`server/python/tests/`):

- `test_assist_service.py` (new): unit tests for `nearest_neighbors` returning correct top-k by cosine similarity over fixture embeddings; correct handling of 0 labeled examples (returns empty list), and missing embeddings (returns empty list).
- `test_label_prediction.py` (new): tests for the rebuild trigger — that calling `/next` after 5 new labels invalidates the cache; that calling it after only 2 new labels does not; that wipe-and-rebuild produces the expected `model_version`.
- `test_assist_endpoint.py` (new): integration tests for `GET /api/single-labels/{id}/assist?chatlog_id=...&message_index=...` returning the cached neighbors; 404 when label or message doesn't exist.

Frontend (`src/tests/`):

- `AssistFlank.test.tsx` (new): renders the empty state when neighbors are empty; renders 1–3 entries when neighbors are non-empty; renders correct yes/no styling per entry.
- Existing `StripBar` tests updated to assert the new no-denominator count format.

Mock mode (`src/services/api.ts`): the new `getAssist(...)` API method returns plausible neighbor data when `VITE_USE_MOCK=true`.

## Files affected

**Backend (server/python/):**
- `assist_service.py` — new module, ~80 lines
- `models.py` — add `LabelPrediction` SQLModel class
- `database.py` — add `LabelPrediction` to `SQLModel.metadata.create_all` (already pattern-matched)
- `schemas.py` — add `AssistResponse` Pydantic schema
- `main.py` — add `/api/single-labels/{id}/assist` route + plumb the rebuild-on-`/next` trigger
- `tests/` — new test files as enumerated above

**Frontend (src/):**
- `components/run/AssistFlank.tsx` — new component, ~80 lines
- `components/run/StripBar.tsx` — change progress pill format
- `pages/LabelRunPage.tsx` — wrap `ThreadView` in a two-column grid; thread `chatlogId` / `messageIndex` to `AssistFlank`; refresh assist on focus changes
- `services/api.ts` — add `getAssist(labelId, chatlogId, messageIndex)` method + mock data
- `types/index.ts` — add `AssistNeighbor` and `AssistResponse` types
- `tests/` — new + updated test files

**Out of scope:**
- `concept_service.py` — unchanged
- `binary_autolabel_service.py` — unchanged
- `queue_service.py` / `decision_service.py` — unchanged (no queue reordering)
- All multi-label flow files — unchanged

## Future work (deferred from scope)

- **Conversation-level uncertainty for queue ordering.** If labeling volume turns out higher than expected, revisit Section 3 from brainstorming.
- **Label-propagation pre-pass before Gemini handoff.** Use the LR/embedding-similarity infrastructure to generate soft labels for the full corpus, pass to Gemini as priors. Cuts handoff cost and surfaces disagreements as review candidates.
- **Mobile / narrow-viewport collapse.** The 320-px flank should collapse to a header-drawer toggle below ~1100-px viewports.
- **Label definition surface.** "Invisible label description while labeling" was identified as a deficiency but deferred. The flank could host this in a future iteration without breaking its current shape.
- **kNN→LR upgrade.** If users actually label 50+ messages and the per-message neighbor evidence stops being precise enough, swap the cosine-only retrieval for fitted L2 logistic regression over embeddings, surfacing nearest examples as evidence (not coefficients). The architectural shape stays the same; only `assist_service.nearest_neighbors` changes internally.
