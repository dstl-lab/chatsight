# Label Name Suggestions — Design Spec

**Date:** 2026-06-03  
**Scope:** Single-label mode only (`/run`). Multi-label queue is explicitly out of scope — do not touch `NewLabelPopover.tsx`, `LabelsPage.tsx`, or any queue-mode component.

---

## Problem

Browser autofill on label name inputs was injecting contact names from participants' computers during user studies. `autoComplete="off"` is not reliably respected by Chrome/Safari. The fix is a custom dropdown that replaces browser suggestions entirely — and since we're building one, it should surface actually useful suggestions: concept candidate names discovered from the chatlog data, filtered to exclude labels that are semantically redundant with ones the instructor already has.

---

## Filtering requirement

Filtering must work at the synonym level, not just string matching. If "confusion" exists as a label, the dropdown must not suggest "Confusion", "confused", "puzzled", "unsure", or other near-synonyms. Simple case-insensitive string comparison is not sufficient.

---

## Architecture

### Backend: `GET /api/concepts/name-suggestions`

New endpoint in `main.py`. Logic:

1. Fetch all `ConceptCandidate` rows where `status == "pending"` from SQLite
2. Fetch all existing label names from `LabelDefinition` (all rows, both `mode='multi'` and `mode='single'` — they share one table)
3. Batch-embed both sets of names using `gemini-embedding-001`
4. For each candidate, compute cosine similarity against every existing label name
5. Drop any candidate where `max_similarity > SUGGESTION_SIMILARITY_THRESHOLD` (constant, default `0.75`)
6. Return `[{ name: str, description: str }]`

The threshold `0.75` is where true synonyms converge in embedding space. Expose as a backend constant (`SUGGESTION_SIMILARITY_THRESHOLD`) so it can be tuned after testing.

If no concept candidates exist, or if the Gemini embedding call fails, return an empty list — do not error.

### Frontend: `useLabelSuggestions` hook

**File:** `src/hooks/useLabelSuggestions.ts`

- Calls `GET /api/concepts/name-suggestions` once on mount
- Returns `{ suggestions: { name: string; description: string }[], loading: boolean }`
- On error: sets `suggestions = []`, does not throw or surface to UI
- No polling or refetching within a session

### Frontend: `LabelNameInput` component

**File:** `src/components/run/LabelNameInput.tsx`  
(Placed in `run/` since it is single-label only.)

Props:
```ts
interface LabelNameInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: () => void
  suggestions: { name: string; description: string }[]
  placeholder?: string
  readOnly?: boolean
  className?: string
  // forwarded: autoFocus, onBlur, onKeyDown, data-*, etc.
}
```

Behavior:
- `autoComplete="off"` on the underlying `<input>`
- Dropdown appears when: input is focused AND typed value is non-empty AND at least one suggestion contains the typed string (case-insensitive)
- Client-side filter: suggestions where `name.toLowerCase().includes(typed.toLowerCase())`
- Dropdown does not appear if typed value is an exact case-insensitive match to a suggestion (user already has it)
- ↑↓ keys navigate highlighted row; Enter selects highlighted row (calls `onChange` with the name, then `onCommit`); Escape closes dropdown
- Clicking a suggestion fills the input and calls `onCommit`
- Each row: suggestion name (bold, `text-on-canvas`) + description (muted, truncated to one line)
- If `suggestions` is empty, component behaves as a plain `<input>` — no dropdown ever renders

### Wiring

`useLabelSuggestions` is called in `LabelRunPage.tsx`. The resulting `suggestions` array is passed as a prop down to:

- `StripBar.tsx` — replaces the bare `<input>` in the label name slot with `LabelNameInput`
- `NoteLabelPopover.tsx` — replaces the bare `<input>` for the name field with `LabelNameInput`

**Do not wire into any multi-label component.**

---

## Data flow

```
LabelRunPage mounts
  → useLabelSuggestions fires once
  → GET /api/concepts/name-suggestions
      → fetch pending ConceptCandidates
      → fetch existing label names (single + multi)
      → embed both with gemini-embedding-001
      → cosine filter at 0.75 threshold
      → return [{name, description}]
  → suggestions stored in hook state
  → passed as prop to StripBar + NoteLabelPopover
  → LabelNameInput renders dropdown on focus+type
```

---

## Error handling

| Failure | Behavior |
|---|---|
| No concept candidates | Returns `[]`, input is a plain text field |
| Gemini embedding call fails | Returns `[]`, input is a plain text field |
| All candidates filtered out | Returns `[]`, input is a plain text field |
| Frontend fetch error | `suggestions = []`, no error shown |

The input must never be broken or degraded by a failed suggestion fetch.

---

## Testing

**Backend:**
- Unit test `cosine_similarity` filter: confirm "confusion" (existing) suppresses "confused", "puzzled", "unsure" as candidates; confirm unrelated candidates (e.g., "code syntax help") pass through
- Mock `gemini-embedding-001` call — return pre-computed vectors
- Test empty-candidate and Gemini-error paths return `[]` gracefully

**Frontend:**
- `LabelNameInput` is pure props-driven UI — no fetch logic to test separately
- Verify dropdown appears/hides at correct conditions via existing vitest + RTL setup
- `useLabelSuggestions` is a thin fetch wrapper; covered by integration if needed

---

## Out of scope

- Multi-label queue (`NewLabelPopover`, `QueuePage`, `LabelsPage`) — do not touch
- The label split dialog in `LabelsPage.tsx` — intentionally shows existing labels, leave as-is
- Suggestion ranking or sorting beyond the existing candidate order
- Re-fetching suggestions after a new label is created within the session
