# CodeRabbit Review Log — Day 21-25

## Day 21 Review (Pilot commitment tracker)

### Scope Reviewed
- `web/lib/pilot-commitment-store.js`
- `web/app/api/pilot-commitments/route.js`
- `web/components/PilotCommitmentPanel.jsx`
- `web/app/page.js`

### Bug Risk Check
- ✅ Read/write flows include required `clinicName` validation.
- ✅ Update and delete operations handle missing IDs with 400 responses.
- ✅ UI disables mutation buttons while a record is being saved.

### Security Check
- ✅ Write routes protected with internal key/origin checks.
- ✅ Route-level rate limits applied for read/write paths.
- ✅ Audit events emitted for create/update/delete attempts.

### Maintainability Check
- ✅ Storage module follows existing local/Mongo fallback pattern.
- ✅ API route uses shared response and guard helpers.
- ✅ UI panel uses existing design system classes and clear prop contract.

### Follow-ups
- Add unit tests for payload validators and store normalization.
- Extend admin metrics with commitment-funnel rollups (Day 23).

## Day 22 Review (Validation hardening)

### Scope Reviewed
- `web/lib/pilot-commitment-schemas.js`
- `web/app/api/pilot-commitments/route.js`
- `web/tests/pilot-commitment-schemas.test.mjs`

### Findings
- ✅ Field-level constraints added for email, status, date format, and numeric ranges.
- ✅ PATCH now rejects id-only/no-op payloads.
- ✅ Malformed body and invalid payload cases covered in tests.

## Day 23 Review (Pipeline analytics)

### Scope Reviewed
- `web/app/api/admin/metrics/route.js`
- `web/app/api/admin/metrics/export/route.js`
- `web/components/AdminMetricsPanel.jsx`

### Findings
- ✅ Commitment funnel rollup added to metrics payload.
- ✅ Pipeline CSV export added behind existing internal-key checks.
- ✅ Admin UI now exposes funnel KPIs and export action.

## Day 25 Review (Operating review integration)

### Scope Reviewed
- `web/app/api/admin/operating-review/route.js`
- `docs/weekly-pilot-review-checklist.md`

### Findings
- ✅ Operating review markdown now includes commitment funnel snapshot.
- ✅ Weekly checklist documented for consistent review cadence.

## Day 24 Review (Close automation)

### Scope Reviewed
- `web/components/PilotCommitmentPanel.jsx`

### Findings
- ✅ Added one-click template actions for terms message and kickoff checklist.
- ✅ Added status/date-aware reminder line for close urgency.
- ✅ Clipboard actions are gated on browser clipboard availability.
