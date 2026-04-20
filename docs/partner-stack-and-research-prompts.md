# Partner Stack And Research Prompts

Use this file when deciding whether to add accelerator partner tools or request deeper research.

## Best Partner Stack Opportunities

### 1. AgentMail

Best use:

- generate payer follow-up drafts
- create staff escalation emails
- send route-change alerts to clinic operations leads

Why it helps:

- creates a visible post-verdict action layer
- makes the product feel operational, not just analytical

## 2. Testsprite

Best use:

- end-to-end regression testing for the Next.js UI
- flow coverage for autoplay, custom intake, workspace loading, and SSE terminal states

Why it helps:

- strong Demo Day trust signal
- reduces risk as routing logic and UI state grow

## 3. Fireworks.ai

Best use:

- normalize noisy chart notes into a cleaner evidence summary before readiness comparison
- extract evidence snippets from longer notes and document payloads

Why it helps:

- strongest if chart inputs become less synthetic and more varied

## 4. Composio

Best use:

- only after a concrete downstream target exists, such as CRM, tasking, or ticketing

Why it helps:

- can turn operator packet output into a real task in an external system

## 5. TinyFish third-step opportunity

Best use:

- authenticated portal handoff after readiness and routing
- upload/staging workflow for a limited portal class

Why it helps:

- biggest strategic move left in the product

## Deep Research Prompts

### Prompt 1: Medicaid and Wellcare state-plan coverage

```text
Research official payer/provider routing pages for Medicaid-heavy and Wellcare state-plan workflows relevant to prior authorization.

Use only official payer or provider sources.
Return only valid JSON.
If a field is unknown, use null or [].
Do not guess.

Target payers:
- Wellcare
- Ambetter
- Superior HealthPlan
- UHC Community Plan
- Aetna Better Health
- Molina Medicaid

For each plan/state combination, return:
- payer_name
- plan_name
- member_state
- line_of_business
- official_prior_auth_url
- official_provider_portal_name
- official_provider_portal_url
- delegated_vendor_name
- delegated_vendor_trigger_notes
- phone_fallback
- notes
- sources
```

### Prompt 2: Vendor-routing rules by procedure cluster

```text
Research when prior-authorization workflows are delegated to specialty vendors such as Carelon, eviCore, Cohere, Evolent/RadMD, or TurningPoint.

Use only official payer/provider/vendor sources where possible.
Return only valid JSON.
Do not guess.

Procedure clusters:
- lumbar MRI
- cervical MRI
- knee MRI
- shoulder MRI
- epidural steroid injection
- facet injection
- radiofrequency ablation
- total knee arthroplasty
- total hip arthroplasty

For each payer or plan, return:
- payer_name
- plan_name
- procedure_cluster
- delegated_vendor_name
- line_of_business
- member_state
- routing_rule_summary
- official_route_url
- sources
```

### Prompt 3: Portal handoff targets

```text
Research official payer/provider portal flows that appear realistic for a third-step TinyFish authenticated workflow after readiness and routing are complete.

Use only official sources.
Return only valid JSON.
Do not guess.

For each candidate, return:
- payer_name
- portal_name
- portal_url
- line_of_business
- member_state
- likely_submission_step_name
- whether_public_docs_describe_the_workflow
- why_this_is_a_good_or_bad_first_authenticated_target
- sources
```
