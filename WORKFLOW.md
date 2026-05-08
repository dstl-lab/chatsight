# Chatsight workflow

This file is the canonical "what is chatsight, what's built, what's open" pointer for collaborators. CLAUDE.md is for code orientation; this is for *research* orientation. When the two disagree, the more recently edited file wins — please flag the conflict.

Last rewritten: 2026-05-07. Supersedes the 2026-03-28 version (which described the multi-label queue era, before the single-label binary pivot).

---

## Research context

Chatsight is HCI + CS-Education research on student–AI tutoring interactions in an undergraduate data-science course. The AI tutor under study is fine-tuned to reference course material (homeworks, labs, projects) when answering student questions.

The research contribution is **the labeling tool itself** — an interface that makes hybrid AI-assisted chatlog labeling efficient and consistent for instructors. An earlier "scoring equation" framing was deprioritized; what remains valuable is the workflow innovation, not the downstream metric.

---

## Current state (post single-label pivot)

The primary flow is a **per-label binary classification run**: the instructor selects one label at a time and decides yes / no / skip on each student message in a queue. After enough decisions, the run can be handed off so a Gemini classifier labels the rest, and the instructor reviews ambiguous cases.

The older multi-label queue (apply N labels per message in one pass) still works and has its own page, but is dormant for new feature work.

What's in place today (as of 2026-05-07):

- **Single-label run** (`src/pages/LabelRunPage.tsx`, `server/python/decision_service.py`, `queue_service.py`). One label, one focused message, three keys: yes / no / skip.
- **Assist flank**: a per-message panel showing the three nearest cosine-NN neighbors among the instructor's prior decisions, as a calibration anchor (`assist_service.py`, `MessageEmbedding` table). Now scoped by `assignment_id` (PR #41).
- **Assignment mappings**: regex-named groups (e.g. `^lab0?3` → "Lab 3") so a run can be filtered to one lab or project (`AssignmentMapping`, `AssignmentsPage.tsx`).
- **Handoff + sample handoff**: classify all (or `?sample_size=N`) remaining messages with Gemini once the human run is done; instructor reviews low-confidence cases before merge.
- **Label management**: create / merge / split / archive labels; archived labels orphan their applications, which can be returned to the queue or auto-classified into new labels.
- **Concept induction** (`concept_service.py`): cluster unlabeled messages via embedding + KMeans, ask Gemini to name each cluster, surface as candidate labels. Implemented but **lightly used** — not currently part of the primary onboarding flow.
- **Recalibration design** at `docs/superpowers/specs/2026-04-11-recalibration-design.md`: blind re-labeling at adaptive intervals to detect drift. Designed, scaffolding tests exist, **not implemented end-to-end**.
- **Analysis page** (`AnalysisPage.tsx`): coverage table, position distribution, temporal usage, label/notebook heatmap. Reasonably full but not yet research-grade.
- **Bug-audit pass** landed 2026-05-07 (PR #41) hardened assist scope, race guards in the run flow, and a deferred-deletion split-label flow.

> **TODO (user)**: anything in the above list that's wrong, missing, or oversold — please call out before this doc is referenced from collaborator briefs.

---

## Primary flows

| Flow | Page | Status |
|------|------|--------|
| Single-label run (yes / no / skip per message, one label at a time) | `LabelRunPage.tsx` (`/run`) | **Active** — primary flow |
| Multi-label queue (apply N labels per message) | `QueuePage.tsx` (`/queue`) | Legacy; no new feature work |
| Label management (create / merge / split / archive) | `LabelsPage.tsx` (`/labels`) | Active |
| Assignment mappings (regex → assignment name) | `AssignmentsPage.tsx` (`/assignments`) | Active |
| Handoff summaries (post-run AI classification status) | `SummariesPage.tsx` (`/summaries`) | Active |
| Analysis | `AnalysisPage.tsx` (`/analysis`) | Active, sparse on research-grade views |
| History | `HistoryPage.tsx` (`/history`) | Active, minimal |

---

## AI integration points

| Surface | Service | What it does |
|---------|---------|---------------|
| Assist flank | `assist_service.py` (cosine-NN over `MessageEmbedding`) | Surfaces 3 most-similar prior decisions to anchor calibration |
| Handoff classifier | `binary_autolabel_service.py` (Gemini function-calling) | Classifies remaining messages yes / no for one label |
| Multi-label batch (legacy) | `autolabel_service.py` | Classifies messages into N existing label categories |
| Label description from examples | `definition_service.py` | One-sentence Gemini-written label definitions |
| Concept candidates | `concept_service.py` (embedding + KMeans + Gemini naming) | Bottom-up label suggestions from unlabeled clusters |
| Concise summary | `autolabel_service.summarize_message` | Shortens long student messages for display |

---

## What's mature vs WIP

**Mature**: single-label run, assist flank, label management (create / archive / merge / split-with-handoff), assignment mappings, basic analysis coverage.

**WIP / sparse**:
- Recalibration / drift detection (designed, not implemented).
- Multi-rater support (data model still flat per message).
- Classifier evaluation (no systematic measurement of Gemini's quality).
- Classifier prompt / few-shot strategy (uses a fixed prompt, naive examples).
- Concept induction integration (the service exists; the UX flow does not surface it well).
- Analysis page as a research-grade dashboard.

**Dormant**: multi-label queue page (intentional — kept working but not prioritized).

---

## Open questions

These supersede the 2026-03 list (which was tied to the older multi-label flow). Five of these are being assigned to research collaborators as week-of-part-time-work briefs (see `docs/handoffs/`):

1. **Smart picker** — what should the queue show next? Current ordering is conversation-aware but not signal-driven. Active-learning literature offers several routes (uncertainty sampling, diversity, calibration-anchored selection).
2. **Drift** — how do we detect and surface labeler inconsistency within a session? The recalibration design is one answer; others exist.
3. **Multi-rater** — how do we model and resolve disagreement when more than one instructor labels the same data?
4. **Classifier quality** — how good is the Gemini handoff classifier today, and what prompt / few-shot strategy actually moves the needle? Build the eval harness first, then run experiments on top of it.
5. **Onboarding / first-30-minutes UX** — what does a new instructor see on first open? The current flow assumes they already know what "single-label binary" means. Design the first-session experience: tutorial, defaults, what to label first, when to hand off.

Independent (not currently assigned to collaborators):

- **Schema versioning across runs** — when labels are merged or split mid-project, what happens to the analytical history? Today the archive flow handles orphans at the application level; project-wide schema evolution is unclear.
- **Concept induction in the user flow** — the LLOOM-inspired concept service exists but doesn't integrate cleanly with the single-label flow. Where should bottom-up candidates surface?

---

## Inspirations

- **LLOOM** (Lam et al.) — LLM-driven concept extraction and iterative refinement over text corpora. Conceptual ancestor of `concept_service.py`.
- **DocWrangler** (Jiang et al.) — Interactive LLM-assisted document labeling with merge / split / refine. Conceptual ancestor of the label-management flow.

Neither is a direct technical dependency; the influence is on workflow design (bottom-up labels, iterative refinement, AI-as-suggestion-not-arbiter).
