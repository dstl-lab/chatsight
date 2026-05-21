# Summaries: AI-vs-human label indicator (single-label workflow)

**Date:** 2026-05-20
**Scope:** Frontend only — `/summaries` single-label view.

## Problem

In the single-label workflow, every message in `/summaries` carries a label that
was applied either by Gemini (auto-label) or by a human (review/flip). The Browse
list rows and the detail pane don't surface this distinction, so an instructor
reading summaries can't tell which verdicts a human actually touched.

## What already exists

The data is fully wired end-to-end — no backend or type work is needed:

- Backend `GET /api/single-labels/{label_id}/messages` returns `applied_by`
  (`server/python/main.py`, in the `MessageListItem` construction).
- `LabelApplication.applied_by` defaults to `"human"` and is set to `"ai"` by the
  binary auto-label path; a human review/flip sets it back to `"human"`.
- Frontend types already include the field:
  - `MessageListItem.applied_by: 'ai' | 'human' | null` (`src/types/index.ts`)
  - `MessageDetail.applied_by: 'ai' | 'human' | null` (`src/types/index.ts`)
- `FocusedMessage` already passes `appliedBy={detail.applied_by}` into
  `VerdictBlock` — but `VerdictBlock` never destructures or renders it.

So this is purely a presentation gap in two components.

## Design decisions

- **Mark only human-labeled messages.** AI auto-labeling is expected to cover the
  large majority of messages, so human-applied labels are the smaller, more
  noteworthy set. AI rows are the baseline and get no glyph.
- **Use an emoji glyph:** 👤 for human. (`applied_by === 'ai'` or `null` → render
  nothing.)
- **Single shared component** so the list row and detail pane stay visually
  consistent and there is one place to change the glyph.

## Components

### 1. `src/components/summaries/AppliedByGlyph.tsx` (new)

```tsx
interface AppliedByGlyphProps {
  appliedBy: 'ai' | 'human' | null
  chatlogId: number
  messageIndex: number
}
```

- Renders `👤` only when `appliedBy === 'human'`; otherwise returns `null`.
- Includes `title="Labeled by human"`, `aria-label="Labeled by human"`, and
  `data-testid={`applied-by-human-${chatlogId}-${messageIndex}`}` — matching the
  existing `flag-glyph-*` / `note-dot-*` testid convention in `MessageListRow`.
- Styled small/subtle to fit the dense warm-palette rows (e.g.
  `text-[11px] leading-none`).

### 2. `src/components/summaries/MessageListRow.tsx`

- Change the grid from `grid-cols-[38px_1fr]` to `grid-cols-[16px_38px_1fr]`,
  adding a fixed leading gutter column for the glyph.
- The glyph cell renders `<AppliedByGlyph .../>`. For AI/null rows the cell is
  empty, so the fixed-width column keeps confidence and text aligned across all
  rows (no horizontal jitter).

### 3. `src/components/summaries/VerdictBlock.tsx`

- Add `appliedBy` to the destructured props (currently received but dropped).
- Render the human glyph in the verdict header `flex` row (alongside the verdict
  badge), only when `appliedBy === 'human'`. Reuse `AppliedByGlyph` (the detail
  pane has room, so a short "Human" text label next to the glyph is acceptable
  but optional).

## Testing

- New vitest test for `MessageListRow`:
  - `applied_by: 'human'` → `applied-by-human-{id}-{idx}` testid present.
  - `applied_by: 'ai'` and `applied_by: null` → that testid absent.
- Follows the existing summaries component test patterns in `src/tests/`.

## Out of scope

- Backend / API changes (`main.py`, `api.ts`).
- TypeScript type changes (`applied_by` already present).
- Any AI-vs-human classification or persistence logic.
- The multi-label `/summaries` view and other pages.

## Success criteria

- Human-labeled messages show 👤 in both the Browse list and the detail pane.
- AI-labeled / unlabeled messages show no glyph.
- `npm run build` (type-check + build) passes.
- New test passes (`npm test`).
