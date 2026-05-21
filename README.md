# Chatsight

Chatsight is a research tool that helps instructors label student-AI tutoring conversations. Instead of defining a labeling rubric upfront (which tends to break down as you read real data), instructors read through messages one at a time and create label categories as they go. After enough human labels exist, AI can suggest labels for the rest.

---

## How it works

Chatsight has **two labeling modes**, toggled in the app. Both show one student message at a time with the surrounding AI tutor responses as collapsible context (markdown + LaTeX rendering).

### Multi-label queue mode (`/queue`)

For exploratory, many-labels-per-message coding:

1. The system shows one student message at a time.
2. The instructor **toggles one or more labels** on/off, **creates a new label** on the fly if nothing fits, or **skips** the message.
3. Clicking **"Next"** advances (disabled until at least one label is applied); a brief **undo toast** lets you revert.
4. **Two-tier AI assist**: after **20** human-labeled messages, Gemini suggestions appear as ghost tags; after **min(40% of total, 100)** human labels, an **auto-label** button batch-classifies the rest in the background.
5. Labels can be **merged, split, renamed, reordered, or archived** from the label management view as understanding evolves (archiving returns a label's orphaned messages to the queue).
6. **Concept induction** ("Discover") clusters unlabeled messages and proposes candidate labels for you to accept or reject.

### Single-label mode (`/run`)

For one decision per message (a binary "does this label apply?" pass), with a warm editorial UI:

1. The instructor makes a **yes / no / skip** decision per message (keyboard-driven: `a` / `d` / Space, `s` to undo — rebindable).
2. A **readiness** indicator tracks when enough variety has been labeled to hand off.
3. On **handoff**, Gemini classifies all remaining messages (inline or via the Gemini Batch API for large jobs). Low-confidence predictions land in a **review queue** for the instructor to confirm or override.
4. Optional free-text **instructor guidance** is fed into the classifier, and a "Gemini's Understanding" preview shows how the model interprets the label.

Other views: **`/summaries`** (per-label message browser with human-vs-AI provenance), **`/analysis`** (mode-aware dashboards), **`/assignments`** (group messages by notebook/assignment), and **`/history`**.

---

## Prerequisites

You need three things installed:

- **Node.js** (v18+) — runs the frontend
- **Python 3.11+** with **[uv](https://github.com/astral-sh/uv)** — runs the backend. uv is a fast Python package manager; install it with `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **kubectl** — needed to tunnel into the external database (see below)

---

## Setup

### 1. Clone the repo and install dependencies

```bash
git clone <repo-url>
cd chatsight

# Frontend dependencies
npm install

# Backend dependencies (uv handles this automatically on first run,
# but you can install explicitly)
cd server/python
uv sync
cd ../..
```

### 2. Create a `.env` file

Create a file called `.env` in the repo root (not inside `server/`):

```
GEMINI_API_KEY=<your-google-gemini-api-key>
PG_PASSWORD=<postgresql-password-for-dsc10_tutor-user>
```

Ask a team member for these values. The Gemini key is for AI label suggestions and auto-labeling. The PG password is for reading chatlog data from the external database.

### 3. Start the database tunnel

The chatlog data lives in an external PostgreSQL database that you access through a Kubernetes port-forward. This must be running before you start the backend:

```bash
kubectl port-forward <pod-name> 5432:5432
```

Ask a team member for the pod name. This forwards the remote database to `localhost:5432`. If the backend crashes on startup with a connection error, this tunnel is probably not running.

### 4. Start the app

From the repo root, start everything with one command:

```bash
npm run dev:all
```

This runs `bin/dev`, which starts the kubectl port-forward, the backend (`:8000`), and the frontend (`:5173`) together in a single terminal with color-prefixed logs (freeing those ports first if they're in use, and auto-reconnecting the tunnel if it drops). Press Ctrl+C to stop everything.

> `dev:all` starts the database tunnel itself, so you can **skip [step 3](#3-start-the-database-tunnel)** when using it. To run the pieces separately instead, start the tunnel from step 3, then in two terminals run `cd server/python && uv run uvicorn main:app --reload` and `npm run dev`.

Open http://localhost:5173 in your browser. The frontend automatically proxies API calls to the backend, so you don't need to configure anything else.

**API docs:** http://localhost:8000/docs — FastAPI auto-generates interactive documentation for every endpoint. Useful for testing routes directly.

---

## Project structure

```
chatsight/
├── src/                              # Frontend (React 19 + TypeScript)
│   ├── App.tsx                       # React Router shell + Mode/Keybind providers
│   ├── pages/                        # QueuePage (/queue), LabelRunPage (/run), HistoryPage,
│   │   │                             #   LabelsPage, AssignmentsPage, SummariesPage, AnalysisPage
│   │   ├── summaries/                # Mode-aware summaries variants (multi / single)
│   │   └── analysis/                 # Mode-aware analysis variants (multi / single)
│   ├── components/
│   │   ├── Navigation.tsx            # Top nav bar
│   │   ├── queue/                    # Multi-label UI (MessageCard, ProgressSidebar, archive, Discover…)
│   │   ├── run/                      # Single-label UI (DecisionDock, StripBar, ReadinessChip, ThreadView…)
│   │   ├── decision/                 # DecisionWorkspace, AiReviewDock, KeybindSettingsModal
│   │   └── summaries/                # Summaries browser components
│   ├── hooks/                        # useMode (single/multi), useKeybinds, useTheme
│   ├── services/api.ts               # All fetch calls to the backend (mock mode aware)
│   ├── types/index.ts                # Shared TypeScript interfaces
│   ├── mocks/                        # Mock data for development without a backend
│   └── tests/                        # Frontend tests (vitest + React Testing Library)
│
├── server/python/                    # Backend (FastAPI + Python 3.11+, managed by uv)
│   ├── main.py                       # ~all API routes (~4.8k lines, single file)
│   ├── models.py                     # Database tables (SQLModel ORM)
│   ├── schemas.py                    # Request/response shapes (Pydantic)
│   ├── database.py                   # DB connections (SQLite + PostgreSQL) + migrations
│   ├── queue_service.py              # Multi-label queue ordering / advance / undo / skip
│   ├── decision_service.py           # Single-label yes/no/skip decisions + readiness math
│   ├── autolabel_service.py          # Multi-label Gemini batch classification (suggest + auto-label)
│   ├── binary_autolabel_service.py   # Single-label (binary) Gemini classification
│   ├── explore_service.py            # Hybrid-queue "explore" sampling (student-message novelty)
│   ├── concept_service.py            # Concept induction (embed + cluster + name)
│   ├── definition_service.py         # Gemini label descriptions / "understanding" previews
│   ├── assist_service.py             # Single-message suggestion path
│   ├── assignment_service.py         # Notebook filename → assignment-name mapping
│   ├── analysis_single_label.py      # Single-label analysis APIRouter
│   ├── label_service.py              # Legacy pre-queue Gemini labeling (reference only)
│   ├── pyproject.toml                # Python dependencies
│   └── tests/                        # Backend tests (pytest, in-memory SQLite)
│
├── WORKFLOW.md                       # Research context and design rationale
├── CLAUDE.md                         # AI assistant instructions
└── vite.config.ts                    # Vite config (proxy, Tailwind, test setup)
```

---

## How the pieces connect

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Browser (:5173)   │         │   External PostgreSQL (:5432)    │
│                     │   /api  │   (read-only, via kubectl)       │
│   React frontend    │────────▶│                                  │
│                     │  proxy  │   Contains student-AI chatlogs   │
└─────────────────────┘         │   in an "events" table           │
                                └──────────────┬───────────────────┘
                                               │ reads chatlog data
                                ┌──────────────▼───────────────────┐
                                │   FastAPI backend (:8000)        │
                                │                                  │
                                │   Serves chatlog content,        │
                                │   manages labels + sessions,     │
                                │   calls Gemini for AI features   │
                                │                                  │
                                │   Writes to ──▶ SQLite           │
                                │                (chatsight.db)    │
                                │                                  │
                                │   Labels, applications,          │
                                │   sessions, skipped messages     │
                                └──────────────────────────────────┘
```

**Two databases, two purposes:**

- **External PostgreSQL** — the source of truth for chatlog data. Contains a single `events` table with student questions and AI responses. Read-only; the backend never writes to it.
- **Local SQLite** (`chatsight.db`) — stores everything the labeling tool creates: label definitions, label applications (both human and AI), sessions, and skipped messages. Auto-created on first backend startup.

The frontend never talks to either database directly. It goes through the backend API, which Vite proxies from `:5173/api/*` to `:8000/api/*`.

---

## API overview

All routes are in `server/python/main.py` (single-label analysis routes are an `APIRouter` in `analysis_single_label.py`). The **authoritative, always-current reference is the auto-generated interactive docs at http://localhost:8000/docs** — there are ~85 routes, so the groups below are a map, not a full list. Everything is under the `/api/...` prefix and the frontend reaches it through the Vite proxy.

| Group | Examples | What it covers |
|-------|----------|----------------|
| **Chatlogs** | `GET /api/chatlogs`, `GET /api/chatlogs/{id}`, `.../messages` | Read conversations + transcripts from the external DB |
| **Labels** | `GET/POST /api/labels`, `PUT /api/labels/{id}`, `.../archive`, `reorder`, `merge`, `split`, `split-autolabel`, `{id}/promote`, `generate-description` | Label CRUD, reorder/archive, merge/split, promote multi→single, AI-generated descriptions |
| **Session** | `POST /api/session/start`, `GET /api/session`, `.../recalibration`, `.../label-review` | Session state, recalibration, label-review |
| **Queue (multi-label)** | `GET /api/queue`, `/queue/stats`, `POST/DELETE /api/queue/apply`, `advance`, `undo`, `skip`, `apply-batch`, `history`, `position` | The multi-label labeling flow |
| **AI assist (multi-label)** | `POST /api/queue/suggest`, `autolabel`, `GET /api/queue/autolabel/status`, `POST /api/queue/concise` | Gemini suggestions + background auto-labeling |
| **Single-label** | `GET/POST /api/single-labels`, `{id}/activate`, `decide`, `undo`, `next`, `readiness`, `handoff`, `retry-handoff`, `review`, `review-queue`, `refine`, `summary`, `assist`, `gemini-preview`, `switch` | The full single-label run + handoff + review lifecycle |
| **Concepts** | `POST /api/concepts/discover`, `GET /api/concepts/candidates`, `PUT .../{id}`, `GET /api/concepts/embed-status` | Concept induction (embed + cluster + accept/reject) |
| **Assignments** | `GET/POST /api/assignments`, `infer`, `merge`, `unmapped` | Notebook→assignment mapping |
| **Analysis & export** | `GET /api/analysis/summary`, `temporal`, `milestones`, `GET /api/analysis/single-label/cohort`, `/runs/{id}`, `GET /api/export/csv`, `onehot-csv`, `GET /api/handoff-summaries` | Dashboards + CSV exports |

---

## AI system

Chatsight uses **Google Gemini 2.0 Flash** (function-calling mode, `mode=ANY`, for structured JSON output) plus **`gemini-embedding-001`** for embeddings. AI-written labels are always stored with `applied_by="ai"` (and a `confidence` score) so they stay distinguishable from human labels.

**Multi-label suggestions** (`autolabel_service.py`, unlocks at 20 human labels): when the instructor views a message, `POST /api/queue/suggest` builds a prompt with label definitions + up to 5 human-labeled examples per label and asks Gemini to classify the current message. The result appears as a ghost tag.

**Multi-label auto-labeling** (unlocks at min(40% of total, 100) human labels): a background thread classifies all unlabeled messages in batches; the frontend polls `/api/queue/autolabel/status` for progress.

**Single-label classification** (`binary_autolabel_service.py`): after the instructor labels a sample and hands off, Gemini makes a binary yes/no decision on every remaining message — either inline (parallel chunks with retry/backoff) or via the **Gemini Batch API** with multi-sub-batch splitting for large jobs. Optional instructor **guidance** is threaded into the prompt; low-confidence predictions are routed to a review queue. `definition_service.py` also generates label descriptions and "Gemini's Understanding" previews.

**Concept induction** (`concept_service.py`): embeds unlabeled messages with `gemini-embedding-001`, clusters them with KMeans, and asks Gemini to name each cluster, producing candidate labels to accept or reject.

**Explore sampling** (`explore_service.py`): embeds *student* messages to score novelty, so the single-label queue surfaces rare/specific help requests instead of generic "help"/assignment-prompt spam.

---

## Running tests

**Backend:**
```bash
cd server/python
uv run pytest
```

Backend tests use an in-memory SQLite database and make no real external-DB or Gemini calls. They do still need `GEMINI_API_KEY` and `PG_PASSWORD` *set* (not valid — just present), because a few service modules build their Gemini client at import time. `conftest.py` supplies a dummy `PG_PASSWORD`; the Gemini key is picked up from your `.env`. If you run tests in an environment without `.env`, export any non-empty value first: `GEMINI_API_KEY=dummy uv run pytest`.

**Frontend:**
```bash
npm test
```

Frontend tests use mock data — no backend needed.

---

## Tech stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19, TypeScript, Vite 6 | Standard modern stack |
| Styling | Tailwind CSS v4 | Utility-first, no config file needed (uses `@tailwindcss/vite` plugin) |
| Rendering | React Markdown (`remark-math`, `remark-gfm`, `rehype-katex`), KaTeX | AI tutor responses contain markdown, GFM tables, and LaTeX math |
| UI | Recharts (charts), `@dnd-kit` (label reorder), Framer Motion (animation), lucide-react (icons) | Analysis dashboards and interactive labeling UI |
| Backend | FastAPI, Uvicorn | Auto-generates API docs, async support, Python type hints |
| ORM | SQLModel | Combines SQLAlchemy + Pydantic (same models for DB and validation) |
| Local DB | SQLite | Zero setup, file-based, good enough for single-user research tool |
| External DB | PostgreSQL | Where the real chatlog data lives (read-only) |
| AI | Google Gemini 2.0 Flash + `gemini-embedding-001`; scikit-learn (KMeans) | Function-calling classification, embeddings, and concept clustering |
| Tests | pytest (backend), vitest (frontend) | Both run fast with in-memory/mock data |

---

## Common issues

**Backend won't start: "PG_PASSWORD" KeyError**
You're missing the `.env` file or it doesn't have `PG_PASSWORD`. See [Setup step 2](#2-create-a-env-file).

**Backend won't start: connection refused on port 5432**
The `kubectl port-forward` tunnel isn't running. See [Setup step 3](#3-start-the-database-tunnel).

**Frontend shows "Loading..." forever**
The backend isn't running, or the proxy isn't working. Check that the backend is up on port 8000 and that `vite.config.ts` has the proxy line `'/api': 'http://localhost:8000'`.

**`chatsight.db` is missing**
It's auto-created the first time the backend starts. If you deleted it, just restart the backend.

**AI suggestions not appearing**
You need at least 20 human-labeled messages before suggestions unlock. Check the progress bar in the sidebar.

**Auto-label button is grayed out**
Auto-labeling requires min(40% of total messages, 100) human labels. Keep labeling manually until the threshold is reached.

---

## Development commands

```bash
# Frontend
npm run dev              # dev server on :5173
npm run dev:all          # bin/dev — kubectl port-forward + backend + frontend together, prefixed logs
npm run build            # type-check + production build
npm test                 # run frontend tests once
npm run test:watch       # run frontend tests in watch mode
npx tsc --noEmit         # type-check only (no build output)

# Backend
cd server/python
uv run uvicorn main:app --reload   # dev server on :8000 (auto-reloads on file changes)
uv run pytest                      # run backend tests
uv add <package>                   # add a Python dependency
```
