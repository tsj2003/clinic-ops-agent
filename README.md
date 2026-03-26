# Clinic Ops Agent

Clinic Ops Agent is a live payer-policy intelligence and action-routing agent for clinics.

It uses the TinyFish Web Agent API to visit a real insurer policy page, extract documentation requirements, compare them against a synthetic patient chart, and then look up the right prior-authorization contact path on the payer site before a staff member spends time in the portal.

## What is real now

- TinyFish is called live when `TINYFISH_MODE=live`
- The app streams real TinyFish SSE events into the Next.js UI
- The UI shows the structured results returned by both TinyFish runs
- The final verdict and operator packet are derived from the live extractions plus chart evidence, not from a hardcoded banner

## The problem it solves

Revenue-cycle teams still manually read payer policy pages to figure out whether a chart has enough evidence to justify a submission, and then they hunt for the right submission or precertification channel. That work is slow, brittle, and expensive. AuthPilot AI turns that browser-heavy prep work into a live operator handoff:

- open the payer policy page
- extract the requirements
- compare them to the chart
- surface missing evidence before portal work begins
- find the payer precertification contact path
- produce an operator-ready action packet

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

### Python

```bash
pip install -r requirements.txt
python main.py
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
