# Analysis Page — Single-Label View + Multi-Label Cleanup Implementation Plan

> **Revision 2 (2026-05-10):** Layout pivoted from scrolling two-tab page to **split-pane single-viewport** dashboard after design feedback. Reference: `mockups/analysis-redesign/app-native/index.html`.
>
> Key structural changes from r1:
> - Top-level tabs removed; replaced with persistent **cohort rail (304px) + run-detail pane** layout.
> - Inside the run-detail pane: `Label health` (default) / `Findings` **sub-tab strip** (segmented control, not routed).
> - Examples moved into a **slide-up drawer** (38vh overlay) triggered from the Findings tab.
> - Three new metrics added: **AI coverage**, **Agreement by confidence**, **conversation-level yes-rate**, plus a **per-run weekly sparkline** in each cohort rail entry.
> - `SectionMark.tsx` task removed; new tasks added for `RailSparkline`, `CoverageCard`, `AgreementByConfidence`. `CohortTab` → `CohortRail`, `RunDetailTab` → `RunDetailPane`, `ExampleMessageGroup` → `ExamplesDrawer`.
>
> Unchanged: file dispatcher refactor, backend module placement, the four multi-label cleanup items, test setup conventions.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/analysis` mode-aware. Build a new warm-palette single-label analysis view (cohort + run-detail tabs) and pay down four pieces of debt on the existing multi-label dashboard.

**Architecture:** `AnalysisPage.tsx` becomes a thin dispatcher; today's body extracts to `MultiLabelAnalysis.tsx`; a new `SingleLabelAnalysis.tsx` is a **split-pane app-native dashboard** — persistent cohort rail (304px) on the left, run-detail pane on the right with a `Label health` / `Findings` sub-tab strip and a slide-up examples drawer. The whole view fits in a single viewport (`body { overflow: hidden }`). Run selection is URL-driven (`?run_id=<id>`); sub-tab state is local component state. Reference mockup: `mockups/analysis-redesign/app-native/index.html`. The single-label view uses only fonts/tokens already loaded (`Source Serif 4`, warm palette CSS variables). Multi-label cleanup is isolated to four small follow-ups that share the dispatcher refactor as their foundation.

**Tech Stack:** React 19 + Vite + TypeScript + Tailwind v4 + Recharts (frontend); FastAPI + SQLModel + SQLite (backend); vitest + React Testing Library (FE tests); pytest with in-memory SQLite (BE tests). Brainstorm spec lives at `/Users/minchan/.claude/plans/let-s-fix-up-this-smooth-anchor.md`.

**Shippable checkpoints:**
1. End of **Phase 0** — refactor only, zero behavior change. Safe to ship.
2. End of **Phase 2** — FE single-label view works against mock data. Safe to ship.
3. End of **Phase 3** — full single-label view wired to real backend. Safe to ship.
4. End of **Phase 4** — multi-label debt paid down. Safe to ship.

---

## File Structure

**New files:**

```
src/pages/analysis/MultiLabelAnalysis.tsx
src/pages/analysis/SingleLabelAnalysis.tsx                    # split-pane shell
src/pages/analysis/single-label/CohortRail.tsx                # 304px left rail (list with sparklines)
src/pages/analysis/single-label/RailSparkline.tsx             # tiny per-entry weekly SVG
src/pages/analysis/single-label/RunDetailPane.tsx             # header + sub-tabs + body
src/pages/analysis/single-label/HealthSubtab.tsx              # composes histogram + sidebar + disagreement
src/pages/analysis/single-label/FindingsSubtab.tsx            # composes assignment + position + weekly + drawer toggle
src/pages/analysis/single-label/ConfidenceHistogram.tsx
src/pages/analysis/single-label/CoverageCard.tsx              # NEW
src/pages/analysis/single-label/AgreementByConfidence.tsx     # NEW
src/pages/analysis/single-label/DisagreementCallout.tsx
src/pages/analysis/single-label/YesRateByAssignmentChart.tsx
src/pages/analysis/single-label/YesRateByPositionChart.tsx
src/pages/analysis/single-label/YesRateOverTimeChart.tsx
src/pages/analysis/single-label/ExamplesDrawer.tsx            # slide-up overlay
src/tests/SingleLabelAnalysis.test.tsx
src/tests/CohortRail.test.tsx
src/tests/ConfidenceHistogram.test.tsx
src/tests/CoverageCard.test.tsx
src/tests/AgreementByConfidence.test.tsx
src/tests/RunDetailPane.test.tsx
server/python/analysis_single_label.py
server/python/data/milestones/dsc10_wi26.json
server/python/tests/test_single_label_cohort.py
server/python/tests/test_single_label_run_detail.py
server/python/tests/test_analysis_milestones.py
server/python/tests/test_analysis_temporal_partial_failure.py
```

(`SectionMark.tsx` from the previous plan revision is dropped — the app-native layout uses chart-card heads, not section ornaments.)

**Modified files:**

```
src/pages/AnalysisPage.tsx                # becomes ~40-line dispatcher
src/services/api.ts                       # add 3 methods + mock fallthrough
src/types/index.ts                        # add 5 new types, extend AnalysisSummary
src/mocks/index.ts                        # add cohort + run-detail fixtures
src/tests/AnalysisPage.test.tsx           # update for dispatcher behavior
server/python/main.py                     # mount router, extend summary + temporal, add milestones route
```

Each file in `src/pages/analysis/single-label/` has one responsibility (one chart or one structural piece). `analysis_single_label.py` owns the two new endpoints and their query logic.

---

## Phase 0 — Foundational refactor (no behavior change)

### Task 1: Add TypeScript types for single-label analysis

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add new types**

Open `src/types/index.ts` and append at the end of the file (after the existing single-label section):

```ts
// ─── Single-label analysis ───

export type SingleLabelCohortRow = {
  run_id: number;
  label_name: string;
  description: string | null;
  phase: 'queued' | 'labeling' | 'handed_off' | 'reviewing' | 'complete';
  yes_count: number;
  no_count: number;
  yes_pct: number;            // 0–100; 0 if (yes + no) == 0
  walked: number;             // distinct messages with a human decision
  total_target: number | null;
  disagreement_pct: number | null;  // 0–100; null if overlap_count == 0
  overlap_count: number;
  updated_at: string;         // ISO 8601
  weekly_sparkline: number[]; // ≤8 weekly yes_pct values, oldest→newest, for the rail sparkline
};

export type AgreementBucket = {
  lo: number;
  hi: number;
  overlap_count: number;
  agree: number;
  agreement_rate: number | null;  // 0–100, null if overlap_count == 0
};

export type SingleLabelCohortResponse = {
  runs: SingleLabelCohortRow[];
};

export type ConfidenceBin = {
  lo: number;                 // inclusive
  hi: number;                 // exclusive (1.0 inclusive in last bin)
  count: number;
  yes: number;
  no: number;
};

export type ExampleMsg = {
  message_id: number;         // LabelApplication.id
  chatlog_id: number;
  message_index: number;
  text: string;
  ai_pred: 'yes' | 'no' | null;
  ai_confidence: number | null;
  human_decision: 'yes' | 'no' | null;
  assignment: string | null;
  position_bucket: 'early' | 'mid' | 'late' | null;
  created_at: string;
  flag: 'low_confidence' | 'human_overruled' | null;
};

export type SingleLabelRunDetail = {
  run: {
    id: number;
    label_name: string;
    description: string | null;
    phase: 'queued' | 'labeling' | 'handed_off' | 'reviewing' | 'complete';
    updated_at: string;
    walked: number;
    total_target: number | null;
    yes_pct: number;           // per-message
    conv_yes_pct: number;      // per-conversation (distinct chatlog_id with ≥1 yes)
  };
  confidence_histogram: {
    bins: ConfidenceBin[];
    coverage: { with_confidence: number; total_ai: number };
  };
  ai_coverage: {               // NEW
    covered: number;           // distinct (chatlog_id, msg_idx) with AI rows
    total: number;             // total MessageCache entries
    pct: number;               // 0–100
  };
  agreement_by_confidence: {   // NEW
    buckets: AgreementBucket[];  // length 5, edges [0,.2,.4,.6,.8,1.0]
  };
  disagreement: {
    overlap_count: number;
    agree: number;
    disagree: number;
    rate: number | null;       // 0–100 or null
    breakdown: {
      ai_yes_human_no: number;
      ai_no_human_yes: number;
    };
  };
  by_assignment: { key: string; yes: number; no: number; yes_pct: number }[];
  by_position: { bucket: 'early' | 'mid' | 'late'; yes: number; no: number; yes_pct: number }[];
  weekly: { week_start: string; yes: number; no: number; yes_pct: number }[];
  examples: {
    yes: ExampleMsg[];
    no: ExampleMsg[];
    edge: ExampleMsg[];
  };
};

export type AssignmentMilestone = {
  name: string;
  date: string;               // YYYY-MM-DD
  kind: 'lab' | 'exam' | 'project' | 'other';
};
```

- [ ] **Step 2: Extend AnalysisSummary**

Find the existing `AnalysisSummary` type (search `src/types/index.ts` for `export type AnalysisSummary`). Add `notebook_breakdown` to the type — it's a record keyed by notebook name, with each value a record keyed by label name → integer count:

```ts
// Add to AnalysisSummary type (do not remove existing fields):
notebook_breakdown?: Record<string, Record<string, number>>;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (the types compile; no consumers yet so no new errors)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add single-label analysis types"
```

---

### Task 2: Split AnalysisPage.tsx into dispatcher + MultiLabelAnalysis

This is mechanical extraction — no logic changes. After this task, `/analysis` renders identically.

**Files:**
- Create: `src/pages/analysis/MultiLabelAnalysis.tsx`
- Modify: `src/pages/AnalysisPage.tsx`
- Test: `src/tests/AnalysisPage.test.tsx` (update for dispatcher)

- [ ] **Step 1: Write the failing test**

Open `src/tests/AnalysisPage.test.tsx` and add a new test at the top of the file's test block (after the existing imports/mocks):

```tsx
test('renders MultiLabelAnalysis when mode === "multi"', async () => {
  localStorage.setItem('chatsight-mode', 'multi')
  renderPage()
  // The multi-label page renders this section header; it confirms we landed on MultiLabelAnalysis.
  await waitFor(() => expect(screen.getByText(/Label Frequency/i)).toBeInTheDocument())
})

test('renders SingleLabelAnalysis when mode === "single"', async () => {
  localStorage.setItem('chatsight-mode', 'single')
  renderPage()
  // SingleLabelAnalysis renders the "Findings" masthead.
  await waitFor(() => expect(screen.getByText(/Findings/i)).toBeInTheDocument())
})
```

You will also need to wrap `renderPage` with `ModeProvider`:

```tsx
import { ModeProvider } from '../hooks/useMode'

function renderPage() {
  return render(
    <MemoryRouter>
      <ModeProvider>
        <AnalysisPage />
      </ModeProvider>
    </MemoryRouter>
  )
}
```

- [ ] **Step 2: Run test to verify the multi-mode test fails for the right reason**

Run: `npm test -- AnalysisPage`
Expected: The "renders SingleLabelAnalysis when mode === 'single'" test FAILS because `SingleLabelAnalysis` doesn't exist yet. The multi-mode test should PASS (current behavior).

- [ ] **Step 3: Create MultiLabelAnalysis.tsx by moving the page body**

Create the directory: `mkdir -p src/pages/analysis`

Open the current `src/pages/AnalysisPage.tsx`. Identify:
- All imports (top of file)
- The exported function (`export function AnalysisPage() { … }`)

Create `src/pages/analysis/MultiLabelAnalysis.tsx` with this exact structure — copy the entire current body of `AnalysisPage`:

```tsx
// All the imports that the original AnalysisPage uses go here.
// (Copy verbatim from the current AnalysisPage.tsx — Recharts, api, types, react-router-dom, useMemo, useState, etc.)
import { useEffect, useMemo, useState } from 'react'
// ... (paste every import from the current AnalysisPage.tsx)

// All helper constants currently at the top of AnalysisPage.tsx (ASSIGNMENT_MILESTONES, etc.) move here.
// (Paste verbatim — we'll replace ASSIGNMENT_MILESTONES with a fetched value in Task 17, not now.)

export function MultiLabelAnalysis() {
  // (Paste the entire body of the current AnalysisPage function here, unchanged.)
}
```

- [ ] **Step 4: Reduce AnalysisPage.tsx to a dispatcher**

Replace the entire contents of `src/pages/AnalysisPage.tsx` with:

```tsx
import { useMode } from '../hooks/useMode'
import { MultiLabelAnalysis } from './analysis/MultiLabelAnalysis'
import { SingleLabelAnalysis } from './analysis/SingleLabelAnalysis'

export function AnalysisPage() {
  const { mode } = useMode()
  return mode === 'single' ? <SingleLabelAnalysis /> : <MultiLabelAnalysis />
}
```

- [ ] **Step 5: Create a placeholder SingleLabelAnalysis so the dispatcher compiles**

Create `src/pages/analysis/SingleLabelAnalysis.tsx`:

```tsx
export function SingleLabelAnalysis() {
  return (
    <main className="max-w-[920px] mx-auto px-14 py-18 font-serif text-on-canvas">
      <header className="pb-3.5 border-b border-edge-warm flex items-baseline justify-between">
        <span className="text-[12px] text-stone tracking-[0.08em]">
          CHATSIGHT · FINDINGS · single-label runs
        </span>
        <span className="text-[12px] italic text-stone">placeholder · Phase 0</span>
      </header>
      <h1 className="text-5xl font-medium tracking-tight mt-9 mb-2">Findings</h1>
      <p className="italic text-[17px] text-tertiary max-w-[560px]">
        (SingleLabelAnalysis placeholder — filled in during Phase 2.)
      </p>
    </main>
  )
}
```

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm test -- AnalysisPage`
Expected: Both new tests PASS — multi mode shows "Label Frequency", single mode shows "Findings".

- [ ] **Step 7: Manual smoke test**

Start the dev server: `npm run dev`
Open `http://localhost:5173/analysis` in multi-label mode (the default). Confirm every section that was on `/analysis` before is still there. Compare side-by-side with `main` if needed.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AnalysisPage.tsx src/pages/analysis/ src/tests/AnalysisPage.test.tsx
git commit -m "refactor: split AnalysisPage into mode dispatcher + MultiLabelAnalysis"
```

---

## Phase 1 — API client + mock fixtures

### Task 3: Add mock fixtures for cohort and run detail

**Files:**
- Modify: `src/mocks/index.ts`

- [ ] **Step 1: Inspect the existing mock pattern**

Read the existing `src/mocks/index.ts`. Note the export style (likely `export const mockApi = { … }`). The fixtures below append to that object — keep the same style.

- [ ] **Step 2: Append the cohort fixture**

Add to `src/mocks/index.ts` (alongside the existing fixture exports):

```ts
import type { SingleLabelCohortResponse, SingleLabelRunDetail } from '../types'

export const mockSingleLabelCohort: SingleLabelCohortResponse = {
  runs: [
    {
      run_id: 1,
      label_name: 'help-seeking',
      description: 'asking the tutor for an explanation, not just an answer',
      phase: 'reviewing',
      yes_count: 149,
      no_count: 91,
      yes_pct: 62,
      walked: 240,
      total_target: 600,
      disagreement_pct: 8,
      overlap_count: 150,
      updated_at: '2026-05-08T14:30:00Z',
      weekly_sparkline: [65, 58, 71, 68, 62, 55, 60, 63],
    },
    {
      run_id: 2,
      label_name: 'confusion',
      description: 'student signals they are stuck or lost',
      phase: 'labeling',
      yes_count: 61,
      no_count: 119,
      yes_pct: 34,
      walked: 180,
      total_target: 400,
      disagreement_pct: 21,
      overlap_count: 120,
      updated_at: '2026-05-09T09:12:00Z',
      weekly_sparkline: [22, 28, 35, 32, 38, 42, 40, 34],
    },
    {
      run_id: 3,
      label_name: 'off-topic',
      description: 'chat unrelated to the course',
      phase: 'complete',
      yes_count: 40,
      no_count: 180,
      yes_pct: 18,
      walked: 220,
      total_target: 220,
      disagreement_pct: 4,
      overlap_count: 220,
      updated_at: '2026-04-22T17:55:00Z',
      weekly_sparkline: [15, 18, 19, 17, 16, 18, 20, 18],
    },
  ],
}
```

- [ ] **Step 3: Append the run-detail fixture**

In the same file, append:

```ts
export const mockSingleLabelRunDetail: SingleLabelRunDetail = {
  run: {
    id: 1,
    label_name: 'help-seeking',
    description: 'asking the tutor for an explanation, not just an answer',
    phase: 'reviewing',
    updated_at: '2026-05-08T14:30:00Z',
    walked: 240,
    total_target: 600,
    yes_pct: 62,
    conv_yes_pct: 38,
  },
  ai_coverage: {
    covered: 222,
    total: 2180,
    pct: 10,
  },
  agreement_by_confidence: {
    buckets: [
      { lo: 0.0, hi: 0.2, overlap_count: 32, agree: 29, agreement_rate: 91 },
      { lo: 0.2, hi: 0.4, overlap_count: 25, agree: 19, agreement_rate: 76 },
      { lo: 0.4, hi: 0.6, overlap_count: 18, agree: 10, agreement_rate: 55 },
      { lo: 0.6, hi: 0.8, overlap_count: 30, agree: 26, agreement_rate: 87 },
      { lo: 0.8, hi: 1.0, overlap_count: 45, agree: 43, agreement_rate: 96 },
    ],
  },
  confidence_histogram: {
    bins: [
      { lo: 0.0, hi: 0.1, count: 32, yes: 8,  no: 24 },
      { lo: 0.1, hi: 0.2, count: 28, yes: 5,  no: 23 },
      { lo: 0.2, hi: 0.3, count: 21, yes: 4,  no: 17 },
      { lo: 0.3, hi: 0.4, count: 12, yes: 3,  no: 9  },
      { lo: 0.4, hi: 0.5, count: 8,  yes: 4,  no: 4  },
      { lo: 0.5, hi: 0.6, count: 9,  yes: 5,  no: 4  },
      { lo: 0.6, hi: 0.7, count: 14, yes: 10, no: 4  },
      { lo: 0.7, hi: 0.8, count: 22, yes: 18, no: 4  },
      { lo: 0.8, hi: 0.9, count: 35, yes: 32, no: 3  },
      { lo: 0.9, hi: 1.0, count: 41, yes: 40, no: 1  },
    ],
    coverage: { with_confidence: 222, total_ai: 222 },
  },
  disagreement: {
    overlap_count: 150,
    agree: 138,
    disagree: 12,
    rate: 8,
    breakdown: { ai_yes_human_no: 5, ai_no_human_yes: 7 },
  },
  by_assignment: [
    { key: 'Lab 1 — Probability',     yes: 33, no: 9,  yes_pct: 78 },
    { key: 'Lab 2 — DataFrames',      yes: 27, no: 11, yes_pct: 71 },
    { key: 'Final Project',           yes: 18, no: 10, yes_pct: 64 },
    { key: 'Lab 5 — Hypothesis',      yes: 18, no: 13, yes_pct: 58 },
    { key: 'Midterm',                 yes: 13, no: 11, yes_pct: 52 },
    { key: 'Lab 3 — Visualization',   yes: 13, no: 14, yes_pct: 49 },
    { key: 'Lab 4 — Regression',      yes: 9,  no: 13, yes_pct: 41 },
    { key: 'Concept Check',           yes: 6,  no: 22, yes_pct: 23 },
  ],
  by_position: [
    { bucket: 'early', yes: 77, no: 31, yes_pct: 71 },
    { bucket: 'mid',   yes: 59, no: 33, yes_pct: 64 },
    { bucket: 'late',  yes: 19, no: 21, yes_pct: 48 },
  ],
  weekly: [
    { week_start: '2026-03-09', yes: 8,  no: 4,  yes_pct: 65 },
    { week_start: '2026-03-16', yes: 10, no: 8,  yes_pct: 58 },
    { week_start: '2026-03-23', yes: 16, no: 6,  yes_pct: 71 },
    { week_start: '2026-03-30', yes: 19, no: 9,  yes_pct: 68 },
    { week_start: '2026-04-06', yes: 19, no: 12, yes_pct: 62 },
    { week_start: '2026-04-13', yes: 16, no: 13, yes_pct: 55 },
    { week_start: '2026-04-20', yes: 16, no: 10, yes_pct: 60 },
    { week_start: '2026-04-27', yes: 15, no: 9,  yes_pct: 63 },
  ],
  examples: {
    yes: [
      { message_id: 101, chatlog_id: 11, message_index: 4, text: "I'm not sure what bool_array does — can you explain again?", ai_pred: 'yes', ai_confidence: 0.91, human_decision: 'yes', assignment: 'Lab 2', position_bucket: 'mid', created_at: '2026-04-10T12:00:00Z', flag: null },
      { message_id: 102, chatlog_id: 12, message_index: 5, text: 'Why does .groupby() return a different result for sum vs mean here?', ai_pred: 'yes', ai_confidence: 0.84, human_decision: 'yes', assignment: 'Lab 5', position_bucket: 'mid', created_at: '2026-04-12T15:30:00Z', flag: null },
      { message_id: 103, chatlog_id: 13, message_index: 1, text: 'I keep getting a KeyError on this DataFrame — what am I doing wrong?', ai_pred: 'yes', ai_confidence: 0.78, human_decision: 'yes', assignment: 'Lab 2', position_bucket: 'early', created_at: '2026-04-13T09:00:00Z', flag: null },
    ],
    no: [
      { message_id: 201, chatlog_id: 21, message_index: 9, text: 'Thanks, that worked!', ai_pred: 'no', ai_confidence: 0.02, human_decision: 'no', assignment: 'Final', position_bucket: 'late', created_at: '2026-04-15T11:00:00Z', flag: null },
      { message_id: 202, chatlog_id: 22, message_index: 0, text: 'Make this plot blue.', ai_pred: 'no', ai_confidence: 0.08, human_decision: 'no', assignment: 'Lab 3', position_bucket: 'early', created_at: '2026-04-16T13:00:00Z', flag: null },
      { message_id: 203, chatlog_id: 23, message_index: 2, text: 'Can you write the code for me?', ai_pred: 'no', ai_confidence: 0.12, human_decision: 'no', assignment: 'Concept', position_bucket: 'early', created_at: '2026-04-17T14:00:00Z', flag: null },
    ],
    edge: [
      { message_id: 301, chatlog_id: 31, message_index: 4, text: "What does it mean when something is 'closed under' an operation?", ai_pred: 'no', ai_confidence: 0.51, human_decision: 'yes', assignment: 'Lab 1', position_bucket: 'mid', created_at: '2026-04-18T10:00:00Z', flag: 'low_confidence' },
      { message_id: 302, chatlog_id: 32, message_index: 1, text: 'Should I use .loc or .iloc here?',                            ai_pred: 'no', ai_confidence: 0.42, human_decision: 'yes', assignment: 'Lab 2', position_bucket: 'early', created_at: '2026-04-19T11:00:00Z', flag: 'human_overruled' },
    ],
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add src/mocks/index.ts
git commit -m "feat(mocks): add single-label cohort and run-detail fixtures"
```

---

### Task 4: Add api.ts methods for single-label endpoints

**Files:**
- Modify: `src/services/api.ts`
- Test: covered indirectly by component tests in Phase 2 (no separate api.test.ts in this codebase)

- [ ] **Step 1: Inspect existing api.ts mock pattern**

Read `src/services/api.ts`. Find an existing method like `getAnalysisSummary()`. Note the mock-mode pattern (look for `import.meta.env.VITE_USE_MOCK` or similar) and copy that exact pattern for the new methods.

- [ ] **Step 2: Add `getSingleLabelCohort`**

In `src/services/api.ts`, alongside the other analysis methods, add:

```ts
async getSingleLabelCohort(): Promise<SingleLabelCohortResponse> {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { mockSingleLabelCohort } = await import('../mocks')
    return mockSingleLabelCohort
  }
  const res = await fetch('/api/analysis/single-label/cohort')
  if (!res.ok) throw new Error(`Failed to load single-label cohort: ${res.status}`)
  return res.json()
},
```

If `getAnalysisSummary` uses a different mock pattern (e.g., wrapping with `withMock(...)`), adjust the snippet to match exactly. The function name and return type must stay as above.

- [ ] **Step 3: Add `getSingleLabelRunDetail`**

In the same api object:

```ts
async getSingleLabelRunDetail(runId: number): Promise<SingleLabelRunDetail> {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { mockSingleLabelRunDetail } = await import('../mocks')
    return mockSingleLabelRunDetail
  }
  const res = await fetch(`/api/analysis/single-label/runs/${runId}`)
  if (!res.ok) throw new Error(`Failed to load run detail: ${res.status}`)
  return res.json()
},
```

- [ ] **Step 4: Add `getMilestones`**

```ts
async getMilestones(course?: string): Promise<AssignmentMilestone[]> {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    return []
  }
  const qs = course ? `?course=${encodeURIComponent(course)}` : ''
  const res = await fetch(`/api/analysis/milestones${qs}`)
  if (!res.ok) {
    if (res.status === 404) return []
    throw new Error(`Failed to load milestones: ${res.status}`)
  }
  return res.json()
},
```

- [ ] **Step 5: Update imports at top of api.ts**

Add to the type imports at the top:

```ts
import type {
  SingleLabelCohortResponse,
  SingleLabelRunDetail,
  AssignmentMilestone,
} from '../types'
```

(Merge into the existing `import type { … } from '../types'` line if one exists.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/api.ts
git commit -m "feat(api): add single-label cohort, run-detail, and milestones methods"
```

---

## Phase 2 — Frontend single-label view (against mock data)

### Task 5: ~~SectionMark shared component~~ — REMOVED in r2

The app-native layout uses `chart-card` headers (small title + italic sub-caption), not `§ N ·` section ornaments. Skip this task entirely; do not create `src/pages/analysis/single-label/SectionMark.tsx`.

> **Original task below kept for reference only — do not implement:**

**Files:**
- Create: `src/pages/analysis/single-label/SectionMark.tsx`

- [ ] **Step 1: Write the component (no separate test — exercised by parent tests)**

```tsx
type Props = {
  glyph: string;       // e.g. "§ 1 ·"
  title: string;       // e.g. "Label health"
};

export function SectionMark({ glyph, title }: Props) {
  return (
    <div className="flex items-baseline gap-3.5 mb-7">
      <span className="text-[13px] italic text-ochre tracking-[0.02em]">{glyph}</span>
      <h2 className="text-[26px] font-medium tracking-[-0.012em] text-on-canvas">{title}</h2>
      <span className="flex-1 h-px bg-edge-strong translate-y-[-6px]" />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/analysis/single-label/SectionMark.tsx
git commit -m "feat(analysis): add SectionMark shared component"
```

---

### Task 6: SingleLabelAnalysis shell — split-pane layout

> **r2 revision:** This task replaced the r1 "two-tab page with URL state" approach. The new shell is a **split-pane single viewport**: 304px cohort rail on the left + run-detail pane on the right. **No top-level tabs.** Run selection lives in URL as `?run_id=<id>` (no `?view=` param). Sub-tabs (`Label health` / `Findings`) live inside `RunDetailPane` as component state, not routed. Reference: `mockups/analysis-redesign/app-native/index.html` — the body inside `.app > .main` is what this component renders.
>
> The r1 code samples below describe the wrong structure (top-level tabs, masthead, "Findings" h1). **Discard them** and implement against the mockup instead. The test patterns (vi.mock, ModeProvider wrap, beforeEach) and the file path (`src/pages/analysis/SingleLabelAnalysis.tsx`) stay the same. Replace the test cases with:
>
> - `renders cohort rail and run-detail pane simultaneously` — both `getByRole('list')` (rail) and the run name should be in the document after data loads.
> - `selects most-recent run by default when no run_id in URL` — first call to `getSingleLabelRunDetail` should be with the cohort's most-recent run.
> - `updates URL when a different cohort entry is clicked` — `?run_id=...` should change.
> - `does NOT set ?view= param` — confirm no top-level tab routing.
>
> Replace the implementation with the structure shown in the mockup: top-bar mode toggle, then `.main` grid with `grid-template-columns: 304px 1fr`, mounting `<CohortRail />` and `<RunDetailPane />`.

Replaces the placeholder created in Task 2. Owns the masthead, title, and tab switching via `useSearchParams`.

**Files:**
- Modify: `src/pages/analysis/SingleLabelAnalysis.tsx`
- Test: `src/tests/SingleLabelAnalysis.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/SingleLabelAnalysis.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SingleLabelAnalysis } from '../pages/analysis/SingleLabelAnalysis'
import { api } from '../services/api'
import { mockSingleLabelCohort, mockSingleLabelRunDetail } from '../mocks'

vi.mock('../services/api', () => ({
  api: {
    getSingleLabelCohort: vi.fn(),
    getSingleLabelRunDetail: vi.fn(),
  },
}))

const mocked = api as {
  getSingleLabelCohort: ReturnType<typeof vi.fn>
  getSingleLabelRunDetail: ReturnType<typeof vi.fn>
}

function renderAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="/analysis" element={<SingleLabelAnalysis />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mocked.getSingleLabelCohort.mockResolvedValue(mockSingleLabelCohort)
  mocked.getSingleLabelRunDetail.mockResolvedValue(mockSingleLabelRunDetail)
})

test('defaults to cohort tab when no query params', async () => {
  renderAt('/analysis')
  expect(await screen.findByRole('tab', { name: /Cohort overview/i })).toHaveAttribute('aria-selected', 'true')
})

test('selects run-detail tab when ?view=run', async () => {
  renderAt('/analysis?view=run&run_id=1')
  expect(await screen.findByRole('tab', { name: /Run detail/i })).toHaveAttribute('aria-selected', 'true')
})

test('renders editorial masthead', async () => {
  renderAt('/analysis')
  expect(await screen.findByText(/CHATSIGHT/i)).toBeInTheDocument()
  expect(screen.getByText(/FINDINGS/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SingleLabelAnalysis`
Expected: FAIL — `SingleLabelAnalysis` is a placeholder; tabs don't exist yet.

- [ ] **Step 3: Implement the shell**

Replace `src/pages/analysis/SingleLabelAnalysis.tsx` entirely with:

```tsx
import { useSearchParams } from 'react-router-dom'
import { CohortTab } from './single-label/CohortTab'
import { RunDetailTab } from './single-label/RunDetailTab'

export function SingleLabelAnalysis() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'run' ? 'run' : 'cohort'
  const runId = Number(params.get('run_id') ?? '0') || null

  const setView = (next: 'cohort' | 'run', nextRunId?: number) => {
    const update = new URLSearchParams(params)
    update.set('view', next)
    if (next === 'run' && nextRunId != null) update.set('run_id', String(nextRunId))
    if (next === 'cohort') update.delete('run_id')
    setParams(update, { replace: false })
  }

  const today = new Date().toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
  }).toUpperCase().replace(/, /g, ' · ').replace(/\s/g, ' · ')

  return (
    <main className="max-w-[920px] mx-auto px-14 pt-18 pb-30 font-serif text-on-canvas">
      <header className="flex items-baseline justify-between pb-3.5 border-b border-edge-warm text-stone text-[12px]">
        <div className="flex items-baseline gap-3.5">
          <span className="inline-block w-[5px] h-[5px] rounded-full bg-ochre translate-y-[-2px]" />
          <span className="tracking-[0.08em]">CHATSIGHT · FINDINGS</span>
          <span className="italic">Vol. I · single-label runs</span>
        </div>
        <span className="italic">compiled {today}</span>
      </header>

      <div className="pt-9 pb-4">
        <h1 className="text-[56px] leading-[1.02] tracking-[-0.022em] font-medium">
          Findings <span className="text-ochre italic font-normal">&amp;</span> label health
        </h1>
        <p className="italic text-[17px] text-tertiary max-w-[560px] mt-2.5">
          A reading view for single-label runs — how decisively the model marks a concept,
          where it disagrees with you, and what the data says when looked at sideways.
        </p>
      </div>

      <nav className="flex gap-8 pt-7 border-b border-edge-warm" role="tablist" aria-label="Analysis views">
        <TabButton
          selected={view === 'cohort'}
          glyph="§ I"
          label="Cohort overview"
          onClick={() => setView('cohort')}
        />
        <TabButton
          selected={view === 'run'}
          glyph="§ II"
          label="Run detail"
          onClick={() => setView('run', runId ?? undefined)}
        />
      </nav>

      <section className="pt-11" hidden={view !== 'cohort'} aria-hidden={view !== 'cohort'} role="tabpanel">
        {view === 'cohort' && (
          <CohortTab onSelectRun={(id) => setView('run', id)} />
        )}
      </section>
      <section className="pt-11" hidden={view !== 'run'} aria-hidden={view !== 'run'} role="tabpanel">
        {view === 'run' && (
          <RunDetailTab runId={runId} onPickRun={(id) => setView('run', id)} />
        )}
      </section>
    </main>
  )
}

function TabButton(props: {
  selected: boolean
  glyph: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      onClick={props.onClick}
      className={`appearance-none bg-transparent border-0 pb-3.5 -mb-px font-serif text-[15px] cursor-pointer ${
        props.selected
          ? 'text-on-canvas border-b-[1.5px] border-ochre'
          : 'text-stone hover:text-on-canvas'
      }`}
    >
      <span className="text-[12px] italic text-ochre-dim mr-1.5">{props.glyph}</span>
      {props.label}
    </button>
  )
}
```

- [ ] **Step 4: Create stub CohortTab and RunDetailTab so the shell compiles**

Create `src/pages/analysis/single-label/CohortTab.tsx`:

```tsx
export function CohortTab(_props: { onSelectRun: (runId: number) => void }) {
  return <div className="italic text-stone">CohortTab placeholder</div>
}
```

Create `src/pages/analysis/single-label/RunDetailTab.tsx`:

```tsx
export function RunDetailTab(_props: { runId: number | null; onPickRun: (runId: number) => void }) {
  return <div className="italic text-stone">RunDetailTab placeholder</div>
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- SingleLabelAnalysis`
Expected: PASS (all three).

Also re-run: `npm test -- AnalysisPage`
Expected: PASS (the mode dispatcher still routes correctly).

- [ ] **Step 6: Manual smoke test**

`VITE_USE_MOCK=true npm run dev` and visit `http://localhost:5173/analysis` in single-label mode. Confirm masthead, title, and both tabs render. Click each tab; the URL should switch between `?view=cohort` and `?view=run`. Reload on the run tab — the URL state persists.

- [ ] **Step 7: Commit**

```bash
git add src/pages/analysis/SingleLabelAnalysis.tsx src/pages/analysis/single-label/CohortTab.tsx src/pages/analysis/single-label/RunDetailTab.tsx src/tests/SingleLabelAnalysis.test.tsx
git commit -m "feat(analysis): single-label page shell with URL-driven tabs"
```

---

### Task 7: CohortRail — left rail with sparklines (renamed from CohortTab in r2)

> **r2 revision:** Renamed from `CohortTab` to `CohortRail` and renamed the test file accordingly (`src/tests/CohortRail.test.tsx`). The component is now a **vertical 304px-wide list**, not a wide ledger table. Each entry follows the structure in the mockup's `.rail-entry`:
>
> - `.name` (serif 14.5px) + 1-line `.desc`
> - `.meta` row with three pills: yes%, disagreement% (brick if ≥15%), walked/target
> - `.status-row` with phase indicator on left + `<RailSparkline />` (88×18px) on right
> - Selected entry gets a 2px ochre left border
> - A filter `<input>` at the top of the rail filters entries by name substring (client-side)
>
> The r1 ledger-table code below is the wrong shape. **Replace it** with a `<ul>` of `<li class="rail-entry">` elements styled like the mockup. The test cases stay structurally the same (renders rows, shows tabular metrics, underlines high disagreement, clicking calls `onSelectRun`, empty state) but the assertion DOM is the rail markup, not a `<table>`. The component prop is `onSelectRun: (runId: number) => void` — unchanged.
>
> Also add a new test: `renders a sparkline per entry` — `expect(container.querySelectorAll('.rail-spark')).toHaveLength(rows.length)`.

> **Original r1 task below kept for reference only:**

**Files:**
- Modify: `src/pages/analysis/single-label/CohortTab.tsx`
- Test: `src/tests/CohortTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/CohortTab.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CohortTab } from '../pages/analysis/single-label/CohortTab'
import { api } from '../services/api'
import { mockSingleLabelCohort } from '../mocks'

vi.mock('../services/api', () => ({
  api: { getSingleLabelCohort: vi.fn() },
}))
const mocked = api as { getSingleLabelCohort: ReturnType<typeof vi.fn> }

beforeEach(() => {
  mocked.getSingleLabelCohort.mockResolvedValue(mockSingleLabelCohort)
})

test('renders one row per run', async () => {
  render(<CohortTab onSelectRun={() => {}} />)
  await waitFor(() => expect(screen.getByText('help-seeking')).toBeInTheDocument())
  expect(screen.getByText('confusion')).toBeInTheDocument()
  expect(screen.getByText('off-topic')).toBeInTheDocument()
})

test('shows tabular yes-pct, disagree, walked/target', async () => {
  render(<CohortTab onSelectRun={() => {}} />)
  await waitFor(() => screen.getByText('help-seeking'))
  expect(screen.getByText('62')).toBeInTheDocument()        // yes_pct
  expect(screen.getByText('8')).toBeInTheDocument()         // disagreement_pct
  expect(screen.getByText('240')).toBeInTheDocument()       // walked
})

test('underlines disagreement >= 15%', async () => {
  render(<CohortTab onSelectRun={() => {}} />)
  await waitFor(() => screen.getByText('confusion'))
  const cell = screen.getByText('21').closest('td')
  expect(cell?.querySelector('[data-warn="true"]')).not.toBeNull()
})

test('clicking a row calls onSelectRun with run_id', async () => {
  const onSelect = vi.fn()
  render(<CohortTab onSelectRun={onSelect} />)
  await waitFor(() => screen.getByText('help-seeking'))
  fireEvent.click(screen.getByText('help-seeking').closest('tr')!)
  expect(onSelect).toHaveBeenCalledWith(1)
})

test('shows empty state when no runs', async () => {
  mocked.getSingleLabelCohort.mockResolvedValue({ runs: [] })
  render(<CohortTab onSelectRun={() => {}} />)
  await waitFor(() => expect(screen.getByText(/no single-label runs yet/i)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CohortTab`
Expected: FAIL — placeholder doesn't render any of these.

- [ ] **Step 3: Implement CohortTab**

Replace `src/pages/analysis/single-label/CohortTab.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import type { SingleLabelCohortRow } from '../../../types'

const DISAGREE_THRESHOLD = 15  // %

type Props = {
  onSelectRun: (runId: number) => void
}

export function CohortTab({ onSelectRun }: Props) {
  const [rows, setRows] = useState<SingleLabelCohortRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.getSingleLabelCohort()
      .then((res) => { if (alive) setRows(res.runs) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  if (error) return <p className="italic text-brick">— {error}</p>
  if (rows === null) return <p className="italic text-stone">— loading runs</p>
  if (rows.length === 0) {
    return <p className="italic text-stone">— no single-label runs yet.</p>
  }

  return (
    <>
      <p className="text-tertiary italic text-[15px] mb-7 max-w-[560px]">
        {rows.length === 1 ? 'One run' : `${rows.length} runs`} across the term.{' '}
        <em>Yes&nbsp;%</em> reads as the rate among messages the instructor has decided.{' '}
        <em>Disagree&nbsp;%</em> is on the overlap where both a human decision and an AI prediction exist.
      </p>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th align="left">Label</Th>
            <Th align="right">Yes %</Th>
            <Th align="right">Disagree</Th>
            <Th align="right">Walked</Th>
            <Th align="right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Row key={r.run_id} row={r} index={i} onClick={() => onSelectRun(r.run_id)} />
          ))}
        </tbody>
      </table>

      <p className="mt-5 italic text-[13px] text-stone">
        <span className="text-ochre-dim">→</span> Click a row to open run detail.
        Disagreement above {DISAGREE_THRESHOLD}% is underlined — usually a sign the definition is drifting.
      </p>
    </>
  )
}

function Th(props: { align: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <th
      className={`pb-3 border-b border-edge-strong font-normal italic text-[12px] text-stone tracking-[0.02em] ${
        props.align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {props.children}
    </th>
  )
}

function Row({ row, index, onClick }: { row: SingleLabelCohortRow; index: number; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-b border-edge-warm hover:bg-edge-warm/40 transition-colors group"
      style={{ animation: `rowIn 360ms ease ${40 + index * 40}ms backwards` }}
    >
      <td className="py-5 pr-4 align-baseline">
        <div className="text-[22px] tracking-[-0.012em] text-on-canvas">{row.label_name}</div>
        {row.description && (
          <div className="mt-0.5 text-[11.5px] italic text-stone">{row.description}</div>
        )}
      </td>
      <NumCell value={row.yes_pct} unit="%" />
      <NumCell value={row.disagreement_pct ?? null} unit="%" warn={(row.disagreement_pct ?? 0) >= DISAGREE_THRESHOLD} />
      <NumCell value={row.walked} unit={row.total_target ? `/${row.total_target}` : ''} />
      <td className="py-5 pr-0 align-baseline text-right">
        <StatusRule phase={row.phase} />
        <span className="text-[11.5px] italic text-stone ml-2.5">{row.phase}</span>
      </td>
      <style>{`
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0);  }
        }
      `}</style>
    </tr>
  )
}

function NumCell({ value, unit, warn }: { value: number | null; unit: string; warn?: boolean }) {
  return (
    <td className="py-5 pr-4 align-baseline text-right">
      <span
        data-warn={warn ? 'true' : undefined}
        className={`text-[17px] text-on-canvas tabular-nums ${
          warn ? 'border-b border-brick pb-px' : ''
        }`}
        style={{ fontFeatureSettings: '"tnum", "smcp"' }}
      >
        {value === null ? '—' : value}
        {value !== null && unit && <span className="ml-0.5 text-[11px] text-stone align-top">{unit}</span>}
      </span>
    </td>
  )
}

function StatusRule({ phase }: { phase: SingleLabelCohortRow['phase'] }) {
  if (phase === 'complete')  return <span className="inline-block w-14 h-px bg-moss align-[4px]" />
  if (phase === 'labeling')  return <span className="inline-block w-14 h-px bg-ochre align-[4px]" />
  if (phase === 'reviewing') return <span className="inline-block w-14 border-t border-dotted border-ochre align-[4px]" />
  return <span className="inline-block w-14 h-px bg-stone/50 align-[4px]" />
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- CohortTab`
Expected: PASS (all five).

- [ ] **Step 5: Manual aesthetic check**

`VITE_USE_MOCK=true npm run dev`, navigate to `/analysis` in single-label mode. Verify:
- Label name is in the display serif at 22px
- Numbers align in a column (tabular nums)
- `21%` on the confusion row is underlined in brick (warning)
- Status rules: dotted ochre for reviewing, solid moss for complete, solid ochre for labeling
- Row hover applies a faint warm background; cursor is a pointer
- Rows reveal with staggered fade-in on first paint

- [ ] **Step 6: Commit**

```bash
git add src/pages/analysis/single-label/CohortTab.tsx src/tests/CohortTab.test.tsx
git commit -m "feat(analysis): cohort tab — ledger-style single-label comparison"
```

---

### Task 7a: RailSparkline (NEW in r2)

A tiny SVG component that renders a per-run weekly yes-rate trendline inside each cohort rail entry.

**Files:**
- Create: `src/pages/analysis/single-label/RailSparkline.tsx`

- [ ] **Step 1: Implement (no separate test — exercised by CohortRail test)**

```tsx
type Props = {
  values: number[]   // 0–100, oldest → newest, ≤ 8 entries
}

export function RailSparkline({ values }: Props) {
  if (values.length < 2) {
    return <svg className="rail-spark" viewBox="0 0 88 18" aria-hidden="true" />
  }
  const w = 88
  const h = 18
  const pad = 2
  const inner = w - pad * 2
  const innerH = h - pad * 2
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const stepX = inner / Math.max(values.length - 1, 1)
  const points = values
    .map((v, i) => {
      const x = pad + i * stepX
      const y = h - pad - ((v - min) / range) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="rail-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline className="line" points={points} />
    </svg>
  )
}
```

The matching CSS (added once globally, e.g. in `index.css` or the component's neighbor stylesheet):

```css
.rail-spark { width: 88px; height: 18px; display: block; flex: none; }
.rail-spark .line { fill: none; stroke: var(--app-moss); stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
```

- [ ] **Step 2: Type-check & commit**

```bash
npx tsc --noEmit
git add src/pages/analysis/single-label/RailSparkline.tsx
git commit -m "feat(analysis): RailSparkline for cohort rail entries"
```

---

### Task 7b: CoverageCard (NEW in r2)

Sidebar card on the Health sub-tab showing what fraction of the message pool the AI has predicted on.

**Files:**
- Create: `src/pages/analysis/single-label/CoverageCard.tsx`
- Test: `src/tests/CoverageCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { CoverageCard } from '../pages/analysis/single-label/CoverageCard'

test('renders pct, fraction, and legend', () => {
  render(<CoverageCard coverage={{ covered: 222, total: 2180, pct: 10 }} />)
  expect(screen.getByText('10')).toBeInTheDocument()
  expect(screen.getByText('222 / 2,180')).toBeInTheDocument()
  expect(screen.getByText(/AI/i)).toBeInTheDocument()
  expect(screen.getByText(/UNCOV/i)).toBeInTheDocument()
})

test('renders 0% empty state', () => {
  render(<CoverageCard coverage={{ covered: 0, total: 100, pct: 0 }} />)
  expect(screen.getByText('0')).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement**

```tsx
import type { SingleLabelRunDetail } from '../../../types'

type Props = { coverage: SingleLabelRunDetail['ai_coverage'] }

const fmt = (n: number) => n.toLocaleString('en-US')

export function CoverageCard({ coverage }: Props) {
  const uncov = Math.max(coverage.total - coverage.covered, 0)
  return (
    <div className="chart-card coverage-card">
      <div className="card-head">
        <div className="card-title">AI coverage</div>
      </div>
      <div className="row">
        <span className="v">{coverage.pct}<span className="pct">%</span></span>
        <span className="frac">{fmt(coverage.covered)} / {fmt(coverage.total)}</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${coverage.pct}%` }} />
      </div>
      <div className="legend-row">
        <span className="seg"><span className="sw cov" />AI <span className="v">{fmt(coverage.covered)}</span></span>
        <span className="seg"><span className="sw unc" />UNCOV <span className="v">{fmt(uncov)}</span></span>
      </div>
    </div>
  )
}
```

Styling lives in the same stylesheet as `.chart-card` (defined in the SingleLabelAnalysis-scoped CSS) — see the mockup for the exact class names.

- [ ] **Step 3: Run test & commit**

```bash
npm test -- CoverageCard
git add src/pages/analysis/single-label/CoverageCard.tsx src/tests/CoverageCard.test.tsx
git commit -m "feat(analysis): CoverageCard"
```

---

### Task 7c: AgreementByConfidence (NEW in r2)

Sidebar card with five vertical bars showing human–AI agreement rate at each confidence bucket.

**Files:**
- Create: `src/pages/analysis/single-label/AgreementByConfidence.tsx`
- Test: `src/tests/AgreementByConfidence.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { AgreementByConfidence } from '../pages/analysis/single-label/AgreementByConfidence'

const buckets = [
  { lo: 0.0, hi: 0.2, overlap_count: 32, agree: 29, agreement_rate: 91 },
  { lo: 0.2, hi: 0.4, overlap_count: 25, agree: 19, agreement_rate: 76 },
  { lo: 0.4, hi: 0.6, overlap_count: 18, agree: 10, agreement_rate: 55 },
  { lo: 0.6, hi: 0.8, overlap_count: 30, agree: 26, agreement_rate: 87 },
  { lo: 0.8, hi: 1.0, overlap_count: 45, agree: 43, agreement_rate: 96 },
]

test('renders five bars with axis labels', () => {
  render(<AgreementByConfidence buckets={buckets} />)
  expect(screen.getAllByTestId('agreement-bar')).toHaveLength(5)
  expect(screen.getByText('.0–.2')).toBeInTheDocument()
  expect(screen.getByText('.8–1')).toBeInTheDocument()
})

test('uses brick color when rate < 65%', () => {
  render(<AgreementByConfidence buckets={buckets} />)
  const middleBar = screen.getAllByTestId('agreement-bar')[2]
  expect(middleBar.className).toMatch(/weak/)
})

test('empty-bucket bar renders without a value label', () => {
  const empty = [...buckets]
  empty[2] = { lo: 0.4, hi: 0.6, overlap_count: 0, agree: 0, agreement_rate: null }
  render(<AgreementByConfidence buckets={empty} />)
  expect(screen.queryByText('55%')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Implement**

```tsx
import type { AgreementBucket } from '../../../types'

type Props = { buckets: AgreementBucket[] }

const LABELS = ['.0–.2', '.2–.4', '.4–.6', '.6–.8', '.8–1']

function fillClass(rate: number | null): string {
  if (rate === null) return ''
  if (rate >= 80) return ''        // default moss
  if (rate >= 65) return 'mid'     // ochre
  return 'weak'                    // brick
}

function gloss(buckets: AgreementBucket[]): string {
  const valid = buckets.filter((b) => b.agreement_rate !== null)
  if (valid.length < 3) return ''
  const edges = (valid[0].agreement_rate! + valid[valid.length - 1].agreement_rate!) / 2
  const middle = valid.slice(1, -1).reduce((s, b) => s + (b.agreement_rate ?? 0), 0) / (valid.length - 2)
  if (edges > 80 && middle < 65) return 'Most trustworthy at the extremes — the middle bin is a coin flip.'
  if (middle >= 80) return 'Agreement holds across the range.'
  return 'Confidence is loosely correlated with agreement.'
}

export function AgreementByConfidence({ buckets }: Props) {
  return (
    <div className="chart-card agreement-card">
      <div className="card-head">
        <div className="card-title">Agreement by confidence</div>
      </div>
      <div className="bars">
        {buckets.map((b, i) => (
          <div key={i} className="bar-col">
            <div
              data-testid="agreement-bar"
              className={`bar-fill ${fillClass(b.agreement_rate)}`}
              style={{ height: `${b.agreement_rate ?? 0}%`, animationDelay: `${i * 40}ms` }}
            />
            {b.agreement_rate !== null && <div className="bar-val">{b.agreement_rate}%</div>}
          </div>
        ))}
      </div>
      <div className="x-axis">
        {LABELS.map((l) => <span key={l}>{l}</span>)}
      </div>
      <div className="gloss">{gloss(buckets)}</div>
    </div>
  )
}
```

- [ ] **Step 3: Run test & commit**

```bash
npm test -- AgreementByConfidence
git add src/pages/analysis/single-label/AgreementByConfidence.tsx src/tests/AgreementByConfidence.test.tsx
git commit -m "feat(analysis): AgreementByConfidence chart"
```

---

### Task 8: ConfidenceHistogram

**Files:**
- Create: `src/pages/analysis/single-label/ConfidenceHistogram.tsx`
- Test: `src/tests/ConfidenceHistogram.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { ConfidenceHistogram } from '../pages/analysis/single-label/ConfidenceHistogram'
import { mockSingleLabelRunDetail } from '../mocks'

test('renders 10 bins with correct yes/no breakdown', () => {
  render(<ConfidenceHistogram histogram={mockSingleLabelRunDetail.confidence_histogram} />)
  const bins = screen.getAllByTestId('hist-bin')
  expect(bins).toHaveLength(10)
})

test('shows axis ticks .0 through .9', () => {
  render(<ConfidenceHistogram histogram={mockSingleLabelRunDetail.confidence_histogram} />)
  expect(screen.getByText('.0')).toBeInTheDocument()
  expect(screen.getByText('.9')).toBeInTheDocument()
})

test('shows empty state when no AI rows', () => {
  render(<ConfidenceHistogram histogram={{ bins: [], coverage: { with_confidence: 0, total_ai: 0 } }} />)
  expect(screen.getByText(/no AI predictions yet/i)).toBeInTheDocument()
})

test('shows coverage footnote when some AI rows lack confidence', () => {
  render(
    <ConfidenceHistogram
      histogram={{
        bins: mockSingleLabelRunDetail.confidence_histogram.bins,
        coverage: { with_confidence: 220, total_ai: 250 },
      }}
    />
  )
  expect(screen.getByText(/30 AI rows lacking confidence excluded/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ConfidenceHistogram`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement ConfidenceHistogram**

```tsx
import type { ConfidenceBin } from '../../../types'

type Props = {
  histogram: {
    bins: ConfidenceBin[]
    coverage: { with_confidence: number; total_ai: number }
  }
}

export function ConfidenceHistogram({ histogram }: Props) {
  const { bins, coverage } = histogram

  if (bins.length === 0 || coverage.total_ai === 0) {
    return <p className="italic text-stone">— no AI predictions yet for this run.</p>
  }

  const max = Math.max(...bins.map((b) => b.count), 1)
  const excluded = coverage.total_ai - coverage.with_confidence

  return (
    <>
      <div className="grid grid-cols-10 gap-2 items-end h-[180px] mt-2" role="img" aria-label="Confidence histogram">
        {bins.map((b, i) => {
          const stackH = (b.count / max) * 100
          const yesShare = b.count === 0 ? 0 : (b.yes / b.count) * 100
          const noShare = 100 - yesShare
          return (
            <div key={i} data-testid="hist-bin" className="flex flex-col justify-end">
              <div
                className="flex flex-col origin-bottom"
                style={{
                  height: `${stackH}%`,
                  animation: `barIn 600ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 30}ms backwards`,
                }}
              >
                <div className="bg-brick" style={{ height: `${noShare}%` }} />
                <div className="bg-moss"  style={{ height: `${yesShare}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-10 gap-2 mt-2.5 pt-2 border-t border-edge-warm">
        {bins.map((_, i) => (
          <span
            key={i}
            className="text-[10px] text-stone text-center tabular-nums tracking-[0.04em]"
          >
            {`.${i}`}
          </span>
        ))}
      </div>
      <p className="mt-3.5 italic text-[13px] text-tertiary flex gap-4 items-baseline">
        <span>{describeShape(bins)}</span>
        <span className="not-italic text-[11px] text-stone tracking-[0.04em]">
          <span className="inline-block w-2.5 h-2.5 bg-moss mr-1.5 align-middle" />YES
        </span>
        <span className="not-italic text-[11px] text-stone tracking-[0.04em]">
          <span className="inline-block w-2.5 h-2.5 bg-brick mr-1.5 align-middle" />NO
        </span>
      </p>
      {excluded > 0 && (
        <p className="mt-1 italic text-[11px] text-stone">
          ({excluded} AI rows lacking confidence excluded from histogram.)
        </p>
      )}
      <style>{`
        @keyframes barIn {
          from { transform: scaleY(0); opacity: 0; }
          to   { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}

function describeShape(bins: ConfidenceBin[]): string {
  if (bins.length < 3) return ''
  const total = bins.reduce((s, b) => s + b.count, 0)
  if (total === 0) return ''
  const low = bins.slice(0, 3).reduce((s, b) => s + b.count, 0) / total
  const mid = bins.slice(3, 7).reduce((s, b) => s + b.count, 0) / total
  const high = bins.slice(7).reduce((s, b) => s + b.count, 0) / total
  if (low > 0.3 && high > 0.3 && mid < 0.25) return 'Bimodal — the model is decisive on this concept.'
  if (mid > 0.5) return 'Mass near the middle — the model is hesitating.'
  if (high > 0.5) return 'Mass near 1 — model is confident this label applies.'
  if (low > 0.5)  return 'Mass near 0 — model is confident this label does not apply.'
  return 'Mixed distribution.'
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- ConfidenceHistogram`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/pages/analysis/single-label/ConfidenceHistogram.tsx src/tests/ConfidenceHistogram.test.tsx
git commit -m "feat(analysis): confidence histogram with shape inference"
```

---

### Task 9: DisagreementCallout

**Files:**
- Create: `src/pages/analysis/single-label/DisagreementCallout.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  disagreement: SingleLabelRunDetail['disagreement']
  threshold?: number   // default 15
}

export function DisagreementCallout({ disagreement, threshold = 15 }: Props) {
  if (disagreement.overlap_count === 0) {
    return (
      <p className="mt-9 italic text-stone">
        — no human/AI overlap yet. Disagreement becomes computable once the AI has predicted on messages
        you've also decided.
      </p>
    )
  }

  const { rate, disagree, overlap_count, breakdown } = disagreement
  const above = rate !== null && rate >= threshold

  return (
    <div className="mt-9 grid grid-cols-3 border-t border-b border-edge-warm">
      <Cell label="DISAGREEMENT">
        <span className="text-[36px] tabular-nums tracking-[-0.02em] text-on-canvas">
          {rate}
          <span className="text-[16px] text-stone ml-0.5">%</span>
          <span className="text-[14px] italic text-stone ml-1.5 align-top">{disagree} / {overlap_count}</span>
        </span>
        <p className={`mt-1.5 italic text-[13px] ${above ? 'text-brick' : 'text-tertiary'}`}>
          {above
            ? `above the ${threshold}% drift threshold.`
            : `below the ${threshold}% drift threshold.`}
        </p>
      </Cell>
      <Cell label="AI YES · HUMAN NO" border>
        <span className="text-[36px] tabular-nums text-on-canvas">{breakdown.ai_yes_human_no}</span>
        <p className="mt-1.5 italic text-[13px] text-tertiary">model over-applies on edge cases.</p>
      </Cell>
      <Cell label="AI NO · HUMAN YES" border>
        <span className="text-[36px] tabular-nums text-on-canvas">{breakdown.ai_no_human_yes}</span>
        <p className="mt-1.5 italic text-[13px] text-tertiary">model misses softer cases.</p>
      </Cell>
    </div>
  )
}

function Cell({ label, children, border }: { label: string; children: React.ReactNode; border?: boolean }) {
  return (
    <div className={`py-5 pr-6 ${border ? 'border-l border-edge-warm pl-6' : ''}`}>
      <div className="text-[11px] italic text-ochre tracking-[0.04em]">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/analysis/single-label/DisagreementCallout.tsx
git commit -m "feat(analysis): disagreement callout with drift threshold"
```

---

### Task 10: YesRateByAssignmentChart

**Files:**
- Create: `src/pages/analysis/single-label/YesRateByAssignmentChart.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  rows: SingleLabelRunDetail['by_assignment']
}

export function YesRateByAssignmentChart({ rows }: Props) {
  if (rows.length === 0) return <p className="italic text-stone">— no assignment data yet.</p>

  const sorted = [...rows].sort((a, b) => b.yes_pct - a.yes_pct)

  return (
    <div className="grid grid-cols-[220px_1fr_56px] gap-x-4 gap-y-3 items-center">
      {sorted.map((r, i) => (
        <div className="contents" key={r.key}>
          <div className="text-[15px] text-on-canvas truncate">{r.key}</div>
          <div className="relative h-4 bg-edge-warm/60">
            <div
              className={fillClass(r.yes_pct)}
              style={{
                width: `${r.yes_pct}%`,
                animation: `barFill 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 40}ms backwards`,
              }}
            />
          </div>
          <div
            className="text-right text-[14px] text-on-canvas tabular-nums"
            style={{ fontFeatureSettings: '"tnum", "smcp"' }}
          >
            {r.yes_pct}
            <sup className="ml-1 text-[9px] text-stone tracking-[0.04em]" style={{ fontFeatureSettings: '"smcp", "tnum"' }}>
              {r.yes + r.no}
            </sup>
          </div>
        </div>
      ))}
      <style>{`
        @keyframes barFill {
          from { transform: scaleX(0); transform-origin: left; }
          to   { transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </div>
  )
}

function fillClass(pct: number): string {
  const base = 'absolute top-0 left-0 bottom-0 origin-left'
  if (pct >= 50)  return `${base} bg-moss`
  if (pct >= 30)  return `${base} bg-moss-dim`
  return `${base} bg-moss/55`
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/analysis/single-label/YesRateByAssignmentChart.tsx
git commit -m "feat(analysis): yes-rate by assignment chart"
```

---

### Task 11: YesRateByPositionChart

**Files:**
- Create: `src/pages/analysis/single-label/YesRateByPositionChart.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { SingleLabelRunDetail } from '../../../types'

const LABELS: Record<'early' | 'mid' | 'late', string> = {
  early: 'EARLY · msgs 0–2',
  mid:   'MID · msgs 3–6',
  late:  'LATE · msgs 7+',
}

type Props = {
  rows: SingleLabelRunDetail['by_position']
}

export function YesRateByPositionChart({ rows }: Props) {
  // Ensure stable order regardless of backend ordering.
  const order: Array<'early' | 'mid' | 'late'> = ['early', 'mid', 'late']
  const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r] as const))

  if (rows.length === 0) return <p className="italic text-stone">— no decisions yet.</p>

  return (
    <div className="grid grid-cols-3 gap-7 mt-2">
      {order.map((bucket, i) => {
        const r = byBucket[bucket]
        if (!r) return <Empty key={bucket} label={LABELS[bucket]} />
        return (
          <div key={bucket} className="border-t border-edge-warm pt-4">
            <div className="text-[11px] italic text-ochre tracking-[0.04em]">{LABELS[bucket]}</div>
            <div className="mt-1.5 text-[32px] tabular-nums tracking-[-0.02em] text-on-canvas">
              {r.yes_pct}<span className="text-[16px] text-stone">%</span>
            </div>
            <div className="mt-2.5 h-1 bg-edge-warm/60 relative">
              <div
                className="absolute top-0 left-0 bottom-0 bg-moss origin-left"
                style={{
                  width: `${r.yes_pct}%`,
                  animation: `barFill 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 60}ms backwards`,
                }}
              />
            </div>
            <div className="mt-2 italic text-[12px] text-stone">n = {r.yes + r.no}</div>
          </div>
        )
      })}
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="border-t border-edge-warm pt-4">
      <div className="text-[11px] italic text-ochre tracking-[0.04em]">{label}</div>
      <div className="mt-1.5 italic text-stone text-[13px]">— no data</div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check & commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/pages/analysis/single-label/YesRateByPositionChart.tsx
git commit -m "feat(analysis): yes-rate by conversation position trio"
```

---

### Task 12: YesRateOverTimeChart

**Files:**
- Create: `src/pages/analysis/single-label/YesRateOverTimeChart.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  weeks: SingleLabelRunDetail['weekly']
}

export function YesRateOverTimeChart({ weeks }: Props) {
  if (weeks.length === 0) return <p className="italic text-stone">— not enough history yet.</p>

  // Project to viewBox 800 × 160. y inverted (0 at top).
  const w = 800
  const h = 160
  const pad = 40
  const innerW = w - pad - 16

  const xs = weeks.map((_, i) => pad + (i / Math.max(weeks.length - 1, 1)) * innerW)
  const ysYes = weeks.map((wk) => h - 30 - (wk.yes_pct / 100) * (h - 50))
  const maxN = Math.max(...weeks.map((wk) => wk.yes + wk.no), 1)
  const ysN = weeks.map((wk) => 130 - ((wk.yes + wk.no) / maxN) * 60)

  const pointStr = (xs: number[], ys: number[]) =>
    xs.map((x, i) => `${x},${ys[i]}`).join(' ')

  const weekLabel = (iso: string) => {
    const d = new Date(iso)
    // ISO week number (rough)
    const oneJan = new Date(d.getFullYear(), 0, 1)
    const wk = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7)
    return `W${wk}`
  }

  return (
    <div className="border-t border-b border-edge-warm py-6 mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block w-full h-[160px]">
        <line x1="0" y1="80" x2={w} y2="80" stroke="var(--app-edge-warm, #e7dfc7)" strokeWidth="1" strokeDasharray="2 4" />
        <polyline
          fill="none" stroke="var(--app-moss, #6b8456)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round"
          points={pointStr(xs, ysYes)}
        />
        <polyline
          fill="none" stroke="var(--app-ochre-dim, #8c6d1f)" strokeWidth="1.4"
          strokeDasharray="3 4"
          strokeLinejoin="round" strokeLinecap="round"
          points={pointStr(xs, ysN)}
        />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ysYes[i]} r="2.5" fill="var(--app-moss, #6b8456)" />
        ))}
      </svg>
      <div className="grid mt-2 text-[10px] text-stone tracking-[0.04em] tabular-nums text-center"
           style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((wk) => <span key={wk.week_start}>{weekLabel(wk.week_start)}</span>)}
      </div>
      <p className="mt-3.5 italic text-[13px] text-tertiary flex gap-5">
        <span className="not-italic text-[11px] text-stone tracking-[0.04em]">
          <span className="inline-block w-[18px] h-[1.5px] bg-moss mr-1.5 align-middle" />YES RATE
        </span>
        <span className="not-italic text-[11px] text-stone tracking-[0.04em]">
          <span className="inline-block w-[18px] border-t-[1.5px] border-dotted border-ochre-dim mr-1.5 align-middle" />N (PER WK)
        </span>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Type-check & commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/pages/analysis/single-label/YesRateOverTimeChart.tsx
git commit -m "feat(analysis): weekly yes-rate sparkline with companion N line"
```

---

### Task 13: ExamplesDrawer — slide-up overlay (renamed from ExampleMessageGroup in r2)

> **r2 revision:** Examples are no longer inline in the Findings view. They live in a **slide-up drawer** (38vh, overlays the right run-detail pane only — `left: 304px; right: 0; bottom: 0;`). Triggered by a single horizontal pill at the bottom of the Findings sub-tab showing `YES <n> · NO <n> · EDGE <n> · ▸`. Clicking flips `aria-expanded` and toggles `.open` on the drawer; the arrow rotates 90°. Drawer body is a 3-column grid (yes / no / edge), each capped at 8 sampled rows.
>
> Renamed file: `src/pages/analysis/single-label/ExamplesDrawer.tsx` (was `ExampleMessageGroup.tsx`). The single component owns the drawer chrome + all three column groups internally — no separate `ExampleMessageGroup`. Tests: render the closed state, open it, assert all three groups present, assert ≤8 rows per group, assert edge group renders flag text (`low confidence` / `human overruled`). Reference: `mockups/analysis-redesign/app-native/index.html` — search for `.drawer` and `.ex-group`.

> **Original r1 task below kept for reference only:**

**Files:**
- Create: `src/pages/analysis/single-label/ExampleMessageGroup.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { ExampleMsg } from '../../../types'

type Props = {
  title: string             // "YES — SAMPLED", "NO — SAMPLED", "EDGE — FLAGGED FOR REVIEW"
  total: number             // total in this category (for "N = 3 OF 149")
  msgs: ExampleMsg[]
  variant?: 'default' | 'edge'
}

export function ExampleMessageGroup({ title, total, msgs, variant = 'default' }: Props) {
  if (msgs.length === 0) return null
  const isEdge = variant === 'edge'

  return (
    <section className="example-group">
      <div className="flex justify-between items-baseline pb-2 border-b border-edge-warm">
        <span className="text-[11px] italic text-ochre tracking-[0.04em]">{title}</span>
        <span className="text-stone text-[11px] tracking-[0.08em]" style={{ fontFeatureSettings: '"smcp", "tnum"' }}>
          N = {msgs.length} OF {total}
        </span>
      </div>
      {msgs.map((m) => (
        <blockquote
          key={m.message_id}
          className="grid grid-cols-[1fr_200px] gap-x-8 py-4 pl-7 border-b border-edge-warm relative max-md:grid-cols-1"
        >
          <span
            aria-hidden="true"
            className={`absolute left-0 top-3.5 text-[28px] leading-none ${isEdge ? 'text-brick' : 'text-ochre'}`}
          >
            &ldquo;
          </span>
          <p className="text-[16px] leading-[1.5] text-on-canvas">{m.text}</p>
          <aside
            className={`italic text-[12px] text-right border-l border-edge-warm pl-4 self-center max-md:border-l-0 max-md:pl-0 max-md:text-left max-md:mt-2 ${
              m.flag ? 'text-brick' : 'text-stone'
            }`}
          >
            {m.assignment && (<span className="not-italic text-on-canvas">{m.assignment}</span>)}
            {m.position_bucket && <> · {m.position_bucket}</>}
            {m.ai_pred !== null && m.ai_confidence !== null && (
              <> · <span className="not-italic">ai {m.ai_confidence.toFixed(2)} {m.ai_pred}</span></>
            )}
            {m.flag === 'low_confidence' && <> — low confidence</>}
            {m.flag === 'human_overruled' && <> — human overruled</>}
            {!m.flag && m.human_decision && (
              <> · <span className="not-italic">human {m.human_decision}</span></>
            )}
          </aside>
        </blockquote>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Type-check & commit**

```bash
npx tsc --noEmit
git add src/pages/analysis/single-label/ExampleMessageGroup.tsx
git commit -m "feat(analysis): example message group with marginal flags"
```

---

### Task 14: RunDetailPane — header + sub-tabs + body (renamed from RunDetailTab in r2)

> **r2 revision:** Renamed component + file to `RunDetailPane` (lives in `src/pages/analysis/single-label/RunDetailPane.tsx`). Structure:
>
> 1. **Header** (`.pane-header`): eyebrow `RUN`, run name, readout `walked X/Y · yes A% msgs / B% convos · D/N overlap disagreed`, right-side `↻ refresh` / `↗ export` link buttons. Note the new `B% convos` — pull from `detail.run.conv_yes_pct`.
> 2. **Sub-tab strip** (`.subtabs`): `Label health` (default) | `Findings`, segmented-control style. Active state has an ochre underline. **Component state**, not URL.
> 3. **Body** (`.pane-body`): mounts either `<HealthSubtab />` or `<FindingsSubtab />` based on the sub-tab state.
>
> Extract two child components:
>
> - **HealthSubtab.tsx** — owns the Health grid: `<ConfidenceHistogram />` (main, flexible) + sidebar (`<CoverageCard />` + `<AgreementByConfidence />` stacked) + `<DisagreementCallout />` (full-width below).
> - **FindingsSubtab.tsx** — owns the Findings grid: `<YesRateByAssignmentChart />` (left card) + right card containing `<YesRateByPositionChart />` and `<YesRateOverTimeChart />` stacked + the examples-toggle pill that opens `<ExamplesDrawer />`.
>
> Tests for `RunDetailPane`:
> - Renders header with run name + readout (including the new `% convos` segment).
> - Default sub-tab is `Label health`; clicking `Findings` swaps content.
> - Sub-tab state is local (does NOT touch `useSearchParams`).
> - Error state for failed fetch.
> - Empty state when `runId === null` (no run selected yet).
>
> The r1 task below shows a single monolithic component with `<SectionMark />` ornaments and inline message bubbles. **Discard the JSX structure** and follow the mockup. Keep the data-fetching pattern (`useEffect` per `runId`, `alive` flag) — that's unchanged.

> **Original r1 task below kept for reference only:**

**Files:**
- Modify: `src/pages/analysis/single-label/RunDetailTab.tsx`
- Test: `src/tests/RunDetailTab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { RunDetailTab } from '../pages/analysis/single-label/RunDetailTab'
import { api } from '../services/api'
import { mockSingleLabelRunDetail, mockSingleLabelCohort } from '../mocks'

vi.mock('../services/api', () => ({
  api: {
    getSingleLabelRunDetail: vi.fn(),
    getSingleLabelCohort: vi.fn(),
  },
}))
const mocked = api as {
  getSingleLabelRunDetail: ReturnType<typeof vi.fn>
  getSingleLabelCohort: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mocked.getSingleLabelRunDetail.mockResolvedValue(mockSingleLabelRunDetail)
  mocked.getSingleLabelCohort.mockResolvedValue(mockSingleLabelCohort)
})

test('renders dateline with run name', async () => {
  render(<RunDetailTab runId={1} onPickRun={() => {}} />)
  await waitFor(() => expect(screen.getByText(/help-seeking/i)).toBeInTheDocument())
  expect(screen.getByText(/RUN —/i)).toBeInTheDocument()
})

test('renders both section marks', async () => {
  render(<RunDetailTab runId={1} onPickRun={() => {}} />)
  await waitFor(() => screen.getByText(/Label health/i))
  expect(screen.getByText(/Findings/i)).toBeInTheDocument()
  expect(screen.getByText(/§ 1/)).toBeInTheDocument()
  expect(screen.getByText(/§ 2/)).toBeInTheDocument()
})

test('prompts to pick a run when runId is null', async () => {
  render(<RunDetailTab runId={null} onPickRun={() => {}} />)
  await waitFor(() => expect(screen.getByText(/pick a run/i)).toBeInTheDocument())
})

test('shows error state when fetch fails', async () => {
  mocked.getSingleLabelRunDetail.mockRejectedValue(new Error('boom'))
  render(<RunDetailTab runId={1} onPickRun={() => {}} />)
  await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- RunDetailTab`
Expected: FAIL — placeholder doesn't render any of this.

- [ ] **Step 3: Implement RunDetailTab**

```tsx
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import type { SingleLabelCohortRow, SingleLabelRunDetail } from '../../../types'
import { SectionMark } from './SectionMark'
import { ConfidenceHistogram } from './ConfidenceHistogram'
import { DisagreementCallout } from './DisagreementCallout'
import { YesRateByAssignmentChart } from './YesRateByAssignmentChart'
import { YesRateByPositionChart } from './YesRateByPositionChart'
import { YesRateOverTimeChart } from './YesRateOverTimeChart'
import { ExampleMessageGroup } from './ExampleMessageGroup'

type Props = {
  runId: number | null
  onPickRun: (runId: number) => void
}

export function RunDetailTab({ runId, onPickRun }: Props) {
  const [detail, setDetail] = useState<SingleLabelRunDetail | null>(null)
  const [cohort, setCohort] = useState<SingleLabelCohortRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    api.getSingleLabelCohort()
      .then((r) => setCohort(r.runs))
      .catch(() => { /* picker just won't have entries */ })
  }, [])

  useEffect(() => {
    if (runId == null) {
      setDetail(null)
      return
    }
    let alive = true
    setError(null)
    setDetail(null)
    api.getSingleLabelRunDetail(runId)
      .then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [runId])

  if (runId == null) {
    return (
      <div>
        <p className="italic text-stone mb-4">Pick a run to read.</p>
        {cohort.length > 0 && (
          <ul className="list-none">
            {cohort.map((r) => (
              <li key={r.run_id}>
                <button
                  type="button"
                  onClick={() => onPickRun(r.run_id)}
                  className="appearance-none bg-transparent border-0 cursor-pointer text-on-canvas font-serif text-[18px] hover:text-ochre py-2"
                >
                  {r.label_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  if (error)   return <p className="italic text-brick">— {error}</p>
  if (!detail) return <p className="italic text-stone">— loading run</p>

  const when = new Date(detail.run.updated_at).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric',
  }).toUpperCase().replace(' ', ' · ')

  return (
    <div>
      <header className="flex items-baseline justify-between pb-3.5 border-b border-edge-warm relative">
        <div className="flex items-baseline gap-4.5">
          <span className="text-[11px] italic text-ochre">RUN —</span>
          <span className="text-[28px] tracking-[-0.014em] text-on-canvas">{detail.run.label_name}</span>
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            className="appearance-none border-0 bg-transparent font-serif italic text-[12px] text-stone hover:text-on-canvas cursor-pointer py-1"
          >
            change run ▾
          </button>
        </div>
        <span className="text-[12px] italic text-stone tracking-[0.04em]">{when}</span>
        {showPicker && cohort.length > 0 && (
          <ul className="absolute top-full left-0 mt-1 z-10 bg-bg-warm border border-edge-warm rounded-sm py-2 min-w-[220px] list-none">
            {cohort.map((r) => (
              <li key={r.run_id}>
                <button
                  type="button"
                  onClick={() => { onPickRun(r.run_id); setShowPicker(false) }}
                  className="appearance-none bg-transparent border-0 cursor-pointer text-on-canvas font-serif text-[15px] hover:text-ochre py-1.5 px-4 text-left w-full"
                >
                  {r.label_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>
      <p className="mt-2.5 italic text-[14px] text-tertiary">
        walked <span className="not-italic text-on-canvas">{detail.run.walked}{detail.run.total_target ? `/${detail.run.total_target}` : ''}</span>
        <span className="text-ochre-dim mx-1.5">·</span>
        <span className="not-italic text-on-canvas">{detail.run.yes_pct}%</span> yes
        <span className="text-ochre-dim mx-1.5">·</span>
        <span className="not-italic text-on-canvas">{detail.disagreement.disagree}</span> of{' '}
        <span className="not-italic text-on-canvas">{detail.disagreement.overlap_count}</span> overlap disagreed
      </p>

      <section className="mt-14">
        <SectionMark glyph="§ 1 ·" title="Label health" />
        <ConfidenceHistogram histogram={detail.confidence_histogram} />
        <DisagreementCallout disagreement={detail.disagreement} />
      </section>

      <section className="mt-14">
        <SectionMark glyph="§ 2 ·" title="Findings" />

        <h3 className="text-[14px] italic font-normal text-stone mb-4.5">Yes-rate by assignment</h3>
        <YesRateByAssignmentChart rows={detail.by_assignment} />

        <h3 className="text-[14px] italic font-normal text-stone mt-14 mb-4.5">Yes-rate by conversation position</h3>
        <YesRateByPositionChart rows={detail.by_position} />

        <h3 className="text-[14px] italic font-normal text-stone mt-14 mb-4.5">Yes-rate over time</h3>
        <YesRateOverTimeChart weeks={detail.weekly} />

        <h3 className="text-[14px] italic font-normal text-stone mt-14 mb-4.5">Example messages</h3>
        <div className="flex flex-col gap-7">
          <ExampleMessageGroup title="YES — SAMPLED"           total={detail.run.yes_pct === 0 ? 0 : Math.round((detail.run.yes_pct / 100) * detail.run.walked)} msgs={detail.examples.yes} />
          <ExampleMessageGroup title="NO — SAMPLED"            total={detail.run.walked - Math.round((detail.run.yes_pct / 100) * detail.run.walked)}            msgs={detail.examples.no} />
          <ExampleMessageGroup title="EDGE — FLAGGED FOR REVIEW" total={detail.disagreement.disagree}                                                            msgs={detail.examples.edge} variant="edge" />
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- RunDetailTab`
Expected: PASS (all four).

Run: `npm test`
Expected: PASS for the whole suite. The `AnalysisPage` and `SingleLabelAnalysis` tests already covered should still pass.

- [ ] **Step 5: Manual aesthetic walkthrough**

`VITE_USE_MOCK=true npm run dev`. Visit `/analysis?view=run&run_id=1` in single-label mode. Verify against the plan's aesthetic checklist:
- Dateline header reads `RUN — help-seeking · MAY 2026` style
- `§ 1 · Label health` and `§ 2 · Findings` section marks with hairline rule extending right
- Confidence histogram stacks brick-on-top-of-moss with sharp corners, axis ticks `.0`–`.9` in tabular nums
- Disagreement callout shows three cells, 8% with italic "below threshold" footnote
- Assignment bars sorted desc with superscript sample-size annotations
- Position trio with three cards
- Weekly line chart with dotted ochre companion line
- Example messages as blockquotes with hanging ochre quotation marks
- Edge group's marginal aside is brick-colored, hanging quote is brick

- [ ] **Step 6: Commit**

```bash
git add src/pages/analysis/single-label/RunDetailTab.tsx src/tests/RunDetailTab.test.tsx
git commit -m "feat(analysis): compose run detail from health + findings clusters"
```

---

## Phase 3 — Backend single-label endpoints

### Task 15: Create `analysis_single_label.py` module and cohort endpoint

> **r2 revision:** Cohort response rows now include `weekly_sparkline: list[float]` (length ≤ 8, ordered oldest → newest). Compute it per run by bucketing this run's human `LabelApplication` rows into ISO weeks (use `_week_start` from Task 16) and emitting `yes_pct` for each of the last 8 weeks with any decisions. If fewer than 8 weeks of data exist, return what's available (don't pad with zeros). Add a test:
> ```python
> def test_cohort_includes_weekly_sparkline(client, session):
>     run_id = _setup_run(session)
>     # add 3 weeks of decisions
>     ...
>     r = client.get("/api/analysis/single-label/cohort")
>     row = r.json()["runs"][0]
>     assert isinstance(row["weekly_sparkline"], list)
>     assert len(row["weekly_sparkline"]) <= 8
> ```

**Files:**
- Create: `server/python/analysis_single_label.py`
- Create: `server/python/tests/test_single_label_cohort.py`
- Modify: `server/python/main.py` (mount route)

- [ ] **Step 1: Write the failing test**

Create `server/python/tests/test_single_label_cohort.py`:

```python
from datetime import datetime
from sqlmodel import Session
from models import LabelDefinition, LabelApplication


def _make_single_label(session: Session, name: str, phase: str = "labeling") -> LabelDefinition:
    ld = LabelDefinition(
        name=name,
        description=f"desc for {name}",
        mode="single",
        phase=phase,
        is_active=True,
    )
    session.add(ld)
    session.commit()
    session.refresh(ld)
    return ld


def _add_decision(session: Session, label_id: int, chatlog_id: int, msg_idx: int,
                  value: str, applied_by: str = "human", confidence: float | None = None):
    session.add(LabelApplication(
        label_id=label_id, chatlog_id=chatlog_id, message_index=msg_idx,
        applied_by=applied_by, value=value, confidence=confidence,
        created_at=datetime.utcnow(),
    ))
    session.commit()


def test_cohort_empty(client):
    r = client.get("/api/analysis/single-label/cohort")
    assert r.status_code == 200
    assert r.json() == {"runs": []}


def test_cohort_with_one_run_no_decisions(client, session):
    _make_single_label(session, "help-seeking")
    r = client.get("/api/analysis/single-label/cohort")
    rows = r.json()["runs"]
    assert len(rows) == 1
    assert rows[0]["label_name"] == "help-seeking"
    assert rows[0]["yes_count"] == 0
    assert rows[0]["no_count"] == 0
    assert rows[0]["yes_pct"] == 0
    assert rows[0]["disagreement_pct"] is None
    assert rows[0]["overlap_count"] == 0


def test_cohort_with_mixed_human_and_ai(client, session):
    ld = _make_single_label(session, "help-seeking")
    # Human decisions: 6 yes, 4 no
    for i in range(6):
        _add_decision(session, ld.id, 1, i, "yes")
    for i in range(4):
        _add_decision(session, ld.id, 1, i + 100, "no")
    # AI predictions on overlap: 5 of which agree, 1 disagrees
    for i in range(5):
        _add_decision(session, ld.id, 1, i, "yes", applied_by="ai", confidence=0.9)
    _add_decision(session, ld.id, 1, 100, "yes", applied_by="ai", confidence=0.6)  # AI yes vs human no
    r = client.get("/api/analysis/single-label/cohort")
    row = r.json()["runs"][0]
    assert row["yes_count"] == 6
    assert row["no_count"] == 4
    assert row["yes_pct"] == 60
    assert row["overlap_count"] == 6
    assert row["disagreement_pct"] == 17  # 1/6 ≈ 16.66 → rounded
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_single_label_cohort.py -v`
Expected: FAIL — endpoint returns 404 (not registered).

- [ ] **Step 3: Create the module**

Create `server/python/analysis_single_label.py`:

```python
"""Single-label analysis endpoints — cohort overview and run detail.

Reads from LabelApplication where the parent LabelDefinition has mode='single'.
- Human decisions: applied_by='human', value in ('yes','no','skip').
- AI predictions:  applied_by='ai',    value in ('yes','no'), confidence usually set.
"""

from datetime import datetime
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from database import get_session
from models import LabelApplication, LabelDefinition

router = APIRouter(prefix="/api/analysis/single-label", tags=["analysis"])


def _round_pct(num: int, denom: int) -> int:
    if denom == 0:
        return 0
    return round(100 * num / denom)


@router.get("/cohort")
def get_cohort(session: Session = Depends(get_session)) -> dict:
    runs = session.exec(
        select(LabelDefinition)
        .where(LabelDefinition.mode == "single")
        .where(LabelDefinition.archived_at.is_(None))
        .order_by(LabelDefinition.created_at)
    ).all()

    rows = []
    for ld in runs:
        apps = session.exec(
            select(LabelApplication).where(LabelApplication.label_id == ld.id)
        ).all()

        human = [a for a in apps if a.applied_by == "human"]
        ai    = [a for a in apps if a.applied_by == "ai"]

        yes_n = sum(1 for a in human if a.value == "yes")
        no_n  = sum(1 for a in human if a.value == "no")
        walked = len({(a.chatlog_id, a.message_index) for a in human if a.value in ("yes", "no", "skip")})

        # Overlap: (chatlog_id, message_index) where both human and AI exist (excl. skip).
        human_by_key = {(a.chatlog_id, a.message_index): a.value for a in human if a.value in ("yes", "no")}
        overlap = []
        for a in ai:
            key = (a.chatlog_id, a.message_index)
            if key in human_by_key:
                overlap.append((human_by_key[key], a.value))
        disagree = sum(1 for h, ai_v in overlap if h != ai_v)
        overlap_count = len(overlap)

        rows.append({
            "run_id": ld.id,
            "label_name": ld.name,
            "description": ld.description,
            "phase": ld.phase,
            "yes_count": yes_n,
            "no_count": no_n,
            "yes_pct": _round_pct(yes_n, yes_n + no_n),
            "walked": walked,
            "total_target": ld.classification_total,
            "disagreement_pct": _round_pct(disagree, overlap_count) if overlap_count else None,
            "overlap_count": overlap_count,
            "updated_at": _isoformat(_most_recent(apps, ld)),
        })

    return {"runs": rows}


def _most_recent(apps, ld: LabelDefinition) -> datetime:
    if not apps:
        return ld.created_at
    return max((a.created_at for a in apps), default=ld.created_at)


def _isoformat(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"
```

- [ ] **Step 4: Mount the router in main.py**

Open `server/python/main.py`. Find where `app = FastAPI(...)` is created. Below that (and below other `from … import …` statements at the top of the file), add:

```python
from analysis_single_label import router as single_label_analysis_router
app.include_router(single_label_analysis_router)
```

If `main.py` declares all routes via `@app.get` directly with no other routers, this still works — `include_router` and inline `@app.get` coexist.

- [ ] **Step 5: Run tests**

Run: `cd server/python && uv run pytest tests/test_single_label_cohort.py -v`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add server/python/analysis_single_label.py server/python/main.py server/python/tests/test_single_label_cohort.py
git commit -m "feat(api): /api/analysis/single-label/cohort"
```

---

### Task 16: Run-detail endpoint

> **r2 revision:** Response payload now includes three additional fields (matching the updated TS types in Task 1):
>
> 1. **`run.conv_yes_pct`** — conversation-level yes-rate. Compute as: `100 * len({chatlog_id for a in humans if a.value == 'yes'}) // max(len({chatlog_id for a in humans if a.value in ('yes','no')}), 1)`. Add it inside the `"run": {...}` dict alongside `yes_pct`.
> 2. **`ai_coverage: { covered, total, pct }`** — `covered = len({(a.chatlog_id, a.message_index) for a in ais})`; `total = session.exec(select(func.count()).select_from(MessageCache)).one()`; `pct = round(100 * covered / max(total, 1))`. Cache the total per request to avoid recomputing.
> 3. **`agreement_by_confidence: { buckets: [...] }`** — 5 buckets of width 0.2 (edges `[0, .2, .4, .6, .8, 1.0]`). For each bucket, iterate AI rows whose confidence falls in the bucket; for those that overlap a human decision, count agree/disagree. Emit `{lo, hi, overlap_count, agree, agreement_rate}` per bucket (rate `None` if `overlap_count == 0`).
>
> Helper to write:
> ```python
> def _agreement_buckets(ais, human_yn) -> list[dict]:
>     edges = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0001]  # 1.0001 so 1.0 lands in last bucket
>     buckets = [{"lo": edges[i], "hi": min(edges[i+1], 1.0), "overlap_count": 0, "agree": 0, "agreement_rate": None} for i in range(5)]
>     for a in ais:
>         if a.confidence is None or a.value not in ("yes", "no"):
>             continue
>         key = (a.chatlog_id, a.message_index)
>         h = human_yn.get(key)
>         if h is None:
>             continue
>         idx = next(i for i in range(5) if edges[i] <= a.confidence < edges[i+1])
>         buckets[idx]["overlap_count"] += 1
>         if h == a.value:
>             buckets[idx]["agree"] += 1
>     for b in buckets:
>         if b["overlap_count"] > 0:
>             b["agreement_rate"] = round(100 * b["agree"] / b["overlap_count"])
>     return buckets
> ```
>
> Add tests:
> ```python
> def test_run_detail_ai_coverage(client, session):
>     run_id = _setup_run(session)
>     # add 3 distinct AI predictions and 10 MessageCache rows
>     ...
>     r = client.get(f"/api/analysis/single-label/runs/{run_id}")
>     assert r.json()["ai_coverage"] == {"covered": 3, "total": 10, "pct": 30}
>
> def test_run_detail_agreement_buckets(client, session):
>     run_id = _setup_run(session)
>     # craft AI predictions across multiple buckets with known agreement
>     ...
>     r = client.get(f"/api/analysis/single-label/runs/{run_id}")
>     buckets = r.json()["agreement_by_confidence"]["buckets"]
>     assert len(buckets) == 5
>     assert all("agreement_rate" in b for b in buckets)
>
> def test_run_detail_conv_yes_pct(client, session):
>     run_id = _setup_run(session)
>     # add yes decisions across some chatlogs, no decisions across others
>     ...
>     r = client.get(f"/api/analysis/single-label/runs/{run_id}")
>     assert "conv_yes_pct" in r.json()["run"]
> ```

**Files:**
- Modify: `server/python/analysis_single_label.py`
- Create: `server/python/tests/test_single_label_run_detail.py`

- [ ] **Step 1: Write the failing tests**

```python
from datetime import datetime, timedelta
from sqlmodel import Session
from models import LabelDefinition, LabelApplication, AssignmentMapping, MessageCache


def _setup_run(session: Session) -> int:
    ld = LabelDefinition(name="help-seeking", mode="single", phase="labeling", is_active=True)
    session.add(ld); session.commit(); session.refresh(ld)
    return ld.id


def test_run_detail_404_for_missing(client):
    r = client.get("/api/analysis/single-label/runs/99999")
    assert r.status_code == 404


def test_run_detail_histogram_bins(client, session):
    run_id = _setup_run(session)
    # AI predictions across 10 bins: one prediction at confidence = bin midpoint
    for i, c in enumerate([0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]):
        session.add(LabelApplication(
            label_id=run_id, chatlog_id=1, message_index=i,
            applied_by="ai", value="yes" if c >= 0.5 else "no", confidence=c,
        ))
    # Edge: include the value 1.0 to verify it lands in the last bin (inclusive).
    session.add(LabelApplication(
        label_id=run_id, chatlog_id=1, message_index=99,
        applied_by="ai", value="yes", confidence=1.0,
    ))
    session.commit()

    r = client.get(f"/api/analysis/single-label/runs/{run_id}")
    assert r.status_code == 200
    bins = r.json()["confidence_histogram"]["bins"]
    assert len(bins) == 10
    assert bins[0]["count"] == 1   # 0.05 → bin 0
    assert bins[9]["count"] == 2   # 0.95 and 1.0 → bin 9


def test_run_detail_disagreement_breakdown(client, session):
    run_id = _setup_run(session)
    # Human decisions
    session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=1, applied_by="human", value="yes"))
    session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=2, applied_by="human", value="no"))
    # AI predictions: agree on msg 1, disagree on msg 2 (ai_yes_human_no)
    session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=1, applied_by="ai", value="yes", confidence=0.9))
    session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=2, applied_by="ai", value="yes", confidence=0.7))
    session.commit()

    r = client.get(f"/api/analysis/single-label/runs/{run_id}")
    d = r.json()["disagreement"]
    assert d["overlap_count"] == 2
    assert d["disagree"] == 1
    assert d["breakdown"] == {"ai_yes_human_no": 1, "ai_no_human_yes": 0}


def test_run_detail_examples_capped_at_8(client, session):
    run_id = _setup_run(session)
    for i in range(20):
        session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=i, applied_by="human", value="yes"))
    session.commit()
    r = client.get(f"/api/analysis/single-label/runs/{run_id}")
    assert len(r.json()["examples"]["yes"]) <= 8


def test_run_detail_no_ai_predictions(client, session):
    run_id = _setup_run(session)
    session.add(LabelApplication(label_id=run_id, chatlog_id=1, message_index=1, applied_by="human", value="yes"))
    session.commit()
    r = client.get(f"/api/analysis/single-label/runs/{run_id}")
    body = r.json()
    assert body["disagreement"]["overlap_count"] == 0
    assert body["disagreement"]["rate"] is None
    assert body["confidence_histogram"]["coverage"]["total_ai"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server/python && uv run pytest tests/test_single_label_run_detail.py -v`
Expected: FAIL — endpoint not implemented.

- [ ] **Step 3: Add the endpoint and helpers**

Append to `server/python/analysis_single_label.py`:

```python
from typing import Optional


@router.get("/runs/{run_id}")
def get_run_detail(run_id: int, session: Session = Depends(get_session)) -> dict:
    ld = session.get(LabelDefinition, run_id)
    if ld is None or ld.mode != "single" or ld.archived_at is not None:
        raise HTTPException(status_code=404, detail="run not found")

    apps = session.exec(
        select(LabelApplication).where(LabelApplication.label_id == run_id)
    ).all()
    humans = [a for a in apps if a.applied_by == "human"]
    ais    = [a for a in apps if a.applied_by == "ai"]

    # ─── confidence histogram ───
    bins = [
        {"lo": i / 10, "hi": (i + 1) / 10, "count": 0, "yes": 0, "no": 0}
        for i in range(10)
    ]
    ai_with_conf = [a for a in ais if a.confidence is not None]
    for a in ai_with_conf:
        c = max(0.0, min(1.0, a.confidence or 0.0))
        idx = 9 if c >= 1.0 else int(c * 10)
        bins[idx]["count"] += 1
        if a.value == "yes":
            bins[idx]["yes"] += 1
        elif a.value == "no":
            bins[idx]["no"] += 1

    # ─── disagreement ───
    human_yn = {(a.chatlog_id, a.message_index): a.value for a in humans if a.value in ("yes", "no")}
    agree = disagree = ai_yes_human_no = ai_no_human_yes = 0
    for a in ais:
        key = (a.chatlog_id, a.message_index)
        h = human_yn.get(key)
        if h is None or a.value not in ("yes", "no"):
            continue
        if h == a.value:
            agree += 1
        else:
            disagree += 1
            if a.value == "yes" and h == "no": ai_yes_human_no += 1
            if a.value == "no"  and h == "yes": ai_no_human_yes += 1
    overlap = agree + disagree

    # ─── by assignment ───
    # Build (chatlog_id, msg_index) → assignment name via MessageCache.assignment_id → AssignmentMapping.
    assignment_for = _assignment_index(session)
    by_assn: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in humans:
        if a.value not in ("yes", "no"): continue
        key = (a.chatlog_id, a.message_index)
        name = assignment_for.get(key, "Unassigned")
        by_assn[name][a.value] += 1
    by_assignment = [
        {"key": k, "yes": v["yes"], "no": v["no"], "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"])}
        for k, v in by_assn.items()
    ]
    by_assignment.sort(key=lambda r: r["yes_pct"], reverse=True)

    # ─── by position ───
    pos_buckets = {"early": {"yes": 0, "no": 0}, "mid": {"yes": 0, "no": 0}, "late": {"yes": 0, "no": 0}}
    for a in humans:
        if a.value not in ("yes", "no"): continue
        bucket = "early" if a.message_index <= 2 else ("mid" if a.message_index <= 6 else "late")
        pos_buckets[bucket][a.value] += 1
    by_position = [
        {"bucket": b, "yes": v["yes"], "no": v["no"], "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"])}
        for b, v in pos_buckets.items()
    ]

    # ─── weekly ───
    weekly_map: dict[str, dict[str, int]] = defaultdict(lambda: {"yes": 0, "no": 0})
    for a in humans:
        if a.value not in ("yes", "no"): continue
        wk = _week_start(a.created_at)
        weekly_map[wk][a.value] += 1
    weekly = sorted(
        ({"week_start": w, "yes": v["yes"], "no": v["no"], "yes_pct": _round_pct(v["yes"], v["yes"] + v["no"])}
         for w, v in weekly_map.items()),
        key=lambda r: r["week_start"],
    )

    # ─── examples ───
    text_lookup = _message_text_index(session, run_id)
    msg_to_record = lambda a, flag: {
        "message_id": a.id,
        "chatlog_id": a.chatlog_id,
        "message_index": a.message_index,
        "text": text_lookup.get((a.chatlog_id, a.message_index), "(message not cached)"),
        "ai_pred": _ai_pred_for(ais, a),
        "ai_confidence": _ai_conf_for(ais, a),
        "human_decision": a.value if a.applied_by == "human" else None,
        "assignment": assignment_for.get((a.chatlog_id, a.message_index)),
        "position_bucket": "early" if a.message_index <= 2 else ("mid" if a.message_index <= 6 else "late"),
        "created_at": _isoformat(a.created_at),
        "flag": flag,
    }
    yes_examples  = [msg_to_record(a, None) for a in sorted([a for a in humans if a.value == "yes"], key=lambda x: x.created_at, reverse=True)[:8]]
    no_examples   = [msg_to_record(a, None) for a in sorted([a for a in humans if a.value == "no"],  key=lambda x: x.created_at, reverse=True)[:8]]
    edge_apps     = _edge_apps(ais, human_yn)
    edge_examples = [msg_to_record(a, _flag_for(a, human_yn)) for a in edge_apps[:8]]

    return {
        "run": {
            "id": ld.id,
            "label_name": ld.name,
            "description": ld.description,
            "phase": ld.phase,
            "updated_at": _isoformat(_most_recent(apps, ld)),
            "walked": len({(a.chatlog_id, a.message_index) for a in humans if a.value in ("yes", "no", "skip")}),
            "total_target": ld.classification_total,
            "yes_pct": _round_pct(
                sum(1 for a in humans if a.value == "yes"),
                sum(1 for a in humans if a.value in ("yes", "no")),
            ),
        },
        "confidence_histogram": {
            "bins": bins,
            "coverage": {"with_confidence": len(ai_with_conf), "total_ai": len(ais)},
        },
        "disagreement": {
            "overlap_count": overlap,
            "agree": agree,
            "disagree": disagree,
            "rate": _round_pct(disagree, overlap) if overlap else None,
            "breakdown": {"ai_yes_human_no": ai_yes_human_no, "ai_no_human_yes": ai_no_human_yes},
        },
        "by_assignment": by_assignment,
        "by_position": by_position,
        "weekly": weekly,
        "examples": {"yes": yes_examples, "no": no_examples, "edge": edge_examples},
    }


def _assignment_index(session: Session) -> dict[tuple[int, int], str]:
    """(chatlog_id, message_index) → assignment name."""
    from models import AssignmentMapping, MessageCache
    cache = session.exec(select(MessageCache)).all()
    mappings = {am.id: am.name for am in session.exec(select(AssignmentMapping)).all()}
    out: dict[tuple[int, int], str] = {}
    for m in cache:
        if m.assignment_id and m.assignment_id in mappings:
            out[(m.chatlog_id, m.message_index)] = mappings[m.assignment_id]
    return out


def _message_text_index(session: Session, label_id: int) -> dict[tuple[int, int], str]:
    """(chatlog_id, message_index) → text for messages this run touched."""
    from models import MessageCache
    cache = session.exec(select(MessageCache)).all()
    return {(m.chatlog_id, m.message_index): m.message_text for m in cache}


def _ai_pred_for(ais: list[LabelApplication], target: LabelApplication) -> Optional[str]:
    for a in ais:
        if a.chatlog_id == target.chatlog_id and a.message_index == target.message_index:
            return a.value
    return None


def _ai_conf_for(ais: list[LabelApplication], target: LabelApplication) -> Optional[float]:
    for a in ais:
        if a.chatlog_id == target.chatlog_id and a.message_index == target.message_index:
            return a.confidence
    return None


def _edge_apps(ais: list[LabelApplication], human_yn: dict[tuple[int, int], str]) -> list[LabelApplication]:
    """AI predictions that are low confidence OR disagree with a human decision."""
    out: list[LabelApplication] = []
    for a in ais:
        if a.value not in ("yes", "no"):
            continue
        key = (a.chatlog_id, a.message_index)
        h = human_yn.get(key)
        is_low = a.confidence is not None and 0.4 <= a.confidence <= 0.6
        is_disagree = h is not None and h != a.value
        if is_low or is_disagree:
            out.append(a)
    return sorted(out, key=lambda a: a.created_at, reverse=True)


def _flag_for(a: LabelApplication, human_yn: dict[tuple[int, int], str]) -> str:
    h = human_yn.get((a.chatlog_id, a.message_index))
    if h is not None and h != a.value:
        return "human_overruled"
    return "low_confidence"


def _week_start(dt: datetime) -> str:
    monday = dt - timedelta(days=dt.weekday())
    return monday.date().isoformat()
```

- [ ] **Step 4: Run tests**

Run: `cd server/python && uv run pytest tests/test_single_label_run_detail.py -v`
Expected: PASS (all five).

Also run: `cd server/python && uv run pytest -v`
Expected: PASS for all backend tests (no regressions).

- [ ] **Step 5: Commit**

```bash
git add server/python/analysis_single_label.py server/python/tests/test_single_label_run_detail.py
git commit -m "feat(api): /api/analysis/single-label/runs/{run_id}"
```

---

### Task 17: Smoke test the FE→BE wiring

- [ ] **Step 1: Start the full stack**

In one terminal: `cd server/python && uv run uvicorn main:app --reload`
In another:       `npm run dev` (with `VITE_USE_MOCK=false` or unset)

- [ ] **Step 2: Open the cohort tab**

Toggle the app to single-label mode. Navigate to `http://localhost:5173/analysis`. If there are no `single`-mode `LabelDefinition` rows in your local SQLite, you'll see the empty state. If there are, you'll see the live cohort.

- [ ] **Step 3: Click a row → run detail loads**

Confirm:
- URL becomes `?view=run&run_id=<id>`
- All run-detail sections render with real data
- Reload the page — the deep link still lands on the same run

- [ ] **Step 4: No commit needed**

Pure verification step.

---

## Phase 4 — Multi-label cleanup

### Task 18: Milestones config + endpoint

**Files:**
- Create: `server/python/data/milestones/dsc10_wi26.json`
- Modify: `server/python/main.py`
- Modify: `src/pages/analysis/MultiLabelAnalysis.tsx`
- Create: `server/python/tests/test_analysis_milestones.py`

- [ ] **Step 1: Extract the inline milestones to JSON**

Read the existing `ASSIGNMENT_MILESTONES` in `src/pages/analysis/MultiLabelAnalysis.tsx`. Translate each entry to JSON shape `{ name, date, kind }` and write to `server/python/data/milestones/dsc10_wi26.json`:

```json
[
  { "name": "Lab 1", "date": "2026-01-15", "kind": "lab" },
  { "name": "Lab 2", "date": "2026-01-22", "kind": "lab" }
]
```

(Use the actual entries from the inline constant — the example above is illustrative.)

- [ ] **Step 2: Write the failing test**

Create `server/python/tests/test_analysis_milestones.py`:

```python
def test_milestones_default_course(client):
    r = client.get("/api/analysis/milestones?course=dsc10_wi26")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert all("name" in m and "date" in m for m in data)

def test_milestones_404_for_missing_course(client):
    r = client.get("/api/analysis/milestones?course=does_not_exist")
    assert r.status_code == 404
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_analysis_milestones.py -v`
Expected: FAIL — endpoint returns 404 because it's not implemented.

- [ ] **Step 4: Implement the endpoint**

In `server/python/main.py`, near the existing analysis routes, add:

```python
import json
from pathlib import Path

MILESTONES_DIR = Path(__file__).parent / "data" / "milestones"
DEFAULT_COURSE = "dsc10_wi26"

@app.get("/api/analysis/milestones")
def get_milestones(course: str = DEFAULT_COURSE):
    path = MILESTONES_DIR / f"{course}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"course '{course}' not found")
    return json.loads(path.read_text())
```

- [ ] **Step 5: Run tests**

Run: `cd server/python && uv run pytest tests/test_analysis_milestones.py -v`
Expected: PASS (both).

- [ ] **Step 6: Update MultiLabelAnalysis.tsx to fetch milestones**

In `src/pages/analysis/MultiLabelAnalysis.tsx`:
1. Remove the inline `const ASSIGNMENT_MILESTONES = [...]` constant.
2. Add a `useEffect` that calls `api.getMilestones('dsc10_wi26')` and stores the result in component state.
3. Replace every reference to the constant with the state variable.

Concrete edits:

```tsx
// Add near other useState/useEffect calls in MultiLabelAnalysis:
const [milestones, setMilestones] = useState<AssignmentMilestone[]>([])

useEffect(() => {
  api.getMilestones('dsc10_wi26')
    .then(setMilestones)
    .catch(() => setMilestones([]))  // gracefully fall back to no milestones
}, [])
```

And import `AssignmentMilestone` from `'../../types'` at the top.

- [ ] **Step 7: Manual smoke test**

`npm run dev` and visit `/analysis` (multi mode). Confirm the assignment milestone markers still appear on the calendar/throughput sections. If they're missing, check the Network tab for `/api/analysis/milestones` — adjust the JSON file shape to match what the calendar rendering expects.

- [ ] **Step 8: Commit**

```bash
git add server/python/data/milestones/dsc10_wi26.json server/python/main.py server/python/tests/test_analysis_milestones.py src/pages/analysis/MultiLabelAnalysis.tsx
git commit -m "feat(analysis): serve milestones from JSON config"
```

---

### Task 19: Surface `notebook_breakdown` in summary response

**Files:**
- Modify: `server/python/main.py` (around the existing `/api/analysis/summary` route, near line 2143)
- Modify: `src/pages/analysis/MultiLabelAnalysis.tsx`
- Modify: `server/python/tests/test_*.py` (find existing summary tests; add assertion for the new field)

- [ ] **Step 1: Locate the existing `notebook_breakdown` computation**

In `server/python/main.py`, search for the `notebook_breakdown` variable (the brainstorm cites ~line 2143). Confirm it's a `dict[str, dict[str, int]]`.

- [ ] **Step 2: Add it to the response**

Find the return statement of the `/api/analysis/summary` handler. Add `"notebook_breakdown": notebook_breakdown` to the response dict.

- [ ] **Step 3: Sanity-check the data**

Run: `cd server/python && uv run uvicorn main:app --reload`
Hit `http://localhost:8000/api/analysis/summary` in a browser. Inspect the `notebook_breakdown` field. Check for:
- Non-empty (assuming there's labeled data)
- Counts look reasonable (not absurdly large; sum matches per-notebook expectations)
- No double-counting (a given (chatlog, msg_index, label) appears only once)

If values are wrong, **stop** — fix the aggregation in `main.py` before wiring the frontend. The fix likely lives in the same loop that computes the breakdown.

- [ ] **Step 4: Render the notebook breakdown in MultiLabelAnalysis**

In `src/pages/analysis/MultiLabelAnalysis.tsx`, add a new section after the existing Notebook × Label heatmap section. Render `summary.notebook_breakdown` as a small table (notebooks as rows, top 5 labels as columns, counts in cells). Match the existing card styling.

If the existing page already has a "Notebook × Label Heatmap" section (it does, per the brainstorm), this new section is redundant — instead, **wire the existing heatmap to read from `summary.notebook_breakdown`** rather than its current source. Confirm by reading the heatmap's data prop.

- [ ] **Step 5: Commit**

```bash
git add server/python/main.py src/pages/analysis/MultiLabelAnalysis.tsx
git commit -m "feat(analysis): surface notebook_breakdown in summary response"
```

---

### Task 20: Per-card failure isolation in `/api/analysis/temporal`

**Files:**
- Modify: `server/python/main.py` (the `/api/analysis/temporal` handler)
- Modify: `src/pages/analysis/MultiLabelAnalysis.tsx`
- Create: `server/python/tests/test_analysis_temporal_partial_failure.py`

- [ ] **Step 1: Write the failing test**

```python
from unittest.mock import patch

def test_temporal_throughput_failure_does_not_kill_other_blocks(client):
    # If we can simulate a failure inside compute_throughput (the function name will
    # differ — find the actual one in main.py and patch it), the response should
    # still include tutor_usage and heatmap with valid data.
    with patch("main.compute_labeling_throughput", side_effect=Exception("boom")):
        r = client.get("/api/analysis/temporal")
    assert r.status_code == 200
    body = r.json()
    assert "tutor_usage" in body and body["tutor_usage"].get("error") is None
    assert "notebook_label_heatmap" in body and body["notebook_label_heatmap"].get("error") is None
    assert "labeling_throughput" in body
    assert body["labeling_throughput"].get("error") is not None
```

(Adjust `compute_labeling_throughput` to whatever the actual function name is in main.py — read it first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server/python && uv run pytest tests/test_analysis_temporal_partial_failure.py -v`
Expected: FAIL — the existing handler propagates exceptions; one failure nukes the rest.

- [ ] **Step 3: Refactor the temporal handler**

Open `server/python/main.py` and find the `/api/analysis/temporal` handler. Wrap each sub-block computation in a try/except that catches `Exception` and stores `{"error": str(e)}` in the response slot instead of letting the exception propagate. The existing `tutor_usage.error` contract (returned around line 733-ish per the brainstorm) is the template.

Concrete pattern for each sub-block:

```python
try:
    tutor_usage = compute_tutor_usage(...)
except Exception as e:
    tutor_usage = {"error": str(e)}

try:
    notebook_label_heatmap = compute_heatmap(...)
except Exception as e:
    notebook_label_heatmap = {"error": str(e)}

try:
    labeling_throughput = compute_labeling_throughput(...)
except Exception as e:
    labeling_throughput = {"error": str(e)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server/python && uv run pytest tests/test_analysis_temporal_partial_failure.py -v`
Expected: PASS.

- [ ] **Step 5: Update the frontend to render per-card errors**

In `src/pages/analysis/MultiLabelAnalysis.tsx`, find the temporal section. Replace any code that does `if (!temporal) return …` with per-card checks:

```tsx
{temporal.tutor_usage.error ? (
  <p className="italic text-app-danger">— {temporal.tutor_usage.error}</p>
) : (
  <TutorUsageChart data={temporal.tutor_usage} />
)}

{temporal.notebook_label_heatmap.error ? (
  <p className="italic text-app-danger">— {temporal.notebook_label_heatmap.error}</p>
) : (
  <NotebookHeatmap data={temporal.notebook_label_heatmap} />
)}

{temporal.labeling_throughput.error ? (
  <p className="italic text-app-danger">— {temporal.labeling_throughput.error}</p>
) : (
  <ThroughputChart data={temporal.labeling_throughput} />
)}
```

The actual component names and prop shapes will match what's already in `MultiLabelAnalysis` — change names to fit. The key change is **per-card** error rendering instead of **page-level** unmount.

- [ ] **Step 6: Commit**

```bash
git add server/python/main.py server/python/tests/test_analysis_temporal_partial_failure.py src/pages/analysis/MultiLabelAnalysis.tsx
git commit -m "fix(analysis): per-card failure isolation in /api/analysis/temporal"
```

---

### Task 21: Per-label drill-down filter in multi-label view

**Files:**
- Modify: `src/pages/analysis/MultiLabelAnalysis.tsx`

- [ ] **Step 1: Add state and URL sync**

Near the top of `MultiLabelAnalysis`, add:

```tsx
import { useSearchParams } from 'react-router-dom'

// inside the component:
const [params, setParams] = useSearchParams()
const selectedLabel = params.get('label')

const setSelectedLabel = (next: string | null) => {
  const update = new URLSearchParams(params)
  if (next) update.set('label', next)
  else      update.delete('label')
  setParams(update, { replace: false })
}
```

- [ ] **Step 2: Wire the Label Frequency chart**

Find the existing Label Frequency rendering (per the brainstorm, around `AnalysisPage.tsx:471-521` — now in `MultiLabelAnalysis.tsx`). Add an `onClick` to each label row that toggles selection:

```tsx
onClick={() => setSelectedLabel(selectedLabel === label.name ? null : label.name)}
className={`... ${selectedLabel === label.name ? 'outline outline-1 outline-app-accent' : ''}`}
```

- [ ] **Step 3: Add the filter chip**

Near the top of the page (just under the header), conditionally render:

```tsx
{selectedLabel && (
  <div className="sticky top-0 z-10 bg-app-surface/90 backdrop-blur-sm border border-app-edge rounded px-4 py-2 inline-flex items-center gap-2 my-4">
    <span className="text-app-on-surface text-sm">
      Filtered: <strong>{selectedLabel}</strong>
    </span>
    <button
      type="button"
      onClick={() => setSelectedLabel(null)}
      className="text-app-faint hover:text-app-on-surface text-sm cursor-pointer"
    >
      clear ✕
    </button>
  </div>
)}
```

- [ ] **Step 4: Apply the filter to dependent sections**

For each section that should respect the filter (Position, Throughput, Notebook heatmap), wrap the data with a memoized filter:

```tsx
const filteredPosition = useMemo(
  () => selectedLabel
    ? summary.position_distribution.filter(p => p.label === selectedLabel)
    : summary.position_distribution,
  [summary.position_distribution, selectedLabel]
)
```

Apply the same pattern to throughput and notebook heatmap data props.

- [ ] **Step 5: Manual smoke test**

`npm run dev`, navigate to `/analysis` in multi-label mode. Click a label in Label Frequency. Confirm:
- URL gains `?label=<name>`
- Filter chip appears
- Position, throughput, and notebook sections narrow to that label
- Clicking the chip's clear button restores everything

- [ ] **Step 6: Commit**

```bash
git add src/pages/analysis/MultiLabelAnalysis.tsx
git commit -m "feat(analysis): per-label drill-down filter in multi-label view"
```

---

## Phase 5 — End-to-end verification

### Task 22: Full E2E walkthrough + aesthetic checkpoint

- [ ] **Step 1: Start the full stack with real data**

```bash
npm run dev:all
```

This runs the kubectl port-forward, backend, and frontend together.

- [ ] **Step 2: Set up at least one complete single-label run**

If your local DB lacks single-label runs, create one through the UI:
- Switch to single mode → `/run`
- Promote a label, decide on enough messages to populate cohort + run-detail
- If AI predictions don't exist, run autolabel via the existing flow

- [ ] **Step 3: Run the full verification checklist from the spec**

Walk through every numbered step in the "End-to-end (manual)" section of `/Users/minchan/.claude/plans/let-s-fix-up-this-smooth-anchor.md`:

1. Cohort table shows all single-label runs with yes-rate and disagreement.
2. Click a row → URL becomes `?view=run&run_id=...`, run detail renders with all four findings sections.
3. Reload → deep link survives.
4. Switch to multi-label mode → existing dashboard renders unchanged (apart from milestones from endpoint, notebook breakdown, drill-down chip, per-card error isolation).
5. Click a label in Label Frequency → filtered mode; clear chip restores.
6. Force a temporal sub-failure (e.g. patch one compute function to raise) → only that card shows error.
7. **Aesthetic walkthrough (single-label, app-native r2):**
   - The whole view fits in 100vh without scrolling the page (cohort rail and drawer have internal scroll only).
   - Top bar matches `Navigation.tsx` (brand + nav links + mode toggle).
   - Cohort rail is 304px wide; each entry shows name, desc, three metric pills, status row with a tiny moss sparkline on the right.
   - Selected cohort entry shows a 2px ochre left border.
   - Run-detail pane: eyebrow `RUN` + run name + readout including both `% msgs` and `% convos`.
   - Sub-tab strip (`Label health` / `Findings`) with ochre underline on active.
   - Health view: histogram fills left, AI coverage + Agreement-by-confidence stacked on right (252px), disagreement strip full-width below.
   - Findings view: assignment bars left, position trio + weekly sparkline right; example messages pill at the bottom opens a slide-up drawer (38vh).
   - Cards use `rounded-sm` (2px), 1px `edge-warm` borders. No chunky shadows, no gradients, no editorial section marks (`§`), no journal mastheads, no drop caps.
   - 2px ochre progress strip under the top bar on initial fetch.
   - Network tab → only `Source+Serif+4` font is fetched (no Inter, no Roboto, no Fraunces, no Newsreader).
   - Reduced-motion (`prefers-reduced-motion`) disables stagger animations.

- [ ] **Step 4: Run full test suites once more**

```bash
cd server/python && uv run pytest
```
Expected: PASS.

```bash
npm test
```
Expected: PASS.

- [ ] **Step 5: Final commit (if Step 3 surfaced any small fixes)**

```bash
git add -p   # stage selectively
git commit -m "fix(analysis): final E2E polish"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Implementing tasks |
|---|---|
| Mode-aware /analysis | Task 2 (dispatcher) |
| Split-pane shell (cohort rail + run-detail pane) | Task 6 |
| Cohort rail with sparklines | Task 7 (CohortRail) + Task 7a (RailSparkline) |
| Run-detail pane with sub-tabs | Task 14 (RunDetailPane composes HealthSubtab + FindingsSubtab) |
| Confidence histogram | Task 8 |
| AI coverage card (NEW) | Task 7b (CoverageCard) |
| Agreement by confidence (NEW) | Task 7c (AgreementByConfidence) |
| Disagreement callout | Task 9 |
| Yes-rate by assignment | Task 10 |
| Yes-rate by position | Task 11 |
| Yes-rate over time | Task 12 |
| Examples drawer (slide-up overlay) | Task 13 (ExamplesDrawer) |
| Conversation-level yes-rate | Task 14 (header readout) + Task 16 (backend `run.conv_yes_pct`) |
| Backend cohort endpoint + weekly sparkline | Task 15 |
| Backend run-detail + ai_coverage + agreement_by_confidence + conv_yes_pct | Task 16 |
| Milestones JSON + endpoint | Task 18 |
| `notebook_breakdown` surfaced | Task 19 |
| Per-card failure isolation | Task 20 |
| Per-label drill-down | Task 21 |
| App-native aesthetic (split-pane, chart-cards, sub-tabs, no editorial chrome) | Tasks 6–14 + Task 22 aesthetic checkpoint |
| TS types (incl. AgreementBucket, weekly_sparkline, ai_coverage, agreement_by_confidence) | Task 1 |
| Mock fixtures | Task 3 |
| API client | Task 4 |

All sections covered.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in the plan. Each step has concrete code or a concrete command.

**Type consistency:** `SingleLabelCohortRow`, `SingleLabelCohortResponse`, `ConfidenceBin`, `ExampleMsg`, `SingleLabelRunDetail`, `AssignmentMilestone` defined in Task 1 and referenced consistently by name in Tasks 3, 4, 7–14, 17–18. Backend response shapes in Tasks 15, 16 match the TS types field-for-field.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-analysis-single-label-view.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for letting me handle the mechanical work while you stay in oversight mode.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
