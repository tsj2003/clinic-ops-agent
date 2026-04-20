# AuthPilot AI (Clinic Ops Agent)

AuthPilot AI is a live **prior-authorization prep copilot** for specialty clinics: it turns payer-policy research + routing into an operator-ready handoff.

This project is deliberately framed as **Inbound Open Innovation** applied to a mature industry (healthcare operations): instead of building brittle scrapers or waiting for payer APIs that don’t exist, we leverage a live browser agent (TinyFish) to pull policy truth directly from real payer web surfaces, then integrate it into an ops-owned workflow.

## The growth gap (why this exists)

Clinics have a growth gap: case volume and complexity rise, but headcount and expertise do not scale linearly. Prior auth prep becomes the bottleneck:

- staff manually read payer policies and hunt submission routes
- evidence gaps are discovered late (after portal time is spent, or after denial)
- the work is slow, brittle, and expensive

AuthPilot closes that gap by converting manual research into a **repeatable, auditable, operator-owned** workflow.

## What is real now

- TinyFish is called live when `TINYFISH_MODE=live`
- The app streams real TinyFish SSE events into the Next.js UI
- The UI shows the structured results returned by both TinyFish runs
- The final verdict and operator packet are derived from the live extractions plus chart evidence, not from a hardcoded banner
- Saved runs now compare payer snapshots against the previous run so policy and routing changes are visible over time
- Custom mode now supports reusable clinic workspace profiles for design partner workflows
- The UI now renders a staff-ready handoff view in addition to the raw operator packet JSON
- Custom mode now supports case-bundle import/export so workflows can be moved between teammates or saved outside the app
- The operator packet can now be exported as JSON, plain-text brief, or CSV

## The workflow (what happens in one run)

- Open payer policy page (live) → extract documentation requirements
- Compare requirements vs chart evidence → surface missing evidence *before* portal work
- Open payer contact/routing page (live) → find precertification path / phone fallback
- Produce an operator-ready packet: verdict, missing evidence list, routing, checklist

## Hard outcome KPIs (demo-ready)

These are simple, judge-friendly proofs you can say out loud while the run executes:

- **Time saved per case**: 2 hours (120 min) → ~80 seconds (1.33 min)  
  - **118.7 minutes saved per case** (\(~98.9\% reduction\))
- **Denial-risk prevention** (operational): evidence gaps are detected *pre-submission* and returned as a checklist + blockers, reducing wasted portal time and avoidable denials.

## Business-owned integration (not a “cool agent demo”)

Open Innovation succeeds when the business owns outcomes. This system is built for the revenue-cycle ops owner:

- outputs are structured (operator packet) and exportable (JSON/TXT/CSV)
- the workflow is repeatable across cases (workspaces + bundle import/export)
- the UI tracks run history and policy/routing diffs over time

## Default live workflows

The default first workflow checks a live Aetna medical policy page for lumbar spine MRI requirements:

- Workflow name: `Aetna lumbar MRI policy readiness check`
- Policy URL: `https://www.aetna.com/cpb/medical/data/200_299/0236.html`

The default second workflow checks Aetna's public contact page for provider precertification routing:

- Workflow name: `Aetna precertification contact lookup`
- Contact URL: `https://www.aetna.com/about-us/contact-aetna.html`

You can override this in `.env` with:

- `TINYFISH_WORKFLOW_NAME`
- `TINYFISH_WORKFLOW_URL`
- `TINYFISH_WORKFLOW_GOAL`
- `TINYFISH_CONTACT_WORKFLOW_NAME`
- `TINYFISH_CONTACT_WORKFLOW_URL`
- `TINYFISH_CONTACT_WORKFLOW_GOAL`

## Run locally

### Python runner (streams events)

```bash
pip install -r requirements.txt
python3 stream_runner.py
```

### Web

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`. The default mode autostarts the backend stream on page load, and custom mode lets you run your own workflow inputs manually.

## Environment

Copy `.env.example` to `.env` and set:

```bash
TINYFISH_MODE=live
TINYFISH_API_KEY=your_key_here
TINYFISH_API_BASE_URL=https://agent.tinyfish.ai
```

Optional run history persistence:

```bash
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=authpilot
MONGODB_COLLECTION=run_history
```

Optional Axiom observability:

```bash
AXIOM_API_TOKEN=your_axiom_token
AXIOM_DATASET=authpilot_runs
AXIOM_BASE_URL=https://api.axiom.co
```

Optional API write protection:

```bash
INTERNAL_API_KEY=your_internal_ops_key
```

When `INTERNAL_API_KEY` is set, write routes require the `x-internal-api-key` header.

Write-route auth is enforced in middleware for:

- `/api/runs` (`PATCH`)
- `/api/workspaces` (`POST`, `DELETE`)
- `/api/discover-sources` (`POST`)

Structured audit events are emitted for write and discovery operations with signal `audit_event`.

API responses now include a request trace id:

- Header: `x-request-id`
- JSON: `requestId` on success and error payloads

Admin metrics endpoint:

- `GET /api/admin/metrics?days=7&limit=200`

Admin metrics CSV export:

- `GET /api/admin/metrics/export?limit=500`

Returns dashboard-ready rollups (success/failure rates, readiness, latency, failure taxonomy) and observability/audit health.
Includes daily trend series (`dailySeries`, `readinessTrend`) for charting.

If `INTERNAL_API_KEY` is configured, pass header:

`x-internal-api-key: <your_key>`

The main UI now includes a **Startup Metrics** panel that reads this endpoint. If protected, paste the same internal key into the panel.

Optional workflow overrides:

```bash
TINYFISH_WORKFLOW_NAME=Aetna lumbar MRI policy readiness check
TINYFISH_WORKFLOW_URL=https://www.aetna.com/cpb/medical/data/200_299/0236.html
TINYFISH_WORKFLOW_GOAL=Read this medical policy page and return compact JSON with keys: policy_name, mentions_conservative_management, evidence_requirements, page_url.
TINYFISH_CONTACT_WORKFLOW_NAME=Aetna precertification contact lookup
TINYFISH_CONTACT_WORKFLOW_URL=https://www.aetna.com/about-us/contact-aetna.html
TINYFISH_CONTACT_WORKFLOW_GOAL=For providers seeking prior authorization help, return compact JSON with keys: provider_precert_phone, provider_precert_notes, source_page_url.
```

## Current limitation

This is now a live two-stage TinyFish workflow, but it is not yet a full private-portal automation system. The strongest next upgrade would be chaining this readiness-and-routing step into a third TinyFish workflow that logs into a real payer or admin portal and performs the downstream submission task.

## Startup Assets

- Startup operating plan: `docs/startup-operating-plan.md`
- Design partner kit: `docs/design-partner-kit.md`
- Public proof plan: `docs/public-proof-plan.md`
- Build sprint backlog: `docs/build-sprint-backlog.md`
- Top 0.5% roadmap: `docs/top-0.5-roadmap.md`
- Top 0.5% execution checklist: `docs/top-0.5-checklist.md`
- Agent context handoff: `docs/agent-context.md`
- Partner stack and deep research prompts: `docs/partner-stack-and-research-prompts.md`
- Weekly operating review: `docs/weekly-operating-review.md`
- Design partner pipeline template: `docs/design-partner-pipeline-template.csv`

## Demo And Deployment Assets

- Final raw demo script: `docs/final-demo-script.md`
- Submission brief: `docs/submission-brief.md`
- Deployment guide: `docs/deploy.md`

## Deploy

This app is best deployed as a Dockerized service because the Next.js API route launches `stream_runner.py` at runtime.

```bash
docker build -t authpilot-ai .
docker run --rm -p 3000:3000 \
  -e TINYFISH_MODE=live \
  -e TINYFISH_API_KEY=your_real_tinyfish_key \
  -e TINYFISH_API_BASE_URL=https://agent.tinyfish.ai \
  authpilot-ai
```
