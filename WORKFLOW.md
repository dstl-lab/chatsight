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

1. **Labeling unit**: Individual messages? Message pairs (student + AI response)? Conversation-level?
2. **Sampling**: Random vs. representative — how do we know when we have "enough" labeled data?
3. **Multi-instructor**: How do we handle disagreements when two instructors label the same message differently?
4. **Label schema versioning**: When labels are merged or split, how do we handle previously labeled data?
5. **Session scope**: Do instructors label within one conversation at a time, or across many conversations looking for patterns?

---

## Inspirations

- **LLOOM** (Lam et al.): LLM-driven concept extraction and iterative refinement over text corpora
- **DocWrangler** (Jiang et al.): Interactive interface for LLM-assisted document labeling with merge/split/refine operations
