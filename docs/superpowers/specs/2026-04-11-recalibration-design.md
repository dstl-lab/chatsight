# Recalibration Feature — Design Spec

## Context

Chatsight's queue-based labeling flow has a known risk: **label drift**. As instructors label hundreds of messages across sessions, their interpretation of labels may shift without them realizing it. The existing session-start label legend helps with between-session recalibration, but there's no mechanism for detecting drift *within* a session or measuring labeling consistency over time.

The recalibration feature periodically resurfaces previously-labeled messages for blind re-labeling, then reveals the original labels so the instructor can reconcile any differences. This serves two purposes: (1) measuring intra-rater reliability as a research metric, and (2) giving the instructor a chance to catch and correct drift.

## Design Decisions

| Aspect | Decision |
|--------|----------|
| Purpose | Blind re-label for consistency measurement + reveal old labels for reconciliation |
| Trigger | Adaptive interval — starts frequent, spaces out as consistency improves |
| Volume | 1 message per recalibration round |
| Selection | Stratified by label + weighted by age |
| UI entry | Inline takeover — purple banner, same queue layout |
| Reconciliation | Sidebar diff with same 1-9 keyboard shortcuts |
| Match behavior | Auto-advance with success toast (skip reconciliation) |
| Consistency visibility | Trend sparkline in ProgressSidebar (no absolute number) |

## Data Model

### New table: `RecalibrationEvent`

```python
class RecalibrationEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chatlog_id: int
    message_index: int
    original_label_ids: str        # JSON array of label IDs from original labeling
    relabel_ids: str               # JSON array of label IDs from blind re-label
    final_label_ids: str           # JSON array of label IDs after reconciliation
    matched: bool                  # True if original_label_ids == relabel_ids
    session_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

- `original_label_ids`, `relabel_ids`, `final_label_ids` are JSON-serialized `list[int]` stored as strings (consistent with SQLite's lack of native JSON arrays).
- `matched` is precomputed at save time for fast consistency queries.
- `session_id` links to the `LabelingSession` active when the recalibration occurred.

After reconciliation, the existing `LabelApplication` rows for this message are updated to reflect `final_label_ids` — labels removed during reconciliation get deleted, labels added get created. No parallel labeling system.

### No changes to existing tables

`LabelApplication`, `LabelingSession`, `MessageCache`, etc. remain unchanged. The `RecalibrationEvent` table is append-only and self-contained.

## Backend

### Endpoints

**`GET /api/session/recalibration`** (placeholder already exists at `main.py:1323`)

Returns the next message to recalibrate, or `null` if no recalibration is due.

Logic:
1. Check if a `LabelingSession` exists. If not, return `null`.
2. Compute the current adaptive interval (see below).
3. Count human-labeled messages since the last `RecalibrationEvent` in this session (or since session start if none). If count < interval, return `null`.
4. Select a message using stratified-by-label + age-weighted sampling (see below).
5. Return `RecalibrationItem`: `{ chatlog_id, message_index, message_text, context_before, context_after, original_label_ids }`.

The frontend calls this after each `handleNext()`. The `original_label_ids` field is included in the response but the frontend hides it during the blind re-label phase and reveals it only during reconciliation.

**`POST /api/session/recalibration`**

Saves a `RecalibrationEvent` and reconciles `LabelApplication` records.

Request body:
```json
{
  "chatlog_id": 42,
  "message_index": 3,
  "original_label_ids": [1, 2],
  "relabel_ids": [1, 3],
  "final_label_ids": [1, 3]
}
```

Actions:
1. Create `RecalibrationEvent` row with `matched = (original_label_ids == relabel_ids)`.
2. Diff `final_label_ids` against current `LabelApplication` rows for this message.
3. Delete `LabelApplication` rows for labels not in `final_label_ids`.
4. Create `LabelApplication` rows for labels in `final_label_ids` not already applied.
5. Return `{ matched, consistency_score }`.

**`GET /api/session/recalibration/stats`**

Returns trend data for the sparkline display.

Response:
```json
{
  "recent_results": [false, true, true, false, true, true, true, true],
  "trend": "improving",
  "current_interval": 15,
  "total_recalibrations": 15
}
```

- `recent_results`: last 8 `matched` values from `RecalibrationEvent`, chronological order. Used to render the sparkline (true = tall bar, false = short bar).
- `trend`: one of `"improving"`, `"steady"`, `"shifting"`. Computed by comparing match rate of the last 4 vs prior 4 events. If fewer than 4 events exist, trend is `"steady"`.
- `current_interval`: the current adaptive interval (for debugging/transparency).
- `total_recalibrations`: total count of events.

### Adaptive Interval Algorithm

```
BASE_INTERVAL = 10
MIN_INTERVAL = 5
MAX_INTERVAL = 30
WINDOW = 5  (last N recalibrations considered)

To compute the current interval:
1. Start with interval = BASE_INTERVAL.
2. Replay all RecalibrationEvents in chronological order, in sliding windows of WINDOW.
3. At each window boundary, adjust:
   - If window consistency >= 0.90: interval = min(interval + 5, MAX_INTERVAL)
   - If window consistency < 0.70: interval = max(interval - 5, MIN_INTERVAL)
   - Otherwise: no change.
4. The final value is the current interval.
```

The interval is recomputed on every `GET /api/session/recalibration` call. It is not stored — it's derived deterministically from `RecalibrationEvent` history. Since recalibration events number in the dozens per session, this replay is fast.

### Counting Messages Since Last Recalibration

To determine whether the interval has been reached:
1. Find the `created_at` timestamp of the most recent `RecalibrationEvent` in the current session. If none, use the session's `started_at`.
2. Count distinct `(chatlog_id, message_index)` pairs in `LabelApplication` where `applied_by = 'human'` and `created_at` > that timestamp.
3. If count >= current interval, recalibration is due.

### Message Selection Algorithm

Goal: proportional label coverage, biased toward older messages.

```
RECALIBRATION_COOLDOWN = 50  (messages labeled since last recalibration of this message)

1. Get all human-labeled messages (messages with at least one human LabelApplication).
2. Exclude messages whose most recent RecalibrationEvent has fewer than
   RECALIBRATION_COOLDOWN human-labeled messages after it (using the same
   timestamp-based counting as the interval check).
3. Group messages by their applied label IDs.
4. For each label, compute:
   - expected_share = label_message_count / total_labeled_messages
   - actual_share = recalibrations_containing_label / total_recalibrations
   - deficit = expected_share - actual_share (clamped to >= 0)
5. Weight each label's messages by deficit (labels that are underrepresented
   in recalibration get boosted).
6. Within each label group, weight messages by age:
   weight = (now - created_at).total_seconds()
   (older messages have higher weight)
7. Sample 1 message using the combined weights.
```

If there are fewer than 5 labeled messages total, recalibration is not triggered (not enough data to be meaningful).

## Frontend

### New State

In `QueuePage.tsx`, add:

```typescript
// Recalibration state
const [recalibrationState, setRecalibrationState] = useState<{
  item: RecalibrationItem       // message + original_label_ids
  phase: 'blind' | 'reconcile'  // current phase
  relabelIds: Set<number>        // labels applied during blind phase
} | null>(null)
```

`recalibrationState !== null` means recalibration mode is active. Like `reviewTarget`, it overrides `displayedMessage`.

### New Type

In `src/types/index.ts`:

```typescript
interface RecalibrationItem extends QueueItem {
  original_label_ids: number[]
}

interface RecalibrationStats {
  recent_results: boolean[]        // last 8 matched values for sparkline
  trend: 'improving' | 'steady' | 'shifting'
  current_interval: number
  total_recalibrations: number
}
```

### New API Functions

In `src/services/api.ts`:

```typescript
getRecalibration(): Promise<RecalibrationItem | null>
saveRecalibration(data: SaveRecalibrationRequest): Promise<{ matched: boolean, consistency_score: number }>
getRecalibrationStats(): Promise<RecalibrationStats>
```

### Flow

**After `handleNext()` in normal queue mode:**

1. Call `api.getRecalibration()`.
2. If `null`: advance normally (load next queue message).
3. If a message is returned: enter recalibration mode.

**Phase 1 — Blind re-label (`phase: 'blind'`):**

- `recalibrationState.item` becomes `displayedMessage`.
- Purple RECALIBRATION banner at top: "Re-label this previously seen message to check consistency".
- Sidebar shows labels as normal with 1-9 shortcuts. `original_label_ids` is not displayed.
- Skip button is disabled (recalibration is not skippable — but see escape hatch below).
- On Enter/Next: snapshot `appliedLabelIds` as `relabelIds`, transition to reconciliation.

**Phase 1.5 — Match check:**

- Compare `relabelIds` with `original_label_ids` (as sets).
- If identical: save `RecalibrationEvent` with `matched: true`, show green MATCH toast ("Consistent! Your labels matched."), auto-advance after 2 seconds, return to queue.
- If different: transition to Phase 2.

**Phase 2 — Reconciliation (`phase: 'reconcile'`):**

- Banner changes to amber MISMATCH: "Labels differ from original — toggle labels to reconcile, then press Enter".
- Sidebar switches to diff view. Each label shows:
  - **MATCH** (green): label is on in both original and re-label.
  - **WAS ON** (red): label was on originally, removed in re-label. Currently toggled off.
  - **NEW** (blue): label was off originally, added in re-label. Currently toggled on.
  - Unchanged-off labels: no badge, dimmed as usual.
- 1-9 shortcuts toggle labels on/off as normal. Diff badges update reactively.
- Enter: save `RecalibrationEvent` with `final_label_ids` = current applied labels, update `LabelApplication` rows, return to queue.
- Esc: discard re-label changes, keep original labels, save event with `final_label_ids = original_label_ids`.

**Escape hatch:** If the instructor presses Esc during the blind phase, recalibration is cancelled entirely (no event saved, return to queue). This handles the rare case where they need to skip.

### Calibration Trend in ProgressSidebar

At the bottom of `ProgressSidebar`, below the existing label list — a trend sparkline with no absolute number:

```
───────────────
CALIBRATION
↗ Improving
▁▂▃▃▅▅▆▇
```

**Three states based on trend direction:**
- **Improving** (↗, green) — recent recalibrations are matching more often than earlier ones
- **Steady** (→, neutral) — consistency is stable
- **Shifting** (↘, amber) — recent recalibrations are matching less often

**Sparkline:** Last 8 recalibration events rendered as Unicode block characters (▁▂▃▄▅▆▇█). Each bar represents one event: tall = match, short = mismatch. The visual pattern shows trajectory without revealing an exact score.

**Trend calculation:** Compare match rate of the last 4 events vs the prior 4. If improving by > 1 match: "Improving". If declining by > 1 match: "Shifting". Otherwise: "Steady".

- Only shown after the first recalibration event (sparkline grows as events accumulate, up to 8 bars).
- Fetched via `api.getRecalibrationStats()` on mount and after each recalibration.
- No percentage or fraction shown — the sparkline is the only indicator.
- Uses warm, non-judgmental language: "Shifting" not "Declining" or "Failing".

### Component Changes

| Component | Change |
|-----------|--------|
| `QueuePage.tsx` | New `recalibrationState`, check after `handleNext()`, blind + reconciliation phase handlers |
| `ProgressSidebar.tsx` | Consistency score section at bottom, diff view during reconciliation phase |
| `MessageCard.tsx` | Recalibration banner (purple/amber/green variants), disable skip during recalibration |
| `api.ts` | Three new API functions |
| `types/index.ts` | `RecalibrationItem`, `RecalibrationStats` types |

### No New Components

The recalibration feature reuses existing queue components. The diff view is a render variant within `ProgressSidebar`, not a separate component. The banners follow the same pattern as `ArchiveReviewBanner`. This keeps the component count manageable.

## Mock Mode

Add mock responses to `src/mocks/index.ts`:
- `getRecalibration` returns a mock `RecalibrationItem` every 5th call (simulates interval).
- `saveRecalibration` returns `{ matched: false, consistency_score: 0.8 }`.
- `getRecalibrationStats` returns static stats.

## Testing

### Backend (`server/python/tests/`)

- `test_recalibration.py`:
  - Test `GET /api/session/recalibration` returns `null` when not due.
  - Test it returns a message when interval is reached.
  - Test adaptive interval increases/decreases correctly.
  - Test `POST /api/session/recalibration` creates event and reconciles labels.
  - Test message selection covers all labels over time.
  - Test minimum labeled messages threshold (< 5 = no recalibration).

### Frontend (`src/__tests__/`)

- Test recalibration mode entry after `handleNext`.
- Test blind phase hides original labels.
- Test match detection auto-advances.
- Test mismatch shows diff view with correct badges.
- Test keyboard shortcuts work during reconciliation.
- Test Esc during blind phase cancels without saving.
- Test consistency score renders after first event.

## Verification

1. Start backend + frontend in dev mode.
2. Label 10+ messages to trigger the first recalibration.
3. Verify the purple banner appears and original labels are hidden.
4. Re-label the message. If labels match: verify green toast and auto-advance.
5. If mismatch: verify amber banner, diff badges, and 1-9 toggle shortcuts.
6. Confirm reconciled labels are saved correctly in the database.
7. Label more messages and verify the interval adapts based on consistency.
8. Check the consistency score in the sidebar updates after each recalibration.
9. Run `cd server/python && uv run pytest tests/test_recalibration.py` — all pass.
10. Run `npm test` — all pass, no regressions.
