# Clinic Ops Agent - Submission Guide for Reviewers

## Quick Links
- **Live Demo**: https://clinic-ops-agent.onrender.com
- **GitHub Repo**: https://github.com/tsj2003/clinic-ops-agent
- **Demo Video**: [Link to your X post with video]

---

## What This Project Does (30 Seconds)

Clinic Ops Agent automates the 2-hour prior authorization research process into 80 seconds using **live browser automation** via TinyFish.

**Two-stage live workflow:**
1. Opens real Aetna policy page → extracts MRI requirements
2. Opens Aetna contact page → finds precertification phone numbers
3. Returns operator-ready decision + next steps

**Key differentiator**: Not a chatbot. Not mock data. Real browser agents on real insurance websites.

---

## How to Test (2 Minutes)

### Option 1: Use Live Deployed App (Fastest)
1. Open https://clinic-ops-agent.onrender.com
2. Page auto-starts the TinyFish workflow on load
3. Watch top panel for "Live Browser Proof" status
4. Wait ~80 seconds for completion
5. Check "TinyFish Result Artifact" and "Operator Handoff Packet" at bottom

**What you'll see:**
- ✅ Real TinyFish run IDs (proof of live execution)
- ✅ Live Aetna page extraction results
- ✅ Submission readiness verdict
- ✅ Exact phone number to call

### Option 2: Run Locally

```bash
# Clone repo
git clone https://github.com/tsj2003/clinic-ops-agent.git
cd clinic-ops-agent

# Set up environment
cp .env.example .env
# Edit .env and add: TINYFISH_API_KEY=your_key_here

# Install dependencies
pip install -r requirements.txt
cd web && npm install && cd ..

# Run Python backend
python stream_runner.py

# In new terminal, run frontend
cd web && npm run dev

# Open http://localhost:3000
```

---

## Verify It's Really Live (Not Mock)

**Check these proof points:**

1. **Run IDs visible** in UI (format: UUID like `ba46e11f-e1a8-474f-a708-a17a29b0c745`)
2. **"Live TinyFish"** badge shows green in "Live Browser Proof" section
3. **Variable execution time** (~60-90 seconds depending on Aetna page load speed)
4. **Real extracted content** from current Aetna.com pages (not static JSON)

**To force fail (verify error handling):**
- Use invalid API key → shows error state
- Disconnect internet → shows "Live stream interrupted"

---

## Architecture Overview

```
Frontend (Next.js)
  ↓ SSE Stream
API Route (/api/demo-stream)
  ↓ Spawns Python Process
stream_runner.py
  ↓ TinyFish API Calls
tinyfish_client.py → Aetna.com (live browser)
```

**Key files:**
- `web/app/api/demo-stream/route.js` - SSE endpoint, spawns Python
- `stream_runner.py` - Main workflow orchestration
- `agent/tinyfish_client.py` - TinyFish API integration
- `core/reasoning.py` - Chart analysis engine

---

## Environment Variables (Required for Live Mode)

```bash
TINYFISH_MODE=live                    # Required
TINYFISH_API_KEY=your_key_here        # Required for live
TINYFISH_API_BASE_URL=https://agent.tinyfish.ai
```

**Default workflows (overridable):**
- Policy: Aetna lumbar MRI requirements
- Contact: Aetna precertification phone lookup

---

## Demo Script for Judges

**What to narrate in 2-3 minutes:**

1. **Problem**: "Prior auth costs clinics 2 hours per case in manual research"
2. **Solution**: "This uses TinyFish to automate browser work on real Aetna pages"
3. **Live proof**: Point at run IDs and "Live TinyFish" badge
4. **Result**: Show operator packet with readiness + phone number
5. **Impact**: "80 seconds vs 2 hours of manual work"

**Key line**: "This isn't a chatbot wrapper—it's a browser agent that actually navigates insurance websites."

---

## Business Case Summary

| Metric | Value |
|--------|-------|
| Market Size | $31B annual prior auth admin waste (US) |
| Time Saved | 2 hours → 80 seconds per case |
| Use Case | Pre-submission research automation |
| Next Step | Portal submission + status tracking |

**Why TinyFish matters here:**
- Insurance websites have no APIs
- Each payer has different, complex UIs
- Browser agents are the only viable solution

---

## Troubleshooting

**App shows "Mock Mode":**
- Check TINYFISH_MODE=live in environment
- Verify TINYFISH_API_KEY is set

**Build fails:**
- Docker requires both Node.js + Python in container
- Check Dockerfile has `--break-system-packages` for pip

**TinyFish calls fail:**
- API key may be invalid or expired
- Check network connectivity to agent.tinyfish.ai

---

## Team

- Tarandeep Singh Juneja
- Harjot Singh

Built for TinyFish Hackathon 2025
