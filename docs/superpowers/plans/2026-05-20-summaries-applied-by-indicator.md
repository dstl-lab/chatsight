# Summaries AI-vs-Human Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a 👤 glyph on human-labeled messages in the `/summaries` single-label view (Browse list rows + detail pane); AI-labeled messages get no glyph.

**Architecture:** Pure frontend. The `applied_by` field is already returned by the backend and present in the TS types (`MessageListItem`, `MessageDetail`). A single shared component (`AppliedByGlyph`) renders the glyph for `applied_by === 'human'` and exports a `HUMAN_GLYPH` constant so the detail pane reuses the same source of truth. The Browse row gains a fixed leading gutter column so alignment stays stable whether or not the glyph is present.

**Tech Stack:** React 19 + TypeScript + Tailwind v4 (warm palette), Vitest + React Testing Library.

---

### Task 1: Human glyph in Browse list rows

**Files:**
- Create: `src/components/summaries/AppliedByGlyph.tsx`
- Modify: `src/components/summaries/MessageListRow.tsx`
- Test: `src/tests/summaries/MessageList.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append these tests to `src/tests/summaries/MessageList.test.tsx`. The existing `items` array (top of file) has three rows, all `applied_by: 'ai'`. Add a fourth human row and assertions.

First, change the `items` array to include a human row (replace the closing `]` of the existing array by adding this entry before it):

```tsx
  { chatlog_id: 4, message_index: 0, text: 'human reviewed this one',
    confidence: 0.42, verdict: 'no', applied_by: 'human', flagged: false, has_note: false, notebook: null },
```

Then append these tests at the end of the file:

```tsx
test('human-labeled row shows the human glyph', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.getByTestId('applied-by-human-4-0')).toBeInTheDocument()
})

test('ai-labeled row shows no human glyph', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.queryByTestId('applied-by-human-1-0')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/summaries/MessageList.test.tsx`
Expected: the two new tests FAIL (testid `applied-by-human-4-0` not found); the existing tests still PASS.

- [ ] **Step 3: Create the `AppliedByGlyph` component**

Create `src/components/summaries/AppliedByGlyph.tsx`:

```tsx
export const HUMAN_GLYPH = '👤'
export const HUMAN_TITLE = 'Labeled by human'

interface AppliedByGlyphProps {
  appliedBy: 'ai' | 'human' | null
  chatlogId: number
  messageIndex: number
}

export function AppliedByGlyph({ appliedBy, chatlogId, messageIndex }: AppliedByGlyphProps) {
  if (appliedBy !== 'human') return null
  return (
    <span
      data-testid={`applied-by-human-${chatlogId}-${messageIndex}`}
      title={HUMAN_TITLE}
      aria-label={HUMAN_TITLE}
      className="text-[11px] leading-none"
    >
      {HUMAN_GLYPH}
    </span>
  )
}
```

- [ ] **Step 4: Wire the glyph into `MessageListRow`**

Modify `src/components/summaries/MessageListRow.tsx`. Add the import at the top:

```tsx
import type { MessageListItem } from '../../types'
import { AppliedByGlyph } from './AppliedByGlyph'
```

Change the grid template from `grid-cols-[38px_1fr]` to `grid-cols-[16px_38px_1fr]` and add the glyph cell as the first child of the row `<div>` (before the confidence `<span>`):

```tsx
    <div
      onClick={onSelect}
      className={`grid grid-cols-[16px_38px_1fr] items-center gap-2.5 px-5 py-2 cursor-pointer ${
        active ? 'bg-elevated border-l-2 border-ochre pl-[18px]' : 'hover:bg-surface'
      }`}
    >
      <span className="flex justify-center">
        <AppliedByGlyph
          appliedBy={item.applied_by}
          chatlogId={item.chatlog_id}
          messageIndex={item.message_index}
        />
      </span>
      <span className={`font-mono text-[11px] text-right tabular-nums ${confColor(item.verdict)}`}>
        {item.confidence !== null ? item.confidence.toFixed(2) : '—'}
      </span>
```

Leave the rest of the row (the text `<span>` with flag/note) unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/tests/summaries/MessageList.test.tsx`
Expected: all tests PASS (including the two new ones and the unchanged note-dot/flag-glyph tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/summaries/AppliedByGlyph.tsx src/components/summaries/MessageListRow.tsx src/tests/summaries/MessageList.test.tsx
git commit -m "feat(summaries): show human glyph on human-labeled list rows"
```

---

### Task 2: Human glyph in the detail pane (`VerdictBlock`)

**Files:**
- Modify: `src/components/summaries/VerdictBlock.tsx`
- Test: `src/tests/summaries/VerdictBlock.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/summaries/VerdictBlock.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { VerdictBlock } from '../../components/summaries/VerdictBlock'

const baseProps = {
  verdict: 'no' as const,
  confidence: 0.42,
  matchedPattern: null,
  rationale: null,
  nearThreshold: false,
  onAccept: vi.fn(),
  onFlip: vi.fn(),
  onFlag: vi.fn(),
}

test('shows the human glyph when applied by a human', () => {
  render(<VerdictBlock {...baseProps} appliedBy="human" />)
  expect(screen.getByTestId('verdict-applied-by-human')).toBeInTheDocument()
})

test('shows no human glyph when applied by AI', () => {
  render(<VerdictBlock {...baseProps} appliedBy="ai" />)
  expect(screen.queryByTestId('verdict-applied-by-human')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/summaries/VerdictBlock.test.tsx`
Expected: FAIL — `verdict-applied-by-human` not found (the component currently drops `appliedBy`).

- [ ] **Step 3: Render `appliedBy` in `VerdictBlock`**

Modify `src/components/summaries/VerdictBlock.tsx`.

(a) Add the import at the top, after the existing `import type` line:

```tsx
import { useState } from 'react'
import type { MessageVerdict } from '../../types'
import { HUMAN_GLYPH, HUMAN_TITLE } from './AppliedByGlyph'
```

(b) Add `appliedBy` to the destructured parameters (it is already declared in `VerdictBlockProps` and passed by `FocusedMessage`, just not destructured):

```tsx
export function VerdictBlock({
  verdict, confidence, appliedBy, matchedPattern, rationale, nearThreshold,
  onAccept, onFlip, onFlag,
}: VerdictBlockProps) {
```

(c) Render the glyph inside the header `flex` row, immediately after the verdict badge `</span>` (the one closing the `badgeStyles` span) and before the `matchedPattern` block:

```tsx
        {appliedBy === 'human' && (
          <span
            data-testid="verdict-applied-by-human"
            title={HUMAN_TITLE}
            className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted"
          >
            {HUMAN_GLYPH}
            <span className="uppercase tracking-[0.08em]">human</span>
          </span>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/summaries/VerdictBlock.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Type-check, full test run, and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: full vitest suite PASSES.

```bash
git add src/components/summaries/VerdictBlock.tsx src/tests/summaries/VerdictBlock.test.tsx
git commit -m "feat(summaries): show human glyph in detail pane verdict block"
```

---

## Notes for the implementer

- The warm palette tokens (`ochre`, `moss`, `brick`, `muted`, `paper`, `elevated`, `surface`, `canvas`, `edge`) are defined globally for single-label mode — no import needed; use them as Tailwind classes like existing code.
- Do NOT touch `server/python/`, `src/services/api.ts`, or `src/types/index.ts` — `applied_by` is already plumbed through.
- AI-labeled and `null` rows intentionally render no glyph; the 16px gutter column keeps confidence/text aligned regardless.
