# Clinic Ops Agent: Complete Build + Business Playbook

## Executive Summary

Build a HIPAA-compliant clinic-ops platform that closes the **RCM growth gap**: volumes rise, payer rules change weekly, and staffing/expertise doesn’t scale linearly.

### Wedge product (what wins early)

Start with **prior-auth prep** (the fastest value path):
- live payer policy extraction (no payer APIs required)
- evidence-gap detection *pre-submission* (denial-risk prevention)
- routing + operator handoff packet for billing staff

This is **Inbound Open Innovation** applied to a mature industry: leverage external discovery (TinyFish live browser agents) and integrate it into a business-owned workflow instead of trying to build/maintain brittle scrapers.

### Adoption playbook (from Open Innovation research)

To scale adoption inside clinics and enterprises:
- **Top-down alignment**: tie the workflow to explicit growth/throughput goals (reduce cycle time, reduce denials).
- **Business-owned integration**: ops owners (RCM / prior auth lead) own outcomes; the system outputs operator-ready packets, not “AI vibes.”
- **Champions + phase-gate integration**: internal champion integrates into existing submission workflows; don’t create parallel processes.
- **Hard outcome metrics**: measure time saved and denial-risk reduction, not “number of AI features.”

**Valuation Target: 500 Crore INR (~$60M USD)**
- Required ARR: $2M-$4M (15x-30x valuation multiple for AI startups)
- Survival Milestone: $1M ARR within 3 years (92% failure rate if missed)
- Path: $180k Year 1 → $1M Year 2 → $4M Year 3 → $10M+ Year 4

**Critical Success Factors:**
1. **Survival First**: Hit $1M ARR before any major scaling (70% of startups fail by scaling too early)
2. **Compliance Moat**: 60% of IT leaders prioritize AI control/compliance over speed
3. **Unit Economics**: Target 4:1 LTV:CAC ratio (MedTech benchmark, vs 3:1 minimum baseline)
4. **GTM Strategy**: Match motion to ACV — under $5k (product-led), $5k-$50k (hybrid), $50k+ (enterprise sales)

---

## Phase 1: Build The Product (Months 1-6)

### KPI targets (prove value fast)

- **Time saved per case**: 120 minutes → ~80 seconds (≈ 118.7 minutes saved; ≈ 98.9% faster)
- **Pre-submission denial-risk prevention**: % of cases where evidence gaps are surfaced before portal work begins
- **Ops throughput**: cases prepped per FTE per day

### Week 1-2: Core Denial Detection (MVP)

**Stack:** Google Cloud + TinyFish API + MongoDB

**What to build:**
1. TinyFish scraper logs into Aetna provider portal
2. Navigates to claims section, filters for "denied" status
3. Extracts: claim number, denial code (CO-50, PR-119, etc.), denial reason, date, patient ID, billed amount
4. Stores in MongoDB with `status: "pending_review"`

**Success metric:** Detect 95%+ of denials within 24 hours of posting

**Code structure:**
```
/denial-scraper
  ├── scrapers/
  │   ├── aetna_scraper.py      # TinyFish workflow
  │   ├── uhc_scraper.py        # Phase 2
  │   └── base_scraper.py         # Abstract base
  ├── database/
  │   └── mongo_client.py         # PHI-compliant storage
  └── scheduler.py                # Google Cloud cron
```

### Week 3-4: Appeal Generation Engine

**Stack:** AG2 + Fireworks.ai (Llama 3.1 70B) + Mixedbread + MongoDB

**Multi-agent orchestration:**

```
AG2 Orchestrator
├── Scraper Agent (TinyFish)
│   └── Extracts denial details from portal
├── Diagnostic Agent (Fireworks.ai)
│   └── Analyzes denial code + reason
├── RAG Retriever (Mixedbread)
│   └── Queries: payer policy embeddings + patient chart
└── Appeals Writer Agent (Fireworks.ai)
    └── Drafts letter citing policy + clinical evidence
```

**RAG pipeline:**
1. Embed Aetna medical policies (Mixedbread embeddings)
2. Embed patient clinical notes
3. Vector search: "What policy supports MRI for radiculopathy?"
4. Include top 3 matches in appeal draft

**Appeal template includes:**
- Claim number and patient demographics
- Specific denial code being appealed
- Medical necessity justification (citing policy + chart)
- Requested reconsideration with supporting evidence

### Week 5-6: Human Approval + Submission

**Stack:** v0 by Vercel + TinyFish + AgentMail + Composio

**v0 Dashboard (Human-in-the-Loop):**
```
┌─────────────────────────────────────────┐
│  Denial Management Dashboard             │
├─────────────────────────────────────────┤
│  🔴 12 Denied Claims Need Review         │
│                                         │
│  Claim #4521 | $4,200 | CO-50           │
│  [View Appeal Draft] [Approve] [Edit]   │
│                                         │
│  Claim #4522 | $8,100 | PR-119          │
│  [View Appeal Draft] [Approve] [Edit]   │
└─────────────────────────────────────────┘
```

**Workflow:**
1. Billing staff logs into dashboard
2. Reviews AI-drafted appeal
3. Clicks "Approve & Submit"
4. TinyFish uploads PDF to payer portal
5. AgentMail sends confirmation with tracking ID
6. Composio notifies Slack: "Appeal submitted for Claim #4521"

### Week 7-8: Compliance Layer (HIPAA)

**Stack:** Insforge + Axiom + AgentOps

**HIPAA requirements:**

| Requirement | Implementation |
|-------------|----------------|
| Audit logs | Axiom: Every PHI access logged with user ID, timestamp, action, data accessed |
| Access controls | Role-based: admin, biller, reviewer |
| Encryption | MongoDB Atlas encryption-at-rest, TLS in transit |
| BAAs | Business Associate Agreements with TinyFish, MongoDB, Google Cloud |
| Monitoring | AgentOps tracks agent failures, costs, anomalies |

**Tamper-evident logging format:**
```json
{
  "timestamp": "2024-01-15T09:23:47Z",
  "user_id": "bill_001",
  "action": "viewed_patient_chart",
  "phi_accessed": ["patient_id_4920", "diagnosis_lumbago"],
  "ip_address": "10.0.1.23",
  "agent_run_id": "ba46e11f-e1a8-474f-a708-a17a29b0c745"
}
```

---

## Phase 2: Compliance Moat (Months 6-12)

### Month 6-8: HITRUST Certification

**Why HITRUST over SOC 2:**
- SOC 2 = general tech compliance
- HITRUST = healthcare-specific, maps directly to HIPAA
- Enterprise hospitals require HITRUST
- Shortens sales cycles from 12 months → 6 months

**Steps:**
1. Hire HITRUST consultant ($15-25k)
2. Implement 300+ required controls
3. 3rd party audit ($30-50k)
4. Certification achieved (Month 8)

### Month 8-10: EHR Integrations

**Critical for scale:** Billing teams won't duplicate data entry.

**Priority integrations:**

| EHR | Market Share | Integration Method |
|-----|-------------|---------------------|
| Epic | 35% | HL7 FHIR API |
| Cerner | 25% | HL7 FHIR API |
| athenahealth | 10% | REST API |
| eClinicalWorks | 8% | Custom API |

**What to pull from EHR:**
- Patient demographics
- Diagnosis codes (ICD-10)
- Procedure codes (CPT)
- Clinical notes (relevant to denial)
- Insurance eligibility

**Implementation:**
```python
# Epic FHIR integration
from fhirclient import client

def get_patient_chart(patient_id):
    smart = client.FHIRClient(settings={
        'app_id': 'clinic_ops_agent',
        'api_base': 'https://epic.fhir.url'
    })
    patient = smart.server.read('Patient', patient_id)
    conditions = smart.server.search('Condition', {'patient': patient_id})
    return patient, conditions
```

### Month 10-12: Advanced Features

**Contingency pricing model:**
- Free to use
- Charge 5-10% of recovered revenue only on successful appeals
- Transition to SaaS after proving ROI

**Denial prediction:**
- Use historical data to predict which claims will be denied
- Proactive correction before submission
- Fireworks.ai classification model

---

## Phase 3: Go-To-Market (Months 12-18)

### Months 12-14: Founder-Led Sales (First 10 Customers)

**Target ICP (Ideal Customer Profile):**
- Specialty clinics (radiology, orthopedics, cardiology)
- $2M-$20M annual revenue
- 3-15 billing staff
- Currently using manual denial management
- High denial rate specialty (imaging, DME, etc.)

**Sales process:**
1. LinkedIn outreach to Billing Managers/Directors
2. 15-min demo showing live Aetna portal automation
3. Free pilot: Monitor their denials for 30 days
4. ROI calculation: "We found $X in recoverable denials"
5. Close at $12k-$24k ARR

**Key messaging:**
- Not "AI tool" → "Automated denial recovery system"
- Lead with ROI: "Recover $50k in 90 days or you don't pay"
- Trust first: HITRUST certified, HIPAA compliant

### Months 14-18: Hybrid Sales Motion ($1M ARR Goal)

**Pricing tiers:**

| Tier | Price | Features | Target |
|------|-------|----------|--------|
| Starter | $12k/year | 1 payer, 50 claims/mo, manual approval | Small clinics |
| Growth | $24k/year | 3 payers, 200 claims/mo, auto-submit low-risk | Mid-size |
| Enterprise | $60k+/year | Unlimited, all payers, EHR integration, custom workflows | Hospital systems |

**Marketing channels:**
- LinkedIn content (denial management tips, industry trends)
- Healthcare conferences (HFMA, AAPC, MGMA)
- Referrals from first 10 customers
- Webinars: "How to recover 30% more from denied claims"

**Sales team hiring:**
- Month 14: First AE (Account Executive)
- Month 16: Second AE + SDR (Sales Development Rep)
- Month 18: Customer Success Manager

---

## Phase 4: Scale & Unit Economics (Months 18-36)

### Month 18-24: $5M ARR

**Key metrics:**

| Metric | Target | Why |
|--------|--------|-----|
| LTV:CAC | 4:1 | Industry benchmark for MedTech |
| Gross Margin | 75%+ | High software margins |
| Churn | <10% annually | Stickiness of denial data |
| NRR | 120%+ | Expansion revenue from Growth tier |

**Operational focus:**
- Automated onboarding (reduce implementation time)
- Self-serve for Starter tier
- Expand to 10+ payers (United, BCBS, Cigna, Medicare)
- AI accuracy improvement (95%+ appeal success rate)

### Month 24-36: $10M+ ARR

**Enterprise expansion:**
- Hospital system deals ($100k+ ACV)
- White-label for RCM vendors
- International: Canada, UK, Australia

**Product expansion:**
- Prior authorization automation (pre-denial)
- Coding optimization (prevent denials)
- Contract negotiation intelligence

**Team structure:**
- Engineering: 15 people
- Sales: 8 people
- Customer Success: 5 people
- Compliance/Security: 3 people

---

## Financial Projections

### 3-Year Revenue Model

| Year | Customers | ARPU | ARR | Growth |
|------|-----------|------|-----|--------|
| 1 | 10 | $18k | $180k | — |
| 2 | 50 | $20k | $1M | 455% |
| 3 | 250 | $24k | $6M | 500% |

### Unit Economics (Year 3)

| Metric | Value |
|--------|-------|
| CAC | $6,000 |
| LTV | $72,000 |
| LTV:CAC | 12:1 |
| Payback period | 4 months |
| Gross margin | 80% |

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Payer portal changes | Monitor with AgentOps, update TinyFish workflows weekly |
| PHI breach | HITRUST + encryption + audit logs |
| AI hallucination | Human-in-the-loop for all appeals, accuracy tracking |

### Business Risks

| Risk | Mitigation |
|------|------------|
| Long sales cycles | Founder-led sales, contingency pricing, pilot programs |
| EHR integration complexity | Start with 3 most common, expand gradually |
| Competitor with more funding | Focus on specific niche (radiology/ortho), superior UX |

---

## Immediate Next Steps (This Week)

1. **Apply to Google for Startups Cloud Program** → $200k credits
2. **Create MongoDB Atlas cluster** → Free tier, HIPAA-ready
3. **Build Aetna denial scraper** → First working feature
4. **Schedule 3 customer discovery calls** → Validate pain points
5. **Draft HITRUST roadmap** → Start compliance early

---

## From Hackathon to $60M: Enterprise Platform Requirements

To evolve from a single-feature tool to a 500 Crore INR ($60M) company, you need $2M-$4M ARR. Here's the enterprise platform play:

### 1. Operation-Level HIPAA Compliance (Enterprise Gateway)

**Current:** Demo proves technology works  
**Required:** Military-grade compliance for hospital sales

**Tamper-evident audit logs must record:**
- Exact user ID who triggered action
- Precise timestamp (ISO 8601, UTC)
- Specific action taken (view, edit, submit)
- Exact PHI accessed (patient ID, diagnosis, claim #)
- Agent run ID for full traceability

**Business Associate Agreements (BAAs) required with:**
- TinyFish API (browser automation)
- MongoDB Atlas (PHI storage)
- Google Cloud (infrastructure)
- OpenAI/Fireworks.ai (LLM processing)
- Any future AI/ML vendors

**Compliance stack:**
- Insforge: Automated HIPAA control validation
- Axiom: Immutable audit logging
- HITRUST certification (Month 8 target)

### 2. Deep EHR Integration (Workflow Necessity)

**Current:** Standalone web app  
**Required:** Invisible extension of clinic systems

**Bidirectional sync with major EHRs:**

| EHR | Market Share | Integration | Data Pulled | Data Written |
|-----|--------------|-------------|-------------|--------------|
| Epic | 35% | HL7 FHIR API | Demographics, Dx codes, clinical notes | Auth approval #, status |
| Cerner | 25% | HL7 FHIR API | Same as above | Same as above |
| athenahealth | 10% | REST API | Eligibility, claims | Authorization tracking |
| eClinicalWorks | 8% | Custom API | Billing data | Appeal submissions |

**Integration eliminates duplicate data entry** — the #1 adoption blocker for billing staff.

### 3. Claims Denial Management (Platform Play)

**Market reality:** 60% of providers plan to consolidate RCM vendors in next 3 years. Single-point solutions lose.

**Expand beyond prior auth into full denial management:**

```
Detection → Categorization → Appeal → Submission → Tracking
    ↑                                              ↓
    └────────── Analytics Dashboard ←──────────────┘
```

**Automated denial workflow:**
1. **Detection**: TinyFish scans payer portals daily for denied claims
2. **Categorization**: AI classifies root cause (medical necessity, coding error, eligibility)
3. **Appeal Generation**: Drafts letter citing policy + clinical evidence
4. **Submission**: Uploads PDF to payer portal automatically
5. **Tracking**: Monitors appeal status, escalates if needed

**ROI metrics dashboard:**
- Time-to-authorization (hours → minutes)
- First-attempt approval percentage
- Denial root cause analysis
- Revenue recovered per month
- Cost per appeal (manual vs automated)

### 4. Advanced Anti-Bot and Stealth Infrastructure

**The problem:** Payers actively block automation with CAPTCHAs, rate limits, UI changes.

**Required resiliency stack:**

| Threat | Mitigation |
|--------|------------|
| CAPTCHAs | TinyFish + manual fallback queue |
| Rate limiting | Rotating residential proxies, backoff algorithms |
| UI changes | AgentOps monitoring, daily regression tests |
| Bot detection | Realistic mouse movements, session warming |
| IP blocking | Proxy rotation, ISP diversity |

**Uptime guarantee:** 99.5% availability SLA for enterprise contracts

**Dynamic adaptation:**
- Auto-detect UI changes via visual diff
- Self-healing selectors (find similar elements)
- Human-in-the-loop for unbreakable CAPTCHAs

### 5. ROI-Driven Pricing and Metrics

**To reach $100K+ ACV, prove hard-dollar savings:**

**Phase 1: Contingency Model (Adoption)**
- Free platform access
- Charge 5-10% of revenue recovered from successful appeals
- Low friction, immediate ROI demonstration

**Phase 2: SaaS Transition (Retention)**
- Starter: $12k/year (50 claims/month)
- Growth: $24k/year (200 claims/month, 3 payers)
- Enterprise: $60k+/year (unlimited, all payers, EHR integration)

**Real-time analytics dashboard must show:**
- **Operational**: Time-to-authorization, approval rates, denial root causes
- **Financial**: Revenue recovered, cost savings, contingency fees
- **Compliance**: Audit logs, PHI access tracking, BAA status

**Net Revenue Retention (NRR) target: 120%+** — expansion revenue from existing customers upgrading tiers.

---

## Summary

**What we're building:** An AI-powered denial management system that detects, drafts appeals, and submits through payer portals — with human oversight.

**Why it wins:**
- Real ROI: Recover $50k+ per clinic annually
- Compliance-first: HITRUST certified, HIPAA compliant
- Automation + trust: AI does work, humans approve

**Path to $10M:**
- Months 1-6: Build MVP (detection → draft → submit)
- Months 6-12: HITRUST + EHR integrations
- Months 12-18: Founder sales to $1M ARR
- Months 18-36: Scale to $10M ARR

**First milestone:** Demo working Aetna denial detection to first prospect.

---

**Ready to start building?**
