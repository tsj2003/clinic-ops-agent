# Deployment Guide

This project uses a Next.js web app plus a Python runtime launched from the API route. The simplest reliable public deployment is a single Docker-based service.

## Recommended Platforms

- Railway
- Render
- Fly.io
- Any VM or container host that can run Docker

## Required Environment Variables

Set these in your deployment platform:

```bash
TINYFISH_MODE=live
TINYFISH_API_KEY=your_real_tinyfish_key
TINYFISH_API_BASE_URL=https://agent.tinyfish.ai
PYTHON_BIN=python3
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

## Docker Deploy

Build locally:

```bash
docker build -t authpilot-ai .
```

Run locally:

```bash
docker run --rm -p 3000:3000 \
  -e TINYFISH_MODE=live \
  -e TINYFISH_API_KEY=your_real_tinyfish_key \
  -e TINYFISH_API_BASE_URL=https://agent.tinyfish.ai \
  authpilot-ai
```

Open `http://localhost:3000`.

## Railway

1. Push the repo to GitHub.
2. Create a new Railway project from the repo.
3. Railway should detect the `Dockerfile` automatically.
4. Add the environment variables above.
5. Deploy and open the generated public URL.

## Render

1. Push the repo to GitHub.
2. Create a new Web Service from the repo.
3. Choose Docker deployment.
4. Add the environment variables above.
5. Deploy and use the generated URL for your demo and submission.

## What To Verify Before Recording

- The homepage autostarts on load
- The proof panel shows `Live TinyFish`
- The policy and contact runs populate with live workflow status
- The artifact and operator packet update from the backend stream
- No browser console errors appear during the demo

## Important Note

Avoid deploying this specific build to a platform that only supports static Next.js hosting. The API route depends on a Python process at runtime, so you need a server or container environment, not static hosting.
