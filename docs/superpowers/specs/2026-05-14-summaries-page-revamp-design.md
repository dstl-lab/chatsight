# Summaries page revamp — design spec

**Date:** 2026-05-14
**Branch:** `main` (work to begin on a feature branch)
**Owner:** @m1nce
**Status:** Draft — pending user approval

---

## 1. Motivation

Today's `/summaries` is a flat list of "handoff" cards: one per label that Gemini has classified. Each card shows verdict counts, the patterns Gemini included/excluded, and (when a handoff is running) live status. That's the entire affordance: counts + patterns. There is no path from a card to "look at the actual messages Gemini labeled YES," no way to flip a wrong prediction, no way to refine the label, and no way to manage labels at all (CRUD lives at `/labels`).

In single-label mode, this gap is more acute: `/labels` carries little workflow weight (labels are born from `/run`, not created at `/labels`), and `/summaries` is where instructors *want* to live post-handoff but cannot do useful work.

The revamp turns `/summaries` into the single-label workflow hub — combining live classification monitoring, label CRUD, post-classification message inspection with one-click correction, AI-assisted split/merge, and interpretability — and replaces `/labels` in the single-label nav. Multi-label mode is unchanged.

The anchor outcome is **"fix the dataset"**: the instructor inspects Gemini's verdicts and flips the wrong ones so the YES/NO buckets become trustworthy training/analysis data.

---

## 2. Scope

**In scope (v1):**
- Single-label mode UI revamp at `/summaries`.
- Master-detail layout: label rail + detail panel with five tabs (Browse · Review · Patterns · Refine · Settings).
- Per-message inspection with surrounding conversation context (±N tutor turns, both sides).
- One-click verdict flip, flagging, per-message notes.
- Review-bucket queue mode with cluster bulk-flip and threshold tuning.
- AI-assisted split/merge candidates surfaced in the Refine tab.
- Label CRUD (rename / edit description / delete / re-handoff / sample re-handoff).
- Backend extensions: `LabelApplication` gains `matched_pattern`, `rationale`, `flagged`, `note`.
- New API endpoints (Section 11).

**Out of scope (deferred to v2 or later):**
- Semantic search inside the message list (v1 uses substring `ILIKE`).
- Multi-instructor conflict resolution (single-instructor model assumed).
- Audit history of flips (no immutable history view in v1).
- Multi-label mode revamp — multi-label `/summaries` stays exactly as it is today.
- Real-time collaboration on the same label.

---

## 3. Page architecture and routing

**Route:** `/summaries` remains the single entry point. The `SummariesPage` component branches on `useMode()` at the top:
- `mode === 'multi'`: renders today's component unchanged.
- `mode === 'single'`: renders the new master-detail UI described below.

**Nav (`src/components/Navigation.tsx`):** in single-label mode the `/labels` link is dropped from the link list. `/summaries` carries the label-management load. Multi-label mode's nav is untouched. The `/labels` route stays mounted but redirects to `/summaries` via `<Navigate replace>` in single-label mode (handles stale bookmarks).

**Empty state:** when there are no labels in single-label mode yet, the detail pane shows a single empty-state card pointing the user to `/run` ("labels are born from labeling — head to Run to create your first one"). Labels are not created directly here on day one; new-label creation in `/summaries` is a v1.1 nice-to-have, not required for the anchor outcome.

**Page-level layout:** flex column at full viewport height. Top bar (existing `Navigation`) over a two-column body: rail (~220px) | detail panel (1fr). No page-level scroll; only tab content scrolls.

---

## 4. Master-detail rail

Left rail, ~220px wide, vertically scrollable. Each row corresponds to one label.

**Row content:**
- Status dot (color from existing tokens):
  - moss = `done`
  - ochre with `animate-ping` halo = `classifying` (in-flight)
  - brick = `failed`
  - stone = `archived` (the `JOB_STATE_PENDING` queued state is animated under `classifying`, not stone)
- Label name (`text-paper`, font-serif, 13px).
- One-line mono subtitle:
  - if classifying: `▓▓░░░░ 23% · running` (the existing batch-progress UI condensed) or `▓▓░░░░ Queued · Gemini batch` when batch state is non-`SUCCEEDED`.
  - if done: `{total} · {N} in review` (count of items in the review bucket — surfaces the throughput target).
  - if failed / rate-limited: `⏱ rate-limited · retry` or `✕ failed`.

**Live monitor** lives here primarily — the rail badges + dot animations are how the instructor catches state changes while focused on the detail panel. The detail header also surfaces monitor state for the active label (Section 5.2).

**Bottom of rail:** dashed `+ new label` button (deferred to v1.1 — see Section 2).

**Active row** receives `bg-elevated` + ochre left border.

---

## 5. Detail panel

### 5.1 Header (sticky)

**Title row:**
- Label name (serif, 26px, `text-paper`, `tracking-[-0.012em]`).
- Italic description below (`text-muted`, 13px).
- Right-aligned `⋯` menu — opens a popover with: `Rename` / `Edit description` / `Re-handoff` / `Sample re-handoff…` / `Delete`. **Re-handoff is intentionally folded into this menu** (not a separate button) to reduce header noise.

**Stat strip:**
- `{N} YES` (moss) · `{N} NO` (brick) · `{N} Review` (ochre).
- Trailing `ⓘ` info icon: hover reveals the **confidence-distribution sparkline** and the **agreement-vs-gold-set percentage**. Both are decision-supporting but secondary — moved out of the primary strip to reduce clutter.

**Tab strip:** `Browse · Review · Patterns · Refine · Settings`.
- `Review` carries a small ochre count badge when items are in the review bucket (the only tab with a badge).

**While classifying:** the stat strip is replaced by the existing batch-state UI (counts of completed sub-batches, % bar, stale-poll hint). The tab strip stays — Browse and Review are unavailable but Patterns / Refine / Settings can still be entered.

### 5.2 Browse tab (default for done labels)

Two-column split inside the tab body (~45/55).

**Left: message list pane**
- **Filter bar (top):** `All · YES · NO · Review · + more`. The `+ more` overflow holds `Flagged`, `Notes`, and `Pattern: …` chips. **Per-chip counts are dropped from the labels** (the header strip already shows them); chips themselves toggle filters.
- **Search input:** italic serif placeholder ("search messages…"); substring filter via backend `ILIKE` (no embedding-based semantic search in v1).
- **Sort menu:** default `confidence ↑` (borderline first — drives outcome A). Alternatives: `confidence ↓`, `recently flipped`, `notebook`, `chatlog id`.
- **Rows:** confidence number (color-coded by verdict; ochre for near-threshold) + truncated message preview + note dot + flag glyph. Active row gets `bg-elevated` + ochre left border.
- **Bulk action bar** appears when ≥1 row is checked: `Flip selected to NO/YES`, `Flag selected`, `Clear`.
- **Keyboard nav:** `j/k` move · `f` flip · `n` note · `/` search · `1/2/3` filter to YES/NO/Review.
- **Virtualization:** `react-window` (new dep) — YES buckets can exceed 1 000 rows.

**Right: focused message pane** (on the warm `bg-warm` backdrop)
- Breadcrumb: `chatlog #N · notebook · turn M of K · context ±1 ▾` (the `▾` opens the depth control: `±1 / ±2 / ±3 / full`; default persisted in `localStorage`).
- **Conversation context (focus-first pattern):** two collapsed-by-default bars — `▾ N tutor turns before` and `▾ N tutor turns after` — flank a prominently-anchored student message (ochre left rail + warm tint background, serif body text at 19px). Bars expand on click or via depth control. Both sides of the conversation are fetched, not just the prior turn — this is a critical correction from today's behavior (which shows only the prior tutor turn).
- **Verdict block:** badge (`YES · .58` ochre / `YES · .82` moss / `NO · .14` brick) + clickable pattern excerpt (links into Patterns tab filter) + a `why ▾` toggle that expands Gemini's rationale and "near review threshold" marker. **Rationale is collapsed by default** — high-confidence verdicts don't need it visible.
- **Actions:** `✓ accept [↵]` (primary, moss-tinted) · `↺ flip [f]` · `⚑ flag [⇧F]`. Single click commits an **optimistic update** with a 5s undo toast.
- **Note block:** collapsed `+ add note` chip by default. Expands to a serif textarea that auto-saves on blur. Notes feed into Refine tab heuristics.

### 5.3 Review tab (queue mode)

A dedicated tab for the Review bucket throughput problem (the bucket can hold hundreds of items; the side-by-side Browse layout is wrong for high-throughput single-decision work).

**Layout (full pane, single column, max-width 880px centered):**

**Queue bar (top, sticky):**
- Large `{done} of {total} reviewed` counter (mono, 22px tabular nums).
- Thin progress bar (moss gradient).
- Right-aligned actions: `⚙ threshold · .70` quick-access · `↻ shuffle order` · `⏸ pause`.

**Threshold popover** (opens from `⚙ threshold`):
- Slider for `review_threshold` (range 0.50–0.95).
- **Live preview** as the user drags: `at .60: review shrinks from 91 → 23`. No Gemini call — re-buckets existing AI rows client-side; the `Save & re-bucket` button persists the threshold to `LabelDefinition.review_threshold` and re-computes buckets on the server.

**Cluster banner** (when the next item is part of a cluster ≥3):
- Background-running embedding cluster of the Review bucket (re-uses `concept_service.py` infrastructure).
- Banner shows: `3× icon · "3 similar messages — same notebook, near-identical phrasing" · three excerpts · [Apply YES to all 3 (A)] [skip]`.
- Pressing `A` calls bulk-flip on the cluster's `msg_ids` and skips the cursor past them.
- Most Review items cluster (same notebook + similar phrasing) so this typically collapses a 91-item queue to ~20–30 actual decisions.

**Stage (center):**
- Same context bars + focused-anchor pattern as Browse (consistency — instructors learn one mental model).
- The focused message is **larger** (19px serif).
- Verdict block: badge + pattern link + `near threshold` marker + `why ▾`. Rationale collapsed by default.

**Action row (sticky bottom, four big keyboard targets):**
- `✓ Yes [Y]` (moss border, hover bg)
- `✗ No [N]` (brick border, hover bg)
- separator
- `↷ Skip [S]` (defers without committing; cycles back at end of queue)
- `↺ Undo [⌫]` (rolls back the last decision with a 5s window)

**Auto-advance:** after each decision the queue advances; reaching the end shows a completion card with stats (`done · X flipped · Y skipped · Z left`).

### 5.4 Patterns tab

Keeps today's two-column structure (included / excluded) and adds interactivity.

- Each pattern excerpt is **clickable** — clicking it switches to Browse with a `Pattern: "<excerpt>"` filter chip applied. The verdict block's pattern link in Browse and Review does the same (bidirectional Pattern ↔ Browse loop).
- **Count badge** per pattern: `↗ N messages` — the count helps the user decide if the pattern is real or noise.
- Today's frequency string + confidence-avg sparkline are kept as-is.
- Patterns themselves are **not editable** — they're Gemini output. Refining the label happens via description edits in Refine (and Settings).

### 5.5 Refine tab

Three cards, each surfacing one refinement workflow.

**Card 1 — Refine in place** (always available):
- Edit name and description in serif inputs.
- `Re-handoff with revised description` button. Warning copy: *"this will produce a new run; the current YES/NO bucket is preserved as a snapshot until you accept the new one."* (Snapshotting is v1.1 — see Open Questions.)

**Card 2 — Split** (available when YES bucket ≥ 50):
- `Find candidate splits` button → calls `POST /api/single-labels/:id/find-splits`.
- Backend: embeds the YES bucket, runs KMeans (k=2..4), asks Gemini to name and describe each cluster. Returns 2–4 candidate sub-labels with `name`, `description`, `representative_excerpts` (3–5 per cluster), and `msg_ids`.
- UI: cards side-by-side, each editable (instructor can rename / edit description before accepting).
- Per candidate: `Accept` / `Reject` / `Edit`.
- **Commit confirmation modal:** typed-name confirmation, lists what will happen (N new labels created, M messages reassigned, parent label kept or deleted).
- Long-running call (~30–60s); inline progress strip + ability to navigate away, with a small badge appearing on the Refine tab when results land.

**Card 3 — Merge** (available when ≥ 2 labels exist):
- AI surfaces candidates — pairs of labels whose YES buckets overlap by ≥ a threshold of shared messages or whose pattern excerpts are highly similar (re-uses existing embeddings).
- Each suggestion: pair names + overlap stat ("64% of YES messages shared") + sample overlapping excerpts + `Merge` / `Dismiss`.
- `Manual merge…` button → modal to pick any two labels.
- Merge modal asks: name for the merged label, which description to keep, what happens to non-overlapping messages (default: keep all, recompute YES = YES in either).
- Typed-name confirmation before commit.

### 5.6 Settings tab

The boring config surface — every action also reachable from `⋯` or Refine, but lives here for discoverability.

- Rename (input).
- Edit description (textarea).
- **Review threshold slider** (same control as the Review tab popover; persisted to `LabelDefinition.review_threshold`).
- `Re-handoff` (full) button.
- `Sample re-handoff` input + button (re-classify N random messages — useful when only a slice of the dataset has changed).
- `Delete label` (typed-name confirmation) — reuses the existing archive backend path that returns orphaned messages to the unlabeled pool.

### 5.7 Cross-cutting principle

Every tab points back into Browse:
- Patterns → Browse via filter chip.
- Refine cluster cards → Browse via clicking a representative excerpt.
- Settings re-bucket / threshold changes → Browse with updated counts.

Browse is the trunk; the other tabs are branches.

---

## 6. Density principles (what was trimmed and why)

The earlier high-density mockup felt cluttered. Specific trims:

**Header:**
- Sparkline + agreement metric moved behind a `ⓘ` tooltip next to the counts.
- Re-handoff button folded into the `⋯` menu.
- Tab count-badges removed (counts already shown in chips — except Review badge which stays as a workload signal).

**Browse:**
- 6 filter chips → 4 essentials + `+ more` overflow (`Flagged`, `Notes`, `Pattern:` live there).
- Per-chip count numbers dropped from labels (hover surfaces them).
- Rationale hidden behind `why ▾` toggle.
- Near-threshold info nested inside the `why ▾` expansion.
- Note field collapsed into `+ add note` chip.

**Review tab specifically:** all secondary content (notes, flagging, full pattern audit) is deferred to Browse — Review is single-purpose throughput mode.

---

## 7. Data model changes

`server/python/models.py` — extend `LabelApplication`:

| Column | Type | Purpose |
|---|---|---|
| `matched_pattern` | `Optional[str]` | Pattern excerpt Gemini matched when `applied_by='ai'`. Drives Patterns ↔ Browse link. |
| `rationale` | `Optional[str]` | Gemini's per-message rationale. Surfaced via the `why ▾` toggle. |
| `flagged` | `bool = False` | Instructor flag for refinement workflow. |
| `note` | `Optional[str]` | Instructor's per-(label, message) note. Feeds Refine heuristics. |

All columns nullable. Migration code in `database.py` follows the existing pattern: `ALTER TABLE ... ADD COLUMN ...` guarded by `PRAGMA table_info` check at startup. No data backfill.

`autolabel_service.py`:
- Extend the `classify_messages` Gemini function-calling tool schema with `matched_pattern: string` and `rationale: string` per item.
- Persist these into the new columns when writing `LabelApplication` rows.
- Backward-compatibility: existing AI rows without these fields render with `why ▾` showing "no rationale recorded" and an info hint that the user can re-handoff to backfill.

---

## 8. New API surface

All endpoints live under `/api/single-labels/...` to keep them out of the multi-label namespace. Most are id-scoped (`/api/single-labels/:id/...`); the two cross-label refinement endpoints (`find-merges`, `commit-merge`) are collection-level. Schemas in `schemas.py`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/single-labels/:id` | Label detail: name, description, counts, agreement-vs-gold-set, confidence histogram bins, `review_threshold`. |
| `GET` | `/api/single-labels/:id/messages` | List with query params: `filter` (`yes` / `no` / `review` / `flagged` / `notes` / `pattern={excerpt}`), `sort`, `search`, `offset`, `limit`. Rows include `confidence`, `verdict`, `applied_by`, `note?`, `flagged`. |
| `GET` | `/api/single-labels/:id/messages/:msg_id` | Per-message detail: text, surrounding turns (`?context=1\|2\|3\|full`, default 1), verdict, `matched_pattern`, `rationale`, note. |
| `PATCH` | `/api/single-labels/:id/applications/:msg_id` | Flip verdict (`{verdict: 'yes'\|'no'}`). Sets `applied_by='human'`. |
| `POST` | `/api/single-labels/:id/applications/bulk-flip` | Body: `{msg_ids: int[], verdict: 'yes'\|'no'}`. Idempotent. |
| `POST` | `/api/single-labels/:id/applications/:msg_id/flag` | Toggle flag (DELETE to unflag). |
| `PUT` | `/api/single-labels/:id/applications/:msg_id/note` | Upsert note. Empty string = delete. |
| `POST` | `/api/single-labels/:id/find-splits` | Long-running. Returns 2–4 candidate clusters. |
| `POST` | `/api/single-labels/:id/commit-split` | Body: `{candidates: [...], delete_parent: bool}`. Transactional. |
| `POST` | `/api/single-labels/find-merges` | Cross-label overlap analysis. Returns ranked candidate pairs. |
| `POST` | `/api/single-labels/commit-merge` | Body: `{label_a_id, label_b_id, new_name, new_description, keep_description_from}`. Transactional. |
| `PATCH` | `/api/single-labels/:id` | Rename, edit description, update `review_threshold`. |
| `DELETE` | `/api/single-labels/:id` | Reuses existing archive path. |
| `GET` | `/api/single-labels/:id/review-clusters` | Returns embedding clusters of the Review bucket for the Review tab cluster banner. |

`review-clusters` is computed lazily (first-call per session per label) and cached for the duration of the page load.

---

## 9. Data flow and state

**Polling:** the existing 2s `/api/handoff-summaries` poll continues while any label is `classifying`. Polling stops when all labels reach a terminal state. The poll drives rail badges and the detail header's monitor strip for the active label.

**Lazy fetch:**
- Rail click → `GET /api/single-labels/:id` (label detail; counts + agreement + histogram + threshold).
- Tab enter (Browse) → `GET .../messages?offset=0&limit=50&sort=conf_asc`.
- Row click → `GET .../messages/:msg_id?context=<persisted>`.
- Review tab enter → label detail + `GET .../review-clusters` + first message in queue.

**Optimistic updates:**
- Flip, flag, note all update local state immediately.
- 5s undo toast for flips (existing toast component).
- On PATCH/POST failure: roll back local state, show error toast with retry.

**Bulk flip:** local rows update first, then the bulk endpoint runs. Failure of the entire bulk call rolls all rows back; partial failures (shouldn't happen in v1 — endpoint is all-or-nothing transactionally) would render as an error toast with the failed `msg_ids`.

**Virtualization:** `react-window` for the Browse message list. Add to `package.json` as a new dep.

---

## 10. Persisted UI state (`localStorage`)

| Key | Value | Purpose |
|---|---|---|
| `summaries.context_depth` | `'1' \| '2' \| '3' \| 'full'` | Default conversation context depth. |
| `summaries.active_label_id` | `number` | Last selected label; restored on page reopen. |
| `summaries.browse.sort` | sort key | Default sort in Browse. |
| `summaries.browse.filters` | filter chip names | Last active chips. |
| `summaries.review.threshold_unsaved` | `number?` | Threshold slider draft state (does not auto-persist to backend — explicit Save button). |

State management stays in component-local React state; no Redux/Zustand. If complexity grows beyond manageable, `react-query` becomes a follow-up consideration — out of scope for v1.

---

## 11. Error handling

| Failure mode | Behavior |
|---|---|
| Mid-classification rate-limit | Existing rate-limit retry UI preserved; surfaces in rail status dot and detail header monitor strip. |
| Mid-classification general failure | Existing failure card preserved (in detail header during classification, not as a separate card). |
| Flip / flag / note PATCH failure | Optimistic rollback + error toast with retry button. |
| Bulk flip failure | Rollback all rows; error toast lists `msg_ids` (rare). |
| `find-splits` / `find-merges` failure | Inline error in the Refine card with retry button; partial results not persisted. |
| `commit-split` / `commit-merge` failure | Transactional — either fully applied or fully reverted. UI shows error and leaves label state unchanged. |
| Delete failure | Modal stays open, shows error. |
| Network offline / 5xx generic | Existing fetch error handler in `services/api.ts`. |

---

## 12. Testing

**Frontend** — extend `src/tests/SummariesPage.test.tsx`:
- Existing batch-state tests stay (covers multi-label mode behavior under classification).
- New tests (single-label mode):
  - Master-detail rail renders with mixed statuses.
  - Browse default sort = `confidence_asc`.
  - Flip is optimistic and rolls back on PATCH failure.
  - Filter chip click updates the list.
  - Pattern excerpt click switches to Browse with the pattern filter applied.
  - Context depth control persists to `localStorage` and surfaces on subsequent message opens.
  - Review tab queue advances after a keystroke decision.
  - Cluster banner appears for ≥3-cluster items and bulk-flips on `A`.
  - Threshold popover live-preview updates the queue count without calling the backend.
  - Refine `Find candidate splits` shows candidates after stubbed endpoint resolves.
  - Settings re-handoff requires confirmation.

**Backend** — new file `server/python/tests/test_single_labels.py`. Use the existing in-memory SQLite fixture pattern from `tests/conftest.py`. Cases:
- `GET messages` pagination + filtering + sorting (including `filter=pattern=...`).
- `GET messages/:msg_id` returns ±N surrounding turns from the external `events` table (mock the external DB or use the integration fixture).
- `PATCH applications` flips verdict, sets `applied_by='human'`, returns updated counts.
- `bulk-flip` is idempotent and transactional.
- `find-splits` with mocked Gemini + embeddings returns the expected candidate shape.
- `commit-split` creates labels and reassigns rows transactionally; partial-state corruption test (induced failure mid-commit) rolls back.
- `find-merges` overlap stats math.
- `commit-merge` consolidates rows and preserves the chosen description.
- `review-clusters` returns expected shape on a seeded review bucket.

---

## 13. Phasing

To reduce v1 surface area while keeping the anchor outcome intact, the spec is implementation-phased:

**Phase 1 (anchor — outcome A only):**
- Master-detail layout + rail.
- Detail header with stats strip (sparkline/agreement in tooltip).
- Browse tab with filters, sort, search, virtualized list, conversation context, verdict block, one-click flip, note.
- Settings tab (rename, edit description, delete, full re-handoff).
- `LabelApplication` schema extensions + autolabel persistence.
- API endpoints: label detail, list messages, message detail, flip, note, PATCH label, DELETE label.
- Tests for the above.

**Phase 2 (throughput + audit):**
- Review tab queue mode with keyboard actions.
- Threshold popover (slider + live preview + re-bucket).
- Patterns tab with click-to-filter.
- Flag column + bulk flip.

**Phase 3 (refinement):**
- Refine tab Card 1 (refine in place).
- Refine tab Card 2 (split with AI candidates) — `find-splits`, `commit-split`.
- Refine tab Card 3 (merge with AI candidates) — `find-merges`, `commit-merge`.
- Review-cluster banner + `Apply to all (A)` bulk-flip.
- Sample re-handoff in Settings.

Each phase ships independently; Phase 1 delivers the highest-leverage workflow (the "fix the dataset" loop). Phase 2 and 3 unblock the throughput and refinement workflows.

---

## 14. Open questions

1. **Snapshotting on re-handoff:** the Refine "re-handoff with revised description" copy promises that the current YES/NO bucket is preserved until the new run is accepted. Implementing this requires a `LabelHandoffSnapshot` table (or equivalent) and an "accept" / "discard" gesture. Could be deferred to a v1.5 by initially overwriting on re-handoff (with a strong warning) — instructor preference TBD.

2. **Agreement vs. gold set:** the spec assumes a "gold set" = the human-applied `LabelApplication` rows (where `applied_by='human'`). For computing agreement, we measure: of those gold rows, what fraction agree with the AI verdict? This is a simple SQL aggregate, but should be confirmed as the intended definition before implementation. Caveat: the metric is unstable when the gold set is small (< ~20 rows) — UI should suppress it or surface a confidence interval below that threshold.

3. **External DB cost of context fetches:** `GET messages/:msg_id` with `context=full` requires loading the full conversation from the external `events` table on every row click. For long conversations this could be slow; v1 caps `full` at 50 turns and adds a server-side cache (TTL 5min) per `chatlog_id`. Confirmation that the cap is acceptable would be useful.

4. **New-label creation in `/summaries`:** the empty state directs users to `/run` to create their first label. The `+ new label` button at the bottom of the rail is wireframed but specified as deferred to v1.1. If instructor flow requires creating labels here, promote to v1 Phase 1.

5. **Substring search performance:** v1 uses `ILIKE` on the cached `MessageCache.text` column. For very large datasets (>50k rows) this will be slow without indexing. The spec does not mandate a full-text index in v1 but flags it for monitoring; if performance bites, add `pg_trgm` or SQLite FTS5 in v1.1.

---

## 15. References

- WORKFLOW.md (repository root) — research context, instructor-first labeling, label management needs.
- LLooM Workbench (Stanford HCI, CHI 2024) — concept-detail drill-in patterns. https://stanfordhci.github.io/lloom/about/vis-guide.html
- DocWrangler (UC Berkeley, UIST 2025) — row-at-a-time with side-by-side source comparison, in-situ notes. https://data-people-group.github.io/blogs/2025/01/13/docwrangler/
- Label Studio Data Manager — confidence-sort + bulk actions. https://labelstud.io/guide/manage_data
- Argilla 2.4 — AI suggestions as weak signals, filters, semantic search patterns. https://huggingface.co/blog/argilla-ui-hub
