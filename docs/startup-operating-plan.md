# AuthPilot AI Startup Operating Plan

## Company Thesis

AuthPilot AI is building the payer web intelligence layer for specialty clinics.

We are not trying to automate every part of prior authorization on day one. Our wedge is narrower and more defensible:

- turn live payer websites into structured policy and routing decisions
- tell staff whether a case is submission-ready before they waste time in a portal
- surface missing evidence and the correct next payer route

This is where TinyFish is strongest: messy, changing web workflows that do not behave like clean APIs.

## Why Now

Three market forces make this a real startup opportunity right now:

1. Prior authorization is still painful and manual.
   AMA says the average physician practice completes 39 prior authorizations per physician per week, spends nearly two business days a week on them, and 93% of physicians report care delays while waiting for approval. Source: https://www.ama-assn.org/practice-management/prior-authorization/advocacy-action-fixing-prior-authorization

2. The market is being forced toward better prior auth workflows, but the transition will be messy.
   CMS finalized its interoperability and prior authorization rule in January 2024, requiring faster decisions, denial reasons, and API support on a phased timeline. Source: https://www.cms.gov/newsroom/press-releases/cms-finalizes-rule-expand-access-health-information-and-improve-prior-authorization-process

3. Prior auth is now a visible software budget priority.
   Waystar said in February 2025 that automation for patient access, including prior authorizations, is providers' top revenue-cycle investment priority for 2025. Source: https://www.waystar.com/news/waystar-expands-authorization-automation-to-address-healthcare-providers-top-2025-investment-priority/

Our timing thesis:

- APIs are coming, but clinics still live in messy payer websites today.
- Large platforms focus on broad authorization infrastructure.
- Specialty clinics still need a faster way to interpret changing payer rules before submission work begins.

## Wedge

### Initial ICP

Independent and midsize specialty clinics in:

- spine
- orthopedics
- pain management
- imaging-heavy musculoskeletal care

### Best First Buyer

- revenue cycle manager
- prior auth supervisor
- practice administrator
- surgery scheduler lead

### Best First User

- prior auth specialist
- referral coordinator
- clinic ops staff member preparing submissions

### Why This ICP

- high prior auth volume
- repeated payer research burden
- expensive staff time
- measurable ROI from avoided rework and faster readiness decisions

## Core Product Definition

### What We Sell In The Next 90 Days

Input:

- procedure request
- payer name
- chart summary or uploaded notes

Output:

- submission-readiness verdict
- matched evidence
- missing evidence
- source payer policy
- correct prior auth or precert route
- operator handoff packet

### What We Are Not Selling Yet

- full autonomous submission into every private payer portal
- end-to-end appeals automation
- a generic healthcare chatbot
- a multi-specialty enterprise platform

## TinyFish-Native Moat

TinyFish is not a cosmetic dependency in this product. It is core infrastructure.

Our advantage is strongest where:

- payer rules are buried in public websites
- contact paths are hard to locate
- workflows change often
- navigation requires real browser behavior
- APIs are missing, stale, partial, or payer-limited

Over time, the moat is:

1. live payer web execution
2. structured policy snapshots over time
3. specialty-specific readiness logic
4. observed failure patterns and recovery playbooks

## Product Roadmap

### Phase 1: Trustworthy Readiness Engine

- live payer policy extraction
- live payer routing lookup
- chart-to-requirement matching
- operator packet generation
- truthful live proof and run history

### Phase 2: Team Workflow

- saved runs in MongoDB
- searchable case history
- payer snapshots and change history
- user feedback loop on incorrect or missing requirements
- exportable staff packet

### Phase 3: Downstream Action Layer

- submission prep checklist
- handoff into payer portal workflow
- status follow-up workflows
- payer change alerts for clinics

## Product Principles

We will act like a top-tier startup if we stay disciplined on these five rules:

1. One workflow first.
   Submission readiness and payer routing is the beachhead.

2. One customer first.
   Specialty clinics before large health systems.

3. Truth over theater.
   Every metric, badge, and success state must reflect real execution.

4. TinyFish must remain essential.
   If the workflow could be replaced by a static API, we are drifting.

5. Weekly proof beats weekly ideas.
   We track live runs, user feedback, and outbound responses every week.

## Success Metrics

### Product Metrics

- live run success rate
- median run time
- percentage of runs producing usable routing data
- percentage of cases with actionable missing-evidence output

### Customer Metrics

- minutes saved per authorization case
- percentage of cases caught before avoidable submission
- time-to-next-action for clinic staff
- weekly active staff users per design partner

### Company Metrics

- number of design partner calls
- number of active pilots
- number of paid pilots
- number of public proof posts shipped per week

## Pricing Hypothesis

### Founding Pilot

- 30-day pilot
- target price: $2,500 to $5,000
- includes onboarding, workflow tuning, weekly review, and pilot report

### Early Product Packaging

- clinic subscription plus usage
- example starting point: $999 to $2,499 per month for one specialty workflow
- enterprise pricing only after repeated weekly usage is proven

The goal of the pilot is not revenue maximization. The goal is proof of repeated operational value.

## What We Need To Prove By Demo Day

- this works on live payer websites
- TinyFish is required for the product to function
- the workflow is stable enough for repeated use
- the buyer pain is clear and urgent
- the team understands how to get design partners, not just applause

## 14-Day Sprint

### Days 1-2: Positioning Lock

- finalize the wedge: specialty clinics, not generic prior auth AI
- tighten product language across README, demo, X, and outreach
- decide one canonical workflow for all storytelling

### Days 3-5: Product Maturity

- persist runs and artifacts
- add observability for latency, failures, and payer-specific issues
- make the handoff packet exportable and easy to trust

### Days 6-8: Customer Discovery

- contact 30 target clinics or RCM operators
- run 10 discovery calls
- collect exact language used to describe the pain

### Days 9-11: Design Partner Motion

- convert 2 clinics into active pilots
- tune workflow based on real staff feedback
- collect one measurable ROI data point per pilot

### Days 12-14: Demo Day Proof

- package one strong case study
- publish strongest public proof thread and demo clip
- rehearse a 3-minute Demo Day narrative anchored in real runs and real customer pain

## What We Will Not Do

- expand into every specialty
- add partner tools just because credits exist
- build a generic AI chat layer
- fake enterprise readiness
- optimize for visual polish over operational trust

## Immediate Next Actions

1. Create a design partner list of 30 target clinics.
2. Pick one pilot price and one pilot offer.
3. Add persistent run history and observability.
4. Rewrite public-facing copy around the wedge.
5. Start customer outreach this week.
