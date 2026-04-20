import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCaseBundle, buildOperatorPacketCsv, parseCaseBundle } from '../lib/case-bundle.js';

test('buildCaseBundle captures workspace, intake, config, and intelligence summary', () => {
  const bundle = buildCaseBundle({
    workspaceId: 'ws-1',
    workspaceName: 'Peak Spine Center',
    intake: {
      payerName: 'Aetna',
      procedureLabel: 'Lumbar MRI',
      diagnosis: 'Low back pain',
    },
    config: {
      workflowName: 'Aetna lumbar MRI readiness check',
      workflowUrl: 'https://www.aetna.com/policy',
    },
    suggestion: {
      suggestionSummary: 'Aetna spine imaging route',
      confidence: 'high',
      suggestedPolicyUrl: 'https://www.aetna.com/policy',
      suggestedContactUrl: 'https://www.aetna.com/contact',
      suggestedPortalName: 'Availity Essentials',
      suggestedPortalUrl: 'https://www.availity.com',
    },
    executionPlan: {
      authenticatedPortalTarget: {
        key: 'aetna-availity',
        portalName: 'Availity Essentials',
        portalUrl: 'https://essentials.availity.com/',
        likelySubmissionStepName: 'Authorization Add - Step 4',
      },
      vendorPortalTarget: {
        key: 'carelon',
        vendorName: 'Carelon Medical Benefits Management',
        portalUrl: 'https://providers.carelonmedicalbenefitsmanagement.com',
      },
      downstreamTargets: [
        {
          key: 'epic',
          systemName: 'Epic',
          likelyPayloadFormat: 'FHIR R4 JSON',
          importMethod: 'FHIR REST API using $submit-attachment',
          url: 'https://fhir.epic.com/',
        },
      ],
    },
  });

  assert.equal(bundle.workspace.id, 'ws-1');
  assert.equal(bundle.workspace.name, 'Peak Spine Center');
  assert.equal(bundle.intake.payerName, 'Aetna');
  assert.equal(bundle.config.workflowName, 'Aetna lumbar MRI readiness check');
  assert.equal(bundle.intelligence.suggestedPortalName, 'Availity Essentials');
  assert.equal(bundle.executionPlan.authenticatedPortalTarget.portalName, 'Availity Essentials');
});

test('parseCaseBundle restores valid bundle payloads', () => {
  const raw = JSON.stringify(
    buildCaseBundle({
      workspaceId: 'ws-2',
      workspaceName: 'North Ortho',
      intake: { payerName: 'Cigna', procedureLabel: 'Knee MRI' },
      config: { workflowName: 'Cigna knee MRI readiness check' },
    }),
  );

  const parsed = parseCaseBundle(raw);
  assert.equal(parsed.workspaceId, 'ws-2');
  assert.equal(parsed.workspaceName, 'North Ortho');
  assert.equal(parsed.intake.payerName, 'Cigna');
  assert.equal(parsed.config.workflowName, 'Cigna knee MRI readiness check');
});

test('parseCaseBundle rejects invalid bundle payloads', () => {
  assert.throws(() => parseCaseBundle('not-json'), /valid JSON/i);
  assert.throws(() => parseCaseBundle(JSON.stringify({ foo: 'bar' })), /missing intake or workflow configuration/i);
});

test('buildOperatorPacketCsv emits a useful flat export', () => {
  const csv = buildOperatorPacketCsv({
    case_id: 'CASE-1',
    payer_name: 'Aetna',
    line_of_business: 'Commercial',
    member_state: 'TX',
    diagnosis: 'Low back pain',
    procedure: 'Lumbar MRI',
    submission_ready: true,
    recommended_action: 'submit_to_portal',
    supporting_evidence: ['Documented conservative therapy'],
    missing_evidence: [],
    available_evidence_files: ['chart.pdf'],
    submission_checklist: ['Confirm eligibility'],
    portal_handoff: {
      next_step_title: 'Portal-ready submission package',
      preferred_channel: 'Portal',
      portal_entry_url: 'https://example.com/portal',
      phone_fallback: '800-000-0000',
      delegated_vendor_hint: 'Carelon',
      route_rationale: 'Vendor-first route',
    },
    authenticated_portal_target: {
      portalName: 'Availity Essentials',
      portalUrl: 'https://essentials.availity.com/',
      likelySubmissionStepName: 'Authorization Add - Step 4',
      credentialsNeeded: 'Availity login',
      attachmentsSupported: true,
    },
    vendor_portal_target: {
      vendorName: 'Carelon',
      portalUrl: 'https://providers.carelonmedicalbenefitsmanagement.com',
      uploadStepPresent: true,
      commonRequiredFields: ['Member ID', 'CPT code'],
    },
    downstream_targets: [
      {
        systemName: 'Epic',
        likelyPayloadFormat: 'FHIR R4 JSON',
        importMethod: 'FHIR REST API using $submit-attachment',
        url: 'https://fhir.epic.com/',
      },
    ],
    phi_safe_defaults: [
      {
        topic: 'Log redaction',
        recommendedDefault: 'Metadata-only logging',
        implementationImplication: 'Do not log raw chart text',
      },
    ],
    submission_prep: {
      status: 'ready_for_submission_prep',
      readiness_gate: 'ready',
      owner: 'clinic authorization staff',
      route_review_required: false,
      review_summary: {
        next_review_trigger: 'Proceed to portal entry after eligibility and route confirmation.',
      },
      blockers: [],
      tasks: {
        portal_entry: ['Open the provider route'],
      },
    },
  });

  assert.match(csv, /"case","case_id","CASE-1"/);
  assert.match(csv, /"routing","provider_precert_phone",""/);
  assert.match(csv, /"submission_tasks\.portal_entry","1","Open the provider route"/);
  assert.match(csv, /"authenticated_portal_target","portal_name","Availity Essentials"/);
  assert.match(csv, /"downstream_targets","1\.system_name","Epic"/);
  assert.match(csv, /"phi_safe_defaults","1\.topic","Log redaction"/);
});
