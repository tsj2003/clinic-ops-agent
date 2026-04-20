# Data Retention Policy (AuthPilot Web)

## Run History Retention
- Persisted run records are retained for a bounded window.
- Default retention: **90 days**.
- Configurable via environment variable: `RUN_RETENTION_DAYS`.

## How retention is enforced
- Retention filtering is applied when runs are saved and listed.
- For Mongo-backed deployments, old completed runs are pruned during save/list operations.
- For local fallback storage, out-of-window runs are filtered before write/list.

## PHI-safe logging defaults
- Free-text log payloads are redacted before persistence/streaming for common identifiers:
  - email addresses
  - phone numbers
  - explicit identifier labels (`MRN`, `Member ID`, `Patient ID`, etc.)
  - DOB labels (`DOB`, `Date of Birth`)

## Operator guidance
- Do not paste direct identifiers into free-text fields unless required for active clinical workflow.
- Use minimum-necessary metadata in comments and status notes.
