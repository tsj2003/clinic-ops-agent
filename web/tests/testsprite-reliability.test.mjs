import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateReliabilityGate,
  runReliabilityGate,
  startRegressionRun,
  waitForRegressionCompletion,
} from '../lib/automation/testsprite-reliability.js';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('startRegressionRun creates run payload and returns normalized metadata', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.TESTSPRITE_API_KEY;

  process.env.TESTSPRITE_API_KEY = 'ts_key_123';
  global.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    assert.equal(body.suite, 'nightly-smoke');
    return mockJsonResponse({
      id: 'run_101',
      status: 'queued',
      url: 'https://testsprite.example/run_101',
    });
  };

  try {
    const started = await startRegressionRun({ suite: 'nightly-smoke' });
    assert.equal(started.runId, 'run_101');
    assert.equal(started.status, 'queued');
    assert.match(started.dashboardUrl, /testsprite\.example/);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.TESTSPRITE_API_KEY = previousApiKey;
    } else {
      delete process.env.TESTSPRITE_API_KEY;
    }
  }
});

test('waitForRegressionCompletion polls until terminal status', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.TESTSPRITE_API_KEY;
  let callCount = 0;

  process.env.TESTSPRITE_API_KEY = 'ts_key_123';
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse({
        status: 'running',
        metrics: { passed: 2, failed: 0, total: 2 },
      });
    }

    return mockJsonResponse({
      status: 'passed',
      metrics: { passed: 20, failed: 1, total: 21 },
      dashboardUrl: 'https://testsprite.example/run_102',
    });
  };

  try {
    const finished = await waitForRegressionCompletion({ runId: 'run_102', pollIntervalMs: 1, timeoutMs: 500 });
    assert.equal(finished.status, 'passed');
    assert.equal(finished.metrics.total, 21);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.TESTSPRITE_API_KEY = previousApiKey;
    } else {
      delete process.env.TESTSPRITE_API_KEY;
    }
  }
});

test('evaluateReliabilityGate enforces pass-rate threshold', () => {
  const pass = evaluateReliabilityGate({
    status: 'passed',
    metrics: { passed: 96, failed: 4, total: 100 },
    minPassRate: 0.95,
  });
  assert.equal(pass.gatePassed, true);

  const fail = evaluateReliabilityGate({
    status: 'passed',
    metrics: { passed: 92, failed: 8, total: 100 },
    minPassRate: 0.95,
  });
  assert.equal(fail.gatePassed, false);
  assert.match(fail.reason, /below threshold/i);
});

test('runReliabilityGate skips when key missing unless required', async () => {
  const previousApiKey = process.env.TESTSPRITE_API_KEY;
  delete process.env.TESTSPRITE_API_KEY;

  try {
    const optionalOutcome = await runReliabilityGate({ required: false });
    assert.equal(optionalOutcome.skipped, true);
    assert.equal(optionalOutcome.gatePassed, true);

    const requiredOutcome = await runReliabilityGate({ required: true });
    assert.equal(requiredOutcome.skipped, true);
    assert.equal(requiredOutcome.gatePassed, false);
  } finally {
    if (typeof previousApiKey === 'string') {
      process.env.TESTSPRITE_API_KEY = previousApiKey;
    }
  }
});
