# Chatsight Labeling Interface — Design Spec

**Date:** 2026-03-28
**Status:** Approved, ready for implementation planning

---

## Overview

Chatsight is an HCI + CS Education research tool that helps instructors efficiently label student-AI tutoring conversations. The research problem: manual labeling of chatlog data is inefficient and inconsistent — rubrics defined upfront need revision mid-process, and team members interpret criteria differently.

This spec describes the new labeling interface, replacing the previous auto-label-with-steering paradigm with a **hybrid, instructor-first pipeline**:

1. Instructor reads messages and creates labels bottom-up (no fixed rubric upfront)
2. Gemini assists with label suggestions after 50 labeled messages
3. A label management view lets instructors refine the schema (merge, split, rename)
4. Gemini auto-labels remaining data once a sufficient sample is done

**Inspirations:** LLOOM (concept-based LLM analysis), DocWrangler (interactive LLM-assisted document labeling)

---

## Goals

- Labeling sessions of ~30–60 minutes feel productive and low-anxiety
- Labels emerge organically from reading — no predefined rubric required
- AI suggestions inform without biasing (instructor always chooses freely)
- Non-contiguous sessions don't cause label drift
- All five feature tracks can be developed concurrently after the foundation sprint

---

## Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Queue Mode | `/queue` | Primary labeling interface — one student message at a time |
| Label Management | `/labels` | Review and refine the label schema |
| Analysis | `/analysis` | Charts, coverage, and CSV export |
| Session Start | (modal/overlay) | Recalibration shown at the start of each non-first session |

---

## Data Model

Four new SQLModel tables replace `LabelSet` and `Label`:

### `LabelDefinition`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| name | str | Short label name |
| description | str \| null | Optional. Defaults to null; can be added/edited later |
| created_at | datetime | |

### `LabelApplication`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| label_id | int FK → LabelDefinition | |
| chatlog_id | int | References external DB min-event-id |
| message_index | int | Index of student message within transcript |
| applied_by | str | `"human"` or `"ai"` |
| created_at | datetime | |

### `Session`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| started_at | datetime | |
| last_active | datetime | Updated on each label/skip action |
| labeled_count | int | Total human-labeled messages; drives AI unlock at 50 |

### `SkippedMessage`
| Field | Type | Notes |
|-------|------|-------|
| id | int PK | |
| chatlog_id | int | |
| message_index | int | |
| created_at | datetime | |

---

## API Routes

### Implemented in foundation

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue` | Next batch of student messages to label (excludes already-labeled and skipped; random order; default page size 20). Each item returns `chatlog_id`, `message_index`, message text, and surrounding context. |
| `GET` | `/api/labels` | All `LabelDefinition` rows |
| `POST` | `/api/labels` | Create a new `LabelDefinition` — body: `{name, description?}` |
| `PUT` | `/api/labels/{id}` | Update name or description |
| `POST` | `/api/queue/apply` | Apply a label — body: `{chatlog_id, message_index, label_id}` |
| `POST` | `/api/queue/skip` | Skip a message — body: `{chatlog_id, message_index}` |
| `GET` | `/api/session` | Current session state |
| `POST` | `/api/session/start` | Start or resume a session |

Existing routes `GET /api/chatlogs` and `GET /api/chatlogs/{id}` are unchanged.

### Stubbed in foundation (real implementation in feature sprints)

| Method | Path | Feature owner | Stub response |
|--------|------|---------------|---------------|
| `POST` | `/api/queue/suggest` | AI Integration | Mock suggestion + evidence + rationale — body: `{chatlog_id, message_index}` |
| `POST` | `/api/labels/merge` | Label Management | 200 no-op |
| `POST` | `/api/labels/split` | Label Management | 200 no-op |
| `GET` | `/api/analysis/summary` | Analysis & Export | Mock chart data |
| `GET` | `/api/export/csv` | Analysis & Export | Empty CSV |
| `GET` | `/api/session/recalibration` | Session & Sampling | Mock label examples |
| `GET` | `/api/queue/sample` | Session & Sampling | Random sample |

---

## Screen Designs

### Queue Mode (`/queue`)

**Layout:** Three-panel

**Left sidebar**
- Progress bar: labeled count / total student messages (foundation uses all messages; replaced with sample size once Session & Sampling feature is built)
- Skipped count
- Label legend: each `LabelDefinition` as a row (name + count)

**Center panel**
- Preceding AI response (context, muted style)
- Student message (blue-bordered card, focal point)
- Following AI response (context, muted style)
- AI suggestion ghost tag: anchored to bottom-right corner of student message bubble. Low-contrast, grey styling. Shows label name + "· why?" link. Clicking "why?" drops a left-bordered callout below the message showing evidence quote and rationale. The label strip has **no special marking** for the suggested label — instructor chooses freely.
- AI lock state: tag replaced with "AI unlocks at 50 — N more to go" while `labeled_count < 50`
- Skip button: top-right of center panel, secondary styling

**Bottom strip**
- All `LabelDefinition` chips in a full-width wrapping row
- Clicking a chip applies that label to the current message and advances to next
- "+ New label" chip opens a small popover: name field (required) + description field (optional) + confirm button. Creates the `LabelDefinition` and immediately applies it.

---

### Label Management (`/labels`)

**Three columns:**

1. **Label list** — all `LabelDefinition` rows with name, description, count. Actions per row: edit name, edit description, delete (with confirmation if count > 0).
2. **Messages view** — clicking a label shows all `LabelApplication` rows for that label, each with the student message text and surrounding context.
3. **Schema actions** — Merge (select two labels → combine into one, all applications retroactively updated), Split (select a label → enter two new names, manually re-tag affected messages), Rename (inline edit).

---

### Analysis (`/analysis`)

**Charts panel** (Recharts, reusing existing infrastructure):
- Label frequency bar chart
- Per-notebook breakdown (labels × notebook)
- Conversation arc (label distribution by message position: early / mid / late)
- Label co-occurrence matrix
- Labeling coverage (human-labeled vs. AI-auto-labeled vs. unlabeled)

**Export:** CSV export button — downloads all `LabelApplication` rows with message text, label name, applied_by, chatlog_id, message_index.

---

### Session Start (recalibration overlay)

Shown at session start when `labeled_count > 0` (i.e., not the first session). Displays each `LabelDefinition` with:
- Name and description
- One representative example message (most recently applied)

"Resume labeling →" button dismisses overlay and navigates to `/queue`.

---

## Frontend Shell

- React Router: `/queue`, `/labels`, `/analysis`
- Top navigation bar with links to all three routes
- `src/types/index.ts` defines TypeScript types for all API shapes including stubbed routes
- `src/services/api.ts` updated to match new route structure
- `useMockApi` flag in `api.ts`: when `true`, returns mock responses from `src/mocks/` — lets frontend development proceed independently of backend

---

## Layout Alternatives (kept for reference)

Three layouts were considered for the queue mode screen:

- **A — Side by side:** message left, labeling controls right
- **B — Focused stack:** message center, labels at bottom, context collapsed above
- **C — Three panel (chosen):** progress sidebar + message center + bottom label strip

**AI suggestion placements considered:**
- Dedicated green banner row (too prominent, biases instructor)
- Glowing chip in strip (too forcing)
- Ghost tag on message bubble with "why?" reasoning callout (chosen — least biasing, reasoning available on demand)

---

## Post-Foundation Feature Tracks (concurrent)

Once the foundation is complete, all five tracks are independent:

| Track | Frontend | Backend |
|-------|----------|---------|
| **AI Integration** | Ghost tag display, "why?" callout, AI lock progress indicator, auto-labeling status | Gemini suggestion call with evidence + rationale, 50-message unlock logic, auto-labeling pipeline |
| **Label Management** | Merge/split/rename UI, messages-per-label browser | Merge/split endpoints, retroactive relabeling logic |
| **Analysis & Export** | All charts, coverage tracker, CSV export button | Aggregation queries, CSV generation |
| **Session & Sampling** | Session start recalibration screen, sampling config UI | Sampling strategy (random vs. embedding-based diversity), session persistence |
| **Queue Mode Polish** | Skip queue review flow (revisit skipped messages), transcript browse mode (secondary) | Browse mode message fetching, skip queue retrieval endpoint |

---

## Open Questions

1. **Sampling threshold:** How many labeled messages constitute "enough" for AI auto-labeling? (Currently placeholder: 50 for AI suggestions, undefined for auto-labeling)
2. **Sampling strategy:** Random vs. embedding-based diversity — to be decided in Session & Sampling feature track
3. **Multi-message labeling:** Can a single message receive more than one label? (Not addressed in this spec)
4. **Transcript browse mode:** Secondary to queue mode; exact interaction design deferred
5. **Label schema versioning:** When labels are merged/split, how to handle previously exported CSVs
