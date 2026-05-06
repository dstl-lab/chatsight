# Sample Handoff (Dev) — Design

**Date:** 2026-05-05
**Status:** Approved, ready for implementation planning
**Scope:** Backend only. No frontend changes.

## Motivation

The current `/api/single-labels/{id}/handoff` endpoint always classifies the full set of `pending` messages. For a 17,470-message dataset, a full handoff sends ~350 chunked Gemini calls and routinely runs into quota / rate-limit issues — losing minutes-to-hours of work when a single 429 surfaces or the SDK silently retries.

We need a low-cost way to **smoke-test the handoff pipeline end-to-end** during development: trigger a real handoff that exercises the same HTTP route, `BackgroundTasks` machinery, parallel-sync classification path, summary generation, and `/summaries` rendering — but against a small random subset of pending messages so it completes fast and well within rate-limit headroom.

## Goal

Allow a developer to issue a single HTTP request that runs handoff against an N-sized random sample of `pending`, where the rest of the pipeline behaves identically to a full handoff.

## Non-goals

- No production user-facing UI for sampling. End users still see a single "Hand off" button on the Run page that triggers a full handoff.
- No accuracy-validation feature (held-out evaluation, agreement metrics, confusion matrix). This is a smoke test, not a quality check.
- No reproducibility guarantees — the sample is random per call. If we later need reproducibility, we'd add a seed query param.
- No changes to the parallel-sync vs Batch-API routing logic, the retry-handoff endpoint, the background failure classification (`_classify_error_kind`), or any schema.

## Design

### One optional query param on the existing handoff endpoint

`POST /api/single-labels/{label_id}/handoff?sample_size=400`

- `sample_size` is an optional positive integer query parameter on `handoff_single_label` in `server/python/main.py`.
- If present and `<= 0`, the endpoint returns HTTP 400 with a clear error message.
- If present and positive, after `_do_classification` computes `pending`, the list is reduced via `random.sample(pending, min(sample_size, len(pending)))` before any Gemini calls.
- If absent (`None`), behavior is identical to today: full-set handoff.
- No upper cap. A silly value like `sample_size=999999` simply behaves like "use all of pending" because of the `min()`.

### Wiring

The `sample_size` value must reach `_do_classification`. Plumbing path:

1. `handoff_single_label(label_id, sample_size, bg, db)` validates and forwards the value.
2. `bg.add_task(_classify_in_background, label_id, sample_size)`.
3. `_classify_in_background(label_id, sample_size=None)` opens its own DB session and calls `_do_classification(db, label, sample_size=sample_size)`.
4. `_do_classification(db, label, sample_size=None)` adds one block right after computing `pending`:

   ```python
   if sample_size is not None:
       import random
       pending = random.sample(pending, min(sample_size, len(pending)))
   ```

5. `label.classification_total = len(pending)` runs *after* the sample reduction, so `/summaries` shows the sampled size (not the full pending size) and progress reaches 100% when the sample completes.

### Routing implications

- Sample size 400 is below `BATCH_THRESHOLD` (currently temporarily 100000, normally 500), so it stays on the parallel-sync path. Wall clock with `PARALLEL_CONCURRENCY = 8` and 50-message chunks is approximately ⌈400/50⌉=8 chunks → 1 wave of 8 parallel calls → 5–30s depending on Gemini latency.
- Larger sample sizes (e.g., 2000) on a system with `BATCH_THRESHOLD = 500` would route through Batch API, which is also a valid smoke test (it exercises the batch-submit path). The endpoint doesn't second-guess this — we let the existing routing decide.

### Trigger surface

No UI. Developers invoke via:

- `curl -X POST 'http://localhost:8000/api/single-labels/16/handoff?sample_size=400'`
- FastAPI's auto-generated `/docs` swagger UI (already present)
- Any HTTP client

This means there is no production code path that can accidentally send `sample_size`. The query param is dev-discoverable only, with zero new UI surface to maintain.

## Tests

To be expanded during the implementation-planning phase. Initial set:

- `sample_size=400` against a label with `len(pending) >= 400` produces exactly 400 `LabelApplication` rows of `applied_by='ai'`.
- `sample_size=400` against a label with `len(pending) == 50` produces exactly 50 AI rows (clamped by `min`).
- `sample_size=0` returns HTTP 400.
- `sample_size=-1` returns HTTP 400.
- Omitted `sample_size` → existing full-handoff behavior unchanged (regression check on existing `test_handoff_kicks_off_async_and_pops_next` and `test_classification_writes_ai_rows_and_summary`).
- `label.classification_total` after a sample handoff equals the sample size, not the full pending count.

## Files affected

- `server/python/main.py` — `handoff_single_label`, `_classify_in_background`, `_do_classification` signatures plus the sampling block.
- `server/python/tests/test_handoff_flow.py` — new sample-mode test cases alongside the existing handoff coverage.

No changes to:
- `server/python/binary_autolabel_service.py`
- `server/python/schemas.py`
- `src/**` (frontend)
- `docs/**` other than this spec
- DB schema or any migration

## Future work (out of scope)

- A seed query param for reproducible sampling, if smoke-test investigations need to re-run identical samples.
- A `?sample_size_pct=5` variant for percentage-based sampling, if absolute counts feel awkward across labels with very different pending sizes.
- Promoting this into a real "validate before handoff" UX (the option B/C alternatives discussed during brainstorming) — would require accuracy validation against held-out human labels, not just an eyeball preview, and is a separate spec.
