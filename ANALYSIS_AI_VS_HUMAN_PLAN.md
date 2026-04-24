# Analysis tab: human vs AI labeling — plan

This document is the working plan for the **Analysis** page (`/analysis`): how we compare **instructor (human)** and **model (AI)** labeling, what is implemented today, and what to build next. It complements `WORKFLOW.md` (instructor-first pipeline) with analysis-specific goals and definitions.

---

## 1. Research goals

- **Volume and mix**: How often does each behavior label appear, and what share of applications are human vs AI?
- **Coverage**: What fraction of real student messages (`tutor_query` in Postgres) have been touched by human labels, AI labels, or neither?
- **Where in the transcript** labels attach (early / mid / late), including a **human vs AI split** in the position view.
- **Context**: When students use the tutor (time of day, weekday, calendar), and how labeling throughput (human vs AI per day) tracks that.
- **Future**: **Agreement** between human and AI on the same message, **correction workflows**, and **quality** views (shadow runs, calibration) once data and APIs exist.

---

## 2. Definitions (must stay consistent in UI + API)

| Concept | Meaning in code / DB |
|--------|----------------------|
| **Human label** | `LabelApplication` with `applied_by == "human"`. |
| **AI label** | `LabelApplication` with `applied_by == "ai"`. |
| **Application** | One row: one label on one `(chatlog_id, message_index)`. A message can have multiple labels and both human and AI applications over time. |
| **`label_counts`** (API) | Count of applications per label name (all sources combined). |
| **`human_label_counts` / `ai_label_counts`** | Applications per label, split by `applied_by`. |
| **Coverage `human_labeled` / `ai_labeled`** | Distinct `(chatlog_id, message_index)` that have **at least one** human (or AI) application. The same message can contribute to **both** counts; the UI stacked bar can exceed 100% of “total messages” and is **scaled** so the three segments (human, AI, unlabeled) still fit visually. |
| **Coverage `total`** | Count of `tutor_query` events in the external Postgres DB (proxy for “student messages to label”). |
| **Position buckets** | `message_index` 0–2 → early, 3–6 → mid, 7+ → late; counts are **applications** (not deduped by message) in `position_distribution`. |
| **`position_distribution_human` / `position_distribution_ai`** | Same buckets, filtered by `applied_by`. |
| **`label_source_mix`** | Per label name: distinct `(chatlog_id, message_index)` that have that label from **human only**, **AI only**, or **both** (same message, same label, both sources). |

Document any future change to these definitions in this file and in API docstrings.

---

## 3. Current implementation (snapshot)

### Backend

- **`GET /api/analysis/summary`** (`server/python/main.py`): `label_counts`, `human_label_counts`, `ai_label_counts`, `notebook_breakdown`, `coverage`, `position_distribution`, `position_distribution_human`, `position_distribution_ai`, `label_source_mix` (distinct messages per label: human-only / AI-only / both).
- **`GET /api/analysis/temporal`**: Tutor usage (hour, weekday, calendar day), notebook × label heatmap (raw / row / column normalized), **labeling throughput** per calendar day (`human`, `ai`, `total`). Time bucketing uses `ANALYSIS_TIMEZONE` (IANA, default `America/Los_Angeles`).
- **`GET /api/export/csv`**: Full label export for offline analysis.

### Frontend (`src/pages/AnalysisPage.tsx`)

- **Label frequency**: Modes **Combined** (CSS bars: total length ∝ count vs max label; emerald = human share, indigo = AI share), **Human only**, **AI only** (Recharts horizontal bars).
- **Coverage**: Stacked bar + table (human-labeled, AI-labeled, unlabeled vs total messages).
- **Conversation position**: Per-label early / mid / late; modes **All / Human / AI / Human+AI** (stacked split). **Messages per label** table from `label_source_mix`.
- **Methodology**: collapsible “How to read these metrics” plus CSV export filters (**applied_by**, optional **calendar** range on `LabelApplication.created_at`).
- **Temporal**: Hour / weekday charts, month calendar with tutor volume + course milestone dots, throughput chart, notebook heatmap with mode toggle.
- **Download CSV** for raw tables.

### Tests

- `server/python/tests/test_analysis.py`, `test_temporal_analysis.py`
- `src/tests/AnalysisPage.test.tsx`

---

## 4. Known limitations / caveats

- **Combined frequency** uses `human + ai` application counts per label; it does not dedupe if both applied the same label to the same message (rare but possible).
- **Position “All apps”** still mixes sources; use **Human+AI** mode for the split view.
- **Notebook breakdown** in the summary is keyed off chatlog → notebook mapping from Postgres; failures fall back to empty breakdown with `total` still from queries if possible.
- **Recharts** combined stacked horizontal bars were unreliable; combined mode intentionally uses **HTML/CSS** for the split bars.

---

## 5. Roadmap (prioritized)

### Phase A — Clarify and drill down (low risk)

- [x] Short **on-page methodology** blurb (or link to this doc) for coverage overlap and application vs message.
- [ ] **Filters**: date range, notebook, or “human only / AI only / all” for **summary** stats (may need new query params + SQL).
- [x] **Export**: optional CSV filtered by `applied_by` or date.

### Phase B — Human vs AI comparison (medium effort)

- [x] **Position split**: same early/mid/late view with human vs AI stacks or side-by-side.
- [x] **Per-label coverage**: among messages that have label L, what fraction human-only, AI-only, both? (`label_source_mix` + table)
- [ ] **Throughput vs usage**: normalize labeling counts by tutor traffic (optional ratio chart).

### Phase C — Agreement and quality (research-heavy)

- [ ] **Disagreement set**: messages where human and AI applied different non-empty label sets; export + queue link.
- [ ] **Agreement metrics**: precision/recall/F1 treating human as reference (only where human labeled); stratify by label prevalence.
- [ ] Wire **shadow evaluation** / quality APIs (if present in backend) into Analysis or a dedicated “Quality” subsection.

### Phase D — Polish

- [ ] Accessibility pass on custom bars (keyboard, ARIA values mirroring tooltips).
- [ ] Empty states and loading skeletons consistent across sections.

---

## 6. File map

| Area | Location |
|------|-----------|
| Analysis UI | `src/pages/AnalysisPage.tsx` |
| Types | `src/types/index.ts` (`AnalysisSummary`, `TemporalAnalysis`) |
| API client | `src/services/api.ts` |
| Summary + temporal routes | `server/python/main.py` |
| Fixtures / mocks | `src/mocks/index.ts` (if extended for analysis) |

---

## 7. Revision log

| Date | Change |
|------|--------|
| 2026-04-17 | Regenerated plan: goals, definitions, current stack, limitations, phased roadmap. |
| 2026-04-18 | Shipped Phase A (methodology, CSV filters) + Phase B (position human/AI, `label_source_mix`). |

When you ship a milestone, add a row here and tick boxes in §5.
