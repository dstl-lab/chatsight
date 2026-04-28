# Single-Label Binary Classification Pivot — Design

**Date:** 2026-04-27
**Branch:** `single-label-pivot` (worktree)
**Status:** Design approved; pending written-spec review before implementation plan

## Problem

The current Chatsight queue flow is multi-label: an instructor walks messages and toggles N labels per message. This conflates two cognitive tasks (recognising which label fits *and* deciding whether each candidate label applies) and makes it hard to know when there is "enough data" to hand any one label to Gemini.

The new workflow makes each label a focused pass:

1. Instructor creates a label.
2. Instructor walks messages **conversation-by-conversation**, deciding **yes / no / skip** for that one label.
3. Once the readiness gauge looks good, Gemini auto-labels the rest of the dataset for that label.
4. Instructor reviews Gemini's low-confidence predictions; corrections override.
5. Repeat for the next label.

This document is the design contract for that pivot. It is the input to the implementation plan that will follow.

## Workflow

Single-label, **strictly serial**. Exactly one label is "active" at any time. The active label has a phase:

| Phase         | Meaning                                                                  |
|---------------|--------------------------------------------------------------------------|
| `labeling`    | Instructor is doing the human pass; readiness gauge gates the handoff UI |
| `handed_off`  | Gemini batch is running or has just finished                             |
| `reviewing`   | Instructor is walking low-confidence AI predictions                      |
| `complete`    | Instructor has closed the label                                          |

Within `labeling`, the queue is built as follows. A conversation is *complete for this label* when every student message in it has a decision (yes / no / skip), *in progress* when some but not all do, and *not started* when none do. Ordering: in-progress conversations first (continued from the conversation cursor), then not-started conversations ordered by `chatlog_id` ascending. Within a conversation, student messages are walked in `message_index` ascending order. Decisions advance to the next undecided student message; when a conversation has none left, the queue jumps to the next conversation. `GET /api/labels/{id}/next` returns `null` when no undecided student messages remain.

Readiness gauge tiers (constants tunable from real use):

- **Gray** — `yes_count == 0 OR no_count == 0`. Handoff disabled.
- **Amber** — `yes_count ≥ 1 AND no_count ≥ 1 AND conversations_walked < 5`. Handoff allowed but discouraged.
- **Green** — `yes_count ≥ 1 AND no_count ≥ 1 AND conversations_walked ≥ 5`. Handoff encouraged.

The instructor decides when to actually click handoff; the gauge is advisory.

Handoff: Gemini predicts `value ∈ {yes, no}` plus `confidence ∈ [0, 1]` for every still-unlabeled student message for this label. Predictions are stored as `LabelApplication` rows with `applied_by="ai"`.

Review pass: queue is the AI predictions with `confidence < REVIEW_THRESHOLD` (default `0.75`), sorted by confidence ascending. Instructor flips or confirms; flipping rewrites the row as `applied_by="human"` with `confidence = 1.0`.

Closing the label clears `is_active` and sets phase `complete`. Instructor activates a new label to begin the next cycle.

## Unit of Decision

Only **student messages** receive decisions. Tutor messages appear as conversation context only.

Decision values are `{yes, no, skip}`:

- `yes` / `no` — training signal for Gemini.
- `skip` — recorded as "I don't know"; excluded from training; sticky (does not re-enter the queue).

A student message is addressed by `(chatlog_id, message_index)` (existing convention; `chatlog_id` is the conversation key, equal to `MIN(event.id)` from the external Postgres). A student message has at most one decision per label, enforced by a unique constraint on `(label_id, chatlog_id, message_index)`.

## Data Model

Local SQLite, fresh database file (`chatsight-single.db`) — no migration from `main`'s `chatsight.db`.

**Modified — `LabelApplication`:**
- Add `value: str` (`"yes" | "no" | "skip"`).
- Keep `applied_by: str` (`"human" | "ai"`) and `confidence: Optional[float]`.
- Add unique constraint on `(label_id, chatlog_id, message_index)`.
- A row now represents an explicit *decision*, not a positive-only assertion.

**Modified — `LabelDefinition`:**
- `description: Optional[str]` already exists; reused as Gemini prompt context.
- Add `phase: str` (see Workflow table; default `"labeling"`).
- Add `is_active: bool` (default `False`). Service layer enforces "exactly one active at a time".

**Repurposed — `LabelingSession`:**
- Add `label_id: int` (foreign key to `LabelDefinition`); each row is one run of one label.
- Add `handed_off_at: Optional[datetime]` and `closed_at: Optional[datetime]`.
- `labeled_count` becomes per-label.

**New — `ConversationCursor`:**
- `(label_id, chatlog_id, last_message_index_decided)`. Primary key is the pair `(label_id, chatlog_id)`.
- Lets the instructor resume mid-conversation after pausing.

**Unchanged — `MessageCache`:** Address is `(chatlog_id, message_index)`. `chatlog_id` is the conversation key (no separate `conversation_id` column). `MessageCache` has no timestamp; cross-conversation ordering uses `chatlog_id` ascending (older conversations have smaller IDs because `chatlog_id = MIN(event.id)` from the external DB). Within a conversation, ordering is `message_index` ascending.

**Unchanged — `MessageEmbedding`, `ConceptCandidate`, `RecalibrationEvent`, `SuggestionCache`, `SkippedMessage`:** Untouched on this branch (`SkippedMessage` is dormant — skips become `LabelApplication` rows with `value="skip"` instead).

## Backend (FastAPI)

All routes in `main.py`, no routers. New / changed:

**Label lifecycle**
- `POST /api/labels` — create label `{name, description}`.
- `GET /api/labels` — list with phase + counts.
- `POST /api/labels/{id}/activate` — make active; deactivates others. Idempotent.
- `POST /api/labels/{id}/close` — set phase `complete`; clear `is_active`.

**Labeling pass**
- `GET /api/labels/{id}/next` — returns `{focused_message, conversation_context, cursor}`.
- `POST /api/labels/{id}/decide` — body `{message_id, value}`; writes `LabelApplication(applied_by="human")`; returns next message or `null`.
- `POST /api/labels/{id}/undo` — reverses the most recent human decision in this session.
- `GET /api/labels/{id}/readiness` — `{conversations_walked, total_conversations, yes_count, no_count, skip_count, ready: bool}`.

**Handoff + review**
- `POST /api/labels/{id}/handoff` — runs Gemini batch over still-unlabeled student messages for this label; writes AI rows; sets phase `handed_off`. Synchronous in v1.
- `GET /api/labels/{id}/review-queue` — AI rows with `confidence < REVIEW_THRESHOLD`, sorted ascending. Cursor pagination.
- `POST /api/labels/{id}/review` — body `{message_id, value}`; overrides AI decision; sets `applied_by="human"`, `confidence=1.0`.

**Discover (kept, off the main path)**
- `POST /api/discover/run`, `GET /api/discover/candidates` — unchanged. Converting a candidate to a label uses the new `POST /api/labels`.

**Gemini service layer (`autolabel_service.py`)**
- New: `classify_binary(label, messages) -> [{message_id, value, confidence}]`.
- Uses Gemini function-calling with a single tool `classify_binary` taking `{message_id, value: "yes" | "no", confidence: float}`.
- Prompt: label `name` + `description` + few-shot block of up to 10 yes + 10 no most-recent human decisions for that label.

**Dormant on this branch**
- The existing multi-label `/api/suggest` and `/api/autolabel` routes remain in code but unreached from the new UI. Cleanup PR after the pivot proves out.

## Frontend

**Routing (`src/App.tsx`)**
- `/` → redirect to `/labels`.
- `/labels` → `LabelsPage` (dashboard).
- `/run` → `LabelRunPage` (the active labeling / review surface).
- `/history` → `HistoryPage` (filtered by label).
- `/analysis` → `AnalysisPage` (placeholder, unchanged).

**New components (`src/components/run/`)**
- `LabelHeader.tsx` — top bar with active label, progress chip, balance chip, readiness gauge, handoff button.
- `ConversationContext.tsx` — scrollable thread of prior turns of the current conversation. Reuses markdown + LaTeX rendering from existing `MessageCard`.
- `FocusedMessage.tsx` — highlighted student message under decision.
- `DecisionBar.tsx` — Yes (green) / No (red) / Skip (neutral) buttons. Keyboard shortcuts `y` / `n` / `s`. Disabled while a request is in flight.
- `ReadinessGauge.tsx` — gray / amber / green visual; tooltip explains gating.
- `UndoToast.tsx` — adapted from existing queue undo.

**Modified components**
- `LabelsPage.tsx` — becomes a dashboard with cards per label showing phase, counts, and a context-appropriate action (`Activate` / `Resume` / `Open review` / `Closed`).
- `DiscoverModal.tsx` — kept; entry point moves to `LabelsPage`.
- `QueuePage.tsx` — left in the tree but unreached on this branch; deletion deferred to a cleanup PR.

**State / API**
- `src/services/api.ts` gets binary-decision helpers: `getNext`, `decide`, `undo`, `readiness`, `handoff`, `getReviewQueue`, `review`.
- Old multi-label helpers stay in place but unused from the new UI.
- A small `useActiveLabel` hook reads / sets the active label and its phase.
- Mock mode (`VITE_USE_MOCK=true`) gets matching stubs in `src/mocks/` so the new UI runs without a backend.

**Visual**
- Dark theme (`bg-neutral-950`) preserved.
- Decision colors: green Yes, red No, neutral Skip.
- Readiness gauge tiers as defined in Workflow.

**Tests**
- New vitest suites for `DecisionBar` (keyboard shortcuts, disabled states) and `ReadinessGauge` (three tiers).
- `LabelRunPage` smoke test using mock-mode fetch.

## Branch and Fork Mechanics

- New branch `single-label-pivot` off `main`.
- Created via `git worktree add ../chatsight-single-label single-label-pivot` so `main` stays live in the existing checkout.
- Untracked files on `main` (`SUGGESTIONS.md`, `docs/suggestions/`) stay in `main`'s working tree and do not follow into the worktree.
- New SQLite file `chatsight-single.db`. `database.py` reads a `LOCAL_DB_PATH` env var (fallback `chatsight.db` to keep `main` unchanged); the worktree sets it to `chatsight-single.db`. Schema created on first startup via `SQLModel.metadata.create_all`.

## Testing Strategy

**Backend (`pytest`, in-memory SQLite per `tests/conftest.py`)**
- `test_label_lifecycle.py` — create → activate → decide → readiness → handoff (mocked Gemini) → review → close.
- `test_decisions.py` — yes/no/skip semantics, undo, queue ordering, conversation cursor.
- `test_handoff.py` — `applied_by="ai"` predictions written, low-confidence review queue assembly.

**Frontend (`vitest` + RTL + jsdom)**
- `DecisionBar` keyboard shortcuts and disabled states.
- `ReadinessGauge` three tiers.
- `LabelRunPage` smoke test in mock mode.

**Manual**
- End-to-end with `VITE_USE_MOCK=true`.
- End-to-end against a live backend with a real label run.

## Out of Scope (this branch)

- Migration of multi-label data from `main`'s database.
- Parallel labels in progress (strictly serial for now).
- Spot-check or full-review queues; only confidence-sorted low-confidence review.
- Deletion of dormant multi-label routes / components.
- Changes to Discover internals.

## Risks and Open Items

- **Handoff latency.** Gemini batch is synchronous in v1. If it's too slow on large datasets, move to a background task + polling endpoint.
- **Skip prevalence.** Skip is excluded from training. If instructors skip heavily, training data may be too thin even when readiness is "green"; revisit gating.
- **Threshold tuning.** Readiness tiers and `REVIEW_THRESHOLD` are seeded from intuition; expect to tune from real use.
- **Few-shot drift.** Most-recent-decisions few-shot is cheap but ignores diversity. If prediction quality is poor, consider stratified sampling across yes/no.
