# AuthPilot AI Startup Launch Checklist

## 0) Product definition (Week 1)
- Lock ICP: specialty clinics doing high-volume prior auth (MRI/MSK first).
- Lock wedge metric: time-to-ready packet per case.
- Define north-star KPI: `% cases moved to ready_for_submission within same shift`.

## 1) Product hardening (Week 1-2)
- [x] Preserve synthetic patient payer context when custom intake fields are empty.
- Add strict request validation for all POST/PATCH API routes.
- Add per-route auth for internal ops endpoints (`/api/runs`, `/api/workspaces`).
- Add rate limiting on `/api/demo-stream` and `/api/discover-sources`.
- Add structured error IDs for support and customer success debugging.

## 2) Reliability + ops (Week 2)
- Enforce retry budgets and alerting on TinyFish workflow failure rates.
- Add SLO dashboard: run success rate, median latency, P95 latency, timeout rate.
- Add incident runbook for TinyFish failures and payer page drift.
- Add canary checks for top payer policy URLs.

## 3) Data + compliance baseline (Week 2-3)
- Move all secrets to deploy platform secret manager.
- Rotate exposed/legacy API keys and enforce rotation policy.
- Add data retention policy for run history and workspace artifacts.
- Add PHI/PII handling statement and redaction for logs/telemetry.

## 4) GTM instrumentation (Week 3)
- Track funnel: discovered source -> run started -> packet generated -> submitted.
- Add workspace-level analytics for clinic pilot reporting.
- Add exports for weekly ops review for design partners.

## 5) Pilot readiness (Week 3-4)
- Launch with 2-3 design partner clinics.
- Weekly review cadence: blocker taxonomy, payer routing drift, saved minutes/case.
- Prioritize features from pilot feedback into biweekly release train.

## Immediate next engineering moves
1. Add schema validation (Zod) to all web API route inputs.
2. Add auth guard middleware for write routes.
3. Add basic rate limit for SSE and discovery routes.
4. Add startup metrics panel for conversion + reliability.
