# Week-scoped routes (user-study branch)

**Date:** 2026-06-01
**Branch:** `study/week-scoped-routes` (off `main`)
**Status:** Design approved, pending spec review

## Motivation

For the upcoming user study we want each labeling interface scoped to a single
week of DSC 10 (Winter 2026) coursework, so participants label a bounded,
comparable slice of conversations. A secondary goal: when an instructor triggers
**handoff** in single-label mode, Gemini should only classify the in-scope week,
not the entire chatlog corpus — keeping auto-labeling fast during sessions.

## Scope mapping

Weeks come from the Winter 2026 schedule
(<https://dsc-courses.github.io/dsc10-2026-wi/>), cross-checked against the
repo's own `server/python/data/milestones/dsc10_wi26.json`:

| Route   | Mode         | Week | Assignments       |
|---------|--------------|------|-------------------|
| `/queue`| multi-label  | 3    | Lab 1 + HW 1      |
| `/run`  | single-label | 8    | Lab 5 + HW 5      |

(Week 3 = "Histograms and Functions": Lab 1 due Jan 20, HW 1 due Jan 21.
Week 8 = "Hypothesis and Permutation Testing": Lab 5 due Feb 23, HW 5 due Feb 25.)

Quizzes and discussions are excluded — only graded notebook assignments (Lab/HW)
map to `MessageCache.notebook` filenames.

## Design

### Key constraint

The two routes need **different** scopes, and the message-selection code is
shared: `queue_service.next_message_for_label` backs both single-label `/run`
and multi-label onboarding-browse. So scope is keyed on **label mode**
(multi → Week 3, single → Week 8), not a single global filter.

### 1. New module `server/python/study_scope.py`

Single source of truth. Reuses `assignment_service._canonical_name` so scope is
expressed in the same vocabulary as the rest of the app, and does **not** depend
on `AssignmentMapping` rows having been created by the instructor.

```python
QUEUE_SCOPE = {"Lab 1", "Homework 1"}   # Week 3 — multi-label
RUN_SCOPE   = {"Lab 5", "Homework 5"}   # Week 8 — single-label

def notebook_in_scope(notebook: str | None, names: set[str]) -> bool:
    return notebook is not None and _canonical_name(notebook) in names

def scope_for_mode(mode: str) -> set[str]:
    return RUN_SCOPE if mode == "single" else QUEUE_SCOPE

def in_scope_keys(session, names) -> set[tuple[int, int]]:
    """(chatlog_id, message_index) pairs whose notebook is in scope."""
```

`_canonical_name` maps `hw01.ipynb` → `"Homework 1"`, `lab5.ipynb` → `"Lab 5"`,
etc. (`hw`/`homework` → `Homework`).

### 2. Hard lock — server-side enforcement

The lock is server-side and unconditional: any client-supplied `assignment_id`
is ignored on the locked routes. Enforcement points:

**Queue (Week 3):**
- `/api/queue` — filter `all_cached` candidates to `notebook_in_scope(..., QUEUE_SCOPE)`.
- `/api/queue/stats` and `/api/queue/position` — restrict `total`/`labeled`/`skipped`
  denominators to in-scope keys so progress numbers match the bounded queue.

**Run (Week 8):**
- `queue_service.next_message_for_label` — filter `cache_rows` by the label's
  mode-derived scope (single → `RUN_SCOPE`). Multi-mode callers
  (onboarding-browse) get `QUEUE_SCOPE`.
- `decision_service.compute_readiness` — `total_conversations` counts only
  in-scope conversations, so the readiness denominator reflects Week 8.
- `main._do_classification` — restrict the `pending` set to in-scope keys, so
  the Gemini handoff classifies only Week 8 (the performance goal).

### 3. Frontend

Since the server now ignores `assignment_id` on these routes, the assignment
picker becomes a no-op and should be hidden/disabled to avoid confusion:
- `/run`: hide the assignment picker in `StripBar`.
- `/queue`: hide the assignment picker if present.
- Each page shows a small fixed-scope label, e.g. "Week 3 — Lab 1 & HW 1" /
  "Week 8 — Lab 5 & HW 5".

### 4. Tests

Backend (`pytest`, in-memory SQLite):
- `study_scope.notebook_in_scope` — Lab 1 / HW 1 / Homework 1 notebooks match
  `QUEUE_SCOPE`; Lab 5 matches `RUN_SCOPE`; Lab 2 / unmapped match neither.
- `/api/queue` returns only Week-3 messages; a seeded Week-5 message never appears.
- single-label `next_message_for_label` (single mode) returns only Week-8 messages.
- `_do_classification` pending set excludes out-of-scope messages (Gemini call
  mocked).

## Out of scope / non-goals

- No DB schema change; no new migration. Scope is computed from existing
  `MessageCache.notebook`.
- No change to the labeling pipeline, AI prompt construction, or analysis pages.
- Week→assignment mappings are hardcoded constants for this study branch (not
  configurable via UI) — intentional, since the study fixes them. The lock as a
  whole is gated by `CHATSIGHT_STUDY_LOCK` (default ON); it exists only so the
  legacy test suite (which seeds unscoped data) can disable it via
  `conftest.py`. Production/study runs leave it ON.
- This branch is not intended to merge to `main` as-is; it is a study fixture.

## Success criteria

- `/queue` surfaces only Week-3 (Lab 1 / HW 1) messages; stats/position reflect
  that bounded set.
- `/run` surfaces only Week-8 (Lab 5 / HW 5) messages; readiness denominator and
  Gemini handoff classification are both bounded to Week 8.
- Assignment pickers no longer present a choice on either route.
- Backend tests pass.
