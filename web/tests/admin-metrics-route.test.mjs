import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCaseLifecycleUpdate, normalizeCaseLifecycle } from '../lib/run-store.js';

test('normalizeCaseLifecycle infers collecting_evidence for missing evidence runs', () => {
  const normalized = normalizeCaseLifecycle({
    status: 'completed',
    readiness: {
      ready: false,
      missing_evidence: ['Conservative therapy notes'],
    },
  });

  assert.equal(normalized.status, 'collecting_evidence');
  assert.ok(Array.isArray(normalized.history));
  assert.ok(normalized.history.length > 0);
});

test('applyCaseLifecycleUpdate appends history on meaningful status change', () => {
  const baseRun = {
    caseLifecycle: {
      status: 'new',
      notes: 'Initial intake complete',
      history: [
        {
          status: 'new',
          note: 'Case created',
          actor: 'system',
          source: 'system',
          createdAt: '2026-04-10T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    },
  };

  const updated = applyCaseLifecycleUpdate(baseRun, {
    status: 'ready_for_submission',
    notes: 'Authorization packet ready',
    eventNote: 'Case moved to ready_for_submission',
    actor: 'ops',
    source: 'ui',
  });

  assert.equal(updated.caseLifecycle.status, 'ready_for_submission');
  assert.equal(updated.caseLifecycle.notes, 'Authorization packet ready');
  assert.equal(updated.caseLifecycle.history.length, 2);
  assert.equal(updated.caseLifecycle.history[1].actor, 'ops');
  assert.equal(updated.caseLifecycle.history[1].source, 'ui');
});

test('applyCaseLifecycleUpdate does not duplicate identical terminal events', () => {
  const baseRun = {
    caseLifecycle: {
      status: 'submitted',
      notes: 'Submitted in portal',
      history: [
        {
          status: 'submitted',
          note: 'Submitted in portal',
          actor: 'staff',
          source: 'ui',
          createdAt: '2026-04-10T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    },
  };

  const updated = applyCaseLifecycleUpdate(baseRun, {
    status: 'submitted',
    notes: 'Submitted in portal',
    eventNote: 'Submitted in portal',
    actor: 'staff',
    source: 'ui',
  });

  assert.equal(updated.caseLifecycle.history.length, 1);
});
