# Paid Pilot Terms Sheet (Day 9)

## Pilot Summary
- Product: AuthPilot AI
- Pilot Duration: 14 days
- Scope: One workflow lane (single payer/procedure lane)
- Team: 1-2 staff users
- Review cadence: Weekly KPI review with ops lead

## Commercials
- Pilot Fee: $2,500
- Acceptable range: $2,000-$5,000 (based on volume/support)
- Payment terms: Net 7 from signature

## Scope of Work
AuthPilot AI will provide:
1. Workflow setup (payer/procedure lane)
2. Live readiness + routing runs
3. Operator packet exports for staff handoff
4. KPI snapshot reporting each week

Pilot customer will provide:
1. Pilot owner and weekly review attendee
2. Baseline metrics (week 0)
3. Workflow access context (policy/contact targets)
4. Feedback and adoption checkpoints

## KPI Success Gates (locked at kickoff)
- Denial-rate delta target: ______
- Days-to-auth delta target: ______
- Staff hours saved per case target: ______
- Recovered revenue target: ______

## Acceptance Criteria
Pilot is considered successful if at least two KPI gates are met and at least one staff user adopts the workflow weekly.

## Expansion Trigger
If pilot KPI gates are met:
- Expand to lane 2 within 30 days
- Add additional payer/line-of-business combinations
- Review multi-user deployment plan

## Security + Ops Addendum
- Write routes protected by `x-internal-api-key` when configured
- Request tracing available via `x-request-id` / `requestId`
- Run history includes failure taxonomy and proof states

## Signature Block
- Customer name:
- Customer signer:
- Customer date:
- AuthPilot signer:
- AuthPilot date:
