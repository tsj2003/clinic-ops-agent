# AuthPilot AI Build Sprint Backlog

Use this as the default engineering and product backlog for the TinyFish sprint.

## P0: Must Ship

### 1. Persistent Run History

Why:

- design partners need repeatable trust
- Demo Day judges need proof that this is a system, not a one-off run

Build:

- save each run in MongoDB
- store run metadata, artifact payload, verdict, elapsed time, and failure reason
- add a simple run history view in the UI

Acceptance criteria:

- every live run is saved automatically
- failed runs are visible, not dropped
- a user can open the last 10 runs and inspect outputs

### 2. Production Observability

Why:

- top teams know exactly how their agent fails
- payer-specific breakage will be common

Build:

- send structured logs to Axiom
- track run duration, step durations, failure stage, workflow name, payer domain, and result status
- create a dashboard for success rate and failure reasons

Acceptance criteria:

- every run produces a traceable event stream
- failures are grouped by stage
- we can answer "what broke this week?" in under 5 minutes

### 3. Exportable Operator Packet

Why:

- the product is only useful if a staff member can act on the output

Build:

- add copy and download actions for the operator packet
- make the packet easy to scan for staff
- include policy URL, contact URL, missing evidence, and next action

Acceptance criteria:

- a staff user can export the packet in one click
- exported content is readable without the UI

### 4. Failure Taxonomy And Retry Flow

Why:

- trustworthy software does not blur timeouts, no-result runs, and upstream cancellations

Build:

- normalize failure types
- label: payer_page_failure, contact_lookup_failure, empty_result, extraction_mismatch, timeout
- add retry guidance in the UI

Acceptance criteria:

- every failure maps to one category
- retry suggestions are visible for operator-facing failures

### 5. Payer Snapshot Diffing

Why:

- long-term moat comes from knowing when payer requirements change

Build:

- persist extracted policy snapshots
- compare latest result against prior result
- surface changes in evidence requirements or routing content

Acceptance criteria:

- if the same payer policy changes, we can show what changed
- change history is stored with timestamps

## P1: High Leverage

### 6. Design Partner Workspace Mode

Build:

- lightweight workspace concept by clinic name
- saved default workflows per clinic
- recent cases grouped by clinic

### 7. Guided Input UX

Build:

- cleaner intake form for payer, procedure, and chart summary
- reduce free-form confusion during customer demos

### 8. Case Feedback Loop

Build:

- allow users to mark result as useful, incomplete, or incorrect
- store notes for workflow tuning

## P2: Only If Time Remains

### 9. Portal Handoff Workflow

Build:

- start a third-step TinyFish workflow that prepares the next portal action

### 10. Change Alerts

Build:

- notify when a tracked payer policy page changes materially

## Next Phase Focus

See `docs/top-0.5-roadmap.md` for the detailed plan covering:

- workspace analytics
- payer and procedure intelligence
- downstream action layer
- richer custom-case persistence in history UI

## Partner Stack Use

### TinyFish

- live payer policy extraction
- live routing lookup
- future portal handoff workflow

### MongoDB

- run history
- policy snapshots
- feedback records
- clinic workspace data

### Axiom

- operational logs
- failure dashboards
- latency and run health monitoring

### Fireworks.ai

- only if it materially improves chart evidence normalization

## TinyFish Core Team Questions

Use office hours and engineering channels for these exact questions:

1. What is the best practice for reliable run retries across multi-stage workflows?
2. Which event fields are most stable for production logging and monitoring?
3. How should we think about session reuse versus fresh browser sessions for payer workflows?
4. What failure patterns do they see most often on messy sites and how do top teams handle them?
5. What is the recommended path from public web workflow into authenticated portal workflow?

## Weekly Ship Standard

Every week must end with:

- one product improvement that increases trust
- one customer learning
- one public proof post
- one measurable metric improvement
