import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWebhookReadyExport,
  enrichOperatorPacketWithExecutionPlan,
  getPortalExecutionPlan,
} from '../lib/portal-targets.js';

test('maps Aetna cases to the Availity authenticated portal target', () => {
  const plan = getPortalExecutionPlan({
    payerName: 'Aetna',
    lineOfBusiness: 'Commercial',
    memberState: 'FL',
    procedureLabel: 'Total knee arthroplasty',
    specialty: 'Ortho',
  });

  assert.equal(plan.authenticatedPortalTarget?.key, 'aetna-availity');
  assert.equal(plan.authenticatedPortalTarget?.portalName, 'Availity Essentials');
  assert.equal(plan.authenticatedPortalTarget?.lineOfBusinessLabel, 'Commercial');
});

test('maps delegated vendor workflows to vendor portal targets', () => {
  const plan = getPortalExecutionPlan({
    payerName: 'Humana',
    lineOfBusiness: 'Medicare Advantage',
    memberState: 'OH',
    procedureLabel: 'Shoulder MRI',
    specialty: 'Diagnostic Imaging',
    vendorName: 'Cohere Health',
  });

  assert.equal(plan.vendorPortalTarget?.key, 'cohere');
  assert.match(plan.vendorPortalTarget?.portalUrl || '', /coherehealth/i);
});

test('enrichOperatorPacketWithExecutionPlan attaches portal, downstream, and PHI-safe metadata', () => {
  const packet = enrichOperatorPacketWithExecutionPlan({
    case_id: 'CASE-22',
    payer_name: 'Cigna',
    line_of_business: 'Commercial',
    member_state: 'TX',
    specialty: 'Spine',
    diagnosis: 'Cervical radiculopathy',
    procedure: 'Cervical MRI',
    portal_handoff: {
      delegated_vendor_hint: 'eviCore healthcare',
    },
  });

  assert.equal(packet.authenticated_portal_target?.key, 'cigna-for-hcp');
  assert.equal(packet.vendor_portal_target?.key, 'evicore');
  assert.ok(packet.downstream_targets?.length >= 1);
  assert.ok(packet.phi_safe_defaults?.length >= 1);
});

test('buildWebhookReadyExport omits raw chart text and includes execution-plan metadata', () => {
  const payload = buildWebhookReadyExport({
    case_id: 'CASE-33',
    payer_name: 'UnitedHealthcare Community Plan',
    line_of_business: 'Medicaid',
    member_state: 'OH',
    specialty: 'Spine',
    diagnosis: 'Lumbar pain',
    procedure: 'Lumbar MRI',
    submission_ready: false,
    recommended_action: 'collect_missing_evidence',
    supporting_evidence: ['Trial of conservative therapy'],
    missing_evidence: ['Current neurological exam'],
    submission_checklist: ['Confirm member eligibility'],
    provider_precert_phone: '800-111-2222',
    policy_url: 'https://example.com/policy',
    contact_url: 'https://example.com/contact',
    portal_handoff: {
      route_rationale: 'Community plan route',
      delegated_vendor_hint: 'eviCore healthcare',
    },
    case_lifecycle: {
      status: 'collecting_evidence',
    },
    chart_summary: 'Should not be exported',
  });

  assert.equal(payload.eventType, 'submission_prep_ready');
  assert.equal(payload.executionPlan.authenticatedPortalTarget?.portalName, 'UnitedHealthcare Provider Portal (PAAN)');
  assert.equal(payload.executionPlan.vendorPortalTarget?.vendorName, 'eviCore healthcare');
  assert.ok(payload.executionPlan.downstreamTargets?.length >= 1);
  assert.equal(Object.hasOwn(payload, 'chart_summary'), false);
  assert.match(payload.minimumNecessaryNotice, /excludes raw chart-summary free text/i);
});
