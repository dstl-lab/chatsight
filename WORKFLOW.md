# Chatsight Workflow Needs

## Research Context

Chatsight originated as an investigation into student-AI tutoring interactions in an undergraduate data science course. The AI tutor is fine-tuned to reference course material (homeworks, labs, projects) during student conversations.

### Research Evolution

1. **Initial goal**: Analyze transcript data to understand how students interact with AI tutors. Available methods (sentiment analysis, summary statistics, AI-generated summaries) were insufficient for rich qualitative insights.

2. **Second pivot**: Quantify "how well students use AI" via a theoretical scoring equation applied to categorized student messages. This required labeled data.

3. **Manual labeling attempt**: The research group manually labeled chatlog data to build a training set. Key problems surfaced:
   - Rubrics defined upfront became too broad or too narrow mid-process, requiring full relabeling
   - Team members had different threshold interpretations of rubric criteria, causing inconsistency
   - Wasted effort and high anxiety when label schemas needed revision after significant work

4. **Current focus** (HCI + CS Ed research): Build an interface that makes chatlog labeling *efficient and consistent* for instructors. The scoring equation is deprioritized — the labeling tool itself is the research contribution.

---

## Current Goal

Help instructors label student-AI chatlog data with minimal friction:
- Sessions of approximately 30 minutes to 1 hour
- Labels emerge bottom-up from reading data (no fixed rubric required upfront)
- AI assists in suggesting and validating labels
- After instructor labels a sufficient sample, AI auto-labels the rest

---

## Workflow Needs

### 1. Instructor-First Labeling
- Instructors read through messages (or a sample) and create label categories as they go
- Labels emerge from the data rather than being predefined
- Instructors apply labels to individual student messages within transcripts
- Interface should support creating a new label on the fly while reading

### 2. AI-Assisted Label Suggestion
- After instructors establish some initial labels, AI (Gemini) suggests labels for unlabeled messages
- AI may also propose new candidate label categories it detects in the data
- Instructor reviews and accepts/rejects AI suggestions
- Inspired by **LLOOM** (concept-based LLM analysis) and **DocWrangler** (interactive LLM-assisted document labeling)

### 3. Label Management & Refinement
- View all messages grouped by label to assess category consistency
- **Split**: identify a label that is too broad and divide it into subcategories
- **Merge**: identify two labels that mean the same thing and combine them
- **Rename/redefine**: clarify what a label means after seeing real examples
- This view is critical for maintaining labeling consistency across team members

### 4. Sampling Strategy (Open Question)
Two directions under consideration:
- **Random sampling**: select a random subset of messages/conversations to label
- **Diverse/robust sampling**: use some method (e.g., embedding-based diversity, stratified by notebook/topic) to ensure the sample is representative

Goal: ensure a short labeling session yields a training set that generalizes to the full dataset.

### 5. AI Auto-Labeling the Rest
- Once instructors have labeled a sufficient sample, AI labels remaining messages
- Preferred: interpretable and transparent rather than a black box
- Open question: few-shot prompting with Gemini, fine-tuned model, or traditional classifier trained on embeddings

---

## Open Design Questions

| Flow | Page | Status |
|------|------|--------|
| Single-label run (yes / no / skip per message, one label at a time) | `LabelRunPage.tsx` (`/run`) | **Active** — primary flow |
| Multi-label queue (apply N labels per message) | `QueuePage.tsx` (`/queue`) | Legacy; no new feature work |
| Label management (create / merge / split / archive) | `LabelsPage.tsx` (`/labels`) | Active |
| Assignment mappings (regex → assignment name) | `AssignmentsPage.tsx` (`/assignments`) | Active |
| Handoff summaries (post-run AI classification status) | `SummariesPage.tsx` (`/summaries`) | Active |
| Analysis | `AnalysisPage.tsx` (`/analysis`) | Active, sparse on research-grade views |
| History | `HistoryPage.tsx` (`/history`) | Active, minimal |

---

## AI integration points

| Surface | Service | What it does |
|---------|---------|---------------|
| Assist flank | `assist_service.py` (cosine-NN over `MessageEmbedding`) | Surfaces 3 most-similar prior decisions to anchor calibration |
| Handoff classifier | `binary_autolabel_service.py` (Gemini function-calling) | Classifies remaining messages yes / no for one label |
| Multi-label batch (legacy) | `autolabel_service.py` | Classifies messages into N existing label categories |
| Label description from examples | `definition_service.py` | One-sentence Gemini-written label definitions |
| Concept candidates | `concept_service.py` (embedding + KMeans + Gemini naming) | Bottom-up label suggestions from unlabeled clusters |
| Concise summary | `autolabel_service.summarize_message` | Shortens long student messages for display |

---

## What's mature vs WIP

**Mature**: single-label run, assist flank, label management (create / archive / merge / split-with-handoff), assignment mappings, basic analysis coverage.

**WIP / sparse**:
- Recalibration / drift detection (designed, not implemented).
- Post-handoff review (the dock is functional but minimal — no bulk ops, no comparison anchors, no tunable threshold).
- Classifier evaluation (no systematic measurement of Gemini's quality).
- Classifier prompt / few-shot strategy (uses a fixed prompt, naive examples).
- Concept induction integration (the service exists; the UX flow does not surface it well).
- Analysis page as a research-grade dashboard.

**Dormant**: multi-label queue page (intentional — kept working but not prioritized).

---

## Open questions

These supersede the 2026-03 list (which was tied to the older multi-label flow). Five of these are being assigned to research collaborators as week-of-part-time-work briefs (see `docs/handoffs/`):

1. **Smart picker** — what should the queue show next? Current ordering is conversation-aware but not signal-driven. Active-learning literature offers several routes (uncertainty sampling, diversity, calibration-anchored selection).
2. **Drift** — how do we detect and surface labeler inconsistency within a session? The recalibration design is one answer; others exist.
3. **Post-handoff review** — what should the review experience look like for one instructor walking hundreds of low-confidence AI predictions? Today the dock is one-at-a-time with three buttons; bulk operations, batch-by-similarity, and trust-accrual shortcuts are all unexplored.
4. **Classifier quality** — how good is the Gemini handoff classifier today, and what prompt / few-shot strategy actually moves the needle? Build the eval harness first, then run experiments on top of it.
5. **Negative-space mining** — after several labels exist, which messages are getting actively rejected by every label tried? Cluster that residual; treat each coherent cluster as a candidate missing label or as out-of-scope data the instructor should explicitly acknowledge. Distinct from the existing concept-induction service, which clusters all unlabeled messages and has not produced useful candidates in practice.

Independent (not currently assigned to collaborators):

- **Schema versioning across runs** — when labels are merged or split mid-project, what happens to the analytical history? Today the archive flow handles orphans at the application level; project-wide schema evolution is unclear.
- **Concept induction in the user flow** — the LLOOM-inspired concept service exists but doesn't integrate cleanly with the single-label flow. Where should bottom-up candidates surface?

---

## Inspirations

- **LLOOM** (Lam et al.): LLM-driven concept extraction and iterative refinement over text corpora
- **DocWrangler** (Jiang et al.): Interactive interface for LLM-assisted document labeling with merge/split/refine operations
