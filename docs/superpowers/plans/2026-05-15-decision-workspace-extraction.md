# DecisionWorkspace Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared layout shell (`DecisionWorkspace`) and a unified AI-review dock (`AiReviewDock`) so the three decision-screen callsites in the app stop reinventing layout, scroll contract, keyboard wiring, and dock visuals.

**Architecture:** New `src/components/decision/` directory with three files: `DecisionWorkspace` (layout + keyboard), `AiReviewDock` (unified review/triage dock), `DockButton` (shared primitive). `TriageTab` and the post-handoff-review callsite in `LabelRunPage` migrate to the new shell. The initial-labeling callsite in `LabelRunPage` adopts the shell but keeps its existing `run/DecisionDock` (which has features the AI-review docks don't share).

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-15-decision-workspace-extraction-design.md`

**User preference:** This codebase user reviews and commits changes themselves. Tasks end with a "stop for user review" step instead of `git commit`. Group related task output before stopping so the user can review and commit at a natural breakpoint.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/components/decision/DockButton.tsx` | Shared button + kbd-chip primitive used by `AiReviewDock`. |
| `src/components/decision/AiReviewDock.tsx` | Unified dock for review (post-handoff) and triage (summaries) variants. |
| `src/components/decision/DecisionWorkspace.tsx` | Layout shell: header / body grid (ThreadView + optional flank) / dock. Owns keyboard handler. |
| `src/tests/decision/DockButton.test.tsx` | Unit tests for the primitive. |
| `src/tests/decision/AiReviewDock.test.tsx` | Variant rendering + interaction tests. |
| `src/tests/decision/DecisionWorkspace.test.tsx` | Slot rendering, keyboard, empty state, flank toggle. |

### Modified files

| File | Change |
|------|--------|
| `src/components/summaries/TriageTab.tsx` | Replace inline layout, keyboard handler, and `TriageDock` with `DecisionWorkspace` + `AiReviewDock`. |
| `src/pages/LabelRunPage.tsx` | Two callsites: initial labeling (line 487) and post-handoff review (line 417) adopt `DecisionWorkspace`. Initial keeps existing `run/DecisionDock`; review switches to `AiReviewDock`. The window keydown listener at line 357 moves to shell-driven handlers. |

### Deleted files

| File | When |
|------|------|
| `src/components/summaries/TriageDock.tsx` | After PR 2 (TriageTab migration). |
| `src/tests/summaries/TriageDock.test.tsx` | After PR 2. |
| `src/components/run/ReviewDock.tsx` | After PR 3 (LabelRunPage migration). |

### Unchanged

- `src/components/run/DecisionDock.tsx` continues to drive the initial labeling callsite.
- `src/components/run/ThreadView.tsx` is the rendering primitive both old and new callsites use. The `h-full` band-aid added on `summaries-revamp` stays as defense in depth.

---

## PR 1 — Foundation

Pure addition. Zero consumer changes. The whole PR is independently reviewable and shippable.

### Task 1: `DockButton` primitive

**Files:**
- Create: `src/components/decision/DockButton.tsx`
- Create: `src/tests/decision/DockButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/tests/decision/DockButton.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { DockButton } from '../../components/decision/DockButton'

test('renders label and kbd chip', () => {
  render(<DockButton label="Keep YES" kbd="y" tone="primary" onClick={vi.fn()} />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeInTheDocument()
  expect(screen.getByText('y')).toBeInTheDocument()
})

test('clicking fires onClick', () => {
  const onClick = vi.fn()
  render(<DockButton label="Skip" kbd="s" tone="muted" onClick={onClick} />)
  fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('disabled prevents onClick', () => {
  const onClick = vi.fn()
  render(<DockButton label="Undo" kbd="z" tone="muted" onClick={onClick} disabled />)
  fireEvent.click(screen.getByRole('button', { name: /undo/i }))
  expect(onClick).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
})

test('applies tone-specific border class', () => {
  const { rerender } = render(<DockButton label="X" kbd="x" tone="moss" onClick={vi.fn()} />)
  expect(screen.getByRole('button')).toHaveClass('border-moss')
  rerender(<DockButton label="X" kbd="x" tone="brick" onClick={vi.fn()} />)
  expect(screen.getByRole('button')).toHaveClass('border-brick')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/decision/DockButton.test.tsx`
Expected: FAIL — `DockButton` not found.

- [ ] **Step 3: Implement `DockButton`**

```tsx
// src/components/decision/DockButton.tsx
type Tone = 'primary' | 'moss' | 'brick' | 'muted'

const toneClass: Record<Tone, string> = {
  primary: 'border-ochre bg-ochre-dim text-paper',
  moss: 'border-moss text-moss',
  brick: 'border-brick text-brick',
  muted: 'border-edge text-on-surface',
}

interface DockButtonProps {
  label: string
  kbd: string
  tone: Tone
  onClick: () => void
  disabled?: boolean
}

export function DockButton({ label, kbd, tone, onClick, disabled }: DockButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-[11px] tracking-[0.06em] uppercase disabled:opacity-40 ${toneClass[tone]}`}
    >
      <span className="text-ochre border border-edge px-1 rounded-sm text-[9.5px]">{kbd}</span>
      {label}
    </button>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/decision/DockButton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Stop for user review**

Surface to user: "Task 1 (DockButton) complete — 4 tests pass. Continue to Task 2?"

---

### Task 2: `AiReviewDock` — `triage` variant

**Files:**
- Create: `src/components/decision/AiReviewDock.tsx`
- Create: `src/tests/decision/AiReviewDock.test.tsx`

- [ ] **Step 1: Write the failing tests for the triage variant**

```tsx
// src/tests/decision/AiReviewDock.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { AiReviewDock } from '../../components/decision/AiReviewDock'

const triageProps = {
  mode: { kind: 'triage' as const, aiVerdict: 'yes' as const },
  onYes: vi.fn(),
  onNo: vi.fn(),
  onSkip: vi.fn(),
  onUndo: vi.fn(),
  onAcceptAi: vi.fn(),
  canUndo: true,
  disabled: false,
}

test('triage variant with aiVerdict=yes labels primary "Keep YES", secondary "Flip to NO"', () => {
  render(<AiReviewDock {...triageProps} />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeInTheDocument()
})

test('triage variant with aiVerdict=no reverses labels', () => {
  render(<AiReviewDock {...triageProps} mode={{ kind: 'triage', aiVerdict: 'no' }} />)
  expect(screen.getByRole('button', { name: /flip to yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /keep no/i })).toBeInTheDocument()
})

test('triage variant renders Undo and Accept-AI affordances', () => {
  render(<AiReviewDock {...triageProps} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /accept ai/i })).toBeInTheDocument()
})

test('triage variant disables Undo when canUndo=false', () => {
  render(<AiReviewDock {...triageProps} canUndo={false} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
})

test('triage variant: clicking Accept-AI fires onAcceptAi', () => {
  const onAcceptAi = vi.fn()
  render(<AiReviewDock {...triageProps} onAcceptAi={onAcceptAi} />)
  fireEvent.click(screen.getByRole('button', { name: /accept ai/i }))
  expect(onAcceptAi).toHaveBeenCalledTimes(1)
})

test('triage variant: clicking Keep YES fires onYes', () => {
  const onYes = vi.fn()
  render(<AiReviewDock {...triageProps} onYes={onYes} />)
  fireEvent.click(screen.getByRole('button', { name: /keep yes/i }))
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('triage variant: disabled=true disables all decision buttons', () => {
  render(<AiReviewDock {...triageProps} disabled />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/decision/AiReviewDock.test.tsx`
Expected: FAIL — `AiReviewDock` not found.

- [ ] **Step 3: Implement `AiReviewDock` with the triage variant only**

```tsx
// src/components/decision/AiReviewDock.tsx
import { DockButton } from './DockButton'

export type AiReviewMode =
  | { kind: 'review'; aiValue: 'yes' | 'no'; aiConfidence: number; position: number; total: number }
  | { kind: 'triage'; aiVerdict: 'yes' | 'no' }

export interface AiReviewDockProps {
  mode: AiReviewMode
  onYes: () => void
  onNo: () => void
  onSkip: () => void
  onUndo?: () => void
  onAcceptAi?: () => void
  canUndo?: boolean
  disabled?: boolean
}

export function AiReviewDock(props: AiReviewDockProps) {
  if (props.mode.kind === 'triage') return <TriageDockBody {...props} mode={props.mode} />
  // 'review' branch added in Task 3.
  return null
}

interface TriageBodyProps extends AiReviewDockProps {
  mode: { kind: 'triage'; aiVerdict: 'yes' | 'no' }
}

function TriageDockBody({
  mode,
  onYes,
  onNo,
  onSkip,
  onUndo,
  onAcceptAi,
  canUndo,
  disabled,
}: TriageBodyProps) {
  const aiIsYes = mode.aiVerdict === 'yes'
  return (
    <div className="px-7 py-4 border-t border-edge bg-canvas flex items-center gap-2.5">
      <DockButton
        label={aiIsYes ? 'Keep YES' : 'Flip to YES'}
        kbd="y"
        tone={aiIsYes ? 'primary' : 'moss'}
        onClick={onYes}
        disabled={disabled}
      />
      <DockButton
        label={aiIsYes ? 'Flip to NO' : 'Keep NO'}
        kbd="n"
        tone={aiIsYes ? 'brick' : 'primary'}
        onClick={onNo}
        disabled={disabled}
      />
      <DockButton label="Skip" kbd="s" tone="muted" onClick={onSkip} disabled={disabled} />
      <DockButton
        label="Undo"
        kbd="z"
        tone="muted"
        onClick={onUndo ?? (() => {})}
        disabled={disabled || !canUndo}
      />
      <button
        onClick={onAcceptAi}
        disabled={disabled}
        className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-faint hover:text-paper disabled:opacity-40"
      >
        <span className="inline-block px-1.5 py-0.5 border border-edge rounded-sm mr-2 text-ochre">
          Enter
        </span>
        accept ai &amp; next
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/decision/AiReviewDock.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Stop for user review**

Surface: "Task 2 (AiReviewDock triage variant) complete — 7 tests pass. Continue?"

---

### Task 3: `AiReviewDock` — `review` variant

**Files:**
- Modify: `src/components/decision/AiReviewDock.tsx`
- Modify: `src/tests/decision/AiReviewDock.test.tsx`

- [ ] **Step 1: Append failing tests for the review variant**

Append to `src/tests/decision/AiReviewDock.test.tsx`:

```tsx
const reviewProps = {
  mode: {
    kind: 'review' as const,
    aiValue: 'yes' as const,
    aiConfidence: 0.87,
    position: 3,
    total: 12,
  },
  onYes: vi.fn(),
  onNo: vi.fn(),
  onSkip: vi.fn(),
  disabled: false,
}

test('review variant with aiValue=yes shows "Confirm Yes" and "Flip to No"', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.getByRole('button', { name: /confirm yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeInTheDocument()
})

test('review variant with aiValue=no reverses labels', () => {
  render(
    <AiReviewDock
      {...reviewProps}
      mode={{ ...reviewProps.mode, aiValue: 'no' }}
    />,
  )
  expect(screen.getByRole('button', { name: /confirm no/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to yes/i })).toBeInTheDocument()
})

test('review variant renders position/total + confidence summary', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.getByText(/reviewing AI prediction 3 of 12/i)).toBeInTheDocument()
  expect(screen.getByText(/confidence 0\.87/)).toBeInTheDocument()
})

test('review variant: clicking "Confirm Yes" fires onYes', () => {
  const onYes = vi.fn()
  render(<AiReviewDock {...reviewProps} onYes={onYes} />)
  fireEvent.click(screen.getByRole('button', { name: /confirm yes/i }))
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('review variant: clicking "Flip to No" fires onNo', () => {
  const onNo = vi.fn()
  render(<AiReviewDock {...reviewProps} onNo={onNo} />)
  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))
  expect(onNo).toHaveBeenCalledTimes(1)
})

test('review variant: disabled=true disables all buttons', () => {
  render(<AiReviewDock {...reviewProps} disabled />)
  expect(screen.getByRole('button', { name: /confirm yes/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
})

test('review variant does NOT render Undo or Accept-AI affordances', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /accept ai/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/decision/AiReviewDock.test.tsx`
Expected: 7 new tests FAIL (review variant returns null).

- [ ] **Step 3: Implement the review branch**

Update `src/components/decision/AiReviewDock.tsx`. Replace the body of `AiReviewDock` and append `ReviewDockBody`:

```tsx
export function AiReviewDock(props: AiReviewDockProps) {
  if (props.mode.kind === 'triage') return <TriageDockBody {...props} mode={props.mode} />
  return <ReviewDockBody {...props} mode={props.mode} />
}

interface ReviewBodyProps extends AiReviewDockProps {
  mode: { kind: 'review'; aiValue: 'yes' | 'no'; aiConfidence: number; position: number; total: number }
}

function ReviewDockBody({ mode, onYes, onNo, onSkip, disabled }: ReviewBodyProps) {
  const aiIsYes = mode.aiValue === 'yes'
  return (
    <div className="px-7 py-4 border-t border-edge bg-canvas flex flex-col items-center gap-2.5">
      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
        Reviewing AI prediction {mode.position} of {mode.total}
        <span className="opacity-50 mx-2">·</span>
        confidence {mode.aiConfidence.toFixed(2)}
      </div>
      <div className="flex gap-2.5">
        <DockButton
          label={aiIsYes ? 'Confirm Yes' : 'Flip to Yes'}
          kbd="y"
          tone={aiIsYes ? 'primary' : 'moss'}
          onClick={onYes}
          disabled={disabled}
        />
        <DockButton
          label={aiIsYes ? 'Flip to No' : 'Confirm No'}
          kbd="n"
          tone={aiIsYes ? 'brick' : 'primary'}
          onClick={onNo}
          disabled={disabled}
        />
        <DockButton label="Skip" kbd="s" tone="muted" onClick={onSkip} disabled={disabled} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/tests/decision/AiReviewDock.test.tsx`
Expected: PASS (14 tests total — 7 triage + 7 review).

- [ ] **Step 5: Stop for user review**

Surface: "Task 3 (AiReviewDock review variant) complete — 14 tests pass. Continue?"

---

### Task 4: `DecisionWorkspace` — layout shell (no keyboard yet)

**Files:**
- Create: `src/components/decision/DecisionWorkspace.tsx`
- Create: `src/tests/decision/DecisionWorkspace.test.tsx`

- [ ] **Step 1: Write the failing tests for slot rendering**

```tsx
// src/tests/decision/DecisionWorkspace.test.tsx
import { render, screen } from '@testing-library/react'
import { DecisionWorkspace } from '../../components/decision/DecisionWorkspace'
import type { ConversationTurn } from '../../types'

const thread: ConversationTurn[] = [
  { message_index: 0, role: 'student', text: 'student question' },
]

test('renders header, dock, and ThreadView region', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      header={<div data-testid="header" />}
      dock={<div data-testid="dock" />}
    />,
  )
  expect(screen.getByTestId('header')).toBeInTheDocument()
  expect(screen.getByTestId('dock')).toBeInTheDocument()
  expect(screen.getByText('student question')).toBeInTheDocument()
})

test('omits header region when header prop not provided', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
    />,
  )
  expect(screen.getByTestId('dock')).toBeInTheDocument()
})

test('renders flank in right column when provided', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      flank={<aside data-testid="flank" />}
    />,
  )
  expect(screen.getByTestId('flank')).toBeInTheDocument()
})

test('body grid uses 1-col layout when no flank', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/grid-cols-\[1fr\]/)
})

test('body grid uses 2-col layout when flank is present', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      flank={<aside />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/grid-cols-\[1fr_320px\]/)
})

test('renders emptyState in place of ThreadView when thread is empty', () => {
  render(
    <DecisionWorkspace
      thread={[]}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      emptyState={<div data-testid="empty">Nothing here</div>}
    />,
  )
  expect(screen.getByTestId('empty')).toBeInTheDocument()
  expect(screen.getByTestId('dock')).toBeInTheDocument()
})

test('body region has min-h-0 and overflow-hidden classes (scroll contract)', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/min-h-0/)
  expect(body?.className).toMatch(/overflow-hidden/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/decision/DecisionWorkspace.test.tsx`
Expected: FAIL — `DecisionWorkspace` not found.

- [ ] **Step 3: Implement the layout shell**

```tsx
// src/components/decision/DecisionWorkspace.tsx
import type { ReactNode } from 'react'
import { ThreadView } from '../run/ThreadView'
import type { ConversationTurn } from '../../types'

export interface DecisionWorkspaceProps {
  thread: ConversationTurn[]
  focusIndex: number
  header?: ReactNode
  flank?: ReactNode
  dock: ReactNode
  emptyState?: ReactNode
  onYes?: () => void
  onNo?: () => void
  onSkip?: () => void
  onUndo?: () => void
  onAcceptAi?: () => void
}

export function DecisionWorkspace({
  thread,
  focusIndex,
  header,
  flank,
  dock,
  emptyState,
}: DecisionWorkspaceProps) {
  const isEmpty = thread.length === 0
  const bodyCols = flank ? 'grid-cols-[1fr_320px]' : 'grid-cols-[1fr]'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      {header}
      <div
        data-region="body"
        className={`flex-1 min-h-0 overflow-hidden grid ${bodyCols}`}
      >
        {isEmpty ? (
          <div className="col-span-full flex items-center justify-center">{emptyState}</div>
        ) : (
          <>
            <ThreadView thread={thread} focusIndex={focusIndex} />
            {flank}
          </>
        )}
      </div>
      {dock}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/tests/decision/DecisionWorkspace.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Stop for user review**

Surface: "Task 4 (DecisionWorkspace layout) complete — 7 tests pass. Continue?"

---

### Task 5: `DecisionWorkspace` — keyboard handler

**Files:**
- Modify: `src/components/decision/DecisionWorkspace.tsx`
- Modify: `src/tests/decision/DecisionWorkspace.test.tsx`

- [ ] **Step 1: Append failing tests for keyboard behavior**

Append to `src/tests/decision/DecisionWorkspace.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

test('pressing "y" fires onYes', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('pressing "Y" (uppercase) also fires onYes', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  fireEvent.keyDown(window, { key: 'Y' })
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('pressing "n", "s", "z", "Enter" fires the matching handlers', () => {
  const onNo = vi.fn()
  const onSkip = vi.fn()
  const onUndo = vi.fn()
  const onAcceptAi = vi.fn()
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
      onNo={onNo}
      onSkip={onSkip}
      onUndo={onUndo}
      onAcceptAi={onAcceptAi}
    />,
  )
  fireEvent.keyDown(window, { key: 'n' })
  fireEvent.keyDown(window, { key: 's' })
  fireEvent.keyDown(window, { key: 'z' })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(onNo).toHaveBeenCalledTimes(1)
  expect(onSkip).toHaveBeenCalledTimes(1)
  expect(onUndo).toHaveBeenCalledTimes(1)
  expect(onAcceptAi).toHaveBeenCalledTimes(1)
})

test('omitted handlers are silently ignored (no throw)', () => {
  render(<DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} />)
  expect(() => fireEvent.keyDown(window, { key: 'y' })).not.toThrow()
})

test('keyboard handlers suppressed when focus is in an input', () => {
  const onYes = vi.fn()
  render(
    <>
      <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />
      <input data-testid="probe" />
    </>,
  )
  const input = screen.getByTestId('probe')
  input.focus()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('keyboard handlers suppressed when focus is in a textarea', () => {
  const onYes = vi.fn()
  render(
    <>
      <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />
      <textarea data-testid="probe" />
    </>,
  )
  const ta = screen.getByTestId('probe')
  ta.focus()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('non-mapped keys are ignored and not preventDefault', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  const e = new KeyboardEvent('keydown', { key: 'q', cancelable: true })
  window.dispatchEvent(e)
  expect(onYes).not.toHaveBeenCalled()
  expect(e.defaultPrevented).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/decision/DecisionWorkspace.test.tsx`
Expected: 7 new tests FAIL (no keydown listener yet).

- [ ] **Step 3: Add the keyboard handler to the shell**

Update `src/components/decision/DecisionWorkspace.tsx`. Replace the body of `DecisionWorkspace`:

```tsx
import { useEffect, type ReactNode } from 'react'
import { ThreadView } from '../run/ThreadView'
import type { ConversationTurn } from '../../types'

export interface DecisionWorkspaceProps {
  thread: ConversationTurn[]
  focusIndex: number
  header?: ReactNode
  flank?: ReactNode
  dock: ReactNode
  emptyState?: ReactNode
  onYes?: () => void
  onNo?: () => void
  onSkip?: () => void
  onUndo?: () => void
  onAcceptAi?: () => void
}

export function DecisionWorkspace({
  thread,
  focusIndex,
  header,
  flank,
  dock,
  emptyState,
  onYes,
  onNo,
  onSkip,
  onUndo,
  onAcceptAi,
}: DecisionWorkspaceProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key.toLowerCase()
      switch (key) {
        case 'y':
          onYes?.()
          break
        case 'n':
          onNo?.()
          break
        case 's':
          onSkip?.()
          break
        case 'z':
          onUndo?.()
          break
        case 'enter':
          onAcceptAi?.()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onYes, onNo, onSkip, onUndo, onAcceptAi])

  const isEmpty = thread.length === 0
  const bodyCols = flank ? 'grid-cols-[1fr_320px]' : 'grid-cols-[1fr]'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      {header}
      <div
        data-region="body"
        className={`flex-1 min-h-0 overflow-hidden grid ${bodyCols}`}
      >
        {isEmpty ? (
          <div className="col-span-full flex items-center justify-center">{emptyState}</div>
        ) : (
          <>
            <ThreadView thread={thread} focusIndex={focusIndex} />
            {flank}
          </>
        )}
      </div>
      {dock}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/tests/decision/DecisionWorkspace.test.tsx`
Expected: PASS (14 tests total).

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: type-check clean; entire test suite passes; no existing tests changed.

- [ ] **Step 6: Stop for user review (end of PR 1)**

Surface: "PR 1 (foundation) complete — `DockButton`, `AiReviewDock` (review+triage), `DecisionWorkspace` (layout+keyboard) all in place with 25 new tests passing and zero existing tests changed. Ready to review and commit as one PR. Continue to PR 2 (TriageTab migration) after that?"

---

## PR 2 — Migrate `TriageTab`

### Task 6: Capture the pre-migration test baseline

**Files:**
- (read-only) `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Run existing TriageTab tests and capture pass count**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: PASS. Record the number of passing tests — this is the gate for the migration.

- [ ] **Step 2: Inspect the test file**

Read `src/tests/summaries/TriageTab.test.tsx` end-to-end. Note any test that asserts on internal class names, DOM structure, or specific child components — those are at risk of needing changes the spec forbids. If any exist, flag them and stop for user discussion before proceeding.

- [ ] **Step 3: Stop for user confirmation**

Surface: "TriageTab baseline: N tests passing, M risky assertions found (or none). Proceed with migration?"

---

### Task 7: Replace `TriageDock` usage with `AiReviewDock`

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`

- [ ] **Step 1: Swap the import**

In `src/components/summaries/TriageTab.tsx`, replace:

```tsx
import { TriageDock } from './TriageDock'
```

with:

```tsx
import { AiReviewDock } from '../decision/AiReviewDock'
```

- [ ] **Step 2: Replace the JSX usage**

Find the `<TriageDock ... />` element near the bottom of the main return (the file currently uses it as the last sibling before the error toast). Replace:

```tsx
<TriageDock
  aiVerdict={(focused?.verdict ?? 'yes') as 'yes' | 'no'}
  onYes={() => decide('yes')}
  onNo={() => decide('no')}
  onAcceptAi={acceptAi}
  onSkip={skip}
  onUndo={undo}
  canUndo={history.length > 0 || cursor > 0}
  disabled={!focused}
/>
```

with:

```tsx
<AiReviewDock
  mode={{ kind: 'triage', aiVerdict: (focused?.verdict ?? 'yes') as 'yes' | 'no' }}
  onYes={() => decide('yes')}
  onNo={() => decide('no')}
  onAcceptAi={acceptAi}
  onSkip={skip}
  onUndo={undo}
  canUndo={history.length > 0 || cursor > 0}
  disabled={!focused}
/>
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: PASS — same count as the baseline from Task 6 step 1. If any test fails, the new dock's accessible names diverge from the old one — fix `AiReviewDock` to match (not the test).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Stop for user review**

Surface: "Task 7 done — TriageTab now uses AiReviewDock, all existing tests still pass. Continue?"

---

### Task 8: Replace `TriageTab`'s inline layout and keyboard handler with `DecisionWorkspace`

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`

- [ ] **Step 1: Add the workspace import**

In `src/components/summaries/TriageTab.tsx`, add:

```tsx
import { DecisionWorkspace } from '../decision/DecisionWorkspace'
```

- [ ] **Step 2: Remove the local keyboard handler**

Delete the `useEffect` that registers the window keydown listener (currently `TriageTab.tsx:156-184`). Its responsibilities are now owned by the shell.

- [ ] **Step 3: Replace the two return branches with workspace-based JSX**

The function currently has two returns: an "All caught up" branch (lines 188–205) and the main render branch (lines 207–240). Replace both with a single return that uses `DecisionWorkspace`. Compute `isCaughtUp` BEFORE building the header so the strip's counters reflect the empty state:

```tsx
const isCaughtUp = items.length === 0 || cursor >= items.length

const header = (
  <>
    <TriageStrip
      cursor={isCaughtUp ? 0 : cursor}
      reviewTotal={isCaughtUp ? 0 : items.length}
      hiddenCount={hiddenCount}
    />
    <TriageFilterRow
      filter={filter}
      sort={sort}
      reviewCount={label.review_count}
      flaggedCount={0}
      onFilterChange={setFilter}
      onSortChange={setSort}
    />
  </>
)

return (
  <>
    <DecisionWorkspace
      thread={isCaughtUp || !focused ? [] : thread}
      focusIndex={focusIndex}
      header={header}
      emptyState={
        <div className="text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
          All caught up for "{filter}"
        </div>
      }
      dock={
        <AiReviewDock
          mode={{ kind: 'triage', aiVerdict: (focused?.verdict ?? 'yes') as 'yes' | 'no' }}
          onYes={() => decide('yes')}
          onNo={() => decide('no')}
          onAcceptAi={acceptAi}
          onSkip={skip}
          onUndo={undo}
          canUndo={history.length > 0 || cursor > 0}
          disabled={!focused}
        />
      }
      onYes={() => decide('yes')}
      onNo={() => decide('no')}
      onSkip={skip}
      onUndo={undo}
      onAcceptAi={acceptAi}
    />
    {error && (
      <div
        role="alert"
        className="fixed bottom-4 right-4 bg-brick-dim border border-brick text-paper px-3 py-2 rounded-sm font-mono text-[11px] z-50"
      >
        {error}
      </div>
    )}
  </>
)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/tests/summaries/`
Expected: PASS — every existing summaries test, including `TriageTab.test.tsx`, passes with zero modification. If a test fails, the workspace contract is leaking — fix the shell. **Do not change the test.**

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Manual smoke**

Start the app (`npm run dev:all`) and visit `/summaries` in single-label mode. Verify:
- Focused message lands vertically centered in the body.
- y / n / s / z / Enter all work.
- "All caught up for ..." renders when the bucket is empty.
- The undo toast appears on flip failure (force one if needed).

- [ ] **Step 7: Stop for user review**

Surface: "Task 8 done — TriageTab migrated, zero test changes, smoke clean. Continue to deletion?"

---

### Task 9: Delete `TriageDock` and its test

**Files:**
- Delete: `src/components/summaries/TriageDock.tsx`
- Delete: `src/tests/summaries/TriageDock.test.tsx`

- [ ] **Step 1: Confirm no other importers**

Run: `grep -rn "from .*summaries/TriageDock" src/ --include="*.tsx" --include="*.ts"`
Expected: empty output (the only consumer was `TriageTab`, now migrated).

- [ ] **Step 2: Delete the files**

Run:
```bash
rm src/components/summaries/TriageDock.tsx src/tests/summaries/TriageDock.test.tsx
```

- [ ] **Step 3: Verify the suite still passes**

Run: `npx tsc --noEmit && npx vitest run`
Expected: type-check clean; suite passes.

- [ ] **Step 4: Stop for user review (end of PR 2)**

Surface: "PR 2 complete — TriageTab migrated to DecisionWorkspace + AiReviewDock, TriageDock deleted, all existing tests pass with zero modification. Ready to review and commit. Continue to PR 3 (LabelRunPage)?"

---

## PR 3 — Migrate `LabelRunPage`

### Task 10: Capture the LabelRunPage test baseline

**Files:**
- (read-only) any `src/tests/**/LabelRun*` or related

- [ ] **Step 1: Find and run existing LabelRunPage tests**

Run: `find src/tests -name "*LabelRun*" -o -name "*labelrun*" 2>/dev/null && npx vitest run`
Expected: full suite passes. Note the count for the post-migration gate. If there are no LabelRunPage-specific tests, document that in the surface to user and rely on manual smoke at Task 14.

- [ ] **Step 2: Stop for user confirmation**

Surface: "LabelRunPage baseline: N tests across the suite. Proceed?"

---

### Task 11: Migrate the post-handoff review callsite to `DecisionWorkspace` + `AiReviewDock`

**Files:**
- Modify: `src/pages/LabelRunPage.tsx`

- [ ] **Step 1: Add new imports**

In `src/pages/LabelRunPage.tsx`, add:

```tsx
import { DecisionWorkspace } from '../components/decision/DecisionWorkspace'
import { AiReviewDock } from '../components/decision/AiReviewDock'
```

- [ ] **Step 2: Replace the review-mode return block**

The review branch wraps its content in an outer `<div>` and ends with the `NoteLabelPopover` / `AbortConfirmModal` siblings. Keep those overlays where they are (as siblings of the workspace inside the outer div); only the body-and-dock area moves into `DecisionWorkspace`.

The review branch currently looks like this (around `LabelRunPage.tsx:415-432`):

```tsx
<ConversationMeta
  chatlogId={item.chatlog_id}
  notebook={item.notebook}
  turnCount={1}
/>
<ReviewIntro item={item} />
<div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
  <ThreadView
    thread={[{ message_index: 0, role: 'student', text: item.text }]}
    focusIndex={0}
  />
  <AssistFlank neighbors={assistNeighbors} />
</div>
<ReviewDock
  aiValue={item.ai_value}
  aiConfidence={item.ai_confidence}
  position={reviewIdx + 1}
  total={reviewQueue.length}
  onConfirm={() => handleReview(item.ai_value)}
  onFlip={() => handleReview(flippedValue)}
  onSkip={advanceReview}
  disabled={busy}
/>
```

Replace with:

```tsx
<ConversationMeta
  chatlogId={item.chatlog_id}
  notebook={item.notebook}
  turnCount={1}
/>
<ReviewIntro item={item} />
<DecisionWorkspace
  thread={[{ message_index: 0, role: 'student', text: item.text }]}
  focusIndex={0}
  flank={<AssistFlank neighbors={assistNeighbors} />}
  dock={
    <AiReviewDock
      mode={{
        kind: 'review',
        aiValue: item.ai_value,
        aiConfidence: item.ai_confidence,
        position: reviewIdx + 1,
        total: reviewQueue.length,
      }}
      onYes={() => handleReview('yes')}
      onNo={() => handleReview('no')}
      onSkip={advanceReview}
      disabled={busy}
    />
  }
  onYes={() => handleReview('yes')}
  onNo={() => handleReview('no')}
  onSkip={advanceReview}
/>
```

Note: the AiReviewDock's `onYes`/`onNo` map directly to YES/NO outcomes (not "confirm AI" vs "flip"). `ReviewDock`'s `onConfirm`/`onFlip` (which used the precomputed `flippedValue` from earlier in the function) becomes: pressing Y always commits "yes", N always commits "no". This matches the keyboard convention used everywhere else in the app. The `flippedValue` local variable can be removed once this is the only consumer.

- [ ] **Step 3: Drop the old `ReviewDock` import**

In `src/pages/LabelRunPage.tsx`, delete:

```tsx
import { ReviewDock } from '../components/run/ReviewDock'
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: existing tests pass with zero modification. Type-check clean: `npx tsc --noEmit`.

- [ ] **Step 5: Stop for user review**

Surface: "Task 11 done — review callsite migrated. Continue to initial-labeling callsite?"

---

### Task 12: Migrate the initial-labeling callsite to `DecisionWorkspace`

**Files:**
- Modify: `src/pages/LabelRunPage.tsx`

- [ ] **Step 1: Replace the initial-labeling return block**

The initial-labeling branch currently looks like this (around `LabelRunPage.tsx:480-499`):

```tsx
<div className="grid grid-rows-[auto_auto_1fr_auto] flex-1 min-h-0 overflow-hidden bg-canvas">
  <div className="bg-canvas">
    <StripBar ... />
    <QueueLine ... />
  </div>
  <ConversationMeta ... />
  <div className="grid grid-cols-[1fr_320px] min-h-0 overflow-hidden">
    <ThreadView thread={focused.thread} focusIndex={focused.focus_index} />
    <AssistFlank neighbors={assistNeighbors} />
  </div>
  <DecisionDock
    onDecide={handleDecide}
    onUndo={handleUndo}
    onHandoff={handleHandoff}
    onSkipConversation={handleSkipConversation}
    disabled={busy}
    loading={busy}
    recent={recent}
  />
```

Refactor to wrap StripBar/QueueLine/ConversationMeta inside `DecisionWorkspace.header`, and slot the existing `DecisionDock` into `DecisionWorkspace.dock`:

```tsx
<DecisionWorkspace
  thread={focused.thread}
  focusIndex={focused.focus_index}
  header={
    <>
      <div className="bg-canvas">
        <StripBar
          label={activeLabel}
          readiness={readiness ?? defaultReadiness()}
          assignments={assignments}
          unmapped={unmapped}
          selectedAssignmentId={selectedAssignmentId}
          onSelectAssignment={(id) => setSelectedAssignmentId(id)}
          onHandoff={handleHandoff}
          onSampleHandoff={handleSampleHandoff}
          onAbort={() => setAbortOpen(true)}
        />
        <QueueLine
          queued={queued}
          onAdd={() => setNoteOpen(true)}
          onRemove={handleRemoveQueued}
          onClearAll={handleClearQueue}
        />
      </div>
      <ConversationMeta
        chatlogId={focused.chatlog_id}
        notebook={focused.notebook}
        turnCount={focused.conversation_turn_count}
      />
    </>
  }
  flank={<AssistFlank neighbors={assistNeighbors} />}
  dock={
    <DecisionDock
      onDecide={handleDecide}
      onUndo={handleUndo}
      onHandoff={handleHandoff}
      onSkipConversation={handleSkipConversation}
      disabled={busy}
      loading={busy}
      recent={recent}
    />
  }
  onYes={() => handleDecide('yes')}
  onNo={() => handleDecide('no')}
  onSkip={() => handleDecide('skip')}
  onUndo={handleUndo}
  onAcceptAi={handleHandoff}
/>
```

Notes:
- The `<div className="grid grid-rows-[auto_auto_1fr_auto] ...">` outer container is replaced by `DecisionWorkspace`'s own root layout. Any sibling overlays inside that container (`NoteLabelPopover`, `AbortConfirmModal` when `abortOpen`) must be relocated as siblings of `DecisionWorkspace` inside a fragment, so they continue to render at the same DOM depth.
- The existing `run/DecisionDock` is unchanged.
- Wrap the new return in a fragment to keep modals as siblings:

```tsx
return (
  <>
    <DecisionWorkspace ... />
    <NoteLabelPopover ... />
    {abortOpen && <AbortConfirmModal ... />}
  </>
)
```

- [ ] **Step 2: Remove the now-redundant window keydown handler**

Delete the `useEffect` at `LabelRunPage.tsx:357` that registers the window keydown listener. The shell handles `y` / `n` / `s` / `z` / Enter now. If that handler also bound `⇧S` (shift+S) for skip-conversation, KEEP a slimmed version that handles only the shift-prefixed shortcut(s) and any other keys the shell does not own.

```tsx
// Slimmed handler — only keys the shell does NOT own.
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      handleSkipConversation()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [handleSkipConversation])
```

If the original handler did not handle shift+S, delete it entirely.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: existing tests pass; type-check clean (`npx tsc --noEmit`).

- [ ] **Step 4: Stop for user review**

Surface: "Task 12 done — initial-labeling callsite migrated. Continue to manual smoke?"

---

### Task 13: Delete `ReviewDock`

**Files:**
- Delete: `src/components/run/ReviewDock.tsx`

- [ ] **Step 1: Confirm no other importers**

Run: `grep -rn "from .*run/ReviewDock" src/ --include="*.tsx" --include="*.ts"`
Expected: empty output.

- [ ] **Step 2: Delete the file**

Run: `rm src/components/run/ReviewDock.tsx`

- [ ] **Step 3: Type-check and run suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Stop for user review**

Surface: "Task 13 done — ReviewDock deleted. Continue to final smoke?"

---

### Task 14: Manual smoke test

**Files:**
- (manual; no code changes)

- [ ] **Step 1: Start the stack**

Run: `npm run dev:all`
Expected: kubectl, backend, and frontend all start cleanly.

- [ ] **Step 2: Verify initial labeling flow**

In single-label mode, go to `/run`. Open any label that has no AI predictions yet.
- Press `y` / `n` / `s`: the dock and keyboard both record a decision and advance.
- Press `z`: undo works.
- Press `Enter`: hand-off triggers.
- Press `⇧S`: skip-conversation triggers (if the shortcut was present originally).
- Focused turn is centered vertically in the body of the workspace.
- AssistFlank renders in the right column.

- [ ] **Step 3: Verify post-handoff review flow**

Trigger a handoff on a label, wait for completion (or seed a label with AI predictions). The page should enter review mode.
- Position/total + confidence pill renders above the buttons.
- Pressing `y` and `n` commits the corresponding verdict regardless of which is the AI prediction.
- Pressing `s` skips.
- Focused turn is centered.

- [ ] **Step 4: Verify summaries triage flow**

Visit `/summaries`, pick a classified label, stay on the default `review` filter.
- Press `y` / `n`: keep/flip works.
- Press `z`: undo restores the previous verdict.
- Press `Enter`: accept AI + advance.
- "All caught up for review" renders when the bucket is empty.
- Focused message stays vertically centered as messages advance.

- [ ] **Step 5: Stop for user review (end of PR 3)**

Surface: "PR 3 complete — both `LabelRunPage` callsites migrated, `ReviewDock` deleted, manual smoke clean. The extraction is done. Final state: `DecisionWorkspace` owns the layout and keyboard contract for all three callsites; `AiReviewDock` owns the AI-prediction dock for two of them; `run/DecisionDock` remains for initial labeling. Today's scroll bug is now structurally impossible to reintroduce."

---

## Definition of done

- [ ] All 25+ new unit tests pass.
- [ ] Every existing test in `src/tests/summaries/` and `src/tests/` passes with **zero modification** after migration.
- [ ] `npx tsc --noEmit` is clean.
- [ ] Manual smoke (Task 14) passes for all three flows.
- [ ] `src/components/summaries/TriageDock.tsx` and `src/components/run/ReviewDock.tsx` are deleted.
- [ ] `src/components/run/DecisionDock.tsx` is unchanged.
- [ ] `src/components/run/ThreadView.tsx`'s `h-full` band-aid is unchanged (defense in depth).
