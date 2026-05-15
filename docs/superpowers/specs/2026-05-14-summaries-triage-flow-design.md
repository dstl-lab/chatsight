# Summaries Triage Flow — Design

**Date:** 2026-05-14
**Branch:** `summaries-revamp`
**Supersedes:** the `BrowseTab` portion of `2026-05-14-summaries-page-revamp-design.md`. Header, LabelRail, SettingsTab, and all backend Phase-1 endpoints remain unchanged.

## Motivation

Phase 1 of the summaries revamp shipped a master–detail `BrowseTab` with bucket chips (Yes / No / Review / All) and a message-by-message list. In real use this creates anxiety:

- The `REVIEW` count is often larger than `YES + NO` combined (one observed label: 9,962 review / 1,142 yes / 803 no). Rendered at the same prominence as the other counts, it reads as a backlog the user owes.
- "Review" implies obligation — every item must be touched — but the actual research task is *validating the AI's pattern recognition*, not personally labeling every borderline case.
- The bucket-list framing matches a labeler's mental model. Instructors are validators. They want to read stories and confirm/flip predictions, not work through a queue of disembodied messages.

## Mental model change

| Before | After |
|---|---|
| "Buckets of messages to process" | "Next AI-classified message to confirm or flip" |
| Decision unit: row in a list | Decision unit: focused message inside its conversation thread |
| Navigation: click a row | Navigation: `y` / `n` / `Enter` auto-advances to next hit |
| Review count: looming `9962` | Review count: progress (`23 of 47 to review`) |
| High-confidence yes/no: invisible until you click into them | High-confidence yes/no: reframed as `HIDDEN — already trusted`, visible but de-emphasized |

The unit of work is now a **hit** — a single AI-classified message. Hits live inside conversations; the conversation is the *context*, the hit is the *decision*.

## Goals

- Mirror /run's decision loop and keyboard economy (5 keys: `y` `n` `s` `z` `Enter`).
- Make the Review pile feel finite by showing progress (`X of Y`) instead of a raw backlog.
- Preserve qualitative reading: hits are always shown inside their conversation thread.
- Reuse `/run`'s `ThreadView` and the keyboard-handler pattern from `LabelRunPage.tsx`.

## Non-goals

- Threshold-tuning UI improvements (out of scope; SettingsTab handles this today).
- Concept induction / candidate label flow.
- Multi-label summaries (`SummariesPageMulti` is untouched).
- Reverting Phase 1 components: `LabelRail`, `DetailHeader` (with info panel), `RenameModal`, `DeleteConfirmModal`, `SettingsTab` all stay.
- New backend endpoints. The existing single-label routes are sufficient.

## Layout

Reference mockups: `.superpowers/brainstorm/93665-1778790328/content/run-style.html` and `shortcuts.html`. The page swaps the current Browse tab for a new Triage tab; the Settings tab is unchanged.

```
┌─ Detail header (unchanged) ─────────────────────────────────┐
│  self-correction · catches mistakes        [⋯ menu]         │
│  1142 YES   803 NO   91 REVIEW   ⓘ info panel              │
│  [ Triage ] [ Settings ]                                    │
└─────────────────────────────────────────────────────────────┘
┌─ TriageStrip ───────────────────────────────────────────────┐
│  23 of 47 to review                  HIDDEN (high-conf) 10765│
└─────────────────────────────────────────────────────────────┘
┌─ TriageFilterRow ───────────────────────────────────────────┐
│  [Review (47)] [Flagged (3)] [All]   ↧ confidence asc       │
└─────────────────────────────────────────────────────────────┘
┌─ Focused hit + conversation context ────────────────────────┐
│  conv #4811 · turn 4 of 12                                  │
│                                                             │
│  user · turn 3   how do I compute the mean of a column…    │
│  ai · turn 3     Yes! .mean() on a DataFrame returns…       │
│  ▍ user · turn 4 (focus)                                   │
│  ▍  the mean is 4.2, oh wait that's the median…            │
│  ▍  ↳ Gemini: YES · 0.63 — low confidence                   │
│  ai · turn 5     Right! And you can pass a column to…       │
└─────────────────────────────────────────────────────────────┘
┌─ TriageDock ────────────────────────────────────────────────┐
│  [y Keep YES]  [n Flip to NO]  [s Skip]  [z Undo]           │
│                                       Enter accept ai & next│
└─────────────────────────────────────────────────────────────┘
```

The `DetailHeader` (with the ⓘ info panel and the ⋯ menu) is unchanged. Only the tab body changes.

## Components

### New

- `src/components/summaries/TriageTab.tsx` — replaces `BrowseTab.tsx`. Owns the focused-hit index, the filter/sort state, optimistic flip + rollback. Handles keyboard.
- `src/components/summaries/TriageStrip.tsx` — small strip below the detail header showing `X of Y to review` (left) and `HIDDEN N · already trusted` (right, muted).
- `src/components/summaries/TriageFilterRow.tsx` — filter chips (Review / Flagged / All) + sort dropdown. Replaces the current `FilterBar`. `Yes` and `No` buckets are no longer top-level chips — they're reachable by `All` + sort.
- `src/components/summaries/TriageDock.tsx` — decision dock styled like `/run`'s `DecisionDock` and `ReviewDock`. Buttons + keyboard hints, mirrors AI's predicted verdict (the "keep" label color matches the AI's prediction; "flip" goes the other way).

### Reused (no changes)

- `ThreadView` from `src/components/run/ThreadView.tsx` — renders the conversation thread with a focused turn. The triage hit becomes that focused turn.
- Existing API methods in `src/services/api.ts`:
  - `listSingleLabelMessages` — fetch page of hits in current filter/sort.
  - `getSingleLabelMessageDetail` — fetch focused hit + context for `ThreadView` (`context_before` / `context_after` already returned).
  - `flipSingleLabelVerdict` — PATCH flip.
  - `upsertSingleLabelNote` — note save (kept for parity with /run's `l` key; this spec does not bind `l` yet — see Out of scope).

### Deleted

- `src/components/summaries/BrowseTab.tsx` — replaced.
- `src/components/summaries/FilterBar.tsx` — replaced by `TriageFilterRow`.
- `src/components/summaries/MessageList.tsx`, `MessageListRow.tsx` — the row-list view is gone. (If we later add a secondary browse view, we can resurrect from git history.)
- `src/components/summaries/FocusedMessage.tsx` — replaced by `ThreadView` + `TriageDock`.

The deletions remove ~4 components; the additions add ~4. Net file count unchanged.

## State machine

```
items: MessageListItem[]            # current page, fetched on filter/sort change
cursor: number                      # index into items
focused: MessageDetail | null       # fetched when cursor changes
```

Transitions:

- **Mount / filter change / sort change:** fetch `items`, reset `cursor` to 0.
- **Cursor change:** fetch `focused` (detail with context). `ThreadView` renders.
- **Decide (`y` / `n` / `Enter`):** optimistic flip on `items[cursor]` and `focused`. PATCH. On success: `cursor += 1`. On failure: rollback both, show error toast (same pattern as current `BrowseTab.flip`).
- **Skip (`s`):** `cursor += 1`. No backend write.
- **Undo (`z`):** `cursor = max(0, cursor - 1)` AND if the now-current hit was just flipped, send a PATCH restoring its previous verdict. Track a small `recentDecisions: { cursor: number; from: 'yes'|'no'|null; to: 'yes'|'no' }[]` ring buffer (last ~10) so undo knows what to restore. Optimistic UI then PATCH; rollback on failure.
- **End of page:** when `cursor >= items.length - 5`, prefetch next page (`offset: items.length`), append on arrival.
- **End of pool:** when no more pages, render a small "All caught up for this filter" state with `[ View all hits ]` to switch the filter to All.

## API

No new endpoints. All four methods listed above already exist.

Two small notes:

- `listSingleLabelMessages` already supports `bucket`, `sort`, `search`, `offset`, `limit`. We use it as-is. The current `BrowseBucket` type union (`'yes' | 'no' | 'review' | 'flagged' | 'all'`) covers the chip set; `yes` and `no` are no longer surfaced as chips but the type stays for API back-compat and to support future spot-check filters.
- `getSingleLabelMessageDetail` already returns `context_before` and `context_after`. `ThreadView` expects a thread array — adapter logic in `TriageTab` builds `thread = [...context_before, focused, ...context_after]` and sets `focus_index = context_before.length`.

## Keyboard

Wires up a single `keydown` listener inside `TriageTab` following the exact pattern in `LabelRunPage.tsx:314-359` (skip when an input/textarea is focused, prevent default only for keys that would otherwise type).

| Key | Action |
|---|---|
| `y` | Set verdict to YES on focused hit, advance. |
| `n` | Set verdict to NO on focused hit, advance. |
| `Enter` | Accept AI's verdict (no flip), advance. |
| `s` | Skip — advance without writing. |
| `z` | Undo — step back one hit; revert the last flip if any. |

`l` (note) is deliberately omitted in this phase — see Out of scope.

## TriageStrip messaging

The "Review" count remains real and accurate, but is framed as a progress fraction (`23 of 47`). The "Hidden" number is the count of high-confidence predictions and is computed client-side as `hidden = yes_count + no_count - review_count` (the existing `SingleLabelDetail` fields are sufficient — no schema change). It's shown muted, with the microcopy `already trusted — not in this queue`. Hidden hits are reachable via the `All` filter chip; they're not gone, they're just not the foreground task.

When `review_count` would be zero, the strip shows `Nothing to review for this label — all predictions cleared the confidence threshold.` and the dock disappears (read-only mode).

## Optimistic flip semantics

Reuse the existing pattern in `BrowseTab.flip` (lines 53–87): set local state immediately, PATCH, rollback on failure with the `flip-failure` toast already shipped in commit `c586be9`. No new error handling needed.

## Migration plan

1. Add the new components in `src/components/summaries/`.
2. Update `SummariesPageSingle.tsx` to render `<TriageTab>` instead of `<BrowseTab>` when `tab === 'browse'`. Keep the tab id `'browse'` for localStorage continuity (or rename the enum; see open question).
3. Delete the four obsolete components and their tests.
4. Update `SummariesTab` type in `DetailHeader.tsx` if we rename the tab. (Currently `'browse' | 'settings'`. We'll likely keep `'browse'` to avoid storage migration; the label on the chip becomes "Triage".)

## Testing

Frontend (vitest + RTL):

- `TriageTab.test.tsx`
  - Renders strip with progress fraction.
  - Renders chips and reacts to chip click (refetches list).
  - Renders focused hit inside `ThreadView` with correct `focus_index`.
  - `y` / `n` / `Enter` fire flip with correct verdict and advance the cursor.
  - `s` advances without writing.
  - `z` steps back; if previous decision flipped, undoing reverts.
  - End-of-page prefetch triggers when cursor nears `items.length`.
  - "All caught up" state when pool empty.
- `TriageDock.test.tsx`
  - Renders the four primary actions + Enter hint.
  - "Keep" label reflects the AI's predicted verdict (Keep YES vs Keep NO).
- `TriageStrip.test.tsx`
  - Progress fraction when review_count > 0.
  - "Nothing to review" copy when review_count === 0.

Backend: no changes, no new tests required. Existing `test_single_label_routes.py` and `test_handoff_flow.py` already cover the routes consumed.

## Open questions

1. **Tab name on the chip.** Spec leans toward keeping the internal id `'browse'` (avoid localStorage migration) but relabeling the chip from "Browse" to "Triage". OK to go that way.
2. **What does `Flagged` mean?** Spec assumes a future feature surface; for Phase 1 of this redesign, the `Flagged` chip can be hidden if `flagged_count` is `0` so we don't ship dead UI. (Confirm: hide-when-empty is fine.)

## Out of scope (capture for later)

- **`l` for notes** in the triage dock. /run uses `l` to open a label-creation popover; here it would open a note for the focused hit. Worth adding once the rest is stable.
- **Threshold-tuning nudge** when `review_count > yes_count + no_count`. Lives in SettingsTab; cross-link from TriageStrip is a stretch.
- **Suggested-sample mode** ("Triage 30 random borderline cases, then stop"). The brainstorming pass discussed this as a more ambitious reframe; the triage flow is the foundation it would build on.
- **Conversation-level browse view** (the original Option A/B/C mockups). The triage flow + `All` filter covers the most-needed browsing; a dedicated conversation reader is a follow-on if the validator workflow grows.

## Risks

- **Loss of message-list overview.** Some users may want to see a paginated list of 50 hits at a glance. We're betting the triage-flow + progress strip is enough; if users push back, we can reintroduce a list view as a secondary tab without redoing this work.
- **Conversation context width.** `ThreadView` is designed for /run's full-page layout; inside the summaries page (which has a LabelRail on the left), available width is narrower. We may need to pass a `compact` prop to `ThreadView`. If the diff is invasive, fork to `ThreadViewCompact` instead of modifying.
