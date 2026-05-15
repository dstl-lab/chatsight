# Summaries Triage Flow Implementation Plan

> **For agentic workers:** This plan is structured for **iterative execution in the main session** with explicit user-review/commit gates at phase boundaries (per project convention — the user reviews diffs and commits themselves). Do NOT run `git add` / `git commit`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the summaries-page-single `BrowseTab` with a `/run`-style triage flow that reframes the Review-bucket anxiety into a finite, 5-key decision loop.

**Architecture:** Four new components in `src/components/summaries/` — `TriageTab` (orchestrator) plus three leaves (`TriageStrip`, `TriageFilterRow`, `TriageDock`). Reuses `/run`'s `ThreadView`. No backend changes — existing single-label endpoints are sufficient. Phase boundaries are explicit user-review/commit gates.

**Tech stack:** React 19, TypeScript, Tailwind v4, vitest + React Testing Library + jsdom.

**Spec reference:** `docs/superpowers/specs/2026-05-14-summaries-triage-flow-design.md`

---

## Phase 1 — Leaf components

Build the three small leaf components first (TDD), with no dependencies on each other or `TriageTab`. After this phase, the building blocks exist but are not yet wired in.

### Task 1: TriageStrip — progress + hidden-count strip

**Files:**
- Create: `src/components/summaries/TriageStrip.tsx`
- Create: `src/tests/summaries/TriageStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/tests/summaries/TriageStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { TriageStrip } from '../../components/summaries/TriageStrip'

test('renders progress fraction when review_total > 0', () => {
  render(<TriageStrip cursor={22} reviewTotal={47} hiddenCount={10765} />)
  expect(screen.getByText('23 of 47 to review')).toBeInTheDocument()
  expect(screen.getByText(/10765/)).toBeInTheDocument()
  expect(screen.getByText(/already trusted/i)).toBeInTheDocument()
})

test('renders "nothing to review" copy when review_total === 0', () => {
  render(<TriageStrip cursor={0} reviewTotal={0} hiddenCount={2000} />)
  expect(screen.getByText(/nothing to review/i)).toBeInTheDocument()
  expect(screen.queryByText(/\d+ of \d+ to review/)).not.toBeInTheDocument()
})

test('progress uses cursor + 1 (1-indexed display)', () => {
  render(<TriageStrip cursor={0} reviewTotal={47} hiddenCount={0} />)
  expect(screen.getByText('1 of 47 to review')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageStrip.test.tsx`
Expected: failures because `TriageStrip` does not exist.

- [ ] **Step 3: Implement component**

`src/components/summaries/TriageStrip.tsx`:

```tsx
interface TriageStripProps {
  cursor: number
  reviewTotal: number
  hiddenCount: number
}

export function TriageStrip({ cursor, reviewTotal, hiddenCount }: TriageStripProps) {
  if (reviewTotal === 0) {
    return (
      <div className="px-7 py-3 border-b border-edge-subtle bg-canvas flex items-center">
        <span className="font-mono text-[11px] tracking-[0.12em] text-muted">
          Nothing to review for this label — all predictions cleared the confidence threshold.
        </span>
      </div>
    )
  }

  return (
    <div className="px-7 py-3 border-b border-edge-subtle bg-canvas flex items-center justify-between">
      <span className="font-mono text-[12px] tracking-[0.08em] text-paper">
        <span className="text-ochre">{cursor + 1}</span>
        <span className="text-faint mx-1">of</span>
        <span className="text-on-canvas">{reviewTotal}</span>
        <span className="text-faint ml-2 tracking-[0.16em] uppercase text-[9.5px]">to review</span>
      </span>
      <span className="font-mono text-[10px] tracking-[0.12em] text-faint">
        <span className="text-on-surface">{hiddenCount.toLocaleString()}</span>
        <span className="ml-2 uppercase">hidden · already trusted</span>
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run src/tests/summaries/TriageStrip.test.tsx`
Expected: 3 tests pass.

---

### Task 2: TriageFilterRow — filter chips + sort

**Files:**
- Create: `src/components/summaries/TriageFilterRow.tsx`
- Create: `src/tests/summaries/TriageFilterRow.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/tests/summaries/TriageFilterRow.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { TriageFilterRow } from '../../components/summaries/TriageFilterRow'

test('renders review and all chips; flagged chip hidden when flaggedCount = 0', () => {
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={0}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /flagged/i })).not.toBeInTheDocument()
})

test('flagged chip appears when flaggedCount > 0', () => {
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={3}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /flagged \(3\)/i })).toBeInTheDocument()
})

test('clicking a chip fires onFilterChange with that value', () => {
  const onFilterChange = vi.fn()
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={3}
      onFilterChange={onFilterChange}
      onSortChange={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^all$/i }))
  expect(onFilterChange).toHaveBeenCalledWith('all')
})

test('changing sort dropdown fires onSortChange', () => {
  const onSortChange = vi.fn()
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={0}
      onFilterChange={vi.fn()}
      onSortChange={onSortChange}
    />,
  )
  fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'confidence_desc' } })
  expect(onSortChange).toHaveBeenCalledWith('confidence_desc')
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageFilterRow.test.tsx`
Expected: failures (component does not exist).

- [ ] **Step 3: Implement component**

`src/components/summaries/TriageFilterRow.tsx`:

```tsx
import type { BrowseBucket, BrowseSort } from '../../types'

export type TriageFilter = Extract<BrowseBucket, 'review' | 'flagged' | 'all'>

interface TriageFilterRowProps {
  filter: TriageFilter
  sort: BrowseSort
  reviewCount: number
  flaggedCount: number
  onFilterChange: (next: TriageFilter) => void
  onSortChange: (next: BrowseSort) => void
}

export function TriageFilterRow({
  filter, sort, reviewCount, flaggedCount, onFilterChange, onSortChange,
}: TriageFilterRowProps) {
  return (
    <div className="px-7 py-2.5 border-b border-edge-subtle flex items-center gap-2 bg-canvas">
      <Chip active={filter === 'review'} onClick={() => onFilterChange('review')}>
        Review ({reviewCount})
      </Chip>
      {flaggedCount > 0 && (
        <Chip active={filter === 'flagged'} onClick={() => onFilterChange('flagged')}>
          Flagged ({flaggedCount})
        </Chip>
      )}
      <Chip active={filter === 'all'} onClick={() => onFilterChange('all')}>
        All
      </Chip>
      <label className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-faint flex items-center gap-2">
        sort
        <select
          aria-label="sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as BrowseSort)}
          className="bg-canvas border border-edge rounded-sm px-2 py-1 text-on-canvas font-mono text-[11px]"
        >
          <option value="confidence_asc">↧ confidence asc</option>
          <option value="confidence_desc">↥ confidence desc</option>
          <option value="recently_flipped">↺ recently flipped</option>
        </select>
      </label>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full border font-mono text-[10px] tracking-[0.12em] uppercase ${
        active ? 'border-ochre text-ochre bg-ochre-dim' : 'border-edge text-on-surface hover:text-paper'
      }`}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run src/tests/summaries/TriageFilterRow.test.tsx`
Expected: 4 tests pass.

---

### Task 3: TriageDock — decision dock (y/n/Enter/s/z)

**Files:**
- Create: `src/components/summaries/TriageDock.tsx`
- Create: `src/tests/summaries/TriageDock.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/tests/summaries/TriageDock.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { TriageDock } from '../../components/summaries/TriageDock'

const baseProps = {
  aiVerdict: 'yes' as const,
  onYes: vi.fn(),
  onNo: vi.fn(),
  onAcceptAi: vi.fn(),
  onSkip: vi.fn(),
  onUndo: vi.fn(),
  canUndo: true,
  disabled: false,
}

test('when AI predicted yes, primary button reads "Keep YES" and secondary "Flip to NO"', () => {
  render(<TriageDock {...baseProps} aiVerdict="yes" />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeInTheDocument()
})

test('when AI predicted no, button labels reverse', () => {
  render(<TriageDock {...baseProps} aiVerdict="no" />)
  expect(screen.getByRole('button', { name: /flip to yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /keep no/i })).toBeInTheDocument()
})

test('clicking "Keep YES" (AI=yes) fires onYes', () => {
  const onYes = vi.fn()
  render(<TriageDock {...baseProps} aiVerdict="yes" onYes={onYes} />)
  fireEvent.click(screen.getByRole('button', { name: /keep yes/i }))
  expect(onYes).toHaveBeenCalled()
})

test('clicking "Flip to NO" (AI=yes) fires onNo', () => {
  const onNo = vi.fn()
  render(<TriageDock {...baseProps} aiVerdict="yes" onNo={onNo} />)
  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))
  expect(onNo).toHaveBeenCalled()
})

test('Skip button fires onSkip', () => {
  const onSkip = vi.fn()
  render(<TriageDock {...baseProps} onSkip={onSkip} />)
  fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  expect(onSkip).toHaveBeenCalled()
})

test('Undo button is disabled when canUndo is false', () => {
  render(<TriageDock {...baseProps} canUndo={false} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
})

test('all decision buttons are disabled when disabled=true', () => {
  render(<TriageDock {...baseProps} disabled={true} />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageDock.test.tsx`
Expected: failures (component does not exist).

- [ ] **Step 3: Implement component**

`src/components/summaries/TriageDock.tsx`:

```tsx
interface TriageDockProps {
  aiVerdict: 'yes' | 'no'
  onYes: () => void
  onNo: () => void
  onAcceptAi: () => void
  onSkip: () => void
  onUndo: () => void
  canUndo: boolean
  disabled: boolean
}

export function TriageDock({
  aiVerdict, onYes, onNo, onAcceptAi, onSkip, onUndo, canUndo, disabled,
}: TriageDockProps) {
  const aiIsYes = aiVerdict === 'yes'

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
      <DockButton label="Undo" kbd="z" tone="muted" onClick={onUndo} disabled={disabled || !canUndo} />
      <button
        onClick={onAcceptAi}
        disabled={disabled}
        className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-faint hover:text-paper disabled:opacity-40"
      >
        <span className="inline-block px-1.5 py-0.5 border border-edge rounded-sm mr-2 text-ochre">Enter</span>
        accept ai &amp; next
      </button>
    </div>
  )
}

type Tone = 'primary' | 'moss' | 'brick' | 'muted'

const toneClass: Record<Tone, string> = {
  primary: 'border-ochre bg-ochre-dim text-paper',
  moss: 'border-moss text-moss',
  brick: 'border-brick text-brick',
  muted: 'border-edge text-on-surface',
}

function DockButton({
  label, kbd, tone, onClick, disabled,
}: { label: string; kbd: string; tone: Tone; onClick: () => void; disabled: boolean }) {
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

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run src/tests/summaries/TriageDock.test.tsx`
Expected: 7 tests pass.

---

### ⏸ STOP — Phase 1 complete. User reviews the diff and commits.

Suggested commit message: `feat(summaries): TriageStrip + TriageFilterRow + TriageDock leaf components`

---

## Phase 2 — TriageTab orchestrator

The big one. Wires the leaves together with state, fetching, optimistic flip, undo ring buffer, and keyboard handling. Reuses `/run`'s `ThreadView`.

### Task 4: TriageTab — basic shell (fetch + render)

**Files:**
- Create: `src/components/summaries/TriageTab.tsx`
- Create: `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/tests/summaries/TriageTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { TriageTab } from '../../components/summaries/TriageTab'
import { api } from '../../services/api'
import type { SingleLabelDetail, MessageListItem, MessageDetail } from '../../types'

vi.mock('../../services/api', () => ({
  api: {
    listSingleLabelMessages: vi.fn(),
    getSingleLabelMessageDetail: vi.fn(),
    flipSingleLabelVerdict: vi.fn(),
  },
}))

const detail: SingleLabelDetail = {
  id: 1, name: 'self-correction', description: null, phase: 'complete',
  yes_count: 1142, no_count: 803, review_count: 47, review_threshold: 0.7,
  agreement_vs_gold: 0.87, confidence_histogram: [],
}

const item1: MessageListItem = {
  chatlog_id: 100, message_index: 4, text: 'the mean is 4.2…',
  confidence: 0.63, verdict: 'yes', applied_by: 'ai',
  flagged: false, has_note: false, notebook: 'nb1.ipynb',
}

const focused1: MessageDetail = {
  chatlog_id: 100, message_index: 4, text: 'the mean is 4.2…',
  confidence: 0.63, verdict: 'yes', applied_by: 'ai',
  matched_pattern: null, rationale: null, flagged: false, note: null,
  context_before: [{ role: 'student', turn_index: 3, text: 'how do I compute the mean' }],
  context_after: [{ role: 'tutor', turn_index: 5, text: 'Right!' }],
  notebook: 'nb1.ipynb', turn_index: 4, total_turns: 12,
}

test('renders TriageStrip with progress and HIDDEN = yes+no-review', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items: [item1], total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/1 of 47 to review/)).toBeInTheDocument())
  // hidden = 1142 + 803 - 47 = 1898
  expect(screen.getByText(/1,898/)).toBeInTheDocument()
})

test('renders ThreadView with focused turn in the middle', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items: [item1], total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())
  expect(screen.getByText(/how do I compute the mean/)).toBeInTheDocument()
  expect(screen.getByText(/Right!/)).toBeInTheDocument()
})

test('shows "all caught up" empty state when items is empty', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: failures (component does not exist).

- [ ] **Step 3: Implement basic shell**

`src/components/summaries/TriageTab.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import { TriageStrip } from './TriageStrip'
import { TriageFilterRow, type TriageFilter } from './TriageFilterRow'
import { TriageDock } from './TriageDock'
import { ThreadView } from '../run/ThreadView'
import type {
  BrowseSort, ConversationTurn, MessageDetail, MessageListItem, SingleLabelDetail,
} from '../../types'

interface TriageTabProps {
  label: SingleLabelDetail
  onLabelChanged: () => void
}

export function TriageTab({ label, onLabelChanged: _onLabelChanged }: TriageTabProps) {
  const [filter, setFilter] = useState<TriageFilter>('review')
  const [sort, setSort] = useState<BrowseSort>('confidence_asc')
  const [items, setItems] = useState<MessageListItem[]>([])
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState<MessageDetail | null>(null)

  const hiddenCount = Math.max(0, label.yes_count + label.no_count - label.review_count)

  useEffect(() => {
    api.listSingleLabelMessages(label.id, { bucket: filter, sort, limit: 200 }).then((r) => {
      setItems(r.items)
      setCursor(0)
    })
  }, [label.id, filter, sort])

  useEffect(() => {
    const cur = items[cursor]
    if (!cur) {
      setFocused(null)
      return
    }
    api.getSingleLabelMessageDetail(label.id, cur.chatlog_id, cur.message_index, '2').then(setFocused)
  }, [label.id, items, cursor])

  const thread: ConversationTurn[] = useMemo(() => {
    if (!focused) return []
    return [
      ...focused.context_before.map((t) => ({ message_index: t.turn_index, role: t.role, text: t.text })),
      { message_index: focused.turn_index, role: 'student' as const, text: focused.text },
      ...focused.context_after.map((t) => ({ message_index: t.turn_index, role: t.role, text: t.text })),
    ]
  }, [focused])

  const focusIndex = focused?.context_before.length ?? 0

  // "All caught up" when there's nothing to triage OR cursor has advanced past
  // the loaded items (queue exhausted after a string of decisions). The
  // pagination prefetch in Task 8 will extend `items` if a next page exists.
  if (items.length === 0 || cursor >= items.length) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-canvas">
        <TriageStrip cursor={0} reviewTotal={0} hiddenCount={hiddenCount} />
        <TriageFilterRow
          filter={filter}
          sort={sort}
          reviewCount={label.review_count}
          flaggedCount={0}
          onFilterChange={setFilter}
          onSortChange={setSort}
        />
        <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
          All caught up for "{filter}"
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      <TriageStrip cursor={cursor} reviewTotal={items.length} hiddenCount={hiddenCount} />
      <TriageFilterRow
        filter={filter}
        sort={sort}
        reviewCount={label.review_count}
        flaggedCount={0}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {focused && <ThreadView thread={thread} focusIndex={focusIndex} />}
      </div>
      <TriageDock
        aiVerdict={(focused?.verdict ?? 'yes') as 'yes' | 'no'}
        onYes={() => {}}
        onNo={() => {}}
        onAcceptAi={() => {}}
        onSkip={() => {}}
        onUndo={() => {}}
        canUndo={false}
        disabled={!focused}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: 3 tests pass.

---

### Task 5: TriageTab — decision flow (y / n / Enter)

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`
- Modify: `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/tests/summaries/TriageTab.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react'

test('clicking "Keep YES" (AI=yes) calls flipSingleLabelVerdict("yes") and advances cursor', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  const focused2 = { ...focused1, chatlog_id: 101, message_index: 2 }
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail)
    .mockResolvedValueOnce(focused1)
    .mockResolvedValueOnce(focused2)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100, message_index: 4, text: '', confidence: 0.63,
    verdict: 'yes', applied_by: 'human', flagged: false, has_note: false, notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /keep yes/i }))

  await waitFor(() => {
    expect(api.flipSingleLabelVerdict).toHaveBeenCalledWith(detail.id, 100, 4, 'yes')
  })
  await waitFor(() => expect(screen.getByText(/2 of 2 to review/)).toBeInTheDocument())
})

test('clicking "Flip to NO" (AI=yes) calls flipSingleLabelVerdict("no") and advances', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100, message_index: 4, text: '', confidence: 0.63,
    verdict: 'no', applied_by: 'human', flagged: false, has_note: false, notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))

  await waitFor(() => {
    expect(api.flipSingleLabelVerdict).toHaveBeenCalledWith(detail.id, 100, 4, 'no')
  })
})
```

- [ ] **Step 2: Run test, expect new tests to FAIL**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: 2 new tests fail (flip not wired up; cursor doesn't advance).

- [ ] **Step 3: Wire decision callbacks**

In `src/components/summaries/TriageTab.tsx`, replace the placeholder callbacks with real handlers. Add `onLabelChanged` use and `error` toast.

Replace the function body — add this block ABOVE the `if (items.length === 0)` check:

```tsx
  const [error, setError] = useState<string | null>(null)

  const decide = async (verdict: 'yes' | 'no') => {
    const cur = items[cursor]
    if (!cur || !focused) return
    const prevVerdict = focused.verdict
    // Optimistic flip
    setFocused({ ...focused, verdict, applied_by: 'human' })
    setItems((arr) =>
      arr.map((it, i) =>
        i === cursor ? { ...it, verdict, applied_by: 'human' } : it,
      ),
    )
    try {
      await api.flipSingleLabelVerdict(label.id, cur.chatlog_id, cur.message_index, verdict)
      _onLabelChanged()
      setCursor((c) => Math.min(c + 1, items.length))
    } catch {
      setError('Flip failed — retry?')
      setTimeout(() => setError(null), 4000)
      setFocused({ ...focused, verdict: prevVerdict })
      setItems((arr) =>
        arr.map((it, i) =>
          i === cursor ? { ...it, verdict: prevVerdict, applied_by: 'ai' } : it,
        ),
      )
    }
  }

  const acceptAi = () => {
    if (!focused?.verdict || focused.verdict === 'review') return
    decide(focused.verdict)
  }
```

Replace the `<TriageDock>` callbacks:

```tsx
      <TriageDock
        aiVerdict={(focused?.verdict ?? 'yes') as 'yes' | 'no'}
        onYes={() => decide('yes')}
        onNo={() => decide('no')}
        onAcceptAi={acceptAi}
        onSkip={() => {}}
        onUndo={() => {}}
        canUndo={false}
        disabled={!focused}
      />
```

Append the error toast block before the closing fragment/div:

```tsx
      {error && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 bg-brick-dim border border-brick text-paper px-3 py-2 rounded-sm font-mono text-[11px] z-50"
        >
          {error}
        </div>
      )}
```

- [ ] **Step 4: Run test, expect all PASS**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: all tests pass.

---

### Task 6: TriageTab — skip + undo with ring buffer

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`
- Modify: `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/tests/summaries/TriageTab.test.tsx`:

```tsx
test('Skip advances cursor without writing', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/1 of 2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /skip/i }))

  await waitFor(() => expect(screen.getByText(/2 of 2/)).toBeInTheDocument())
  expect(api.flipSingleLabelVerdict).not.toHaveBeenCalled()
})

test('Undo after a flip restores the previous verdict on the server and steps back', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 47, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100, message_index: 4, text: '', confidence: 0.63,
    verdict: 'no', applied_by: 'human', flagged: false, has_note: false, notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/1 of 2/)).toBeInTheDocument())

  // Flip first hit no, advances to second
  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))
  await waitFor(() => expect(screen.getByText(/2 of 2/)).toBeInTheDocument())

  // Undo: should step back AND PATCH the previous verdict back to 'yes'
  fireEvent.click(screen.getByRole('button', { name: /undo/i }))
  await waitFor(() => expect(screen.getByText(/1 of 2/)).toBeInTheDocument())
  expect(api.flipSingleLabelVerdict).toHaveBeenLastCalledWith(detail.id, 100, 4, 'yes')
})
```

- [ ] **Step 2: Run test, expect new tests to FAIL**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: 2 new tests fail.

- [ ] **Step 3: Add skip + undo with ring buffer**

In `src/components/summaries/TriageTab.tsx`, add a ring buffer and the two handlers.

Add after the `error` useState:

```tsx
  type Decision = { cursor: number; from: 'yes' | 'no' | null; to: 'yes' | 'no' }
  const [history, setHistory] = useState<Decision[]>([])
```

Update `decide()` to push a Decision onto history (limit 10):

```tsx
    try {
      await api.flipSingleLabelVerdict(label.id, cur.chatlog_id, cur.message_index, verdict)
      _onLabelChanged()
      setHistory((h) => [...h.slice(-9), { cursor, from: prevVerdict as 'yes' | 'no' | null, to: verdict }])
      setCursor((c) => Math.min(c + 1, items.length))
    } catch {
```

Add the two new handlers:

```tsx
  const skip = () => {
    setCursor((c) => Math.min(c + 1, items.length))
  }

  const undo = async () => {
    const last = history[history.length - 1]
    if (!last) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    setCursor(last.cursor)
    setHistory((h) => h.slice(0, -1))
    const cur = items[last.cursor]
    if (!cur || last.from === null) return
    try {
      await api.flipSingleLabelVerdict(label.id, cur.chatlog_id, cur.message_index, last.from)
      _onLabelChanged()
    } catch {
      setError('Undo failed — retry?')
      setTimeout(() => setError(null), 4000)
    }
  }
```

Update the `<TriageDock>` calls:

```tsx
        onSkip={skip}
        onUndo={undo}
        canUndo={history.length > 0 || cursor > 0}
```

- [ ] **Step 4: Run test, expect all PASS**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: all tests pass.

---

### Task 7: TriageTab — keyboard handler (y / n / Enter / s / z)

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`
- Modify: `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `src/tests/summaries/TriageTab.test.tsx`:

```tsx
test('keyboard "y" flips to yes; "n" flips to no; Enter accepts AI verdict', async () => {
  const items: MessageListItem[] = [{ ...item1, chatlog_id: 100, message_index: 4 }]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 1, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100, message_index: 4, text: '', confidence: 0.63,
    verdict: 'yes', applied_by: 'human', flagged: false, has_note: false, notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.keyDown(window, { key: 'n' })
  await waitFor(() => expect(api.flipSingleLabelVerdict).toHaveBeenLastCalledWith(detail.id, 100, 4, 'no'))
})

test('keyboard listener ignores keypresses when focus is in an input', async () => {
  const items: MessageListItem[] = [{ ...item1, chatlog_id: 100, message_index: 4 }]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({ items, total: 1, offset: 0, limit: 200 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(
    <div>
      <input data-testid="other-input" />
      <TriageTab label={detail} onLabelChanged={vi.fn()} />
    </div>,
  )
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  const input = screen.getByTestId('other-input')
  input.focus()
  fireEvent.keyDown(input, { key: 'y' })

  expect(api.flipSingleLabelVerdict).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: 2 new tests fail.

- [ ] **Step 3: Add keyboard handler**

In `src/components/summaries/TriageTab.tsx`, add this `useEffect` near the other effects (modeled on `LabelRunPage.tsx:314-359`):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ['INPUT', 'TEXTAREA'].includes(
        (document.activeElement as HTMLElement | null)?.tagName ?? '',
      )
      if (inField) return
      switch (e.key.toLowerCase()) {
        case 'y':
          decide('yes')
          break
        case 'n':
          decide('no')
          break
        case 'enter':
          acceptAi()
          break
        case 's':
          skip()
          break
        case 'z':
          undo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, cursor, focused, history])
```

(Note: handlers are recreated on each render — that's why the dep array includes the relevant state. This matches `LabelRunPage`'s pattern.)

- [ ] **Step 4: Run test, expect all PASS**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: all tests pass.

---

### Task 8: TriageTab — pagination prefetch

**Files:**
- Modify: `src/components/summaries/TriageTab.tsx`
- Modify: `src/tests/summaries/TriageTab.test.tsx`

- [ ] **Step 1: Add failing test**

Append:

```tsx
test('prefetches next page when cursor approaches end of current page', async () => {
  const page1 = Array.from({ length: 10 }, (_, i): MessageListItem => ({
    ...item1, chatlog_id: 100 + i, message_index: 0,
  }))
  const page2 = Array.from({ length: 5 }, (_, i): MessageListItem => ({
    ...item1, chatlog_id: 200 + i, message_index: 0,
  }))
  vi.mocked(api.listSingleLabelMessages)
    .mockResolvedValueOnce({ items: page1, total: 15, offset: 0, limit: 10 })
    .mockResolvedValueOnce({ items: page2, total: 15, offset: 10, limit: 10 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    ...item1, applied_by: 'human',
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/1 of 10/)).toBeInTheDocument())

  // Advance to cursor 6 (within 5 of page end) to trigger prefetch
  for (let i = 0; i < 6; i++) {
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  }

  await waitFor(() => expect(api.listSingleLabelMessages).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByText(/of 15/)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: prefetch test fails.

- [ ] **Step 3: Add prefetch effect**

Use a default page size of 50 in normal operation; the test passes its own page size via `limit`. Change the existing `useEffect` for the initial fetch to use `limit: 50`. Add a second effect for prefetch:

Replace the initial-fetch effect:

```tsx
  const PAGE_SIZE = 50

  useEffect(() => {
    api.listSingleLabelMessages(label.id, { bucket: filter, sort, limit: PAGE_SIZE, offset: 0 }).then((r) => {
      setItems(r.items)
      setCursor(0)
    })
  }, [label.id, filter, sort])
```

Add prefetch effect:

```tsx
  const [prefetching, setPrefetching] = useState(false)

  useEffect(() => {
    if (prefetching) return
    if (items.length === 0) return
    if (cursor < items.length - 5) return
    setPrefetching(true)
    api.listSingleLabelMessages(label.id, { bucket: filter, sort, limit: PAGE_SIZE, offset: items.length })
      .then((r) => {
        if (r.items.length === 0) return
        setItems((cur) => [...cur, ...r.items])
      })
      .finally(() => setPrefetching(false))
  }, [label.id, filter, sort, items.length, cursor, prefetching])
```

(For the test, the initial page size is forced by the mock — the test does not require us to honor `PAGE_SIZE` exactly. The trigger condition `cursor < items.length - 5` is what's tested.)

- [ ] **Step 4: Run test, expect all PASS**

Run: `npx vitest run src/tests/summaries/TriageTab.test.tsx`
Expected: all tests pass.

---

### ⏸ STOP — Phase 2 complete. User reviews the diff and commits.

Suggested commit message: `feat(summaries): TriageTab orchestrator with /run-style decision flow`

---

## Phase 3 — Integration + cleanup

Wire `TriageTab` into `SummariesPageSingle`, rename the tab label, delete the obsolete `BrowseTab` chain, verify everything.

### Task 9: Wire TriageTab into SummariesPageSingle; rename tab label

**Files:**
- Modify: `src/pages/summaries/SummariesPageSingle.tsx`
- Modify: `src/components/summaries/DetailHeader.tsx` (tab label only — type stays `'browse' | 'settings'`)

- [ ] **Step 1: Update SummariesPageSingle**

In `src/pages/summaries/SummariesPageSingle.tsx`:

Replace the import:

```tsx
import { BrowseTab } from '../../components/summaries/BrowseTab'
```

With:

```tsx
import { TriageTab } from '../../components/summaries/TriageTab'
```

Replace the BrowseTab render line:

```tsx
{tab === 'browse' && (
  <BrowseTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
)}
```

With:

```tsx
{tab === 'browse' && (
  <TriageTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
)}
```

- [ ] **Step 2: Update DetailHeader chip label**

In `src/components/summaries/DetailHeader.tsx`, change only the visible chip text (keep the type `SummariesTab = 'browse' | 'settings'` so localStorage stays compatible):

Find:

```tsx
{tab.charAt(0).toUpperCase() + tab.slice(1)}
```

Replace with:

```tsx
{tab === 'browse' ? 'Triage' : 'Settings'}
```

- [ ] **Step 3: Update DetailHeader test for the new chip name**

In `src/tests/summaries/DetailHeader.test.tsx`, change the click target in the tab-change test:

Find:

```tsx
fireEvent.click(screen.getByText(/^Settings$/i))
```

Leave that line alone (it's already correct). Find the test that asserts default labels (if any) — there is none for "Browse" specifically. Add a new assertion to the first test:

In the first test (renders title…), add:

```tsx
expect(screen.getByText(/^Triage$/)).toBeInTheDocument()
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/tests/summaries/`
Expected: all summaries tests pass.

---

### Task 10: Delete obsolete components and their tests

**Files:**
- Delete: `src/components/summaries/BrowseTab.tsx`
- Delete: `src/components/summaries/FilterBar.tsx`
- Delete: `src/components/summaries/MessageList.tsx`
- Delete: `src/components/summaries/MessageListRow.tsx`
- Delete: `src/components/summaries/FocusedMessage.tsx`
- Delete (if present): `src/tests/summaries/BrowseTab.test.tsx`, `FilterBar.test.tsx`, `MessageList.test.tsx`, `FocusedMessage.test.tsx`

- [ ] **Step 1: List what currently exists**

Run: `ls src/components/summaries/ src/tests/summaries/`

- [ ] **Step 2: Delete the obsolete component files**

Run:
```bash
rm src/components/summaries/BrowseTab.tsx
rm src/components/summaries/FilterBar.tsx
rm src/components/summaries/MessageList.tsx
rm src/components/summaries/MessageListRow.tsx
rm src/components/summaries/FocusedMessage.tsx
```

- [ ] **Step 3: Delete their tests (only the ones that exist)**

Run (for each file the `ls` above showed):
```bash
rm -f src/tests/summaries/BrowseTab.test.tsx src/tests/summaries/FilterBar.test.tsx src/tests/summaries/MessageList.test.tsx src/tests/summaries/FocusedMessage.test.tsx
```

- [ ] **Step 4: Verify nothing imports the deleted files**

Run: `grep -rn "from.*summaries/BrowseTab\|from.*summaries/FilterBar\|from.*summaries/MessageList\|from.*summaries/FocusedMessage" src/`
Expected: no matches.

- [ ] **Step 5: Run tests + type-check**

Run: `npx tsc --noEmit && npm test`
Expected: type-check clean, all tests pass.

---

### Task 11: Manual verification in the browser

**Files:** none (manual)

- [ ] **Step 1: Start the backend**

Run (in one terminal): `cd server/python && uv run uvicorn main:app --reload`

- [ ] **Step 2: Start the frontend**

Run (in another terminal): `npm run dev`

- [ ] **Step 3: Verify the triage flow**

Open `http://localhost:5173/summaries`. Select a label that has handed off. Verify:

1. The header counts strip (DetailHeader) is unchanged; ⓘ info panel still works.
2. The new TriageStrip below shows `X of Y to review` and `… hidden · already trusted`.
3. The filter chips show `Review`, optionally `Flagged`, and `All`.
4. The focused hit appears inside the ThreadView (context above + below).
5. `y` flips the verdict to YES on the focused hit, advances to next.
6. `n` flips to NO, advances.
7. `Enter` accepts the AI verdict, advances.
8. `s` advances without writing.
9. `z` steps back; if previous was a flip, the verdict on the server is restored (refresh detail to confirm).
10. The Hidden number equals `yes_count + no_count - review_count` from the DetailHeader counts.
11. Switching to Settings tab still works; Triage chip label appears.

- [ ] **Step 4: Note any visual issues**

If `ThreadView` looks cramped inside the summaries layout, capture the issue and decide between (a) passing a compact prop or (b) accepting and adjusting in a follow-up. Spec already calls this risk out.

---

### ⏸ STOP — Phase 3 complete. User reviews the diff and commits.

Suggested commit message: `feat(summaries): replace BrowseTab with /run-style TriageTab`

---

## Self-review notes

- All four new components are defined with full code (no placeholders).
- Type names are consistent: `TriageFilter` (Task 2), `BrowseSort` (existing), `MessageDetail` / `MessageListItem` / `SingleLabelDetail` (existing).
- `decide`, `acceptAi`, `skip`, `undo` signatures stay stable across Tasks 5–7.
- Tests for keyboard listener mirror the input-skip pattern in `LabelRunPage.tsx:316-320` so the same convention applies.
- Phase boundaries match the user's "don't commit, iterative reviewable phases" preference (memory: `feedback_no_commits.md`).
- Spec coverage:
  - Motivation / mental model → introduced in Phase 1 component design.
  - Layout → Tasks 1, 2, 3, 4 (strip / filter / dock / thread integration).
  - Components new/deleted → Tasks 1–4 (create), Task 10 (delete).
  - State machine + optimistic flip + ring buffer → Tasks 5, 6.
  - API methods → Task 4 (list, detail), Tasks 5, 6 (flip).
  - HIDDEN math (client-side) → Task 4.
  - Keyboard map → Task 7.
  - Migration (wiring + rename) → Task 9.
  - Tests for triage components → Tasks 1, 2, 3, 4–8.
  - No backend changes — confirmed.
