# Handoff briefs

Five themed briefs for week-of-part-time-work delegations to research collaborators. Each `.qmd` renders to a 4-page PDF that's the artifact you hand a recipient.

## The five themes

| # | Theme | Brief |
|---|-------|-------|
| 1 | Smart picker — what should the queue show next? | `01-smart-picker.qmd` |
| 2 | Drift — detecting and correcting label inconsistency | `02-drift.qmd` |
| 3 | Multi-rater support | `03-multi-rater.qmd` |
| 4 | How good is the AI? — classifier quality, end-to-end | `04-classifier-quality.qmd` |
| 5 | First thirty minutes — onboarding UX | `05-onboarding-ux.qmd` |

## Render

```bash
cd docs/handoffs
quarto render            # renders all 5 to _output/
```

PDFs land in `_output/` (gitignored). Each is self-contained — `00-shared-background.qmd` is included into each via Quarto's `{{< include >}}`.

## Adding a new brief

1. Copy an existing brief as a template; keep the YAML structure and the include directive.
2. Add the new file to the `render:` list in `_quarto.yml`.
3. Re-render.

## Editing the shared background

`00-shared-background.qmd` is included into each brief and not rendered standalone. Edit it once and re-render to update all five PDFs.
