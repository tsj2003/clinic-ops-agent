import test from 'node:test';
import assert from 'node:assert/strict';

import { saveRun } from '../lib/run-store.js';

function buildRun({ appRunId, workflowUrl, contactUrl, policyName, evidenceRequirements }) {
  return {
    appRunId,
    status: 'completed',
    mode: 'live',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    workflow: {
      name: 'Snapshot diff test workflow',
      url: workflowUrl,
      goal: 'test',
      contactName: 'Contact workflow',
      contactUrl,
      contactGoal: 'test',
      caseId: 'CASE-1',
      procedure: 'Lumbar MRI',
    },
    artifact: {
      policyResult: {
        policy_name: policyName,
        evidence_requirements: evidenceRequirements,
        page_url: workflowUrl,
        mentions_conservative_management: true,
      },
      contactResult: {
        provider_precert_phone: '800-555-1212',
        provider_precert_notes: 'Use provider menu',
        source_page_url: contactUrl,
      },
    },
    readiness: {
      ready: true,
      confidence: 90,
      supporting_evidence: ['evidence present'],
      missing_evidence: [],
      summary: 'ready',
    },
    logs: {
      thinking: [],
      execution: [],
    },
    metrics: {
      totalSteps: 10,
      eventCount: 10,
      elapsedSeconds: 15,
    },
  };
}

test('saveRun computes first snapshot then changed snapshot diff', async () => {
  const unique = `snapshot-${Date.now()}`;
  const workflowUrl = `https://example.com/policy/${unique}`;
  const contactUrl = `https://example.com/contact/${unique}`;

  const first = await saveRun(
    buildRun({
      appRunId: `${unique}-1`,
      workflowUrl,
      contactUrl,
      policyName: 'Policy A',
      evidenceRequirements: '4 weeks conservative treatment',
    }),
  );

  assert.equal(first.run.snapshotDiff.status, 'first_snapshot');

  const second = await saveRun(
    buildRun({
      appRunId: `${unique}-2`,
      workflowUrl,
      contactUrl,
      policyName: 'Policy A (Updated)',
      evidenceRequirements: '6 weeks conservative treatment',
    }),
  );

  assert.equal(second.run.snapshotDiff.status, 'changed');
  assert.equal(second.run.snapshotDiff.hasChanges, true);
  assert.ok(second.run.snapshotDiff.policyChanges.length >= 1);
});
