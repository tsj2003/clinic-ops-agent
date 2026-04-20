# Pilot Onboarding Runbook (Day 7)

Goal: onboard one pilot clinic to first live run with minimal engineering support.

## 1) Pre-Onboarding Checklist
- [ ] Confirm payer + procedure lane
- [ ] Confirm line of business + member state
- [ ] Confirm one staff owner for pilot
- [ ] Confirm pilot KPI baseline fields

## 2) In-App Setup (Workspace)
Use custom mode and apply a pilot template in Guided Intake:
- `Pilot template: Spine MRI`
- `Pilot template: Pain denial`

Then adjust:
- payer name
- line of business
- state
- procedure and diagnosis
- policy/contact URLs (discover or paste)

## 3) First Run Validation
- [ ] Proof panel shows expected workflow progression
- [ ] Artifact payload returned
- [ ] Readiness verdict returned
- [ ] Operator handoff packet generated
- [ ] Run saved in history with request trace

## 4) Staff Handoff SOP
- Use operator packet brief export for operations queue
- Confirm missing evidence items are assigned
- Re-run after chart updates
- Log outcome to KPI sheet

## 5) KPI Baseline Capture
Record baseline at kickoff:
- Denial rate (%)
- Days to auth
- Staff hours per case
- Recovered revenue ($)

Track weekly deltas against baseline.

## 6) Escalation Path
If run fails:
1. Capture `failure.code` and `failure.stage`
2. Capture `requestId`
3. Retry once if retryable
4. Escalate with run snapshot + logs

## 7) Week-1 Deliverables
- One live run accepted by pilot staff
- One exported handoff used in real workflow
- One weekly KPI review with pilot owner
