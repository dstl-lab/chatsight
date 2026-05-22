# Single-label sampling (`/run`)

**Goal:** Show professors the next **student message** worth labeling—prefer **relevant** chats (real questions, new themes) and **efficient** walks (finish started threads, fair coverage, avoid generic spam).

---

## 1. End-to-end labeling flow

### Detailed

| Step | Where | What happens |
|------|--------|----------------|
| 1 | `src/pages/LabelRunPage.tsx` | Instructor on `/run`; active label from `api.getActiveSingleLabel()` / `refresh()`. |
| 2 | `src/services/api.ts` | `GET /api/single-labels/{id}/next` loads first (or next) focused message. |
| 3 | `server/python/main.py` | `get_next_focused` (≈3323) calls `queue_service.next_message_for_label` with `explore_fraction` from label or env. |
| 4 | `server/python/queue_service.py` | `next_message_for_label` (337): load `MessageCache` + human `LabelApplication` rows → pick **conversation** → pick **pending student turn** → `build_sampling_meta` → `_build_focus_payload` (thread). |
| 5 | `FocusedMessageResponse` | `schemas.py` / `src/types/index.ts` — thread, `sampling_pick`, meta bar percents, etc. |
| 6 | UI | `ThreadView` + `ConversationMeta` + `DecisionDock`; separate `GET /assist` for neighbor sidebar (`LabelRunPage.tsx` ≈110–125). |
| 7 | Decide | Y/N/S → `POST /api/single-labels/{id}/decide` → `decision_service.record_decision` → `_decide_response` → **same** `next_message_for_label` path (≈3375–3390). |

Skip conversation: `POST …/skip-conversation` → same `_decide_response`.

### Simple

**Every label click saves a decision in SQLite, then the server picks the next message and sends back the full card (thread + how it was chosen).** The browser does not choose the queue; it only displays what `/next` or `/decide` returns.

---

## 2. Data sources

### Detailed

| Store | File | Role in sampling |
|-------|------|------------------|
| **External Postgres** `events` | Read via `ext_engine` in `main.py` `populate_message_cache` (≈61–117), `queue_service._fetch_full_thread_uncached` (564+) | Raw tutor/student events. |
| **SQLite `MessageCache`** | `models.py`, filled at startup | One row per **student** message: text, `message_index`, `context_before` / `context_after` (tutor snippets). Queue iterates this—fast. |
| **SQLite `LabelApplication`** | `models.py`, `decision_service.py` | Human yes/no/skip per `(label_id, chatlog_id, message_index)` → defines “decided” vs queue. |
| **SQLite `MessageEmbedding`** | `concept_service` / cache | Student-message vectors; used for neighbors, rarity, conversation centroids. |
| **SQLite `ConversationProfile`** | `models.py`, `explore_service.ensure_conversation_profile` | Gemini one-liner + summary embedding per `(label, chatlog)` for **theme** novelty. |
| **SQLite `LabelExploreGradebook`** | `explore_service.ensure_gradebook` | Cached yes/no pattern summary per label (Layer B). |
| **`LabelDefinition.hybrid_explore_fraction`** | `models.py`, migration in `database.py` | Per-label explore rate; `null` → env default. |

### Simple

**Postgres is ingested once into local SQLite.** All queue and scoring reads SQLite (and optionally Postgres only for full thread display).

---

## 3. Conversation pick (three modes)

Logic: `queue_service._select_next_chatlog_id` (214–334).

### Priority order

1. **In-progress** conversations (some messages labeled, some not) beat **not-started**.
2. Within a bucket, either **continue** / **round-robin** or **explore** (random roll).

### Modes

| `sampling_pick` | When | Behavior |
|-----------------|------|----------|
| **`continue`** | In-progress pool; often 1 chat or non-explore roll (243–247) | Resume a **different** partial chat you left earlier. Same-chat walks after Explore stay `explore` in the UI (`_display_sampling_pick`). |
| **`round_robin`** | New chats; explore roll failed (248–256) | Fair order: assignment grouping + stable shuffle `_shuffle_key` (192–197). |
| **`explore`** | New chats; `random() < explore_fraction` (243, 258–334) | Score subset of candidates; pick top utility band. |

Explore fraction: `queue_service.default_hybrid_explore_fraction()` (186) or `LabelDefinition.hybrid_explore_fraction`; UI in `StripBar.tsx` `HybridExploreMix` → `PATCH` label.

### Simple

**Finish chats you started first.** For new chats, ~35% (default) of the time the server **scores** conversations and picks a strong teaching example; otherwise it rotates fairly.

---

## 4. Explore selection (when `sampling_pick == "explore"`)

File: `server/python/explore_service.py` + `queue_service._select_next_chatlog_id` (258–334).

### Pipeline

1. **Cap pool** — `CHATSIGHT_EXPLORE_SCORE_POOL_CAP` (default 60); random subsample if larger (258–262).
2. **Fast shortlist** — `explore_candidate_priority` (336–353): specificity + spam penalty (no full corpus matrix here).
3. **Top ~25%** of pool → `explore_candidates` (275–277).
4. **Background warm** — `warm_explore_candidates` (714): daemon thread; Gemini gradebook + `ConversationProfile` for shortlist + labeled chats (**does not block** `/decide`).
5. **Utility score** each candidate — `_conversation_utility` (297–322) → `blended_explore_utility` (785+).
6. **Top ~25%** by utility → random choice among them (331–334).

### Simple

**Explore = cheap filter, then heavier scoring on ~15 chats, then random among the best few.** Gemini runs in the background for theme data later.

---

## 5. Scoring features (metrics)

Used for **explore utility** and/or **meta bar** via `build_sampling_meta` (`queue_service.py` 77–183).

| Feature | Module | Meaning for professors |
|---------|--------|-------------------------|
| **Neighbor uncertainty (Amb)** | `queue_service.neighbor_uncertainty_novelty` (36) via `assist_service.nearest_neighbors` | Similar past labels disagree → borderline, worth human judgment. |
| **Message novelty (Msg nov)** | Same call, `1 − max similarity` to labeled neighbors | This line differs from messages you already labeled. |
| **Conversation novelty (Conv nov)** | `explore_service.conversation_novelty` (375) | Whole chat’s student messages ≠ chats you already walked. |
| **Theme novelty (Theme)** | `explore_service.theme_novelty` (424) | AI summary theme ≠ prior labeled chats (needs `ConversationProfile`). |
| **Specificity (Spec)** | `explore_service.student_help_specificity` (229) | Real student ask vs “help” / pasted spec (rules + paste detection). |
| **Rarity (Rare)** | `explore_service.student_message_corpus_rarity` (302) | Wording uncommon in course corpus (subsampled embeddings, max 512 refs). |
| **Spam penalty** | `explore_service.conversation_spam_penalty` (273) | Down-ranks threads of generic or copy-paste pings. |

**Blend:** `blended_explore_utility` (785) — weighted sum (env-tunable `CHATSIGHT_EXPLORE_*_WEIGHT`), × `(1 − spam_penalty)`.

Meta bar UI: `src/components/run/ConversationMeta.tsx` — Explore shows a ≤20-word summary; hover lists score tiers (high/med/low) as bullets.

### Simple

**Scores favor specific, uncommon, on-theme student help and borderline cases; they punish generic help and pasted assignments.** Explore picks show a one-line summary plus hover bullets, not percent chips.

---

## 6. Message-level queue (within a conversation)

After chat pick: `_first_pending_turn` (200–208) — lowest `message_index` in `MessageCache` not in `decided`.

Student messages only in cache; tutor context assembled in `_build_focus_payload` / `_thread_from_message_cache` (417+) or Postgres thread (564+). Leading tutor before first student is stripped (`seen_query` / skip `context_before` on index 0).

### Simple

**Within a chat you walk student messages in order.** Tutor text is context above/below, not the labeling unit.

---

## 7. API reference (sampling-related)

| Method | Route | Handler | Returns |
|--------|-------|---------|---------|
| GET | `/api/single-labels/{id}/next` | `main.get_next_focused` | `FocusedMessageResponse` or null |
| POST | `/api/single-labels/{id}/decide` | `main.post_decide` | `DecideResponse` { `next`, `readiness` } |
| POST | `/api/single-labels/{id}/skip-conversation` | (skip handler) | Same `DecideResponse` |
| GET | `/api/single-labels/{id}/assist` | `main.get_assist` | Neighbors (sidebar only) |
| PATCH | `/api/single-labels/{id}` | `hybrid_explore_fraction` | Updates explore % |

Frontend: `src/services/api.ts` — `getNextFocused`, `decide`, `getAssist`, `patchSingleLabel`.

### Simple

**One POST per label advances the queue; GET assist is extra context, not the queue.**

---

## 8. UI surfaces

| File | Role |
|------|------|
| `src/pages/LabelRunPage.tsx` | Orchestrates refresh, decide, handoff, assignment filter. |
| `src/components/run/StripBar.tsx` | Label stats, assignment picker, **new-chat explore %**, readiness/handoff. |
| `src/components/run/ConversationMeta.tsx` | Conversation #, **Robin / Explore / Continue**, metric hovers. |
| `src/components/run/DecisionDock.tsx` | Y/N/S; **Enter** opens readiness panel (not instant handoff). |
| `src/components/run/ThreadView.tsx` | Renders `thread` + focus. |
| `src/components/run/HoverTip.tsx` | Shared tooltips (strip + meta bar). |

### Simple

**Strip = settings + handoff; meta bar = why this chat; dock = label actions.**

---

## 9. Performance notes

| Sync on every decide | Async |
|----------------------|--------|
| `build_sampling_meta` (all metrics) | `warm_explore_candidates` (Gemini profiles) |
| `next_message_for_label` (full cache scan) | |
| Explore path: multiple k-NN on **new chat** pick only | |
| Postgres thread fetch (cached per `chatlog_id` in process) | |

Set explore % to **0** in strip bar → round-robin only, skips explore utility loop.

### Simple

**Slowness ≈ diagnostics on every click + occasional explore scoring; not Gemini on the hot path.**

---

## 10. Configuration

| Env / field | Default | Effect |
|-------------|---------|--------|
| `CHATSIGHT_HYBRID_EXPLORE_FRACTION` | 0.35 | Explore probability for new chats |
| `LabelDefinition.hybrid_explore_fraction` | null | Overrides env per label |
| `CHATSIGHT_EXPLORE_SCORE_POOL_CAP` | 60 | Max chats considered for explore |
| `CHATSIGHT_CORPUS_RARITY_MAX_REFS` | 512 | Rarity subsample size |
| `CHATSIGHT_EXPLORE_*_WEIGHT` | see `explore_score_weights` (767) | Utility blend |
| `GEMINI_API_KEY` | — | Required for profiles/gradebook; explore works without (theme % empty until warm) |

---

## 11. Tests

| File | Covers |
|------|--------|
| `server/python/tests/test_hybrid_sampling.py` | Pick modes, API metadata |
| `server/python/tests/test_explore_scoring.py` | Specificity, novelty, gradebook, warm noop |

---

## Quick reference (professor-facing)

1. You label **one student message** at a time; the app saves yes/no/skip.
2. The server **finishes in-progress chats** before sampling new ones.
3. **Explore** (strip bar %) biases **new** chats toward specific, diverse, label-worthy help; **Robin** rotates fairly; **Continue** means you’re mid-chat.
4. The meta bar explains **how** this message was chosen; it does not change the queue.
5. **Handoff** sends remaining work to Gemini after enough human examples (readiness chip).
