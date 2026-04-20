import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { getRelevantPayerRules } from '../lib/ai/mixedbread-client.js';
import { runJustificationAudit } from '../lib/automation/rule-auditor.js';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function createTempVectorIndex(vectors = []) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authpilot-mixedbread-'));
  const indexPath = path.join(tempDir, 'vector-index.json');
  await fs.writeFile(
    indexPath,
    `${JSON.stringify({ vectors, updatedAt: new Date().toISOString(), backend: 'local-hnsw-lite' }, null, 2)}\n`,
    'utf-8',
  );
  return { tempDir, indexPath };
}

test('getRelevantPayerRules retrieves CPT 72148 policy for united-healthcare', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.MIXEDBREAD_API_KEY;
  const previousFetchOnly = process.env.MIXEDBREAD_USE_FETCH_ONLY;
  const previousIndexPath = process.env.POLICY_VECTOR_INDEX_PATH;

  const { tempDir, indexPath } = await createTempVectorIndex([
    {
      id: 'uhc-72148-lumbar-mri',
      values: [1, 0, 0],
      metadata: {
        payerId: 'united-healthcare',
        procedureCodes: ['72148'],
        title: 'Lumbar MRI Medical Necessity',
        sourceUrl: 'https://payer.example/uhc/lumbar-mri',
        text: 'For CPT 72148, failed conservative therapy and neuro deficits are required.',
      },
    },
    {
      id: 'uhc-73721-knee-mri',
      values: [0.7, 0.1, 0],
      metadata: {
        payerId: 'united-healthcare',
        procedureCodes: ['73721'],
        title: 'Knee MRI Medical Necessity',
        sourceUrl: 'https://payer.example/uhc/knee-mri',
        text: 'For CPT 73721, persistent locking and instability are required.',
      },
    },
  ]);

  process.env.MIXEDBREAD_API_KEY = 'mxb_test_key';
  process.env.MIXEDBREAD_USE_FETCH_ONLY = 'true';
  process.env.POLICY_VECTOR_INDEX_PATH = indexPath;

  global.fetch = async (url) => {
    const normalized = String(url || '');
    if (normalized.includes('/embeddings')) {
      return mockJsonResponse({
        data: [{ embedding: [1, 0, 0] }],
      });
    }
    if (normalized.includes('/reranking')) {
      return mockJsonResponse({
        data: [
          { index: 0, score: 0.98 },
          { index: 1, score: 0.61 },
        ],
      });
    }
    return mockJsonResponse({ message: 'unexpected url' }, 500);
  };

  try {
    const result = await getRelevantPayerRules('72148', 'united-healthcare', {
      clinicalContext: 'Lumbar radiculopathy with failed PT and NSAIDs',
      topK: 8,
    });

    assert.equal(result.procedureCode, '72148');
    assert.equal(result.payerId, 'united-healthcare');
    assert.equal(result.topOne?.id, 'uhc-72148-lumbar-mri');
    assert.match(result.topOne?.title || '', /Lumbar MRI/i);
    assert.ok(result.totalCandidates >= 1);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') process.env.MIXEDBREAD_API_KEY = previousApiKey;
    else delete process.env.MIXEDBREAD_API_KEY;
    if (typeof previousFetchOnly === 'string') process.env.MIXEDBREAD_USE_FETCH_ONLY = previousFetchOnly;
    else delete process.env.MIXEDBREAD_USE_FETCH_ONLY;
    if (typeof previousIndexPath === 'string') process.env.POLICY_VECTOR_INDEX_PATH = previousIndexPath;
    else delete process.env.POLICY_VECTOR_INDEX_PATH;

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('runJustificationAudit returns no-gap result for CPT 72148 when justification satisfies top rule', async () => {
  const previousFetch = global.fetch;
  const previousMxbKey = process.env.MIXEDBREAD_API_KEY;
  const previousMxbFetchOnly = process.env.MIXEDBREAD_USE_FETCH_ONLY;
  const previousFwKey = process.env.FIREWORKS_API_KEY;
  const previousFwModel = process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL;
  const previousIndexPath = process.env.POLICY_VECTOR_INDEX_PATH;

  const { tempDir, indexPath } = await createTempVectorIndex([
    {
      id: 'uhc-72148-lumbar-mri',
      values: [1, 0, 0],
      metadata: {
        payerId: 'united-healthcare',
        procedureCodes: ['72148'],
        title: 'Lumbar MRI Medical Necessity',
        sourceUrl: 'https://payer.example/uhc/lumbar-mri',
        text: 'Requires persistent neuro deficits and 6 weeks failed conservative management.',
      },
    },
  ]);

  process.env.MIXEDBREAD_API_KEY = 'mxb_test_key';
  process.env.MIXEDBREAD_USE_FETCH_ONLY = 'true';
  process.env.FIREWORKS_API_KEY = 'fw_test_key';
  process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL = 'accounts/fireworks/models/qwen2p5-vl-72b-instruct';
  process.env.POLICY_VECTOR_INDEX_PATH = indexPath;

  global.fetch = async (url) => {
    const normalized = String(url || '');

    if (normalized.includes('api.mixedbread.ai') && normalized.includes('/embeddings')) {
      return mockJsonResponse({ data: [{ embedding: [1, 0, 0] }] });
    }

    if (normalized.includes('api.mixedbread.ai') && normalized.includes('/reranking')) {
      return mockJsonResponse({ data: [{ index: 0, score: 0.99 }] });
    }

    if (normalized.includes('api.fireworks.ai') && normalized.includes('/chat/completions')) {
      return mockJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                hasGap: false,
                missingDataPoints: [],
                summary: 'Clinical notes satisfy payer policy criteria for CPT 72148.',
                confidence: 0.93,
              }),
            },
          },
        ],
      });
    }

    return mockJsonResponse({ message: 'unexpected url' }, 500);
  };

  try {
    const result = await runJustificationAudit({
      run: {
        appRunId: 'run-cpt-72148-audit',
        intake: {
          payerName: 'United Healthcare',
          procedureCode: '72148',
          diagnosis: 'M54.16',
          chartSummary: 'Patient completed six weeks PT and NSAIDs with persistent lumbar radicular pain.',
        },
        operatorPacket: {
          payer_name: 'United Healthcare',
          procedure_code: '72148',
        },
      },
    });

    assert.equal(result.skipped, false);
    assert.equal(result.retrieval.procedureCode, '72148');
    assert.equal(result.audit.hasGap, false);
    assert.match(result.audit.summary, /CPT 72148/i);
    assert.equal(result.topRule?.id, 'uhc-72148-lumbar-mri');
  } finally {
    global.fetch = previousFetch;
    if (typeof previousMxbKey === 'string') process.env.MIXEDBREAD_API_KEY = previousMxbKey;
    else delete process.env.MIXEDBREAD_API_KEY;
    if (typeof previousMxbFetchOnly === 'string') process.env.MIXEDBREAD_USE_FETCH_ONLY = previousMxbFetchOnly;
    else delete process.env.MIXEDBREAD_USE_FETCH_ONLY;
    if (typeof previousFwKey === 'string') process.env.FIREWORKS_API_KEY = previousFwKey;
    else delete process.env.FIREWORKS_API_KEY;
    if (typeof previousFwModel === 'string') process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL = previousFwModel;
    else delete process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL;
    if (typeof previousIndexPath === 'string') process.env.POLICY_VECTOR_INDEX_PATH = previousIndexPath;
    else delete process.env.POLICY_VECTOR_INDEX_PATH;

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
