# Concept Induction Rework — RAG-Style Discovery Design

**Date:** 2026-05-01
**Branch:** `fix-induction`
**Status:** Design approved; pending written-spec review before implementation plan
**Source brief:** `docs/suggestions/D-concept-induction-rework.md`

## Problem

The current concept-induction feature (PR #32) embeds messages, runs KMeans, and asks Gemini to name each cluster. In practice the proposals come back **more specific than the label they were run against** — sub-categories, micro-labels, single-message specializations. That is the opposite of the workflow's intent: instructors want **broad labels applied in combination**, not narrow specializations. The feature exists but fights the grain of the labeling work.

Concept induction is also the oldest AI-discovery piece in the schema and the only one not yet rethought against how instructors actually label.

This document is the design contract for the rework. It resolves every tension in the source brief and is the input to the implementation plan that follows.

## Decisions

| Tension from brief | Decision |
|---|---|
| What to discover | **Mode A — Missing broad labels** (default) and **Mode B — Co-occurrence patterns** |
| Where to look | A: messages with no human labels (AI-only applications still count as in-pool). B: messages with ≥2 human labels |
| Granularity bias | Coverage-targeted retrieval over the residual set with max-min diversity selection. **No KMeans on the discovery path.** |
| When to fire | On-demand only, with a "discovery is ripe" badge gated by drift signal (PR #36) + pool size. **Never auto-fires.** |
| What instructor does | Mode A: accept auto-creates a `LabelDefinition` and auto-applies as `applied_by="ai"`, low confidence. Mode B: note-only ("make a combo label" / "suggest merge" / "dismiss") |
| Measuring useful | Per-candidate decision fields + new `DiscoveryRun` table. No UI dashboard in v1. |

## Framing — RAG-style discovery

Three roles compose into one pipeline, parameterized by mode:

```
                        ┌─────────────────┐
   Trigger              │   query_kind    │
   (manual / badge)     └────────┬────────┘
                                 │
              ┌──────────────────┴───────────────────┐
              │                                      │
       Mode A — broad labels                Mode B — co-occurrence
              │                                      │
      ┌───────▼────────┐                    ┌────────▼─────────┐
      │   RETRIEVE     │                    │     RETRIEVE     │
      │  residual_set  │                    │  co_occur_pairs  │
      │ (max-min div.) │                    │   (≥ min_count)  │
      └───────┬────────┘                    └────────┬─────────┘
              │                                      │
      ┌───────▼────────┐                    ┌────────▼─────────┐
      │   AUGMENT      │                    │     AUGMENT      │
      │  + schema      │                    │  + label defs    │
      │  + style hints │                    │  + co-occur      │
      │  + rejected    │                    │    counts        │
      └───────┬────────┘                    └────────┬─────────┘
              │                                      │
      ┌───────▼────────┐                    ┌────────▼─────────┐
      │   GENERATE     │                    │     GENERATE     │
      │ broad labels   │                    │ combo proposals  │
      │ (function-call)│                    │  (function-call) │
      └───────┬────────┘                    └────────┬─────────┘
              │                                      │
      ┌───────▼────────┐                    ┌────────▼─────────┐
      │ ConceptCandid. │                    │  ConceptCandid.  │
      │ kind="broad_   │                    │  kind="co_       │
      │   label"       │                    │    occurrence"   │
      └────────────────┘                    └──────────────────┘
```

Retrieval and generation are pure functions in separate modules. `discover()` is the only orchestrator. KMeans is removed entirely from the discovery path.

## Architecture

### Module layout

- `server/python/concept_retrieval.py` — **new**. Pure NumPy + SQL. No Gemini calls (except the deterministic embedding model). No DB writes.
- `server/python/concept_generation.py` — **new**. Owns Gemini prompts and tool schemas for both modes.
- `server/python/concept_service.py` — **rewritten**. Becomes a thin orchestrator. Old KMeans path deleted.

### `concept_retrieval.py`

```python
def thinly_labeled_pool(db) -> list[Message]:
    """Mode A corpus: messages with zero human LabelApplications.
       AI-only applications do not count as labeled, since the
       point of discovery is to find what the schema (instructor
       intent) doesn't yet cover. Excludes messages with at least
       one applied_by='human' LabelApplication."""

def retrieve_residual(
    db, threshold: float = 0.55, target_size: int = 80
) -> list[Message]:
    """Mode A retrieval. Score each pool message by max cosine similarity
       to any active LabelDefinition embedding. Keep messages whose max
       similarity is below `threshold` (the residual: schema's blind spot).
       Run max-min diversity selection over residual embeddings to pick
       `target_size` messages that span the residual."""

def retrieve_co_occurrence(
    db, min_count: int = 8
) -> list[CoOccurrencePair]:
    """Mode B retrieval. Aggregate human LabelApplications by
       (chatlog_id, message_index). For each unordered pair of
       LabelDefinitions, count co-occurrences. Return pairs with
       count >= min_count, with example message excerpts."""

def select_diverse(vectors: np.ndarray, k: int) -> list[int]:
    """Greedy max-min farthest-point sampling. No clustering.
       Seed with random vector, iteratively add the vector whose
       minimum distance to already-selected vectors is largest."""
```

Granularity-bias fix lives here: messages reach the LLM as a **diverse spread**, not a centroid-tight neighborhood. Narrow labels cannot span the spread, so the prompt naturally elicits broader proposals.

### `concept_generation.py`

```python
def generate_broad_labels(
    retrieved: list[Message],
    existing_labels: list[LabelDefinition],
    rejected_names: list[str],
) -> list[ConceptDraft]:
    """Mode A. Single Gemini function call. Prompt emphasizes BREADTH:
       - retrieved messages span semantic space (not a tight neighborhood)
       - explicit instruction: "a useful label here covers ≥15% of these
         messages and is meant to co-apply with existing labels"
       - constraint: must be distinct from existing, not in rejected list
       - tool returns: name, description, evidence_message_ids"""

def generate_co_occurrence_concepts(
    pairs: list[CoOccurrencePair],
    existing_labels: list[LabelDefinition],
) -> list[ConceptDraft]:
    """Mode B. For each frequent pair, ask Gemini whether the
       combination represents a coherent third concept worth its own
       label, OR is essentially a redundancy worth merging, OR is just
       two independent things that happen to co-occur. Returns drafts
       with one of three suggested resolutions."""
```

### `concept_service.py`

```python
def discover(db, query_kind: str, trigger: str) -> DiscoveryRun:
    """Orchestrator. Creates a DiscoveryRun row, dispatches to the
       right retrieval+generation path, persists ConceptCandidate rows
       referencing the run, sets run.completed_at and run.n_candidates.
       Errors are caught and stored in run.error; the run is always
       finalized."""

def is_discovery_ripe(db) -> RipeSignal:
    """Computes pool size and reads the PR #36 drift signal.
       Returns ripe=True only when both pass thresholds.
       Cheap; safe to poll on a 30s cadence."""

def accept_broad_label(candidate_id: int, db) -> AcceptResult:
    """Mode A acceptance: creates a LabelDefinition from the candidate,
       auto-applies it to evidence_message_ids with applied_by='ai',
       confidence=0.6. Sets candidate.decision='accept',
       candidate.created_label_id, candidate.decided_at."""
```

## Schema changes

Three changes to `server/python/models.py`. SQLite + `SQLModel.metadata.create_all` handles the new table; the existing startup migration block in `main.py` adds new columns to `ConceptCandidate` if missing. No destructive migration; existing rows remain valid.

### New: `DiscoveryRun`

```python
class DiscoveryRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    query_kind: str                          # "broad_label" | "co_occurrence"
    trigger: str                             # "manual" | "badge"
    drift_value_at_trigger: Optional[float]  # null on Mode B or pre-#36 history
    pool_size_at_trigger: int                # |corpus| at trigger time
    n_candidates: int = 0                    # populated on completion
    error: Optional[str] = None
```

### Extended: `ConceptCandidate`

New nullable columns appended; legacy columns kept for backwards compat.

```python
kind: str = "broad_label"                                    # "broad_label" | "co_occurrence"
discovery_run_id: Optional[int] = Field(default=None,
                                          foreign_key="discoveryrun.id")
shown_at: Optional[datetime] = None
decided_at: Optional[datetime] = None
decision: Optional[str] = None                               # accept | reject | dismiss | suggest_merge | note
created_label_id: Optional[int] = Field(default=None,
                                          foreign_key="labeldefinition.id")
evidence_message_ids: Optional[str] = None                   # JSON: [{"chatlog_id": int, "message_index": int}]
co_occurrence_label_ids: Optional[str] = None                # JSON: [int, int] (Mode B only)
co_occurrence_count: Optional[int] = None                    # Mode B only
```

Legacy `status` and `source_run_id` columns remain for older rows; new code reads/writes `decision` and `discovery_run_id` only.

### Unchanged

`LabelApplication`, `LabelDefinition`, `MessageEmbedding`, `LabelingSession`, `SkippedMessage`, `MessageCache`. The existing `applied_by="ai"` + `confidence` fields on `LabelApplication` are exactly what Mode A's auto-apply needs.

## API endpoints

Routes added/modified in `server/python/main.py`. Existing background-thread pattern (`_discover_status` global) is preserved and extended to include `query_kind` so concurrent runs of different modes still 409.

### Modified

```
POST /api/concepts/discover
  body: { query_kind: "broad_label" | "co_occurrence",
          trigger: "manual" | "badge" }
  → { run_id: int, status: "running" }

GET  /api/concepts/candidates?run_id=&kind=&decision=
  → list of ConceptCandidate including new fields
```

### New

```
GET  /api/concepts/ripe
  → { ripe: bool, pool_size: int, drift_value: float | null,
      reasons: ["pool_below_threshold" | "drift_low" | "ok"] }

POST /api/concepts/candidates/{id}/accept           # Mode A
  body: {}
  → { candidate_id, created_label_id, applied_count }

POST /api/concepts/candidates/{id}/dismiss
  body: { reason?: string }
  → { ok: true }

POST /api/concepts/candidates/{id}/note             # Mode B
  → { ok: true }

POST /api/concepts/candidates/{id}/make-label       # Mode B
  → { candidate_id, created_label_id }              # no auto-apply

POST /api/concepts/candidates/{id}/suggest-merge    # Mode B
  body: { archive_label_id: int, keep_label_id: int }
  → { archived_label_id, kept_label_id, retagged_count }
  Reuses the existing label-archive flow; no new merge logic.

GET  /api/concepts/runs?limit=20
  → list of DiscoveryRun rows
```

### Deprecated but kept

```
PUT  /api/concepts/candidates/{id}    # legacy generic status update
GET  /api/concepts/embed-status
```

## Frontend

Three surfaces. All in `src/`. The existing `DiscoverSection` and `DiscoverModal` are extended, not replaced.

### Mode picker — `src/components/queue/DiscoverSection.tsx`

- Two buttons: **"Find missing labels"** (Mode A) and **"Find label patterns"** (Mode B).
- A small ripeness pill next to each button. Lit when `/api/concepts/ripe` returns `ripe: true` for that mode. Tooltip: *"Drift detected on 3 labels • 87 unlabeled messages ready"*.
- Mode B button hidden until ≥2 messages have ≥2 human labels (otherwise the button has nothing to do).

### Candidate cards — `src/components/queue/DiscoverModal.tsx`

One modal, two card layouts driven by `candidate.kind`.

**Broad-label card:**
- Header: name, description.
- Body: 3–5 evidence excerpts.
- Actions: `Accept & apply` (primary) → calls `/accept` → toast: *"Created 'X' and applied to N messages as AI labels — visible in queue."* `Edit then accept` → opens inline rename/redescribe form, then `/accept`. `Dismiss` → `/dismiss`.

**Co-occurrence card:**
- Header: "**X** + **Y** appear together on **N** messages."
- No primary action — co-occurrence is informational by design.
- Actions: `Make a combo label` (opens inline form pre-seeded with `X+Y` as suggested name; calls `/make-label`). `Suggest merge` (opens chooser: which label to archive; calls `/suggest-merge`). `Note only` (calls `/note`). `Dismiss`.

Both card types show the source `DiscoveryRun.id` and `query_kind` in a subtle footer for traceability.

### Ripeness badge

Pulsing dot on the Discover entry point in `ProgressSidebar` when `/api/concepts/ripe` returns `ripe: true` for *either* mode. Polled every 30s while the queue page is mounted; cleanup on unmount. Per-mode dots inside the modal say which mode is ripe.

### Types — `src/types/index.ts`

```ts
type ConceptCandidate = {
  // ...existing fields
  kind: "broad_label" | "co_occurrence";
  evidence_message_ids?: { chatlog_id: number; message_index: number }[];
  co_occurrence_label_ids?: [number, number];
  co_occurrence_count?: number;
  created_label_id?: number;
  decision?: "accept" | "reject" | "dismiss" | "suggest_merge" | "note";
};

type RipeSignal = {
  ripe: boolean;
  pool_size: number;
  drift_value: number | null;
  reasons: string[];
};
```

### Mocks — `src/mocks/index.ts`

Add fixtures for both `kind` values and a stub `/ripe` response so the frontend stays mock-runnable (`VITE_USE_MOCK=true`).

### Unchanged

Routing, the queue's main labeling flow, label management, history page. The discover surface is the only frontend touch point.

## Rollout — six iterative phases

Implementation runs sequentially in the main session. **No subagents, no parallel agents.** Each phase ends with an explicit stop where the user reviews and commits. No commits are created by Claude.

### Phase 1 — Schema + DB scaffold

- Add `DiscoveryRun` model. Extend `ConceptCandidate` with new nullable columns.
- Update startup migration code in `main.py` to add columns to existing SQLite if missing.
- Backend tests: model creation, columns nullable on old rows, FK integrity.

**STOP — user reviews & commits** (suggested message: `feat: schema for RAG-style concept discovery`).

### Phase 2 — Retrieval module

- Build `concept_retrieval.py` with `thinly_labeled_pool`, `retrieve_residual`, `retrieve_co_occurrence`, `select_diverse`.
- Tests with synthetic embeddings + fixture `LabelApplication` rows. No Gemini key needed.

**STOP — user reviews & commits** (suggested message: `feat: retrieval primitives for concept discovery`).

### Phase 3 — Generation module + orchestrator

- Build `concept_generation.py` with both prompts and tool schemas.
- Rewrite `concept_service.discover()` as the orchestrator. Delete the KMeans path.
- Tests: stub Gemini client, verify prompt construction and persistence, verify error handling writes to `DiscoveryRun.error`.

**STOP — user reviews & commits** (suggested message: `feat: RAG-style discovery orchestrator`).

### Phase 4 — API endpoints

- Add `/discover` (mode-aware), `/ripe`, `/accept`, `/dismiss`, `/note`, `/make-label`, `/suggest-merge`, `/runs`. Extend `/candidates`.
- Implement `is_discovery_ripe` reading the PR #36 drift signal.
- Tests: endpoint contracts, accept-applies-AI-labels behavior, suggest-merge reuses existing archive flow.

**STOP — user reviews & commits** (suggested message: `feat: concept discovery API endpoints`).

### Phase 5 — Frontend mode picker + candidate cards

- Extend `DiscoverSection` with two-button mode picker + ripeness pills.
- Extend `DiscoverModal` with kind-discriminated cards and per-kind action handlers.
- Add `RipeSignal` and extended `ConceptCandidate` types.
- Update `src/services/api.ts` with new endpoints. Update mocks.
- Vitest tests for both card types.

**STOP — user reviews & commits** (suggested message: `feat: mode-aware discover UI with ripeness signal`).

### Phase 6 — Polling badge + cleanup

- Wire ripeness polling on `QueuePage` with cleanup-on-unmount.
- Remove dead code from old KMeans path.
- End-to-end manual test: run a Mode A discovery, accept a candidate, verify AI labels appear in queue with revertibility. Run Mode B, make a combo label, verify it appears in legend.

**STOP — user reviews & commits** (suggested message: `feat: discovery ripeness badge + cleanup`).

## Success metrics

All four signals from the brief's signalbox are derivable from data captured in Phase 1. No additional instrumentation is needed.

| Signal | Computed as | Threshold |
|---|---|---|
| ≥1 accepted label applied to >10 messages | `count(LabelApplication)` grouped by `LabelDefinition.id` where `id IN (created_label_id from ConceptCandidate where decision='accept')`, max ≥ 10 | At least one accepted label crosses 10 within 2 weeks of acceptance |
| Fewer near-duplicates on labels page | Pairwise cosine sim of `name + description` embeddings; count pairs above 0.85 | Trending down across runs vs. pre-rework baseline |
| Schema trends broader, not narrower | Avg `LabelApplication` count per labeled message over time | Increases or holds steady; never declining |
| Voluntary re-invocation | `DiscoveryRun` count grouped by session, `trigger='manual'` | ≥2 manual runs in a session for ≥1 instructor |

### Drift-as-trigger experiment

The brief asks whether drift is the right premise. The answer must be a *finding*, not a built-in assumption.

- Compute acceptance rate per `DiscoveryRun.trigger`: `accepted / n_candidates` for `trigger='badge'` vs `trigger='manual'`.
- Decision rule (after ≥10 runs):
  - Badge runs have meaningfully higher acceptance → drift was useful → promote to auto-trigger in v2.
  - Equal or lower → drift was noise → keep on-demand-only and remove the badge.

### Read surface

Direct SQL queries against `chatsight.db` during research check-ins. No dashboard in v1. (Adding visualization is unjustified until we know which numbers matter.)

## Out of scope

- Replacing the legacy `status` and `source_run_id` columns (deprecated but kept).
- Promoting the badge to an auto-trigger (v2; gated by the experiment above).
- Mode C — missing-axes query (the brief's "axes the schema isn't using" tension). v2 candidate; needs a different prompt and a different evaluation story.
- The "confirm-each" Variant C acceptance UX — open inline mini-queue of evidence per acceptance.
- A discovery-health UI panel.

## Open risks

- **Threshold choice for `retrieve_residual`.** The default `threshold=0.55` for max-cosine-similarity-to-any-label is a reasonable starting point but unvalidated against this corpus. Phase 6's manual end-to-end test should sanity-check that the residual set is non-empty at meaningful schema sizes; tune from there.
- **`min_count=8` for co-occurrence may be too high in early sessions.** With <40 multi-labeled messages, almost no pairs cross 8. Acceptable; Mode B button is hidden until the pool is sufficient anyway.
- **Drift signal coupling.** `is_discovery_ripe` reads PR #36's drift signal; if that signal's API changes, the ripeness badge needs updating. Mitigation: a single read-site, easy to follow.
- **Auto-applied AI labels can pollute the corpus** if the model picks a low-quality candidate and the instructor isn't paying attention. Mitigation: low confidence (0.6) + visibility in the queue with revert affordance + the existing `applied_by="ai"` distinction in any analysis.
