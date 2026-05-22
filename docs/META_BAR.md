# Meta bar on `/run` (ConversationMeta)

The **meta bar** is the thin monospace strip under the top strip bar and above the conversation thread. It is rendered by `src/components/run/ConversationMeta.tsx`. The numbers and labels are **not** editable; they describe the **current** focused student message and **how this conversation entered the queue**.

This document explains only the meta bar: what appears, when, how values are computed, and how data reaches the UI.

---

## Two layers: always shown vs queue extras

### Always shown (every labeling screen that uses ConversationMeta)


| Piece                 | Source field              | Meaning                                                                                                                                                                                 |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Conversation #12345` | `chatlog_id`              | Stable id for this chat in the database.                                                                                                                                                |
| Notebook name         | `notebook`                | Assignment notebook filename, if known. Omitted when null.                                                                                                                              |
| `N turns`             | `conversation_turn_count` | Count of rows in the **display thread** (student + tutor turns shown in the center panel). This can be larger than the number of student messages because tutor replies count as turns. |


These three fields do not depend on explore sampling. They come from the main “focused message” API payload built in `server/python/queue_service.py` → `_build_focus_payload`.

### Queue extras (the part that changes)

Extra chips appear only when **all three** are present on the API response (`ConversationMeta.tsx` lines 82–85):

- `sampling_pick` — not null (`continue`, `explore`, or `round_robin`)
- `conversation_student_messages` — not null
- `pending_student_message_number` — not null

If any of those is missing (for example some review-only views that only pass `chatlogId` / `notebook` / `turnCount`), you see **only** the always-shown line with no Explore/Robin/Continue and no explore sentence.

---

## Pick mode chip: Explore, Robin, or Continue


| Label        | When the server sets it                                                                                                                                                                                                                     | What it means for you                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Continue** | The queue returned you to a **different** in-progress chat you had started earlier (not the chat you just labeled). Set when `_display_sampling_pick` keeps internal `continue` because your last human label was in another conversation. | You are resuming a chat you left unfinished. Explore % does **not** apply. |
| **Robin**    | This is a **new** chat (no labels yet in this conversation for this label), and the random explore roll failed, or explore is 0%.                                                                                                           | Next chat in fair rotation (by assignment, then shuffled order). Not chosen by explore scoring.             |
| **Explore**  | New chat, and random roll succeeded (`random() < hybrid_explore_fraction`). Server scored candidates and picked one of the top utility chats.                                                                                               | This chat was selected by the explore scorer (see frozen sentence below). |


Hover text for **Robin** and **Continue** is defined in `ConversationMeta.tsx` (`pickTip`). Color: Explore = ochre, Continue = brighter, Robin = faint.

**Important:** The pick chip describes **how this conversation entered the queue** on the first student message. Within a chat, messages are always the next unlabeled student message in order.

---

## Message position: `Msg 2/7`


| Field                            | Set in                                                                                           | Meaning                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `conversation_student_messages`  | `queue_service.next_message_for_label` — length of student rows in `MessageCache` for this chat. | Total student messages in this conversation in the local cache. |
| `pending_student_message_number` | `message_index + 1` in `build_sampling_meta` (line 126).                                         | Which student message you are labeling now (1-based).           |


Example: `Msg 2/7` = second student message of seven in this chat.

This does not count tutor turns. `N turns` in the always-shown section **does** count tutor + student display turns.

---

## Explore chip (hover only)

When `sampling_pick` is **explore**, the meta bar shows an **Explore** label (ochre) with a hover tip — one static sentence on what Explore optimizes for (specificity, novelty, rarity; avoids copy-paste and ambiguity). Per-conversation pick explanations are not shown in the UI.

**Robin** and **Continue** keep their own hover tips. **Msg x/y** is always shown when queue fields are present.

Metric percent fields (`neighbor_uncertainty_pct`, `conversation_novelty_pct`, etc.) may still exist on the API for other features; they are **not** shown in the meta bar.

---

## Why the meta bar changes from message to message

- **Continue** only when you return to a different in-progress chat.
- **Msg x/y** updates every time you advance to the next student message.
- **Explore** hover text is the same for every Explore pick (not per chat).

---

## End-to-end flow (one labeling advance)

Read top to bottom. This is what happens when you press Yes, No, or Skip (or load `/run` for the first message).

1. **Browser** (`src/pages/LabelRunPage.tsx`, `handleDecide` or initial `refresh`) calls `POST /api/single-labels/{label_id}/decide` or `GET .../next` via `src/services/api.ts`.
2. **API** (`server/python/main.py`, `_decide_response` or `get_next_focused`) saves your decision (if any) through `decision_service.record_decision`, then calls `queue_service.next_message_for_label` with the label’s explore fraction.
3. **Pick a conversation** (`queue_service.next_message_for_label`, lines 337–396):
  - Load all student messages from SQLite `MessageCache` for this label (optionally filtered by assignment).
  - Load all human decisions from `LabelApplication` for this label.
  - Split chats into **in-progress** (some messages labeled) vs **not started**.
  - Call `_select_next_chatlog_id` → returns `(chatlog_id, sampling_pick)` where `sampling_pick` is `continue`, `round_robin`, or `explore`.
4. **Pick the student message** within that chat (`_first_pending_turn`): lowest `message_index` in that chat that is not in your decided set.
5. **Build meta bar context** (`build_sampling_meta`):
  - On **explore** pick only: compose and freeze `explore_pick_summary` via `_ensure_explore_pick_summary`.
  - Read frozen summary from `ConversationCursor` for every later message in that chat.
  - Set `sampling_pick`, `conversation_student_messages`, `pending_student_message_number`.
6. **Build thread** (`_build_focus_payload`): load student + tutor turns for the center panel; compute `conversation_turn_count` and `focus_index`.
7. **Merge** meta into the JSON response (`FocusedMessageResponse` in `server/python/schemas.py`).
8. **Browser** receives JSON; `LabelRunPage` stores it in `focused` state.
9. **ConversationMeta** receives props from `focused.`* (lines 525–537 in `LabelRunPage.tsx`).
10. **ConversationMeta** renders always-shown fields, queue chips, optional 10-word explore sentence, and hover for full text.
11. **Separately** (not in meta bar): browser calls `GET /api/single-labels/{id}/assist` for the right-hand neighbor list (`LabelRunPage.tsx`).

---

## Quick lookup table


| Piece                      | Needs                                    | Meaning                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------------- |
| Explore / Robin / Continue | Active single-label queue                | How this **chat** was first opened           |
| Msg x/y                    | Always with queue extras                 | Position in student-message queue            |
| Explore sentence (10 words)| `explore_pick_summary` on cursor         | Why Explore picked this chat (frozen)        |


---

## Files involved (reference)


| Role                  | File                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Renders bar           | `src/components/run/ConversationMeta.tsx`                                                |
| Passes props          | `src/pages/LabelRunPage.tsx`                                                             |
| API response shape    | `server/python/schemas.py` (`FocusedMessageResponse`)                                    |
| Pick summary + meta   | `server/python/queue_service.py` (`compose_explore_pick_summary`, `build_sampling_meta`) |
| Scoring helpers       | `server/python/explore_service.py`                                                       |
| Neighbor embeddings   | `server/python/assist_service.py` (`nearest_neighbors`)                                  |
| Hover UI component    | `src/components/run/HoverTip.tsx`                                                        |


