# First-time tutorial (single-label `/run`)

## When it shows

The tutorial is an overlay on the **normal** `/run` labeling page — not a separate screen. It appears when:

- There are **no single labels** in the database, and
- You have not skipped/finished the tutorial **this tab session**, or you **reloaded the page** (F5 / refresh — that clears the session skip flag).

Switching to Analysis or Summaries and back to Run does **not** re-open the tutorial. A full page reload with zero labels does.

## First visit (empty database)

1. `/run` loads the scored **starter conversation** (same picker as before) — **no label is saved yet**.
2. You see the normal labeling UI with an empty **Label name…** field and the starter message.
3. The tutorial overlay starts if not skipped.
4. When you type a name and press Enter, the label is created with that seed and labeling begins.

**Skip (no label yet):** `Skip` advances to the **next message in the same conversation** (`POST /api/onboarding/browse/skip`). `Shift+Skip` picks a **new** starter conversation. Your place in the conversation is remembered in `sessionStorage` when you switch tabs; a **full page reload** clears it and returns to the scored starter at message 1.

## Tutorial controls

- **Click anywhere** (dimmed area or popup) → next step
- **Space** → skip entire tutorial (marks `chatsight_onboarding_skipped`)
- **Skip tutorial** button → same as Space

Steps: overview → label name (top strip) → Yes/No/Skip → + note a label. Yes/No/Skip and the label field stay disabled until the tutorial ends or is skipped.

## Starter selection (`onboarding_service.py`)

See previous metrics (explore priority, spam, length, contrast, paste rejection). Cached in `OnboardingStarterCache`.

## API

- `GET /api/onboarding/starter` — starter + `focused` thread
- `POST /api/single-labels` with seed fields — first `/next` uses seed (`queue_service`)
