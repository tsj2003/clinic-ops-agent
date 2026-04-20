import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { listPolicySentinelChanges } from '../lib/automation/policy-sentinel.js';

test('listPolicySentinelChanges returns filtered recent change history with summary', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authpilot-policy-sentinel-dashboard-'));
  const manifestPath = path.join(tempDir, 'policy-manifest.json');

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: '2026-04-17.test',
        updatedAt: '2026-04-17T10:15:00.000Z',
        policies: {
          'policy-1': { payerId: 'aetna' },
          'policy-2': { payerId: 'uhc' },
        },
        crawls: [{ payerId: 'aetna' }, { payerId: 'uhc' }],
        changes: [
          {
            policyKey: 'policy-1',
            payerId: 'aetna',
            title: 'Aetna Lumbar MRI',
            status: 'STALE_RELOAD_REQUIRED',
            timestamp: '2026-04-17T10:00:00.000Z',
            semantic: { summary: 'PT duration increased to 6 weeks.' },
            alert: { alerted: true },
          },
          {
            policyKey: 'policy-2',
            payerId: 'uhc',
            title: 'UHC Knee MRI',
            status: 'METADATA_CHANGED',
            timestamp: '2026-04-16T09:00:00.000Z',
            semantic: { summary: 'Footer changed only.' },
            alert: { alerted: false },
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  try {
    const result = await listPolicySentinelChanges({
      manifestPath,
      payerId: 'aetna',
      status: 'STALE_RELOAD_REQUIRED',
      limit: 5,
    });

    assert.equal(result.summary.totalPoliciesTracked, 2);
    assert.equal(result.summary.totalChangeEvents, 2);
    assert.equal(result.summary.staleReloadRequired, 1);
    assert.equal(result.summary.alertsSent, 1);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].payerId, 'aetna');
    assert.equal(result.changes[0].status, 'STALE_RELOAD_REQUIRED');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
