import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runAllscaleBatchExtractionAndSimulation,
  runDenialSimulationGate,
  simulateDenialProbability,
} from '../lib/automation/denial-simulator.js';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('simulateDenialProbability enforces exact Mixedbread policy_id citation', async () => {
  const previousApiKey = process.env.FIREWORKS_API_KEY;
  process.env.FIREWORKS_API_KEY = 'fw-key';

  try {
    const result = await simulateDenialProbability({
      run: {
        appRunId: 'run-sim-1',
        intake: {
          procedureCode: '72148',
          payerName: 'United Healthcare',
          chartSummary: 'Persistent radicular symptoms despite conservative care.',
        },
      },
      policy: {
        id: 'policy-uhc-72148-vault',
        title: 'UHC Lumbar MRI Prior Auth',
        sourceUrl: 'https://example.com/policy',
        text: 'Requires failed conservative treatment and objective deficits.',
      },
      workflowConfig: {
        fireworksApiKey: 'fw-key',
      },
      fireworkFetch: async () =>
        mockJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  policy_id: 'hallucinated-policy-id',
                  denialProbabilityScore: 67,
                  denialReason: 'No objective deficits documented.',
                  missingDocumentation: ['Objective neurological exam findings'],
                }),
              },
            },
          ],
        }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.policyId, 'policy-uhc-72148-vault');
    assert.equal(result.denialProbabilityScore, 67);
  } finally {
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});

test('runDenialSimulationGate sets RE_PLANNING_REQUIRED and reroutes to auditor when risk > 40%', async () => {
  const lifecycleUpdates = [];
  const reroutes = [];
  const yottaEvents = [];

  const result = await runDenialSimulationGate({
    run: {
      appRunId: 'run-sim-2',
      workspace: { id: 'practice-1' },
      intake: {
        procedureCode: '27447',
        payerName: 'United Healthcare',
        diagnosis: 'Knee OA',
        chartSummary: 'Pain and mobility limitation.',
      },
      operatorPacket: {
        procedure_code: '27447',
        payer_name: 'United Healthcare',
        source_system: 'athenahealth',
        case_id: 'case-2',
      },
    },
    workflowConfig: {
      denialRiskThreshold: 40,
      fireworksApiKey: 'fw-key',
    },
    retrievePolicyFn: async () => ({
      topOne: {
        id: 'policy-27447-uhc',
        title: 'UHC TKA criteria',
        sourceUrl: 'https://example.com/uhc-tka',
        text: 'Requires conservative treatment failure and imaging evidence.',
      },
      totalCandidates: 1,
    }),
    rerouteAuditFn: async ({ run }) => {
      reroutes.push(run);
      return { ok: true, run };
    },
    updateLifecycleFn: async (_runId, updates) => {
      lifecycleUpdates.push(updates);
      return { ok: true };
    },
    traceWriter: async () => ({ ok: true, tracePath: '/tmp/trace.json' }),
    yottaClient: {
      track: async (payload) => {
        yottaEvents.push(payload);
        return { ok: true };
      },
    },
    fireworkFetch: async () =>
      mockJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                policy_id: 'policy-27447-uhc',
                denialProbabilityScore: 78,
                denialReason: 'Conservative-treatment duration not documented.',
                missingDocumentation: ['PT duration and modality details'],
              }),
            },
          },
        ],
      }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.requiresReplanning, true);
  assert.equal(result.denialProbabilityScore, 78);
  assert.equal(result.preventedDenialCostUsd, 100);
  assert.equal(lifecycleUpdates.length, 1);
  assert.equal(lifecycleUpdates[0].emrSync.status, 'RE_PLANNING_REQUIRED');
  assert.equal(reroutes.length, 1);
  assert.equal(yottaEvents.length, 1);
  assert.equal(yottaEvents[0].event, 'authpilot.prevented_denial_cost');
});

test('runAllscaleBatchExtractionAndSimulation supports 500 concurrency with >=5s extraction latency floor', async () => {
  let fakeNow = 0;

  const outcome = await runAllscaleBatchExtractionAndSimulation({
    practiceId: 'practice-scale-1',
    concurrency: 500,
    jobs: [
      {
        run: {
          appRunId: 'scale-run-1',
          workspace: { id: 'practice-scale-1' },
          intake: {
            procedureCode: '72148',
            payerName: 'United Healthcare',
            chartSummary: 'Lumbar pain.',
          },
        },
      },
    ],
    now: () => fakeNow,
    sleepFn: async (ms) => {
      fakeNow += Number(ms);
    },
    extractionFn: async () => {
      fakeNow += 1200;
      return {
        extraction: {
          clinicalJustificationText: 'Objective deficits and conservative care failure.',
        },
      };
    },
    simulationFn: async () => ({
      ok: true,
      requiresReplanning: false,
      denialProbabilityScore: 22,
    }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.effectiveConcurrency, 500);
  assert.equal(outcome.totalJobs, 1);
  assert.equal(outcome.minExtractionLatencyMs, 5000);
  assert.equal(outcome.results[0].extractionLatencyMs, 5000);
});
