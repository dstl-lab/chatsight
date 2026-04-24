# TODO

## Current Issues

- [ ] Gemini (`/api/queue/suggest`) endpoint returns only one label. Will need to consider how to deal with multiple candidates.
- [ ] Gemini reasoning for label sometimes includes rationale of "...based on 5 human-labeled examples", but would be helpful to see the examples and correct them if needed.
- [ ] `tests/test_stubs.py::test_merge_stub` and `test_split_stub` fail with 404. The `/api/labels/merge` and `/api/labels/split` endpoints are now real implementations (not stubs) but the tests don't seed `LabelDefinition` rows, so `db.get` returns None. Either rewrite these as proper integration tests against the real endpoints or delete them. See `server/python/main.py:1066-1135`.

## LLOOM / DocWrangler-Inspired Features

### Concept Induction (LLOOM)

- [ ] **AI concept suggestion** — Resurrect `label_service.py`'s `generate_labels` pointed at unlabeled messages. Surface as "Suggest new categories" after 20+ labels exist. AI proposes candidate labels for message clusters that don't fit existing labels, instructor accepts/rejects/renames.
- [ ] **Schema drift detection** — After auto-labeling, show a confidence distribution view. Low-confidence messages are candidates for a new label or indicate a schema problem. Feeds back into the refinement cycle.

### Label Refinement (DocWrangler)

- [ ] **Label consistency view** — Page or panel showing all messages for a selected label side-by-side, so the instructor can assess whether the label is coherent. Prerequisite for meaningful merge/split.
- [ ] **Split: AI-assisted clustering and reassignment** — The `/api/labels/split` endpoint currently creates two new labels but *drops* the original label's applications instead of reassigning them (see `main.py:1113-1117`). Needs AI clustering to propose the split boundary and reassign each application to the right side.

### Iterative Refinement Loop

- [ ] **Reclassification after schema changes** — When labels are merged/split, AI re-classifies affected messages under the updated schema. Instructor reviews edge cases. Similar pattern to existing archive orphan flow.