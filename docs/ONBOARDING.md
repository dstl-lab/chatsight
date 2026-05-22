# First-time onboarding (single-label `/run`)

## UX

When there are **no single labels** and the instructor has not skipped the tutorial (`localStorage` key `chatsight_onboarding_skipped`), `/run` shows a **modal** (not a separate route):

1. Three bullets: how labeling works.
2. First **three student messages** from one **scored starter conversation**.
3. **Suggested label names** per message (“A professor might call this: …”) — Gemini when `GEMINI_API_KEY` is set, else short rule-based names. Click a chip to fill the label name field.
4. **Your first label name** (explicit: typed text becomes the label title; description optional later) → **Start labeling** → seed → normal run UI.

**Skip tutorial** sets the localStorage flag and falls back to the inline “create first label” form (no seed).

## Starter selection (`onboarding_service.py`)

Reuses `explore_service` metrics:

- `explore_candidate_priority` (specificity, rarity, spam)
- `conversation_spam_penalty` — reject if &gt; 0.5
- Length 2–8 student messages; bonus for 3–7
- **Contrast bonus** if specificity spans high/low across turns
- Reject if any of the first three preview turns looks copy-pasted (paste ≥ 0.7)

Winner: top ~5% by refined score among a **shortlist** (default 80 conversations), tie-break **`min(chatlog_id)`** for stability.

**Performance:** Phase 1 scores all conversations with the same **fast** metrics as explore shortlist (`use_corpus_rarity=False` — no embedding matrix walks). Phase 2 refines only the shortlist. Example framings also skip corpus rarity. First pick on a large corpus may take a few seconds; results are **cached** in `OnboardingStarterCache` until `MessageCache` row count changes.

Override shortlist size: `CHATSIGHT_ONBOARDING_SCORE_CAP` (default `80`).

## API

- `GET /api/onboarding/starter` — starter payload
- `GET /api/onboarding/starter?refresh=true` — force recompute
- `POST /api/single-labels` with `seed_chatlog_id` / `seed_message_index` — first `/next` uses seed (`queue_service`)

## Dataset portability

No course-specific label names; scoring and framings use cached student text and embeddings only.
