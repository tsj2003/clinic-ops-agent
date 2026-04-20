import fs from 'fs/promises';
import path from 'path';
import assert from 'node:assert/strict';

import { runZeroTouchEmrPolling } from '../web/lib/automation/emr-polling-service.js';
import { runUhcPortalSubmission } from '../web/lib/automation/portal-agent.js';
import { getRevenueSnapshot, triggerRevenueEvent } from '../web/lib/automation/billing-engine.js';

const auditResults = [];

function pass(message) {
  auditResults.push({ ok: true, message });
  console.log(`✅ ${message}`);
}

function check(condition, message) {
  assert.equal(Boolean(condition), true, message);
  pass(message);
}

async function main() {
  console.log('🔎 Hard Audit: Phase 1-10 critical pipeline checks');

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.UHC_PORTAL_CREDENTIALS = process.env.UHC_PORTAL_CREDENTIALS || JSON.stringify({
    username: 'audit-user',
    password: 'audit-pass',
  });

  const extractionCalls = [];
  const ragAuditCalls = [];
  const savedRuns = [];
  const axiomEvents = [];
  const yottaEvents = [];
  const sequence = [];

  const pollingResult = await runZeroTouchEmrPolling({
    includeEpic: false,
    startDate: '2026-04-20',
    pollAthena: async () => ({
      ok: true,
      skipped: false,
      appointments: [
        {
          sourceSystem: 'athenahealth',
          appointmentId: 'audit-appt-001',
          patientId: 'pat-audit-1',
          patientFirstName: 'Jordan',
          patientLastName: 'Miles',
          payerName: 'United Healthcare',
          providerName: 'Dr. Audit',
          providerId: 'prov-audit-1',
          departmentId: 'dept-audit',
          appointmentDate: '2026-04-20',
          cptCodes: ['72148'],
          primaryCptCode: '72148',
          chartSummary: 'Lumbar radiculopathy, failed PT x 6 weeks with neurological findings.',
          clinicalRecordImageBase64: 'ZmFrZS1pbWFnZS1kYXRh',
          raw: {},
        },
      ],
    }),
    listRuns: async () => ({ runs: [] }),
    fireworkExtractor: async (payload) => {
      extractionCalls.push(payload);
      sequence.push('extraction');
      return {
        extraction: {
          procedureCodes: ['72148'],
          diagnosisCodes: ['M54.16'],
          clinicalJustificationText: 'Persistent radicular pain with objective deficits despite conservative treatment.',
        },
      };
    },
    ragEvaluator: async ({ appointment, extraction }) => {
      ragAuditCalls.push({ appointmentId: appointment.appointmentId, extraction });
      sequence.push('rag_audit');
      return {
        status: 'SUBMITTED_PENDING_PROOF',
        hasGap: false,
        reason: 'Policy criteria met and packet evidence is complete.',
        retrieval: {
          topOne: {
            id: 'uhc-72148-policy',
            title: 'UHC Lumbar MRI Prior Auth Criteria',
          },
        },
      };
    },
    saveRunFn: async (run) => {
      savedRuns.push(run);
      sequence.push('run_saved');
      return { ok: true, run };
    },
    emitEventFn: async (event) => {
      axiomEvents.push(event);
      return { ok: true };
    },
    yottaClient: {
      track: async (payload) => {
        yottaEvents.push(payload);
        return { ok: true };
      },
    },
    jitterMs: 0,
  });

  check(pollingResult.ok === true, 'Polling completed successfully.');
  check(pollingResult.createdRuns === 1, 'Polling created one proactive run automatically.');
  check(extractionCalls.length === 1, 'Fireworks extraction agent invoked automatically during polling.');
  check(ragAuditCalls.length === 1, 'RAG auditor invoked automatically after extraction.');
  check(savedRuns.length === 1, 'Run persisted automatically without manual Sync action.');
  check(
    sequence.join('>') === 'extraction>rag_audit>run_saved',
    'Extraction -> RAG audit -> RunStore persistence executed in sequence.',
  );

  const run = savedRuns[0];
  const submissionPayloads = [];

  const readySubmission = await runUhcPortalSubmission({
    run,
    attachmentPath: '/tmp/fake-audit.pdf',
    headless: true,
    clinicalGap: {
      hasGap: false,
      summary: run.readiness?.summary,
      missingDataPoints: [],
      emrStatus: run?.operatorPacket?.emr_sync?.status,
    },
    sessionFactory: () => ({
      headless: true,
      page: null,
      async open() {
        return { id: 'fake-page' };
      },
    }),
    executeFlow: async ({ clinicalGap, flowRun }) => {
      submissionPayloads.push({ clinicalGap, runId: flowRun?.appRunId });
    },
  });

  check(readySubmission.ok === true, 'Portal submission agent accepts ready (no-gap) payload.');
  check(submissionPayloads.length === 1, 'Portal agent received payload from RAG/readiness output.');
  check(
    submissionPayloads[0].clinicalGap?.summary === run.readiness?.summary,
    'RAG summary is forwarded into portal submission payload.',
  );

  const blockedSubmission = await runUhcPortalSubmission({
    run,
    attachmentPath: '/tmp/fake-audit.pdf',
    headless: true,
    clinicalGap: {
      hasGap: true,
      emrStatus: 'CLINICAL_GAP_DETECTED',
      summary: 'Missing prior conservative treatment documentation.',
      missingDataPoints: ['6 weeks PT notes'],
    },
    sessionFactory: () => ({
      headless: true,
      page: null,
      async open() {
        throw new Error('should not open browser when gap exists');
      },
    }),
  });

  check(blockedSubmission.ok === false, 'Portal submission is rejected when clinical gap is present.');
  check(blockedSubmission.blocked === true, 'Portal agent explicitly marks clinical-gap block.');

  const voiceAgentPath = path.resolve(process.cwd(), 'web/lib/automation/voice-agent.js');
  const voiceSource = await fs.readFile(voiceAgentPath, 'utf-8');
  check(
    /externalStatus\s*===\s*'DENIED'[\s\S]*generateCombatBriefOnDenial\s*\(/.test(voiceSource),
    'Voice DENIED branch programmatically triggers combat brief generation.',
  );

  const billingRun = {
    workspace: { id: 'practice-hard-audit' },
    intake: { procedureCode: '72148', lineOfBusiness: 'Commercial' },
    operatorPacket: { emr_sync: { payer_reference_id: 'PAYER-REF-HARDCHECK-1' } },
  };

  await triggerRevenueEvent({
    run: { ...billingRun, appRunId: 'hard-check-billing-1' },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'hard-charge-1', status: 'pending' }),
      },
    },
  });

  const duplicateBilling = await triggerRevenueEvent({
    run: { ...billingRun, appRunId: 'hard-check-billing-2' },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'hard-charge-2-should-not-happen', status: 'pending' }),
      },
    },
  });

  const revenueSnapshot = await getRevenueSnapshot({ limit: 20 });
  const matchingCharges = revenueSnapshot.charges.filter((item) => item.payerReferenceId === 'PAYER-REF-HARDCHECK-1');

  check(duplicateBilling.duplicate === true, 'Billing idempotency blocks second charge on double approve.');
  check(matchingCharges.length === 1, 'Only one Parasail charge exists for payer_reference_id idempotency key.');

  check(
    axiomEvents.some((event) => event.signal === 'zero_touch_ingestion_event' && event.createdRun === true),
    'Axiom-compatible zero_touch_ingestion_event emitted for proactive run.',
  );
  check(
    yottaEvents.some((event) => event.event === 'authpilot.recovered_physician_time'),
    'Yotta ROI event emitted for proactive intake.',
  );

  const passed = auditResults.length;
  const failed = 0;

  console.log(`\n🎯 HARD AUDIT RESULT: ${passed}/${passed + failed} assertions passed (100%).`);
}

main().catch((error) => {
  console.error('\n❌ HARD AUDIT FAILED');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
