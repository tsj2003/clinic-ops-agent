import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCaseLifecycleUpdate, normalizeCaseLifecycle } from '../lib/run-store.js';

test('normalizeCaseLifecycle infers ready_for_submission for ready runs', () => {
  const lifecycle = normalizeCaseLifecycle({
    status: 'completed',
    readiness: {
      ready: true,
      missing_evidence: [],
    },
  });

  assert.equal(lifecycle.status, 'ready_for_submission');
  assert.equal(lifecycle.history.length, 1);
});

test('normalizeCaseLifecycle infers collecting_evidence when evidence is missing', () => {
  const lifecycle = normalizeCaseLifecycle({
    status: 'completed',
    readiness: {
      ready: false,
      missing_evidence: ['Conservative care documentation'],
    },
  });

  assert.equal(lifecycle.status, 'collecting_evidence');
});

test('applyCaseLifecycleUpdate appends a new lifecycle event and notes', () => {
  const run = {
    appRunId: 'run-1',
    caseLifecycle: {
      status: 'new',
      notes: '',
      updatedAt: '2026-04-13T00:00:00.000Z',
      history: [
        {
          status: 'new',
          note: 'Case created.',
          actor: 'system',
          source: 'system',
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      ],
    },
  };

  const updated = applyCaseLifecycleUpdate(run, {
    status: 'submitted',
    notes: 'Submitted via provider portal.',
    eventNote: 'Submitted to provider portal.',
    actor: 'staff',
    source: 'ui',
  });

  assert.equal(updated.caseLifecycle.status, 'submitted');
  assert.equal(updated.caseLifecycle.notes, 'Submitted via provider portal.');
  assert.equal(updated.caseLifecycle.history.at(-1).status, 'submitted');
  assert.equal(updated.caseLifecycle.history.at(-1).actor, 'staff');
});
