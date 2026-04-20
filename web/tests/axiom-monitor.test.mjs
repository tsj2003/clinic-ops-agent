import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorrelationId, buildVitalsFromLifecycleEvents } from '../lib/observability/axiom-monitor.js';

test('buildCorrelationId prefers caller-provided value', () => {
  const correlationId = buildCorrelationId({
    correlationId: 'corr-provided',
    requestId: 'req-1',
    runId: 'run-1',
  });

  assert.equal(correlationId, 'corr-provided');
});

test('buildVitalsFromLifecycleEvents calculates tat and savings metrics', () => {
  const events = [
    {
      runId: 'run-vitals-1',
      lifecycle: 'ingest_started',
      recordedAt: '2026-04-16T00:00:00.000Z',
      metadata: {
        manual_minutes_saved: 16,
      },
      cost_simulated: 2.5,
    },
    {
      runId: 'run-vitals-1',
      lifecycle: 'submission_completed',
      recordedAt: '2026-04-16T12:00:00.000Z',
      metadata: {
        manual_minutes_saved: 8,
      },
      cost_simulated: 1.5,
    },
  ];

  const vitals = buildVitalsFromLifecycleEvents(events);

  assert.equal(vitals.averageTatHours, 12);
  assert.equal(vitals.totalEightMinuteBlocksSaved, 3);
  assert.equal(vitals.fireworksSavingsUsd, 4);
  assert.equal(vitals.trackedRuns, 1);
});
