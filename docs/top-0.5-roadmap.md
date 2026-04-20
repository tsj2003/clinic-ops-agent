# AuthPilot AI Top 0.5% Roadmap

This roadmap covers the four highest-leverage product gaps after the current build:

- workspace analytics
- better payer and procedure intelligence
- downstream action layer
- stronger custom-case persistence in history UI

The goal is not to add features for the sake of it. The goal is to make AuthPilot AI feel like a real clinic-ops product that can win Demo Day and survive design partner usage.

## What "Top 0.5%" Means Here

A top-tier build should do four things at once:

1. Show operational maturity.
   The product should remember what happened, who used it, and how often it succeeds or fails.

2. Reduce user thinking, not just user clicking.
   Staff should not have to invent workflow names, guess payer URLs, or interpret raw output on their own.

3. Prepare the next real-world action.
   The product should not stop at "ready or not." It should prepare the team for the next step.

4. Improve with repeated use.
   Every run should make future runs, templates, and workspace insights stronger.

## Current State

What we already have:

- live TinyFish payer policy and routing workflows
- truthful run history
- failure taxonomy with retry guidance
- saved workspace profiles
- guided intake
- payer snapshot diffing
- staff handoff view plus raw JSON packet

What is still missing:

- profile-level analytics per clinic workspace
- better template and payer guidance for new workflows
- actionable downstream prep after readiness
- more obvious intake context inside run history and replay

## Implementation Order

The right order is:

1. Workspace analytics
2. Better custom-case persistence in history UI
3. Better payer and procedure intelligence
4. Downstream action layer

Why this order:

- analytics and richer history increase trust immediately
- payer intelligence reduces setup friction after trust is established
- downstream action should come after the product already captures better context and repeated patterns

## 1. Workspace Analytics

### Why

Once clinics save workspace profiles, they need to know whether those profiles are actually useful. This is the difference between a saved configuration and an operating workflow.

### Build

- aggregate run history by workspace id
- show last run timestamp
- show last successful run timestamp
- show total runs
- show successful runs
- show failure rate
- show average elapsed time
- show most recent failure code

### UI

Add analytics directly inside the workspace panel and optionally in a dedicated workspace details drawer.

Each workspace card should show:

- clinic name
- total runs
- last successful run
- failure rate
- last failure code, if any

### Data model

- keep workspace id on every run
- derive metrics from saved run history
- start with on-read aggregation
- move to cached summary fields only if scale requires it

### Acceptance criteria

- every saved workspace shows basic usage metrics
- analytics work for both MongoDB and local fallback
- a user can tell which workspace is active, stale, risky, or healthy in under 10 seconds

## 2. Better Custom-Case Persistence In History UI

### Why

We now support guided intake, but run history still feels too run-centric and not case-centric. A clinic should be able to look at history and understand the intake context immediately.

### Build

- persist intake context on every run
- surface payer, specialty, diagnosis, and procedure in history cards
- show whether a run came from synthetic demo, custom intake, or a saved workspace
- expose case label more prominently
- allow loading a prior run's intake context back into the guided intake form

### UI

For every run history card, show:

- case label
- payer
- specialty
- diagnosis
- procedure
- workspace name
- input mode

### Acceptance criteria

- run history cards reveal the case context without opening JSON
- replaying a past run restores both workflow configuration and intake context
- staff can quickly distinguish demo runs from real custom workflows

## 3. Better Payer And Procedure Intelligence

### Why

Guided intake is useful, but it still asks the user to know too much. That is friction. Top products reduce that friction with strong defaults, templates, and guardrails.

### Build

#### Phase 1: built-in templates

- add curated starter templates for common payer and procedure patterns
- examples:
  - Aetna lumbar MRI
  - Cigna lumbar MRI
  - UHC lumbar MRI
  - knee arthroplasty readiness

#### Phase 2: intake-assisted draft generation

- generate better workflow names from payer and procedure
- generate stronger default TinyFish goals based on specialty and procedure
- prefill common policy/contact URL patterns where known

#### Phase 3: validation and suggestions

- detect missing or suspicious payer URLs
- warn when policy and contact domains do not match the stated payer
- surface "recommended template" matches based on payer plus procedure

### UI

Add a template selector above guided intake:

- choose starter template
- optionally customize
- run

### Acceptance criteria

- a new user can start from a useful template instead of a blank draft
- guided intake produces better workflow goals automatically
- the app can warn about obvious URL and payer mismatches before the run starts

## 4. Downstream Action Layer

### Why

Right now we stop at readiness and routing. That is valuable, but a top-tier clinic workflow should prepare the actual next operational step too.

### Build

#### Phase 1: submission prep checklist

- generate a checklist based on readiness output
- examples:
  - confirm diagnosis code
  - confirm evidence documents attached
  - call provider precert line
  - upload PT note before submission

#### Phase 2: portal handoff payload

- create a machine-readable action plan for the next portal step
- include:
  - required codes
  - required documents
  - expected next action
  - contact route

#### Phase 3: TinyFish third-step prototype

- add an optional third workflow that prepares a downstream authenticated action
- this can begin as a checklist or draft handoff, not full automation

### UI

Add a new panel:

- `Next Action Checklist`
- `Portal Prep Summary`

### Acceptance criteria

- every completed run yields a clearer operational next step than today
- staff can move from analysis into action without reinterpreting the output
- the product story evolves from "analysis tool" into "workflow system"

## Delivery Plan

### Sprint A

- workspace analytics
- richer history UI with intake context

### Sprint B

- starter payer and procedure templates
- smarter guided draft generation

### Sprint C

- submission prep checklist
- portal handoff payload

### Sprint D

- optional TinyFish third-step prototype
- quality hardening based on design partner feedback

## Metrics To Watch

Track these after shipping the above:

- percent of custom runs started from a saved workspace
- percent of custom runs started from a template
- average time from intake to run start
- workspace success rate
- workspace failure rate
- percent of runs where staff use the exported brief
- percent of runs where next-action checklist is completed

## Demo Day Impact

If we execute this roadmap well, judges should feel:

- this team understands repeated usage, not just one demo
- this product gets smarter as clinics use it
- this is closer to a system of work than a one-off agent
- TinyFish is central to the actual business value

## Immediate Build Sequence

1. Add workspace analytics derived from run history.
2. Upgrade run history cards to show intake context clearly.
3. Add starter templates and validation to guided intake.
4. Add next-action checklist and portal prep summary.
