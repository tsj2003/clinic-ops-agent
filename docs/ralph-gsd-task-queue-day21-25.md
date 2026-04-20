# Ralph + GSD Task Queue — Day 21-25

## Objective
Move from static commitment docs to an in-product pilot close system with updateable deal state.

## Day 21 — In-app commitment tracker (product)
- [x] Add pilot commitment storage module with local + Mongo fallback.
- [x] Add protected API route for list/create/update/delete.
- [x] Add `PilotCommitmentPanel` with status progression controls.
- [x] Wire panel into main operator UI.

Acceptance:
- Team can track pilot deals directly in the app with persistence.

## Day 22 — Data quality + guardrails
- [x] Add field-level input constraints and payload validation tests.
- [x] Add malformed payload test cases.

## Day 23 — Pipeline analytics
- [x] Add conversion funnel rollups (prospect -> signed) to admin metrics.
- [x] Add CSV export for commitment pipeline.

## Day 24 — Commit close automation
- [x] Add one-click “send terms + kickoff checklist” templates per commitment.
- [x] Add next-step reminders in UI.

## Day 25 — Operating review integration
- [x] Include commitment funnel snapshot in operating-review markdown export.
- [x] Add weekly review checklist in docs.

## Ralph Loop
1. Read day objective.
2. Build smallest useful vertical slice.
3. Validate behavior + error paths.
4. Record completion and next bottleneck.
