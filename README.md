# Chatsight

Chatsight is a research tool that helps instructors label student-AI tutoring conversations. Instead of defining a labeling rubric upfront (which tends to break down as you read real data), instructors read through messages one at a time and create label categories as they go. After enough human labels exist, AI can suggest labels for the rest.

---

## How it works

1. The instructor opens the app and enters **queue mode**
2. The system shows one student message at a time, with the surrounding AI responses as collapsible context (supports markdown and LaTeX rendering)
3. The instructor either:
   - **Toggles one or more labels** by clicking them in the sidebar — labels turn on/off, and multiple can be applied to the same message
   - **Creates a new label** on the fly if nothing fits
   - **Skips** the message to come back to it later
4. When done with a message, the instructor clicks **"Next"** to advance (disabled until at least one label is applied)
5. After advancing, an **undo toast** appears briefly — click it to revert and return to that message
6. A progress sidebar tracks how many messages have been labeled
7. **Two-tier AI assist**:
   - After **20** human-labeled messages, AI suggestions appear as ghost tags on each message (powered by Gemini)
   - After **min(40% of total, 100)** human-labeled messages, an **auto-label button** unlocks that batch-classifies all remaining messages in the background

Labels can later be merged, split, or renamed as the instructor's understanding of the data evolves (planned, not yet implemented).

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

You need two terminal tabs:

**Terminal 1 — Backend** (runs on port 8000):
```bash
cd server/python
uv run uvicorn main:app --reload
```

**Terminal 2 — Frontend** (runs on port 5173):
```bash
npm run dev
```

Open http://localhost:5173 in your browser. The frontend automatically proxies API calls to the backend, so you don't need to configure anything else.

**API docs:** http://localhost:8000/docs — FastAPI auto-generates interactive documentation for every endpoint. Useful for testing routes directly.

---

## Project structure

```
chatsight/
├── src/                              # Frontend (React + TypeScript)
│   ├── App.tsx                       # React Router shell
│   ├── pages/
│   │   ├── QueuePage.tsx             # Main labeling screen
│   │   ├── LabelsPage.tsx            # Label management (placeholder)
│   │   └── AnalysisPage.tsx          # Analysis dashboard (placeholder)
│   ├── components/
│   │   ├── Navigation.tsx            # Top nav bar (Queue / Labels / Analysis)
│   │   └── queue/
│   │       ├── MessageCard.tsx       # Student message + collapsible AI context (markdown + LaTeX)
│   │       ├── ProgressSidebar.tsx   # Label toggle buttons, progress, AI unlock bar, auto-label
│   │       └── NewLabelPopover.tsx   # Inline form to create a new label
│   ├── services/api.ts              # All fetch calls to the backend
│   ├── types/index.ts               # Shared TypeScript interfaces
│   ├── mocks/index.ts               # Mock data for development without backend
│   └── tests/                       # Frontend tests (vitest + React Testing Library)
│
├── server/python/                    # Backend (FastAPI + Python)
│   ├── main.py                       # All API routes (single file)
│   ├── models.py                     # Database tables (SQLModel ORM)
│   ├── schemas.py                    # Request/response shapes (Pydantic)
│   ├── database.py                   # Database connections (SQLite + PostgreSQL)
│   ├── label_service.py              # Gemini AI integration (legacy, used for old labeling)
│   ├── autolabel_service.py          # Gemini batch classification for suggestions + auto-labeling
│   ├── pyproject.toml                # Python dependencies
│   └── tests/                        # Backend tests (pytest)
│       ├── conftest.py               # Test fixtures (in-memory SQLite)
│       ├── test_labels.py            # Label CRUD tests
│       ├── test_session.py           # Session + advance tests
│       ├── test_queue_actions.py     # Apply, unapply, undo, advance tests
│       ├── test_stubs.py             # Stub route contract tests
│       └── test_models_smoke.py      # Model import smoke test
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

All routes are defined in `server/python/main.py`.

### Chatlog routes

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/api/chatlogs` | List all conversations from the external DB |
| `GET` | `/api/chatlogs/{id}` | Get a single chatlog's full transcript |

### Label management

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/api/labels` | List all label definitions with application counts |
| `POST` | `/api/labels` | Create a new label (`name`, optional `description`) |
| `PUT` | `/api/labels/{id}` | Rename or redescribe a label |
| `GET` | `/api/labels/{id}/messages` | Get all applications of a specific label |

### Session

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/api/session/start` | Start a new labeling session |
| `GET` | `/api/session` | Get current session state (progress, timing) |

### Queue (labeling flow)

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/api/queue` | Get next batch of unlabeled messages |
| `GET` | `/api/queue/stats` | Total / labeled / skipped message counts |
| `POST` | `/api/queue/apply` | Apply a label to a message (idempotent) |
| `DELETE` | `/api/queue/apply` | Remove a label from a message (toggle off) |
| `GET` | `/api/queue/applied` | Get which labels are applied to a specific message |
| `POST` | `/api/queue/advance` | Record that a message was completed, increment count |
| `POST` | `/api/queue/undo` | Remove all labels for a message, decrement count |
| `POST` | `/api/queue/skip` | Skip a message |

### AI features

| Method | Path | What it does |
|--------|------|--------------|
| `POST` | `/api/queue/suggest` | Get AI suggestion for a single message (real Gemini call) |
| `POST` | `/api/queue/autolabel` | Start background auto-labeling of all unlabeled messages |
| `GET` | `/api/queue/autolabel/status` | Poll auto-labeling progress (`processed`, `total`, `running`) |

### Stub routes (return placeholder data)

| Method | Path | Planned feature |
|--------|------|-----------------|
| `POST` | `/api/labels/merge` | Merge two labels into one |
| `POST` | `/api/labels/split` | Split a label into two |
| `GET` | `/api/analysis/summary` | Label distribution and coverage stats |
| `GET` | `/api/export/csv` | Download all labels as CSV |
| `GET` | `/api/session/recalibration` | Suggest labels to review for consistency |
| `GET` | `/api/queue/sample` | Smart sampling strategy |

---

## AI system

Chatsight uses **Google Gemini 2.0 Flash** for two AI features, both defined in `autolabel_service.py`:

**Suggestions** (unlocks at 20 human labels): When the instructor views a message, the frontend calls `POST /api/queue/suggest`. The backend builds a prompt with label definitions + up to 5 human-labeled examples per label, then asks Gemini to classify the current message. The result appears as a ghost tag on the message card.

**Auto-labeling** (unlocks at min(40% of total, 100) human labels): The instructor clicks "Auto-label remaining" in the sidebar. The backend spawns a background thread that classifies all unlabeled messages in batches of 30. The frontend polls `/api/queue/autolabel/status` to show a progress bar. AI-applied labels are stored with `applied_by="ai"` so they can be distinguished from human labels.

Both features use Gemini's function-calling mode (`mode=ANY`) to force structured JSON output.

---

## Running tests

**Backend:**
```bash
cd server/python
uv run pytest
```

Backend tests use an in-memory SQLite database — no external database, tunnel, or Gemini key needed.

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
| Rendering | React Markdown, KaTeX | AI tutor responses contain markdown and LaTeX math |
| Backend | FastAPI, Uvicorn | Auto-generates API docs, async support, Python type hints |
| ORM | SQLModel | Combines SQLAlchemy + Pydantic (same models for DB and validation) |
| Local DB | SQLite | Zero setup, file-based, good enough for single-user research tool |
| External DB | PostgreSQL | Where the real chatlog data lives (read-only) |
| AI | Google Gemini 2.0 Flash | Function calling for structured label suggestions and batch classification |
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
