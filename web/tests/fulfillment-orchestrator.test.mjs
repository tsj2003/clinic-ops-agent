import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePatientReadinessWithFireworks,
  dispatchPatientNudge,
  runAutonomousProcedureFulfillment,
} from '../lib/automation/fulfillment-orchestrator.js';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('dispatchPatientNudge sends Emitrr SMS with SafeLink and PHI-safe body', async () => {
  const messages = [];

  const result = await dispatchPatientNudge({
    run: {
      appRunId: 'run-fulfill-1',
      intake: {
        patientPhone: '+14155551212',
        firstName: 'Jamie',
      },
      operatorPacket: {
        procedure: 'Total Knee Arthroplasty',
      },
    },
    tenantId: 'practice-1',
    workflowConfig: {
      emitrrApiKey: 'emitrr-key',
      emitrrBaseUrl: 'https://emitrr.example',
      safeLink: 'https://app.authpilot.ai/fulfillment/safe-view?token=abc',
      patientNudgeTemplate:
        'Great news, {FirstName}! Your procedure for {ProcedureLabel} is insurance-approved. View prep instructions here: {SafeLink}',
    },
    fetchImpl: async (_url, init = {}) => {
      messages.push(JSON.parse(init.body));
      return mockJsonResponse({ id: 'msg_1', status: 'queued' });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /(Good|Great) news/i);
  assert.match(messages[0].body, /safe-view\?token=abc/i);
  assert.equal(/SSN|DOB|MRN|Member ID/i.test(messages[0].body), false);
});

test('analyzePatientReadinessWithFireworks marks manual barrier from patient reply', async () => {
  const previousApiKey = process.env.FIREWORKS_API_KEY;
  process.env.FIREWORKS_API_KEY = 'fw-key';

  try {
    const analysis = await analyzePatientReadinessWithFireworks({
      replyText: "I haven't stopped my blood thinners yet and I'm not ready.",
      run: { appRunId: 'run-fulfill-2', operatorPacket: { procedure: 'Total Hip Arthroplasty' } },
      fetchImpl: async () =>
        mockJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  readiness: 'barrier',
                  barrierDetected: true,
                  reason: 'Patient has anticoagulation prep barrier.',
                  confidence: 0.96,
                }),
              },
            },
          ],
        }),
    });

    assert.equal(analysis.ok, true);
    assert.equal(analysis.barrierDetected, true);
    assert.equal(analysis.readiness, 'barrier');
  } finally {
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});

test('runAutonomousProcedureFulfillment locks schedule and emits revenue lock event', async () => {
  const events = [];

  const outcome = await runAutonomousProcedureFulfillment({
    run: {
      appRunId: 'run-fulfill-3',
      workspace: { id: 'practice-22' },
      intake: {
        patientPhone: '+14155550000',
        firstName: 'Alex',
        procedureCode: '27447',
        appointmentId: 'apt-22',
      },
      operatorPacket: {
        source_system: 'athenahealth',
        source_appointment_id: 'apt-22',
        procedure_code: '27447',
        emr_sync: {
          connector: 'athenahealth',
          payer_reference_id: 'PAYER-REF-22',
        },
      },
    },
    tenantId: 'practice-22',
    workflowConfig: {
      emitrrApiKey: 'emitrr-key',
      emitrrBaseUrl: 'https://emitrr.example',
      safeLink: 'https://app.authpilot.ai/fulfillment/safe-view?token=xyz',
      fireworksApiKey: 'fw-key',
      athenaBaseUrl: 'https://athena.example',
      athenaPracticeId: '195900',
      athenaAccessToken: 'athena-token',
    },
    patientReply: 'Got it, I am ready and followed all prep instructions.',
    emitrrFetch: async () => mockJsonResponse({ id: 'msg_22', status: 'queued' }),
    fireworksFetch: async () =>
      mockJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                readiness: 'ready',
                barrierDetected: false,
                reason: 'Patient confirms prep completion.',
                confidence: 0.93,
              }),
            },
          },
        ],
      }),
    emrFetch: async (url, init = {}) => {
      assert.match(String(url), /appointments\/booked\/apt-22/i);
      assert.equal(init.method, 'PUT');
      return mockJsonResponse({ status: 'CONFIRMED' });
    },
    yottaClient: {
      track: async (payload) => {
        events.push(payload);
        return { ok: true };
      },
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.halted, false);
  assert.equal(outcome.scheduleLock?.ok, true);
  assert.equal(outcome.procedureValueUsd, 42000);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'authpilot.procedure_revenue_locked');
});

test('runAutonomousProcedureFulfillment emits Dify state transitions for governance', async () => {
  const difyTransitions = [];

  const outcome = await runAutonomousProcedureFulfillment({
    run: {
      appRunId: 'run-fulfill-4',
      workspace: { id: 'practice-44' },
      intake: {
        patientPhone: '+14155559999',
        firstName: 'Taylor',
        procedureCode: '27130',
        appointmentId: 'apt-44',
      },
      operatorPacket: {
        source_system: 'athenahealth',
        source_appointment_id: 'apt-44',
        procedure_code: '27130',
        emr_sync: {
          connector: 'athenahealth',
          payer_reference_id: 'PAYER-REF-44',
        },
      },
    },
    tenantId: 'practice-44',
    workflowConfig: {
      difyApiKey: 'dify-key',
      difyBaseUrl: 'https://dify.example',
      emitrrApiKey: 'emitrr-key',
      emitrrBaseUrl: 'https://emitrr.example',
      safeLink: 'https://app.authpilot.ai/fulfillment/safe-view?token=qwe',
      fireworksApiKey: 'fw-key',
      athenaBaseUrl: 'https://athena.example',
      athenaPracticeId: '195900',
      athenaAccessToken: 'athena-token',
    },
    patientReply: 'Ready for procedure and completed prep.',
    emitrrFetch: async () => mockJsonResponse({ id: 'msg_44', status: 'queued' }),
    fireworksFetch: async () =>
      mockJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                readiness: 'ready',
                barrierDetected: false,
                reason: 'Prep complete.',
                confidence: 0.91,
              }),
            },
          },
        ],
      }),
    emrFetch: async () => mockJsonResponse({ status: 'CONFIRMED' }),
    difyFetch: async (url, init = {}) => {
      if (String(url).includes('/state-transition')) {
        difyTransitions.push(JSON.parse(init.body));
      }
      return mockJsonResponse({ ok: true });
    },
    yottaClient: {
      track: async () => ({ ok: true }),
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.halted, false);
  assert.equal(difyTransitions.length, 4);
  assert.deepEqual(
    difyTransitions.map((item) => item.state),
    ['approved', 'patient_nudge', 'prep_verification', 'schedule_lock'],
  );
});
