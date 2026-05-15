# DecisionWorkspace extraction — design spec

**Date:** 2026-05-15
**Branch:** `decision-workspace` (off `summaries-revamp`)
**Owner:** @m1nce
**Status:** Approved — implementation pending

---

## 1. Motivation

Three callsites in the app render the same shape: a thread of conversation, one focused turn under decision, a dock of decide / skip / undo controls, and keyboard shortcuts to drive it. Today that shape is reproduced three times across two pages:

- `src/pages/LabelRunPage.tsx` — twice (initial labeling at line 487, post-handoff review at line 417), with `DecisionDock` and `ReviewDock` respectively.
- `src/components/summaries/TriageTab.tsx` — once, with `TriageDock`.

(Post-handoff review at `LabelRunPage.tsx:417` passes a synthetic single-turn thread to `ThreadView` rather than a real conversation context. The shell does not need to know this; it sees a `thread.length === 1` with `focusIndex === 0` and renders it like any other.)

Each callsite reinvents:

- Layout (header / body / dock with optional right flank).
- The "ThreadView must live in a bounded-height parent" contract — which `TriageTab.tsx:218` got wrong (parent was a `block` with `overflow-hidden` instead of a sized flex/grid cell), causing the focused turn to land at inconsistent scroll positions. A one-line band-aid (`h-full` on `ThreadView`) landed on `summaries-revamp` but the structural divergence remains.
- A keyboard handler (`y` / `n` / `s` / `z` / Enter) suppressed when focus is in an input or textarea.
- A three-way decision dock with slight cosmetic differences.

This duplication is the surface that produced today's scroll bug and will produce the next one. The fix is to extract a single layout shell that owns those four concerns, and to fold the three docks into one variant-prop component.

---

## 2. Scope

**In scope:**
- New layout shell `<DecisionWorkspace>` owning layout, ThreadView scroll contract, keyboard wiring, and empty-state rendering.
- New `<AiReviewDock>` replacing `TriageDock` and `ReviewDock` (both react to a single AI prediction with keep/flip/skip semantics).
- Migration of `TriageTab` and the two `LabelRunPage` callsites to the new shell.
- Unit tests for the shell and the unified `AiReviewDock`; behavioral regression tests for the two callers (existing tests must pass unchanged after migration).

**Deliberately left as-is:**
- `src/components/run/DecisionDock.tsx` (initial labeling). It has features the AI-prediction docks don't share — a transient "recent" confirmation toast with inline undo, a `⏎` hand-off button, `⇧S` skip-conversation, large serif buttons — and folding it into a single dock would require a kitchen-sink prop surface. It will continue to be the dock for the initial labeling callsite, slotted into the new `DecisionWorkspace`.

**Out of scope:**
- `useDecisionLoop` hook (approach B from brainstorming). Revisited only if optimistic-flip code drifts again.
- Merging surrounding chrome (`StripBar`, `QueueLine`, `ConversationMeta`, `AssistFlank`, `NoteLabelPopover` vs. `TriageStrip`, `TriageFilterRow`). These legitimately differ.
- Changing data fetching, history shapes, optimistic-flip behavior, or any user-visible behavior.
- Removing the `h-full` band-aid on `ThreadView` (kept as defense in depth; the shell makes it redundant but harmless).

---

## 3. Component API

`src/components/decision/DecisionWorkspace.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { ConversationTurn } from '../../types'

export interface DecisionWorkspaceProps {
  // Conversation rendering
  thread: ConversationTurn[]
  focusIndex: number

  // Slots
  header?: ReactNode    // strip + filter row above ThreadView
  flank?: ReactNode     // right-side panel inside body; reserves 320px col when present
  dock: ReactNode       // <DecisionDock ... /> below ThreadView
  emptyState?: ReactNode // shown when thread.length === 0 (replaces ThreadView+flank)

  // Keyboard handlers — any omitted handler disables that key
  onYes?: () => void
  onNo?: () => void
  onSkip?: () => void
  onUndo?: () => void
  onAcceptAi?: () => void  // Enter
}
```

The shell does not decide; it dispatches. Callers keep ownership of state machines, history, optimistic UI, error toasts, and API calls.

### Behavior contract

1. **Layout** (see Section 4).
2. **ThreadView scroll parent is always bounded.** Body row is a `min-h-0 overflow-hidden` grid cell. `ThreadView`'s `h-full` resolves against it. The "focused turn lands vertically centered" guarantee from `ThreadView.tsx:24-36` becomes structurally enforced.
3. **Keyboard handler.**
   - Registered via one `useEffect` on `window` with cleanup.
   - Suppressed when `document.activeElement` is `INPUT` or `TEXTAREA` (matches existing logic in `TriageTab.tsx:158-161`).
   - Key map: `y` / `Y` → `onYes`, `n` / `N` → `onNo`, `s` / `S` → `onSkip`, `z` / `Z` → `onUndo`, `Enter` → `onAcceptAi`. Matches existing handler at `TriageTab.tsx:162` which lowercases `e.key` before comparing.
   - Omitted handlers: the listener stays registered but does nothing for that key. No `preventDefault` is ever called, so non-matching keys propagate normally.
4. **Modal compatibility.** Existing modal handlers (`NoteLabelPopover`, `AbortConfirmModal`) use `{ capture: true }` and will continue to win over the shell. The shell uses the default bubbling phase.
5. **Empty state.** When `thread.length === 0`, `emptyState` renders in place of the ThreadView + flank pair. The dock continues to render (callers may disable its buttons via the dock's own `disabled` prop).

---

## 4. Layout

```
DecisionWorkspace root
  flex flex-col flex-1 min-h-0 bg-canvas

├── header slot
│     intrinsic height; renders only when `header` is provided

├── body
│     grid; min-h-0; overflow-hidden; row=1fr
│     grid-cols-[1fr]            when flank is absent
│     grid-cols-[1fr_320px]      when flank is present
│   ├── <ThreadView thread={thread} focusIndex={focusIndex} />
│   │     receives a bounded grid cell → h-full resolves correctly
│   └── flank slot
│         renders only when `flank` is provided

└── dock slot
      intrinsic height; always renders
```

The body row uses `min-h-0` + `overflow-hidden` to clip overflow at the workspace boundary rather than the page. The `1fr` row in the outer flex column gives the body the slack to grow/shrink between header and dock.

When `thread.length === 0`, the body's contents are replaced by `emptyState` (the grid wrapper itself stays, so the layout doesn't jump).

---

## 5. Unified `<AiReviewDock>`

`src/components/decision/AiReviewDock.tsx`:

```tsx
export type AiReviewMode =
  | { kind: 'review'; aiValue: 'yes' | 'no'; aiConfidence: number; position: number; total: number }
  | { kind: 'triage'; aiVerdict: 'yes' | 'no' }

export interface AiReviewDockProps {
  mode: AiReviewMode
  onYes: () => void          // "Confirm Yes" (review, ai=yes) / "Keep YES" (triage, ai=yes) / "Flip to Yes" (review or triage, ai=no)
  onNo: () => void           // mirror of onYes
  onSkip: () => void
  onUndo?: () => void        // triage only; review has no undo
  onAcceptAi?: () => void    // triage only; Enter → accept AI prediction + advance
  canUndo?: boolean
  disabled?: boolean
}
```

### Variant behavior

| Variant   | Buttons rendered                                                                       | Source today                          |
|-----------|----------------------------------------------------------------------------------------|---------------------------------------|
| `review`  | Confirm/Flip YES (Y) · Flip/Confirm NO (N) · Skip (S) — position/total + confidence pill above | `components/run/ReviewDock.tsx`       |
| `triage`  | Keep/Flip YES (Y) · Keep/Flip NO (N) · Skip (S) · Undo (Z) · Accept AI → next (Enter)  | `components/summaries/TriageDock.tsx` |

`run/DecisionDock` (initial labeling) is **not** replaced. It is left in place and slotted into `DecisionWorkspace` unchanged.

### Shared primitives

Extract `DockButton` and the kbd badge into `src/components/decision/DockButton.tsx`. `AiReviewDock` uses it for both variants. `run/DecisionDock` continues to use its own `DecisionButton` (different visual style — large serif buttons — that doesn't share primitives with `AiReviewDock`).

---

## 6. Migration plan

Three PRs, each independently shippable. PR N+1 depends on PR N being merged.

### PR 1 — Add new shell + AiReviewDock + tests

Pure addition. No consumer changes.

- New files: `DecisionWorkspace.tsx`, `AiReviewDock.tsx`, `DockButton.tsx`, `DecisionWorkspace.test.tsx`, `AiReviewDock.test.tsx`.
- Verification: new tests pass; type-check clean; existing test suite unchanged.

### PR 2 — Migrate `TriageTab`

- `TriageTab.tsx` sheds its inline layout (lines 188–230), its keyboard handler (lines 156–184), and its dock.
- It becomes: data + state machine + `<DecisionWorkspace ... dock={<AiReviewDock mode={{ kind: 'triage', ... }} ... />} />`.
- Delete `src/components/summaries/TriageDock.tsx` and `src/tests/summaries/TriageDock.test.tsx`.
- Verification: `src/tests/summaries/TriageTab.test.tsx` passes with **zero modification**. If a test needs to change, the shell leaked behavior — fix the shell, not the test.

### PR 3 — Migrate `LabelRunPage`

Two callsites:

- `LabelRunPage.tsx:487` (initial labeling) → `DecisionWorkspace` wrapping the **existing** `run/DecisionDock` (unchanged).
- `LabelRunPage.tsx:417` (post-handoff review) → `DecisionWorkspace` wrapping `<AiReviewDock mode={{ kind: 'review', aiValue, aiConfidence, position, total }} ... />`.
- Move the `useEffect` keyboard handler at `LabelRunPage.tsx:357` into shell-driven handlers passed through props.
- `AssistFlank` becomes the `flank` slot in both callsites.
- Delete `src/components/run/ReviewDock.tsx`. **Keep** `src/components/run/DecisionDock.tsx`.
- Verification: existing run-page tests pass with zero modification; manual smoke of initial labeling, post-handoff review, undo, skip, hand-off (Enter), and shift+S skip-conversation.

---

## 7. Testing

### Shell unit tests (`src/tests/decision/DecisionWorkspace.test.tsx`)

1. Renders header, dock, and ThreadView in the three documented regions.
2. Renders flank in the right column when provided; collapses to single-column grid when not.
3. Renders `emptyState` in place of ThreadView/flank when `thread.length === 0`; dock still renders.
4. Keyboard: `y` / `n` / `s` / `z` / Enter each fire the matching handler.
5. Keyboard: handlers are not invoked when focus is in `input` or `textarea`.
6. Keyboard: omitted handlers do not throw and do not preventDefault.
7. ThreadView's scroll container has a bounded height (verifiable via `getComputedStyle` on the wrapping body grid cell, or via DOM assertion that the parent is the documented grid row).

### Dock unit tests (`src/tests/decision/AiReviewDock.test.tsx`)

1. `mode: 'review', aiValue: 'yes'` renders "Confirm Yes" (Y), "Flip to No" (N), "Skip" (S); confidence + position/total pill renders above.
2. `mode: 'review', aiValue: 'no'` reverses the labels: "Confirm No" (N), "Flip to Yes" (Y).
3. `mode: 'triage', aiVerdict: 'yes'` renders "Keep YES" (Y), "Flip to NO" (N), "Skip" (S), "Undo" (Z), "Accept AI → next" (Enter).
4. `mode: 'triage', aiVerdict: 'no'` reverses the keep/flip labels.
5. `disabled: true` propagates to all buttons in both variants.
6. `canUndo: false` disables the Undo button in `triage` mode.

### Behavioral regression

`src/tests/summaries/TriageTab.test.tsx` and any `LabelRunPage` tests pass with **zero modification** after their respective migration PRs.

---

## 8. File map

### New

- `src/components/decision/DecisionWorkspace.tsx`
- `src/components/decision/AiReviewDock.tsx`
- `src/components/decision/DockButton.tsx`
- `src/tests/decision/DecisionWorkspace.test.tsx`
- `src/tests/decision/AiReviewDock.test.tsx`

### Modified

- `src/components/summaries/TriageTab.tsx` (PR 2)
- `src/pages/LabelRunPage.tsx` (PR 3)

### Deleted

- `src/components/summaries/TriageDock.tsx` (after PR 2)
- `src/tests/summaries/TriageDock.test.tsx` (after PR 2)
- `src/components/run/ReviewDock.tsx` (after PR 3)

### Unchanged

- `src/components/run/DecisionDock.tsx` — continues to serve the initial labeling callsite

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Behavior drift during migration | "Existing tests pass with zero modification" gate per migration PR. |
| Modal keyboard conflicts (`NoteLabelPopover`, `AbortConfirmModal`) | Modals already use `{ capture: true }`; shell uses bubble phase. Verify in PR 3 smoke. |
| Empty-state regressions in `TriageTab` ("All caught up for {filter}") | Pass the existing empty-state JSX as `emptyState`. |
| `LabelRunPage`'s two callsites have subtly different flank widths or header rows | PR 3 may need to revisit the fixed `320px` flank width if AssistFlank diverges. Acceptable to add a `flankWidth` prop later if needed; not required for v1. |
| Premature abstraction | Scope is layout-only; data layers untouched. If the shell ever needs to know about decisions, that's a signal to escalate to approach B (the hook), not to widen the shell. |

---

## 10. Success criteria

1. `<DecisionWorkspace>` is the single source of truth for the decision-screen layout and keyboard handling.
2. `<DecisionDock>` is the single source of truth for the decision-screen control surface.
3. `TriageTab` and both `LabelRunPage` callsites use the shell.
4. The three old docks (`TriageDock`, `DecisionDock` old, `ReviewDock`) are deleted.
5. All existing summaries and run tests pass with zero modification after their respective migration PRs.
6. Today's scroll bug becomes structurally impossible to reintroduce at any current or future callsite.
