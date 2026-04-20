# Security + Procurement Pack (Pilot-Ready)

This is the quick-response pack for technical buyers evaluating AuthPilot AI in a paid pilot.

## 1) Security Posture Snapshot

- Runtime model: Next.js service with Python workflow runner
- Data handling: synthetic/default demo data, plus optional custom intake fields
- Auditability:
  - Structured audit events via `audit_event` signal
  - Run summary telemetry via `run_summary` signal
- Traceability:
  - API responses include `x-request-id`
  - Error payloads also include `requestId`

## 2) Write Route Protection

When `INTERNAL_API_KEY` is set, write APIs require header:

`x-internal-api-key: <key>`

Protected write routes:
- `PATCH /api/runs`
- `POST /api/workspaces`
- `DELETE /api/workspaces`
- `POST /api/discover-sources`

Protection layers:
- Middleware route guard
- API-level write auth checks
- In-memory per-route rate limiting

## 3) Request Tracing + Debug Path

For each request:
- Read `x-request-id` from response headers
- Use `requestId` in response payload
- Correlate with `run_summary` and `audit_event` telemetry records

Recommended incident triage order:
1. Check `requestId` + route response payload
2. Check run history record (`/api/runs`)
3. Check `failure.code` and `failure.stage`
4. Check telemetry record for matching `appRunId`

## 4) Environment Naming Consistency

Use these canonical keys in deployment docs and runbooks:

### Core runtime
- `TINYFISH_MODE`
- `TINYFISH_API_KEY`
- `TINYFISH_API_BASE_URL`
- `PYTHON_BIN`

### API write protection
- `INTERNAL_API_KEY`

### Persistence
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `MONGODB_COLLECTION`

### Observability
- `AXIOM_API_TOKEN`
- `AXIOM_DATASET`
- `AXIOM_BASE_URL`

## 5) Buyer FAQ (Short Answers)

### Is it live browser automation or static rules?
Live browser workflows are executed when `TINYFISH_MODE=live`, with proof states shown in UI.

### How do we know results are traceable?
Every API response carries `x-request-id`, and runs are persisted with failure taxonomy and timestamps.

### How is write access controlled?
Write endpoints require `x-internal-api-key` when `INTERNAL_API_KEY` is configured.

### What happens on stream failure?
Failures are classified with structured codes (`retry_exhausted`, `terminal_event_missing`, `runner_exit_nonzero`, etc.) and persisted to run history.

## 6) Pilot Security Checklist

- [ ] `INTERNAL_API_KEY` configured in pilot environment
- [ ] TinyFish key present and valid
- [ ] Mongo persistence configured (or accepted local fallback)
- [ ] Axiom telemetry configured (recommended)
- [ ] Request tracing validated with one test run
- [ ] Write-route auth verified with/without key
