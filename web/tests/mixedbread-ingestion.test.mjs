import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { ingestPolicyDocumentWholembed } from '../lib/ai/mixedbread-ingestion.js';

test('ingestPolicyDocumentWholembed writes vectors and enforces idempotency by manifest hash', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authpilot-wholembed-'));
  const ledgerPath = path.join(tempDir, 'reindex-ledger.json');

  const upsertCalls = [];
  const vectorStore = {
    upsert: async (records) => {
      upsertCalls.push(records);
      return { ok: true, backend: 'local-hnsw-lite' };
    },
  };

  const embeddingFn = async (inputs) =>
    inputs.map((text, index) => [
      Number((String(text).length % 100) / 100),
      Number(((index + 1) % 10) / 10),
      0.1234,
    ]);

  try {
    const first = await ingestPolicyDocumentWholembed({
      policyId: 'policy-uhc-lumbar-mri',
      payerId: 'unitedhealthcare',
      procedureCategory: 'mri',
      title: 'Lumbar MRI Medical Necessity',
      sourceUrl: 'https://payer.example/uhc/mri-policy.pdf',
      manifestHash: 'hash-v1',
      idempotencyKey: 'hash-v1',
      policyText:
        'Clinical criteria require failed conservative management and objective neurologic findings before MRI approval.',
      updatedAt: '2026-04-16',
      embeddingFn,
      vectorStore,
      ledgerPath,
      chunkChars: 80,
      overlapChars: 10,
    });

    assert.equal(first.ok, true);
    assert.equal(first.skipped, false);
    assert.equal(first.idempotencyKey, 'hash-v1');
    assert.ok(first.records > 0);
    assert.equal(upsertCalls.length, 1);

    const second = await ingestPolicyDocumentWholembed({
      policyId: 'policy-uhc-lumbar-mri',
      payerId: 'unitedhealthcare',
      procedureCategory: 'mri',
      title: 'Lumbar MRI Medical Necessity',
      sourceUrl: 'https://payer.example/uhc/mri-policy.pdf',
      manifestHash: 'hash-v1',
      idempotencyKey: 'hash-v1',
      policyText:
        'Clinical criteria require failed conservative management and objective neurologic findings before MRI approval.',
      updatedAt: '2026-04-16',
      embeddingFn,
      vectorStore,
      ledgerPath,
    });

    assert.equal(second.ok, true);
    assert.equal(second.skipped, true);
    assert.match(second.reason, /already re-indexed/i);
    assert.equal(upsertCalls.length, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
