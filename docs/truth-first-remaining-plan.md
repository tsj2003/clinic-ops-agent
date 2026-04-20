# Truth-First Remaining Plan

Updated: 2026-04-17

This file separates what can be completed in code from what requires real external operations.

## Buildable Now

- [x] Add dedicated Policy Sentinel dashboard APIs.
- [x] Add dedicated manual Peer-to-Peer brief API.
- [x] Add explicit Exception Command Center button for manual P2P brief generation.
- [x] Tighten TestSprite deployment-gate enforcement in CI so missing secrets fail clearly on enforced runs.
- [x] Add truth-first pilot proof visibility so signed pilots are not mistaken for validated external proof.
- [x] Add pilot-proof readiness export for ops and investor-proof packaging.
- [x] Make case-study drafts truth-first so they only become publishable when signed pilot evidence and KPI fields exist.
- [x] Document the exact remaining GitHub branch-protection steps in a repo checklist.

## Still External

- [ ] Real signed pilot execution with an actual customer signature.
- [ ] Real KPI proof from live customer workflows.
- [ ] Branch protection configuration in GitHub to make `TestSprite Reliability Gate` a required status check.
- [ ] External production rollout proof such as live user quotes, real denial deltas, and real turnaround deltas.

## Step-By-Step Execution

### 1. Policy Sentinel APIs

Real implementation scope:
- `POST /api/automation/policy-sentinel/run`
- `GET /api/automation/policy-sentinel/changes`
- dashboard panel to trigger a run and browse recent changes

Definition of done:
- operator can trigger the sentinel from the UI
- operator can browse recent policy deltas without reading pilot-vault files directly
- build and tests pass

### 2. Manual Peer-to-Peer Brief

Real implementation scope:
- `POST /api/automation/peer-to-peer-brief`
- explicit `Generate P2P Brief` button in Exception Command Center
- denial-only guard so the route refuses non-denial cases

Definition of done:
- operator can generate a brief for a denied case from the UI
- run lifecycle is updated with a real audit trail
- generated PDF path is returned and persisted through existing combat-brief storage

### 3. TestSprite Deployment Gate

Real implementation scope:
- fail fast when enforced runs do not have `TESTSPRITE_API_KEY`
- keep branch-protection setup documented as a manual ops step because GitHub required checks cannot be enforced from repo code alone

Definition of done:
- main-branch enforced reliability workflow fails clearly if the secret is missing
- docs state the exact remaining manual GitHub branch-protection action

### 4. Truthful Pilot Proof Tracking

Real implementation scope:
- show signed-pilot proof gaps in the dashboard
- do not count a pilot as externally proven until signed evidence and baseline/current KPI fields exist

Definition of done:
- operators can see proof gaps immediately
- no UI language implies real proof exists when the fields are still empty

## Manual Ops Checklist

These cannot be fabricated in code and must be completed outside the repo:

1. Add at least one real `signed_active` pilot with `signedEvidenceUrl`.
2. Populate baseline KPI fields:
   - `baselineDenialRatePercent`
   - `baselineDaysToAuth`
3. Populate current KPI fields after live execution:
   - `currentDenialRatePercent`
   - `currentDaysToAuth`
4. In GitHub branch protection, require the `TestSprite Reliability Gate` check for deployment branches.
5. Export and archive:
   - operating review markdown
   - case-study markdown
   - commitment snapshot markdown
   - pilot proof readiness markdown

## What We Will Not Fake

- customer signatures
- production KPI deltas
- branch protection settings applied in GitHub UI
- live portal credentials or payer access that do not exist yet
