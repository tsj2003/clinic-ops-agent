import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { detectDeniedSignal, generateCombatBriefOnDenial } from '../lib/automation/combat-brief.js';

async function createTempVectorIndex(vectors = []) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authpilot-combat-brief-'));
  const indexPath = path.join(tempDir, 'vector-index.json');
  await fs.writeFile(
    indexPath,
    `${JSON.stringify({ vectors, updatedAt: new Date().toISOString(), backend: 'local-hnsw-lite' }, null, 2)}\n`,
    'utf-8',
  );
  return { tempDir, indexPath };
}

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('detectDeniedSignal identifies denial keywords', () => {
  assert.equal(detectDeniedSignal({ status: 'DENIED' }), true);
  assert.equal(detectDeniedSignal({ subject: 'Adverse determination notice' }), true);
  assert.equal(detectDeniedSignal({ text: 'Authorization has been approved.' }), false);
});

test('generateCombatBriefOnDenial creates strict JSON brief, PDF artifact, and ROI event', async () => {
  const previousFetch = global.fetch;
  const previousDataScope = process.env.AUTHPILOT_DATA_SCOPE;
  const previousPolicyVectorPath = process.env.POLICY_VECTOR_INDEX_PATH;
  const previousMixedbreadKey = process.env.MIXEDBREAD_API_KEY;
  const previousMixedbreadFetchOnly = process.env.MIXEDBREAD_USE_FETCH_ONLY;
  const previousFireworksKey = process.env.FIREWORKS_API_KEY;
  const previousCombatBriefDir = process.env.COMBAT_BRIEF_DIR;

  const { tempDir, indexPath } = await createTempVectorIndex([
    {
      id: 'policy-uhc-72148',
      values: [1, 0, 0],
      metadata: {
        payerId: 'united-healthcare',
        procedureCodes: ['72148'],
        title: 'UHC Lumbar MRI Medical Necessity',
        sourceUrl: 'https://payer.example/uhc/72148',
        text: 'Requires failed conservative treatment for at least 6 weeks and documented radiculopathy.',
      },
    },
  ]);

  process.env.AUTHPILOT_DATA_SCOPE = 'pilot-vault';
  process.env.POLICY_VECTOR_INDEX_PATH = indexPath;
  process.env.MIXEDBREAD_API_KEY = 'mxb_test_key';
  process.env.MIXEDBREAD_USE_FETCH_ONLY = 'true';
  process.env.FIREWORKS_API_KEY = 'fw_test_key';
  process.env.COMBAT_BRIEF_DIR = path.join(tempDir, 'briefs');

  const trackedEvents = [];

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
                loophole: 'Policy requires 6 weeks of PT, which is present in chart timeline.',
                evidence: 'Clinical note dated 2026-03-12 documents 6 weeks of failed PT.',
                argument:
                  'The denied criterion is met in the chart timeline. Please reverse denial based on documented conservative treatment failure and policy language.',
                confidence: 0.93,
                claims: [
                  {
                    policy_id: 'policy-uhc-72148',
                    note_timestamp: '2026-03-12',
                    policy_quote:
                      'Requires failed conservative treatment for at least 6 weeks and documented radiculopathy.',
                    note_quote: 'Patient completed six weeks of PT with persistent lumbar radicular pain.',
                    rationale: 'Clinical documentation satisfies conservative-treatment duration requirement.',
                  },
                ],
              }),
            },
          },
        ],
      });
    }

    return mockJsonResponse({ message: 'unexpected url' }, 500);
  };

  try {
    const result = await generateCombatBriefOnDenial({
      run: {
        appRunId: 'run-combat-brief-1',
        intake: {
          payerName: 'United Healthcare',
          procedureCode: '72148',
          serviceDate: '2026-03-12',
          chartSummary: 'Patient completed six weeks of PT and still has severe radicular pain.',
        },
        operatorPacket: {
          payer_name: 'United Healthcare',
          diagnosis: 'M54.16',
        },
      },
      denialStatus: 'DENIED',
      denialReason: 'Denied for lack of conservative treatment documentation.',
      payerReferenceId: 'DENIAL-7788',
      yottaClient: {
        track: async (payload) => {
          trackedEvents.push(payload);
          return { ok: true };
        },
      },
      source: 'voice_liaison',
    });

    assert.equal(result.ok, true);
    assert.equal(result.duplicate, false);
    assert.equal(Array.isArray(result.brief.claims), true);
    assert.equal(result.brief.claims.length >= 1, true);
    assert.equal(result.brief.ui.requiredFieldsPresent, true);
    assert.equal(result.brief.claims.every((claim) => claim.policy_id && claim.note_timestamp), true);
    assert.match(result.brief.argument, /reverse denial|denial/i);

    const jsonExists = await fs
      .access(result.brief.storage.jsonPath)
      .then(() => true)
      .catch(() => false);
    const pdfExists = await fs
      .access(result.brief.storage.pdfPath)
      .then(() => true)
      .catch(() => false);

    assert.equal(jsonExists, true);
    assert.equal(pdfExists, true);
    assert.equal(result.brief.storage.retentionDays, 7);

    assert.equal(trackedEvents.length, 1);
    assert.equal(trackedEvents[0].event, 'authpilot.physician_time_recovery');
    assert.equal(trackedEvents[0].properties.minutesRecovered, 15);
  } finally {
    global.fetch = previousFetch;

    if (typeof previousDataScope === 'string') process.env.AUTHPILOT_DATA_SCOPE = previousDataScope;
    else delete process.env.AUTHPILOT_DATA_SCOPE;

    if (typeof previousPolicyVectorPath === 'string') process.env.POLICY_VECTOR_INDEX_PATH = previousPolicyVectorPath;
    else delete process.env.POLICY_VECTOR_INDEX_PATH;

    if (typeof previousMixedbreadKey === 'string') process.env.MIXEDBREAD_API_KEY = previousMixedbreadKey;
    else delete process.env.MIXEDBREAD_API_KEY;

    if (typeof previousMixedbreadFetchOnly === 'string') process.env.MIXEDBREAD_USE_FETCH_ONLY = previousMixedbreadFetchOnly;
    else delete process.env.MIXEDBREAD_USE_FETCH_ONLY;

    if (typeof previousFireworksKey === 'string') process.env.FIREWORKS_API_KEY = previousFireworksKey;
    else delete process.env.FIREWORKS_API_KEY;

    if (typeof previousCombatBriefDir === 'string') process.env.COMBAT_BRIEF_DIR = previousCombatBriefDir;
    else delete process.env.COMBAT_BRIEF_DIR;

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
