# Label Name Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser contact autofill on single-label name inputs with a custom autocomplete dropdown populated by concept candidates filtered to exclude semantically similar existing labels.

**Architecture:** A new backend service (`name_suggestion_service.py`) embeds both concept candidate names and existing label names via `gemini-embedding-001`, filters candidates where cosine similarity to any existing label exceeds 0.75, and returns a clean list. A `useLabelSuggestions` hook fetches this once on mount in `LabelRunPage`. A reusable `LabelNameInput` component wraps `<input>` + dropdown and is wired into `StripBar` and `NoteLabelPopover` — the only two single-label name entry points. Multi-label components (`NewLabelPopover`, `LabelsPage`, `QueuePage`) are not touched.

**Tech Stack:** Python/FastAPI, SQLModel, `google-genai` SDK, numpy (already installed), React 18, TypeScript, Tailwind v4, Vitest + React Testing Library

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/python/name_suggestion_service.py` | Cosine-similarity filtering + Gemini embedding call |
| Modify | `server/python/main.py` | Add `GET /api/concepts/name-suggestions` endpoint |
| Create | `server/python/tests/test_name_suggestions.py` | Backend unit + integration tests |
| Modify | `src/types/index.ts` | Add `LabelNameSuggestion` interface |
| Modify | `src/services/api.ts` | Add `getNameSuggestions` call |
| Create | `src/hooks/useLabelSuggestions.ts` | Fetch + cache suggestions on mount |
| Create | `src/components/run/LabelNameInput.tsx` | Input + filtered dropdown component |
| Create | `src/tests/run/LabelNameInput.test.tsx` | Frontend component tests |
| Modify | `src/components/run/StripBar.tsx` | Accept + forward suggestions; use LabelNameInput |
| Modify | `src/components/run/NoteLabelPopover.tsx` | Accept + forward suggestions; use LabelNameInput |
| Modify | `src/pages/LabelRunPage.tsx` | Call useLabelSuggestions; pass to StripBar + NoteLabelPopover |

---

## Task 1: Add `LabelNameSuggestion` type and `getNameSuggestions` API call

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/api.ts`

- [ ] **Step 1: Add type to `src/types/index.ts`**

Find the `ConceptCandidate` interface (around line 192) and add the new type immediately after it:

```ts
export interface LabelNameSuggestion {
  name: string
  description: string
}
```

- [ ] **Step 2: Add API call to `src/services/api.ts`**

Find the `getCandidates` entry (around line 131) and add the new call immediately after it:

```ts
  getNameSuggestions: (): Promise<LabelNameSuggestion[]> =>
    USE_MOCK ? Promise.resolve([]) : req('/api/concepts/name-suggestions'),
```

Add `LabelNameSuggestion` to the import from `'../types'` at the top of `api.ts`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/services/api.ts
git commit -m "feat: add LabelNameSuggestion type and getNameSuggestions API call"
```

---

## Task 2: Create `name_suggestion_service.py` (TDD)

**Files:**
- Create: `server/python/name_suggestion_service.py`
- Create: `server/python/tests/test_name_suggestions.py`

- [ ] **Step 1: Write failing tests**

Create `server/python/tests/test_name_suggestions.py`:

```python
import math
import pytest
from unittest.mock import MagicMock, patch


def _emb(values):
    e = MagicMock()
    e.values = values
    return e


def _mock_embed(*batches):
    """Return a mock embed_content that yields embeddings from `batches` in order."""
    responses = []
    for vecs in batches:
        r = MagicMock()
        r.embeddings = [_emb(v) for v in vecs]
        responses.append(r)
    m = MagicMock(side_effect=responses)
    return m


# ── _cosine_sim ──────────────────────────────────────────────────────────────

def test_cosine_sim_identical_vectors():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([1.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == pytest.approx(1.0)


def test_cosine_sim_orthogonal_vectors():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]) == pytest.approx(0.0)


def test_cosine_sim_zero_vector_returns_zero():
    from name_suggestion_service import _cosine_sim
    assert _cosine_sim([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]) == 0.0


# ── filter_suggestions ───────────────────────────────────────────────────────

def test_filter_removes_synonym(monkeypatch):
    """'puzzled' should be filtered when 'confusion' exists (cos_sim ≈ 0.99 > 0.75)."""
    import name_suggestion_service as svc

    # candidates: ["puzzled", "code syntax help"], existing: ["confusion"]
    mock = _mock_embed(
        [[0.99, 0.14, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]],
    )
    with patch.object(svc.client.models, "embed_content", mock):
        result = svc.filter_suggestions(
            candidate_names=["puzzled", "code syntax help"],
            candidate_descriptions=["lost student", "syntax questions"],
            existing_names=["confusion"],
        )

    names = [r["name"] for r in result]
    assert "puzzled" not in names          # cos([0.99,0.14,0],[1,0,0]) ≈ 0.99 > 0.75
    assert "code syntax help" in names     # cos([0,0,1],[1,0,0]) = 0.0 < 0.75


def test_filter_returns_all_when_no_existing_labels():
    import name_suggestion_service as svc
    result = svc.filter_suggestions(
        candidate_names=["error tracing"],
        candidate_descriptions=["tracing errors"],
        existing_names=[],
    )
    assert result == [{"name": "error tracing", "description": "tracing errors"}]


def test_filter_returns_empty_when_no_candidates():
    import name_suggestion_service as svc
    result = svc.filter_suggestions(
        candidate_names=[],
        candidate_descriptions=[],
        existing_names=["confusion"],
    )
    assert result == []
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd server/python && uv run pytest tests/test_name_suggestions.py -v
```

Expected: `ImportError: No module named 'name_suggestion_service'`

- [ ] **Step 3: Implement `name_suggestion_service.py`**

Create `server/python/name_suggestion_service.py`:

```python
import math
import os
from typing import List

import numpy as np
from google import genai

SUGGESTION_SIMILARITY_THRESHOLD = 0.75
_EMBED_MODEL = "gemini-embedding-001"

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))


def _cosine_sim(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def filter_suggestions(
    candidate_names: List[str],
    candidate_descriptions: List[str],
    existing_names: List[str],
) -> List[dict]:
    """Return candidates not semantically similar to any existing label name.

    Embeds all texts in one batch call: candidates first, then existing names.
    Drops any candidate whose max cosine similarity to an existing label
    exceeds SUGGESTION_SIMILARITY_THRESHOLD.
    """
    if not candidate_names:
        return []
    if not existing_names:
        return [
            {"name": n, "description": d}
            for n, d in zip(candidate_names, candidate_descriptions)
        ]

    all_texts = candidate_names + existing_names
    resp = client.models.embed_content(model=_EMBED_MODEL, contents=all_texts)
    embeddings = [e.values for e in resp.embeddings]

    cand_vecs = embeddings[: len(candidate_names)]
    exist_vecs = embeddings[len(candidate_names) :]

    result = []
    for name, desc, vec in zip(candidate_names, candidate_descriptions, cand_vecs):
        max_sim = max(_cosine_sim(vec, ex) for ex in exist_vecs)
        if max_sim <= SUGGESTION_SIMILARITY_THRESHOLD:
            result.append({"name": name, "description": desc})
    return result
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd server/python && uv run pytest tests/test_name_suggestions.py -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/python/name_suggestion_service.py server/python/tests/test_name_suggestions.py
git commit -m "feat: add name_suggestion_service with cosine-similarity label filtering"
```

---

## Task 3: Add `/api/concepts/name-suggestions` endpoint to `main.py`

**Files:**
- Modify: `server/python/main.py`
- Modify: `server/python/tests/test_name_suggestions.py`

- [ ] **Step 1: Write failing endpoint tests**

Append to `server/python/tests/test_name_suggestions.py`:

```python
# ── endpoint ─────────────────────────────────────────────────────────────────

def test_endpoint_returns_empty_when_no_candidates(client):
    resp = client.get("/api/concepts/name-suggestions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_endpoint_filters_and_returns_suggestions(client, session):
    from models import LabelDefinition, ConceptCandidate
    import name_suggestion_service as svc

    session.add(LabelDefinition(name="confusion", mode="single", description=""))
    session.add(ConceptCandidate(
        name="puzzled", description="student seems lost",
        status="pending", source_run_id="r1", example_messages="[]",
    ))
    session.add(ConceptCandidate(
        name="code syntax help", description="syntax questions",
        status="pending", source_run_id="r1", example_messages="[]",
    ))
    session.commit()

    mock = _mock_embed(
        [[0.99, 0.14, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]],
    )
    with patch.object(svc.client.models, "embed_content", mock):
        resp = client.get("/api/concepts/name-suggestions")

    assert resp.status_code == 200
    names = [s["name"] for s in resp.json()]
    assert "puzzled" not in names
    assert "code syntax help" in names


def test_endpoint_returns_empty_on_gemini_error(client, session):
    from models import ConceptCandidate
    import name_suggestion_service as svc

    session.add(ConceptCandidate(
        name="scope clarification", description="...",
        status="pending", source_run_id="r1", example_messages="[]",
    ))
    session.commit()

    with patch.object(svc.client.models, "embed_content", side_effect=Exception("network")):
        resp = client.get("/api/concepts/name-suggestions")

    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 2: Run new tests — confirm they fail**

```bash
cd server/python && uv run pytest tests/test_name_suggestions.py::test_endpoint_returns_empty_when_no_candidates -v
```

Expected: `404 Not Found` (endpoint doesn't exist yet).

- [ ] **Step 3: Add endpoint to `main.py`**

Find the existing `GET /api/concepts/candidates` endpoint (around line 2067) and add the new endpoint immediately after it:

```python
@app.get("/api/concepts/name-suggestions")
def get_name_suggestions(db: Session = Depends(get_session)):
    """Return pending concept candidates filtered to exclude semantic duplicates of existing labels."""
    import name_suggestion_service

    candidates = db.exec(
        select(ConceptCandidate).where(ConceptCandidate.status == "pending")
    ).all()
    if not candidates:
        return []

    existing_names = list(db.exec(select(LabelDefinition.name)).all())

    try:
        return name_suggestion_service.filter_suggestions(
            candidate_names=[c.name for c in candidates],
            candidate_descriptions=[c.description for c in candidates],
            existing_names=existing_names,
        )
    except Exception:
        return []
```

- [ ] **Step 4: Run all name suggestion tests**

```bash
cd server/python && uv run pytest tests/test_name_suggestions.py -v
```

Expected: 9 tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd server/python && uv run pytest
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/python/main.py server/python/tests/test_name_suggestions.py
git commit -m "feat: add GET /api/concepts/name-suggestions endpoint"
```

---

## Task 4: Create `useLabelSuggestions` hook

**Files:**
- Create: `src/hooks/useLabelSuggestions.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useLabelSuggestions.ts`:

```ts
import { useState, useEffect } from 'react'
import { api } from '../services/api'
import type { LabelNameSuggestion } from '../types'

export function useLabelSuggestions() {
  const [suggestions, setSuggestions] = useState<LabelNameSuggestion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getNameSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false))
  }, [])

  return { suggestions, loading }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLabelSuggestions.ts
git commit -m "feat: add useLabelSuggestions hook"
```

---

## Task 5: Create `LabelNameInput` component (TDD)

**Files:**
- Create: `src/components/run/LabelNameInput.tsx`
- Create: `src/tests/run/LabelNameInput.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/tests/run/LabelNameInput.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LabelNameInput } from '../../components/run/LabelNameInput'
import type { LabelNameSuggestion } from '../../types'

const suggestions: LabelNameSuggestion[] = [
  { name: 'confusion', description: 'Student shows confusion about a concept' },
  { name: 'code help', description: 'Requesting help with code' },
]

describe('LabelNameInput', () => {
  it('shows filtered suggestions when focused and typing', () => {
    render(<LabelNameInput value="con" onChange={() => {}} suggestions={suggestions} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('confusion')).toBeInTheDocument()
    expect(screen.queryByText('code help')).not.toBeInTheDocument()
  })

  it('hides dropdown when typed value exactly matches a suggestion', () => {
    render(<LabelNameInput value="confusion" onChange={() => {}} suggestions={suggestions} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('calls onChange and onCommit when suggestion is clicked', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(
      <LabelNameInput value="con" onChange={onChange} onCommit={onCommit} suggestions={suggestions} />
    )
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getByText('confusion'))
    expect(onChange).toHaveBeenCalledWith('confusion')
    expect(onCommit).toHaveBeenCalled()
  })

  it('selects first suggestion on Enter when dropdown is open', () => {
    const onChange = vi.fn()
    render(<LabelNameInput value="con" onChange={onChange} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('confusion')
  })

  it('navigates to second suggestion with ArrowDown then selects with Enter', () => {
    const onChange = vi.fn()
    render(<LabelNameInput value="c" onChange={onChange} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('code help')
  })

  it('closes dropdown on Escape', () => {
    render(<LabelNameInput value="con" onChange={() => {}} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('passes unhandled keyDown events to the onKeyDown prop', () => {
    const onKeyDown = vi.fn()
    render(
      <LabelNameInput value="" onChange={() => {}} suggestions={[]} onKeyDown={onKeyDown} />
    )
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalled()
  })

  it('renders as a plain input when suggestions is empty', () => {
    render(<LabelNameInput value="any" onChange={() => {}} suggestions={[]} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test -- run src/tests/run/LabelNameInput.test.tsx
```

Expected: `Cannot find module '../../components/run/LabelNameInput'`

- [ ] **Step 3: Implement `LabelNameInput`**

Create `src/components/run/LabelNameInput.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import type { LabelNameSuggestion } from '../../types'

interface LabelNameInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: () => void
  suggestions: LabelNameSuggestion[]
  placeholder?: string
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  'data-tutorial'?: string
}

export function LabelNameInput({
  value,
  onChange,
  onCommit,
  suggestions,
  placeholder,
  readOnly,
  autoFocus,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: LabelNameInputProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)

  const filtered = suggestions.filter(
    (s) =>
      value.length > 0 &&
      s.name.toLowerCase().includes(value.toLowerCase()) &&
      s.name.toLowerCase() !== value.toLowerCase()
  )
  const showDropdown = open && filtered.length > 0

  // Reset highlight when the filtered list changes
  useEffect(() => {
    setHighlighted(0)
  }, [value])

  function select(name: string) {
    onChange(name)
    setOpen(false)
    onCommit?.()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        select(filtered[highlighted].name)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
        type="text"
        autoComplete="off"
        value={value}
        readOnly={readOnly}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.() }}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {showDropdown && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-y-auto rounded-sm border border-edge bg-elevated shadow-lg"
        >
          {filtered.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === highlighted}
              className={`cursor-pointer px-3 py-2 ${
                i === highlighted ? 'bg-ochre/10' : 'hover:bg-surface'
              }`}
              onMouseDown={(e) => { e.preventDefault(); select(s.name) }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="text-sm font-semibold text-on-canvas">{s.name}</div>
              {s.description && (
                <div className="truncate text-xs text-muted">{s.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test -- run src/tests/run/LabelNameInput.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/run/LabelNameInput.tsx src/tests/run/LabelNameInput.test.tsx
git commit -m "feat: add LabelNameInput component with filtered autocomplete dropdown"
```

---

## Task 6: Wire `LabelNameInput` into `StripBar.tsx`

**Files:**
- Modify: `src/components/run/StripBar.tsx`

- [ ] **Step 1: Add `suggestions` to `StripBarProps` and destructure it**

In `src/components/run/StripBar.tsx`, add to the `StripBarProps` interface (after `onRemoveQueued`):

```ts
  suggestions?: LabelNameSuggestion[]
```

Add to the imports at the top:

```ts
import { LabelNameInput } from './LabelNameInput'
import type { LabelNameSuggestion } from '../../types'
```

Add `suggestions = []` to the destructured props in `StripBar`:

```ts
export function StripBar({
  // ...existing props...
  suggestions = [],
}: StripBarProps) {
```

- [ ] **Step 2: Replace the bare `<input>` with `LabelNameInput`**

Find the `<input>` block inside `{showNameInput ? (` (around line 102). Replace the entire `<input ... />` element with:

```tsx
<LabelNameInput
  data-tutorial="label-name"
  value={labelNameDraft ?? ''}
  readOnly={labelNameLocked}
  suggestions={suggestions}
  onChange={(v) => onLabelNameDraftChange?.(v)}
  onCommit={() => {
    const name = (labelNameDraft ?? '').trim()
    if (name && !isPlaceholderLabelName(name) && !labelNameLocked) {
      commitName?.()
    }
  }}
  onKeyDown={(e) => {
    const name = (labelNameDraft ?? '').trim()
    if (e.key === 'Enter' && name && !isPlaceholderLabelName(name) && !labelNameLocked) {
      e.preventDefault()
      commitName?.()
    }
  }}
  onBlur={() => {
    if (draftMode || labelNameLocked) return
    onLabelNameCommit?.()
  }}
  placeholder="Label name…"
  className="box-border w-full min-w-[10rem] max-w-[18rem] rounded-sm border border-edge bg-surface px-2.5 py-1.5 font-sans text-sm text-on-canvas placeholder:text-faint focus:outline-none focus:border-ochre-dim disabled:opacity-70"
/>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/run/StripBar.tsx
git commit -m "feat: use LabelNameInput in StripBar for single-label name field"
```

---

## Task 7: Wire `LabelNameInput` into `NoteLabelPopover.tsx`

**Files:**
- Modify: `src/components/run/NoteLabelPopover.tsx`

- [ ] **Step 1: Add `suggestions` to `NoteLabelPopoverProps` and import**

In `src/components/run/NoteLabelPopover.tsx`, update the imports and props:

```tsx
import { LabelNameInput } from './LabelNameInput'
import type { LabelNameSuggestion } from '../../types'

interface NoteLabelPopoverProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, description: string) => void
  suggestions?: LabelNameSuggestion[]
}
```

Add `suggestions = []` to the destructured function args:

```tsx
export function NoteLabelPopover({ open, onClose, onSubmit, suggestions = [] }: NoteLabelPopoverProps) {
```

- [ ] **Step 2: Replace the bare `<input>` with `LabelNameInput`**

Find the `<input ref={nameRef} ...>` (around line 65). Replace it with:

```tsx
<LabelNameInput
  ref={nameRef as React.Ref<HTMLInputElement>}
  autoFocus
  autoComplete="off"
  placeholder="e.g. frustration"
  value={name}
  suggestions={suggestions}
  onChange={setName}
  onCommit={() => { if (name.trim()) onSubmit(name.trim(), description.trim()) }}
  className="appearance-none bg-canvas border border-edge text-on-canvas px-[11px] py-[9px] rounded-sm font-sans text-[13px] focus:outline-none focus:border-ochre-dim"
/>
```

Since `LabelNameInput` wraps a `<div>`, remove the `ref={nameRef}` forwarding and instead focus the input a different way. Update the `useEffect` that focuses on open:

```tsx
const inputRef = useRef<HTMLInputElement>(null)

useEffect(() => {
  if (open) {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-note-input]')
      input?.focus()
    })
  } else {
    setName('')
    setDescription('')
  }
}, [open])
```

And add `data-note-input` to the `LabelNameInput`:

```tsx
<LabelNameInput
  data-note-input=""
  autoFocus
  ...
/>
```

Also update the `onKey` handler that checks `document.activeElement === nameRef.current` — replace with a check on `data-note-input`:

```tsx
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  } else if (
    e.key === 'Enter' &&
    (document.activeElement as HTMLElement)?.dataset?.noteInput !== undefined
  ) {
    e.preventDefault()
    if (name.trim()) onSubmit(name.trim(), description.trim())
  }
}
```

Remove the `nameRef` ref entirely.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/run/NoteLabelPopover.tsx
git commit -m "feat: use LabelNameInput in NoteLabelPopover for single-label name field"
```

---

## Task 8: Connect `useLabelSuggestions` in `LabelRunPage.tsx`

**Files:**
- Modify: `src/pages/LabelRunPage.tsx`

- [ ] **Step 1: Call `useLabelSuggestions` in `LabelRunPage`**

Add the import at the top of `LabelRunPage.tsx`:

```ts
import { useLabelSuggestions } from '../hooks/useLabelSuggestions'
```

Add the hook call near the top of the component body (alongside the other hooks):

```ts
const { suggestions } = useLabelSuggestions()
```

- [ ] **Step 2: Pass `suggestions` to `StripBar`**

Find the `<StripBar ... />` usage in `LabelRunPage.tsx` (around line 754). Add:

```tsx
suggestions={suggestions}
```

- [ ] **Step 3: Pass `suggestions` to both `NoteLabelPopover` instances**

There are two `<NoteLabelPopover` instances (around lines 720 and 818). Add `suggestions={suggestions}` to both:

```tsx
<NoteLabelPopover
  open={noteOpen}
  onClose={() => setNoteOpen(false)}
  onSubmit={handleNoteSubmit}
  suggestions={suggestions}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full frontend test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Run full backend test suite**

```bash
cd server/python && uv run pytest
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/LabelRunPage.tsx
git commit -m "feat: connect label name suggestions to single-label run page"
```

---

## Self-Review

**Spec coverage:**
- ✅ Backend embedding filter at 0.75 threshold → Task 2
- ✅ Only `pending` candidates → Task 3 (`where status == "pending"`)
- ✅ Fetch existing labels from `LabelDefinition` (all modes) → Task 3
- ✅ Returns empty list on error → Task 3 (try/except)
- ✅ `useLabelSuggestions` hook, fetch once on mount → Task 4
- ✅ `LabelNameInput` with `autoComplete="off"`, ↑↓ navigation, Enter/Escape → Task 5
- ✅ Shows description per suggestion → Task 5
- ✅ Wired into `StripBar` → Task 6
- ✅ Wired into `NoteLabelPopover` → Task 7
- ✅ `useLabelSuggestions` called in `LabelRunPage`, passed to both components → Task 8
- ✅ Multi-label components not touched — `NewLabelPopover`, `QueuePage`, `LabelsPage` absent from file map

**Type consistency:**
- `LabelNameSuggestion` defined in Task 1, used in Tasks 4, 5, 6, 7 ✅
- `filter_suggestions` signature in Task 2 matches call in Task 3 ✅
- `suggestions` prop on `StripBar` is `LabelNameSuggestion[]` with default `[]` ✅
- `suggestions` prop on `NoteLabelPopover` is `LabelNameSuggestion[]` with default `[]` ✅
