# Top 0.5% Execution Checklist

Use this file as the working execution board. Keep the checkboxes truthful.

## Product Wedge

- [x] Lock the wedge to specialty-clinic payer web intelligence
- [x] Keep TinyFish as core infrastructure, not decorative add-on
- [x] Focus the product on readiness, routing, and submission prep

## What Is Already Shipped

- [x] Live TinyFish policy extraction
- [x] Live TinyFish contact lookup
- [x] Truthful live proof in the UI
- [x] Generic readiness logic
- [x] Generic failure taxonomy
- [x] MongoDB-backed run history with local fallback
- [x] Workspace profiles
- [x] Workspace analytics
- [x] Snapshot diffing
- [x] Guided intake UX
- [x] Payer and procedure intelligence
- [x] Regional payer and state-plan overrides
- [x] Delegated vendor routing hints
- [x] Staff-friendly operator handoff
- [x] Submission-prep package with blockers and staged tasks
- [x] Exportable operator brief and packet
- [x] Case-bundle import/export
- [x] Operator-packet CSV export
- [x] Routing regression tests
- [x] Retry and SSE reliability hardening

## Highest-Value Remaining Engineering Work

### 1. Multi-user case lifecycle

- [x] Add explicit case status model: `new`, `collecting_evidence`, `ready_for_submission`, `submitted`, `escalated`
- [x] Allow staff notes per case
- [x] Persist status transitions with timestamps
- [x] Surface lifecycle state in run history and operator packet views

### 2. Deeper automated quality coverage

- [x] Add tests for `/api/demo-stream` terminal behavior
- [x] Add tests for run persistence and snapshot diffing
- [x] Add tests for case-bundle import/export helpers
- [ ] Add tests for submission-prep packet generation

### 3. Integration-ready data flow

- [x] Add CSV import for case intake rows
- [x] Add JSON import for batches of cases
- [x] Add export format for downstream ops systems
- [x] Add webhook-ready payload shape for future external integrations

### 4. Partner-stack additions that materially help

- [ ] Evaluate Fireworks.ai for chart-note normalization quality
- [ ] Add AgentMail-powered follow-up notifications or escalation drafts
- [ ] Add Testsprite or equivalent E2E regression automation
- [ ] Add Composio only if a concrete downstream integration is chosen

### 5. Security and PHI-safe defaults

- [x] Redact sensitive free-text fields from logs by default
- [x] Add explicit retention notes for saved runs
- [ ] Add environment validation for production-only secrets
- [ ] Separate demo-safe sample data paths from real-data paths

### 6. Third-step TinyFish workflow

- [x] Define the first realistic authenticated portal handoff target
- [ ] Build a third-step workflow that prepares or enters a portal path
- [ ] Persist portal-step proof and outcomes
- [ ] Add portal-step fallback behavior

## Partner Stack Recommendations

### Strong add-ons

- [ ] TinyFish third-step portal handoff
- [ ] MongoDB for case lifecycle state
- [ ] Testsprite for E2E regression
- [ ] AgentMail for payer/staff escalation follow-up

### Optional add-ons

- [ ] Fireworks.ai for document normalization if benchmarks justify it
- [ ] Composio for downstream integrations after a target system is chosen
- [ ] Axiom if external observability becomes necessary again

## Questions Worth Deep Research

- [ ] More Medicaid and Wellcare state-plan routing coverage
- [ ] Vendor delegation rules by procedure cluster and line of business
- [ ] Public provider pages that preview authenticated portal behavior
- [ ] Which portal workflows are realistic candidates for a TinyFish-authenticated third step

## Working Rule

Do not start a new major feature until the current highest-priority unchecked section is completed and validated.
