# First-time tutorial (single-label `/run`)

## When it shows

The tutorial is an overlay on the **normal** `/run` labeling page — not a separate screen. It appears when:

- There are **no single labels** in the database, and
- You have not skipped/finished the tutorial **this tab session**, and
- You arrived via a **document load** (new tab, typed URL, or **F5 / refresh** on any page) — not by clicking **Run** in the nav after already using the app in this tab.

Switching to Summaries (or Analysis) and back to Run does **not** re-open the tutorial, even if you deleted all labels. A **full page reload** with zero labels clears the session skip flag and allows the tutorial again (once per reload).

## First visit (empty database)

1. `/run` loads the scored **starter conversation** (same picker as before) — **no label is saved yet**.
2. You see the **same** labeling chrome as an active run (queue line, conversation meta, Yes/No/Skip dock) with an empty **Label name…** field in the strip; counts stay at 0 until you commit a name.
3. The tutorial overlay starts if not skipped.
4. When you type a name and press Enter, the label is created with that seed and labeling begins.

**Skip (no label yet):** `Skip` advances to the **next message in the same conversation** (`POST /api/onboarding/browse/skip`). At the **last message** in that thread, skip uses the **same hybrid sampling queue** as labeled skip (explore / round-robin across conversations you have not finished browsing in this tab). Finished conversations are tracked in `sessionStorage` (`exhausted_chatlog_ids`). `Shift+Skip` marks the current conversation finished and jumps via that queue immediately. A **full page reload** clears browse position and exhausted list.

## Tutorial controls

- **Click anywhere** (dimmed area or popup) → next step
- **Esc** → skip entire tutorial
- **Skip tutorial** button → same as Esc

Steps: overview → label name (top strip) → Yes/No/Skip → + note a label. Yes/No/Skip and the label field stay disabled until the tutorial ends or is skipped.

## Starter selection (`onboarding_service.py`)

See previous metrics (explore priority, spam, length, contrast, paste rejection). Cached in `OnboardingStarterCache`.

## API

- `GET /api/onboarding/starter` — starter + `focused` thread
- `POST /api/single-labels` with seed fields — first `/next` uses seed (`queue_service`)
