import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { runPolicySentinel } from '../lib/automation/policy-sentinel.js';

test('runPolicySentinel flags semantic criteria change and triggers reindex + alert', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authpilot-policy-sentinel-'));
  const manifestPath = path.join(tempDir, 'policy-manifest.json');
  const snapshotsDir = path.join(tempDir, 'snapshots');
  const previousManifestPath = process.env.POLICY_SENTINEL_MANIFEST_PATH;
  const previousSnapshotsPath = process.env.POLICY_SENTINEL_SNAPSHOTS_DIR;

  process.env.POLICY_SENTINEL_MANIFEST_PATH = manifestPath;
  process.env.POLICY_SENTINEL_SNAPSHOTS_DIR = snapshotsDir;

  const reindexCalls = [];
  const alertCalls = [];

  try {
    const first = await runPolicySentinel({
      targets: [
        {
          payerId: 'unitedhealthcare',
          label: 'UHC',
          searchUrl: 'https://example.com/uhc',
        },
      ],
      crawler: async () => ({
        documents: [
          {
            title: 'Lumbar MRI Medical Necessity',
            pdfUrl: 'https://example.com/uhc-lumbar-mri-v1.pdf',
            lastUpdated: '2026-04-16',
            procedureCategory: 'mri',
          },
        ],
      }),
      downloader: async () =>
        Buffer.from('Policy text now requires 6 weeks of physical therapy prior to MRI authorization.', 'utf-8'),
      semanticDiff: async () => ({
        criteriaChanged: true,
        summary: 'Clinical criteria updated from 4 to 6 weeks PT before MRI.',
        changedClinicalCriteria: ['Conservative treatment duration increased.'],
        newRequirements: ['Requires 6 weeks of physical therapy before MRI approval.'],
        confidence: 0.94,
        modelUsed: 'accounts/fireworks/models/qwen2p5-vl-72b-instruct',
      }),
      reindexer: async (payload) => {
        reindexCalls.push(payload);
        return { ok: true, skipped: false, records: 3, backend: 'local-hnsw-lite' };
      },
      alertDispatcher: async (payload) => {
        alertCalls.push(payload);
        return { ok: true, skipped: false };
      },
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    assert.equal(first.ok, true);
    assert.equal(first.changed, 1);
    assert.equal(first.staleReloadRequired, 1);
    assert.equal(first.reindexed, 1);
    assert.equal(first.alertsSent, 1);
    assert.equal(reindexCalls.length, 1);
    assert.equal(alertCalls.length, 1);

    const second = await runPolicySentinel({
      targets: [
        {
          payerId: 'unitedhealthcare',
          label: 'UHC',
          searchUrl: 'https://example.com/uhc',
        },
      ],
      crawler: async () => ({
        documents: [
          {
            title: 'Lumbar MRI Medical Necessity',
            pdfUrl: 'https://example.com/uhc-lumbar-mri-v1.pdf',
            lastUpdated: '2026-04-16',
            procedureCategory: 'mri',
          },
        ],
      }),
      downloader: async () => Buffer.from('same version', 'utf-8'),
      semanticDiff: async () => ({ criteriaChanged: false, summary: 'No change' }),
      reindexer: async (payload) => {
        reindexCalls.push(payload);
        return { ok: true, skipped: false };
      },
      alertDispatcher: async (payload) => {
        alertCalls.push(payload);
        return { ok: true, skipped: false };
      },
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    assert.equal(second.ok, true);
    assert.equal(second.unchanged, 1);
    assert.equal(second.changed, 0);
    assert.equal(reindexCalls.length, 1);
    assert.equal(alertCalls.length, 1);
  } finally {
    if (typeof previousManifestPath === 'string') {
      process.env.POLICY_SENTINEL_MANIFEST_PATH = previousManifestPath;
    } else {
      delete process.env.POLICY_SENTINEL_MANIFEST_PATH;
    }

    if (typeof previousSnapshotsPath === 'string') {
      process.env.POLICY_SENTINEL_SNAPSHOTS_DIR = previousSnapshotsPath;
    } else {
      delete process.env.POLICY_SENTINEL_SNAPSHOTS_DIR;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
