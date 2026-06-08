# Multi-label Auto-labeling Design

**Date:** 2026-06-08
**Status:** Approved (pending implementation plan)
**Branch:** study/week-scoped-routes

## Problem

In multi-label queue mode, a human instructor can apply **multiple** labels to a
single student message (toggle several labels on, then advance). But when the
instructor hands off to Gemini's batch auto-labeler, each message receives
**exactly one** label. The auto-label output is therefore strictly less
expressive than human labeling in the same mode.

Auto-label should match the human capability: a message can carry zero, one, or
many AI labels.

## Root cause

The single-label-per-message behavior is not a schema limitation — it is forced
by the prompt. In `server/python/autolabel_service.py`:

- The system instruction says *"Assign exactly one label to each message."*
- `build_prompt` reinforces one-label-per-index.

The `classify_messages` tool returns a **flat** `classifications` array of
`{index, label, confidence}`. The consumer loops in `main.py` already write one
`LabelApplication` per `(label, message)` and dedup per
`(label_id, chatlog_id, message_index)`. So the data structures already support
multiple rows per message index — only the prompt prevents it.

**Important constraint:** `classify_batch` is shared by two flows:
- `_run_autolabel` — general multi-label auto-labeling (the target of this change).
- `_run_label_split` (`main.py:~1290`) — splits one label into two sub-labels by
  redistributing each orphaned message into **exactly one** of two new buckets,
  then deletes the original label. This is a 1-of-2 **partition**, not a
  multi-label assignment. Making it multi-select would let a message land in
  both or neither bucket — and "neither" silently drops the message when the
  original label is deleted.

Therefore the new behavior must be **opt-in per call**, leaving the split flow
on today's exactly-one-label semantics.

## Decisions

| Decision | Choice |
|---|---|
| How labels are chosen | Multi-select in one batch call, each label carrying a confidence; only persist labels above a threshold |
| Zero labels allowed? | Yes — a message that fits no label (above threshold) stays unlabeled |
| Threshold source | Global env var `CHATSIGHT_MULTILABEL_THRESHOLD`, default `0.5` |

Rejected alternatives:
- **Binary per label** (N independent yes/no passes): most accurate but N× API
  cost; rejected for cost.
- **Per-label threshold override + env fallback**: more flexible but needs a
  model column + migration; rejected as unnecessary for now (YAGNI).
- **Hardcoded constant**: not tunable without redeploy; rejected.
- **Always ≥1 label (best-fit fallback)**: rejected — conflicts with faithful
  multi-label semantics where some messages genuinely fit no label.

## Design

### 1. `autolabel_service.py` — opt-in multi-select

- Add a `multi_select: bool = False` parameter to both `build_prompt` and
  `classify_batch`. Default `False` preserves today's exactly-one behavior for
  the split flow.
- Provide **two** system-instruction strings (single vs. multi) and select the
  matching `GenerateContentConfig` inside `classify_batch` based on
  `multi_select`. The multi variant instructs the model to assign **every**
  label that applies, emitting a **separate** entry per applicable label for the
  same `index`, and to emit **no** entry for a message that fits no label.
- **Tool description** (`classify_messages`) and the `classifications` item
  description: clarify that the same `index` may appear multiple times (once per
  applicable label) or be absent entirely. (Shared by both modes; the per-call
  system instruction governs how many labels are emitted.)
- **`build_prompt`** closing instruction: when `multi_select`, mirror the
  "all that apply / none is allowed" wording; otherwise keep the existing
  one-label wording.
- **`classify_batch`** return shape is **unchanged**: still a flat
  `list[{index, label, confidence}]`, now possibly with repeated or missing
  indices when `multi_select=True`.
- Add module-level constant:
  `MULTILABEL_THRESHOLD = float(os.environ.get("CHATSIGHT_MULTILABEL_THRESHOLD", "0.5"))`.

### 2. Confidence threshold gate (consumer side)

Applied in `main.py` **only** at the general flow `_run_autolabel`
(line ~1364), which now calls `classify_batch(..., multi_select=True)`.

After clamping `conf` to `[0.0, 1.0]`:
- If `conf` is `None` / non-numeric, treat as **below** threshold → do not persist.
- If `conf < autolabel_service.MULTILABEL_THRESHOLD`, do not persist.
- Otherwise persist the `LabelApplication` (with existing dedup check).

A label only lands when the model is explicitly confident enough.

The split-flow consumer (`main.py:~1290`) calls `classify_batch` with the
default `multi_select=False` and **does not** apply the gate — it keeps today's
exactly-one-label partition behavior, fully unchanged.

### 3. Zero-label outcome

Falls out naturally: a message with no surviving entries gets no
`LabelApplication` and stays unlabeled. No best-fit fallback.
`_autolabel_status["processed"]` continues advancing per batch, so progress
reporting is unaffected.

## What does NOT change

- DB schema, `models.py`, migrations — none.
- The multi-write guard (`_assert_multi_write`), Week 3 scope filtering
  (`QUEUE_SCOPE`), dedup logic, batch size (30), and stop-flag handling.
- Single-label `/run` mode and `binary_autolabel_service.py`.
- `classify_batch`'s public return type.

## Testing

- Mock Gemini so `classify_batch` returns, for one batch:
  - multiple entries for a single `index` (above threshold) → assert multiple
    `LabelApplication` rows written for that message.
  - a sub-threshold entry → assert it is **not** persisted.
  - an `index` with no entries → assert the message stays unlabeled.
- Verify the split flow (`classify_batch` with default `multi_select=False`)
  still produces exactly one label per message and does **not** apply the gate.

## Trade-offs / risks

- With a `0.5` default and "zero allowed", cautious model output may under-label
  early runs. `CHATSIGHT_MULTILABEL_THRESHOLD` is the tuning knob — lower toward
  `0.3` if coverage is too sparse.
