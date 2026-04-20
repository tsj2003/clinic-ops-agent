import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PollingOrchestrator,
  getPollingOrchestrator,
  requiresAuth,
  resetPollingOrchestratorForTest,
  runZeroTouchEmrPolling,
} from '../lib/automation/emr-polling-service.js';

test('requiresAuth only flags high-impact researched CPT codes', () => {
  assert.equal(requiresAuth('27447'), true);
  assert.equal(requiresAuth('27130'), true);
  assert.equal(requiresAuth('72148'), true);
  assert.equal(requiresAuth('29881'), true);

  assert.equal(requiresAuth('99213'), false);
  assert.equal(requiresAuth(''), false);
  assert.equal(requiresAuth({ primaryCptCode: '29881' }), true);
  assert.equal(requiresAuth({ cptCodes: ['99213', '72148'] }), true);
});

test('runZeroTouchEmrPolling deduplicates encounters and emits zero-touch observability events', async () => {
  const emitted = [];
  const savedRuns = [];
  const yottaEvents = [];

  const result = await runZeroTouchEmrPolling({
    includeEpic: false,
    startDate: '2026-04-20',
    pollAthena: async () => ({
      ok: true,
      skipped: false,
      appointments: [
        {
          sourceSystem: 'athenahealth',
          appointmentId: 'appt-dup',
          patientId: 'pat-1',
          patientFirstName: 'Jane',
          patientLastName: 'Doe',
          payerName: 'United Healthcare',
          providerName: 'Dr. A',
          providerId: 'prov-1',
          departmentId: 'dept-1',
          appointmentDate: '2026-04-20',
          cptCodes: ['72148'],
          primaryCptCode: '72148',
          chartSummary: 'Known lumbar radiculopathy with failed conservative treatment.',
          clinicalRecordImageBase64: 'abc123',
          raw: {},
        },
        {
          sourceSystem: 'athenahealth',
          appointmentId: 'appt-new',
          patientId: 'pat-2',
          patientFirstName: 'John',
          patientLastName: 'Smith',
          payerName: 'United Healthcare',
          providerName: 'Dr. B',
          providerId: 'prov-2',
          departmentId: 'dept-1',
          appointmentDate: '2026-04-20',
          cptCodes: ['27447'],
          primaryCptCode: '27447',
          chartSummary: 'Advanced OA and failed conservative treatment.',
          clinicalRecordImageBase64: 'def456',
          raw: {},
        },
      ],
    }),
    pollEpic: async () => ({ ok: true, skipped: false, appointments: [] }),
    listRuns: async () => ({
      runs: [
        {
          operatorPacket: {
            source_system: 'athenahealth',
            source_appointment_id: 'appt-dup',
          },
        },
      ],
    }),
    fireworkExtractor: async () => ({
      extraction: {
        procedureCodes: ['27447'],
        diagnosisCodes: ['M17.11'],
        clinicalJustificationText:
          'Patient with severe osteoarthritis has failed conservative therapy and meets surgical criteria.',
      },
    }),
    ragEvaluator: async () => ({
      status: 'SUBMITTED_PENDING_PROOF',
      hasGap: false,
      reason: 'Policy criteria satisfied with available clinical packet evidence.',
      retrieval: {
        topOne: {
          id: 'policy-27447',
          title: 'Total Knee Arthroplasty Medical Necessity',
        },
      },
    }),
    saveRunFn: async (run) => {
      savedRuns.push(run);
      return { ok: true, run };
    },
    emitEventFn: async (event) => {
      emitted.push(event);
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

  assert.equal(result.ok, true);
  assert.equal(result.highSignalMatches, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.createdRuns, 1);
  assert.equal(savedRuns.length, 1);
  assert.equal(savedRuns[0].operatorPacket.emr_sync.status, 'SUBMITTED_PENDING_PROOF');

  assert.equal(emitted.length, 2);
  assert.equal(emitted.every((item) => item.signal === 'zero_touch_ingestion_event'), true);
  assert.equal(emitted.every((item) => item.physician_time_recovered_minutes === 8), true);

  assert.equal(yottaEvents.length, 2);
  assert.equal(yottaEvents.every((item) => item.event === 'authpilot.recovered_physician_time'), true);
  assert.equal(yottaEvents.every((item) => item.properties.minutesRecovered === 8), true);
});

test('PollingOrchestrator runs tenant cycle and singleton getter returns shared instance', async () => {
  const invocations = [];
  const orchestrator = new PollingOrchestrator({
    runFn: async (payload) => {
      invocations.push(payload);
      return {
        ok: true,
        scanned: 2,
        createdRuns: 1,
      };
    },
    defaultIntervalMs: 1000,
  });

  orchestrator.registerTenant({
    tenantId: 'tenant-alpha',
    includeAthena: true,
    includeEpic: false,
    startDate: '2026-04-20',
  });

  const result = await orchestrator.runTenantCycle('tenant-alpha');
  assert.equal(result.ok, true);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].tenantId, 'tenant-alpha');

  const singletonA = getPollingOrchestrator();
  const singletonB = getPollingOrchestrator();
  assert.equal(singletonA === singletonB, true);
  resetPollingOrchestratorForTest();
});
