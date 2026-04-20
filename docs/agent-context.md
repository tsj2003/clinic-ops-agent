# AuthPilot AI Agent Context

This file is the single-source handoff for any future coding agent working in this repo.

## Product Definition

AuthPilot AI is a payer web intelligence and submission-prep agent for specialty clinics.

Core wedge:

- spine
- orthopedic
- pain-management

Core job:

- visit live payer policy pages with TinyFish
- extract documentation requirements
- compare them against chart evidence
- discover the right prior-auth or precert routing path
- hand staff a submission-prep package before they enter the portal

## Why TinyFish Is Core

The product is not a static summarizer and not generic RAG.

TinyFish is used as the core browser-native infrastructure for:

- payer policy extraction
- payer contact and routing lookup
- live source discovery
- future portal handoff and authenticated workflow steps

## Current Architecture

### Python runtime

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/stream_runner.py`
- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/core/reasoning.py`
- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/agent/tinyfish_client.py`

Responsibilities:

- build patient context from default demo or custom intake
- run TinyFish workflows
- evaluate submission readiness against extracted evidence requirements
- build downstream operator packet
- emit structured SSE-friendly JSON events

### Web app

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/app/page.js`
- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/app/api/demo-stream/route.js`
- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/components/*`
- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/lib/*`

Responsibilities:

- autoplay live demo
- guided intake + advanced config
- workspace persistence
- run history + snapshot diffing
- live proof rendering
- operator packet rendering
- import/export actions

## What Is Already Implemented

### Core workflow

- [x] live TinyFish policy extraction
- [x] live TinyFish contact routing lookup
- [x] generic readiness logic instead of MRI-only phrase matching
- [x] generic recovery/error classification
- [x] truthful proof panel and failure handling

### Product system

- [x] run history with MongoDB fallback to local storage
- [x] workspace profiles for design-partner workflows
- [x] payer snapshot diffing
- [x] guided intake mode
- [x] payer + procedure intelligence suggestions
- [x] state + line-of-business-aware routing
- [x] regional BCBS and fragmented-plan handling
- [x] submission-prep package with blockers and staged tasks
- [x] exportable operator packet and brief
- [x] case-bundle import/export
- [x] operator packet CSV export

### Reliability

- [x] retry/backoff for retryable TinyFish failures
- [x] deterministic SSE termination handling
- [x] failure taxonomy + retry guidance
- [x] routing test suite

## Most Important Files

### Backend

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/stream_runner.py`
  Main workflow runtime and operator packet builder.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/core/reasoning.py`
  Chart evidence reasoning, approval heuristics, requirement matching support.

### Frontend

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/app/page.js`
  Main product experience and state orchestration.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/components/GuidedIntakePanel.jsx`
  Intake UX, payer intelligence, starter templates, live discovery.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/components/WorkspacePanel.jsx`
  Design-partner workspace profiles and analytics.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/components/OperatorPacketCard.jsx`
  Staff-facing handoff and submission-prep rendering.

### Data and persistence

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/lib/payer-intelligence.js`
  Payer routing intelligence, vendor delegation logic, state/LOB overrides.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/lib/run-store.js`
  Run persistence and snapshot diffing.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/lib/workspace-store.js`
  Workspace persistence and analytics.

- `/Users/tarandeepsinghjuneja/tinyfish_hackathone/web/lib/case-bundle.js`
  Case-bundle import/export and operator CSV export helpers.

## Current Product Truth

What the product does well now:

- converts messy payer websites into structured readiness + routing decisions
- supports repeated workflows for design partners
- keeps an auditable history of runs and payer changes
- gives staff a usable prep package instead of just a JSON blob
- supports authenticated payer portal automation with proof capture and EMR close-loop updates
- runs pre-submission policy audit + denial simulation guardrails before portal submission
- supports autonomous follow-up channels (voice + AgentMail + Composio dispatch)
- supports sovereign agent identity, signed intents, revocation, and isolated Daytona execution
- supports high-density executive reasoning adjudication with adversarial checks and immutable redacted reasoning ledger persistence

What the product does not do yet:

- broad production rollout with live signed pilot KPI deltas across multiple real clinics
- full multi-user collaboration and roles
- completed formal compliance certification package for real PHI operations (SOC2/HIPAA program execution)

## Implementation Snapshot (Completed Through Step 14)

Use [implementation.md](../implementation.md) as source-of-truth detail log. Summary below is the current handoff state.

### Phase 1-4 foundation

- ✅ Core quality + PHI hardening, retention controls, and batch intake import pipeline
- ✅ Connector prototypes for athenahealth and Epic first-write handoff
- ✅ Playwright portal submission with proof artifacts and EMR patch paths
- ✅ Fireworks extraction optimization path with benchmark telemetry

### Step 5-9 automation expansion

- ✅ Composio bridge for Slack/Billing/Scheduling with idempotent dispatch
- ✅ Exception Command Center + Axiom vitals and one-click remediation actions
- ✅ Parasail billing + Yotta revenue integrity + 24-hour refund automation
- ✅ Policy Sentinel autonomous RAG maintenance and policy-delta alerting
- ✅ Peer-to-peer combat brief generation with strict citation structure and surgeon alerting

### Step 10 zero-touch intake

- ✅ EMR polling orchestration (athena + Epic), high-signal CPT filter, dedupe, and autonomous run creation
- ✅ Polling APIs and command-center visibility with observability/ROI emission

### Step 11 autonomous fulfillment

- ✅ Dify-governed fulfillment state machine (`approved → patient_nudge → prep_verification → schedule_lock`)
- ✅ Emitrr nudges, Fireworks patient-readiness analysis, and athena/Epic schedule lock adapters

### Step 12 denial simulation + scaling

- ✅ Insforge/adversarial denial simulation with ag2 coordination and Fireworks scoring
- ✅ Blocking re-plan gate when risk > 40%, wired directly into portal submission route
- ✅ Allscale wrapper with 500-concurrency cap and latency floor controls

### Step 13 sovereign identity + isolation

- ✅ Ed25519 per-agent DID identities and secure signer envelope flow
- ✅ Intent verification middleware (passport checks + revocation + timestamp/digest/signature guards)
- ✅ Global kill switch and immutable hash-chained intent ledger in pilot-vault
- ✅ Daytona ephemeral run-scoped sandbox lifecycle around payer submission

### Step 14 reasoning adjudication + adversarial guardrails

- ✅ Photon adjudication client with SDK-first and HTTP fallback behavior
- ✅ Executive adjudicator module combining Mixedbread retrieval + AG2 coordination + Photon scoring
- ✅ `runGiskardAudit()` adversarial checks (hallucination, bias, contradiction)
- ✅ Strict citation enforcement (`note_timestamp`, `page_number`) with forced `integrityScore=0` on missing evidence
- ✅ Blocking integrity gate (`integrityScore < 0.95`) before signing and before Daytona sandbox startup
- ✅ Manual-action fallback path with lifecycle updates and audit emission
- ✅ Immutable ledger extension for redacted reasoning-path persistence (`recordType=reasoning_adjudication`)

### Step 15 production integrity hard audit

- ✅ Added executable production stress audit (`web/scripts/production-stress-audit.mjs`) and npm entrypoint (`npm run audit:production`)
- ✅ Verifies sovereign DID key uniqueness and passport-scope intent enforcement through signed envelope verification
- ✅ Verifies adjudication hard-gate behavior (`AUTHENTICATION_ERROR`) and confirms Daytona sandbox does not spin up on blocked integrity
- ✅ Verifies billing idempotency under duplicate APPROVED voice callbacks keyed by deterministic `payer_reference_id`
- ✅ Verifies PollingOrchestrator timer-loop behavior by asserting extraction start latency and Axiom telemetry side effects

### Latest validation

- ✅ Security/regression suite revalidated after Step 14: 111/111 tests passing

## Recommended Partner Stack Usage

Only use tools that sharpen the wedge.

### Strongest fits

- TinyFish
  Core live web execution and future portal handoff.

- MongoDB
  Run history, snapshots, workspace data, future case lifecycle state.

- Fireworks.ai
  Only if we need better chart-note normalization or document summarization than current heuristics.

- AgentMail
  Strong future fit for payer follow-up emails, escalations, and staff notifications.

- Testsprite
  Strong fit for end-to-end regression coverage across the UI and SSE workflow.

- Composio
  Good later for downstream integrations if we connect into CRMs, ticketing, or task tools.

### Lower-priority or only-if-needed

- Axiom
  Good, but optional since first-party run history exists.

- Dify
  Avoid unless it adds clear product value; risk of making the system look wrapper-like.

- v0 / Superdesign
  Only for surface polish, not core value.

## Next Best Engineering Moves

Read `/Users/tarandeepsinghjuneja/tinyfish_hackathone/docs/top-0.5-checklist.md` for the ordered checklist.

The next implementation priorities after the current pass are:

1. Multi-user case lifecycle
2. More automated tests for SSE, persistence, and packet generation
3. Partner-stack add-ons with direct product value
4. Security and PHI-safe defaults
5. Authenticated third-step portal handoff

## Deep Research That Would Help

If more source research is needed, the highest-value asks are:

1. Additional state-plan overrides for Medicaid and Wellcare branches
2. Vendor-routing rules for TurningPoint, Evolent, Carelon, Cohere, eviCore by payer and procedure cluster
3. Public provider portal rules that differ by line of business
4. Authenticated portal workflow opportunities where TinyFish can realistically add a third step

If asking Gemini for research, request:

- only official payer/provider sources
- exact URLs
- state + line-of-business specificity
- no guesses
- JSON output only
