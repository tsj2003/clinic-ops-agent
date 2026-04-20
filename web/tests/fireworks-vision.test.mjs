import test from 'node:test';
import assert from 'node:assert/strict';

import { logSimulatedSavings, processClinicalRecord } from '../lib/ai/fireworks-client.js';

const MESSY_MEDICAL_NOTE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAFqk6xkAAAAASUVORK5CYII=';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('processClinicalRecord uses json_schema and redacts extracted free text', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.FIREWORKS_API_KEY;
  const calls = [];

  process.env.FIREWORKS_API_KEY = 'fw_test_key_123';

  global.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return mockJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              patientId: 'P-77',
              memberId: 'M-88',
              procedureCode: '72148',
              serviceDate: '04/15/2026',
              dob: '02/03/1985',
              diagnosis: 'M54.16',
              chartSummary: 'Member ID M-88 with SSN 123-45-6789 failed PT and NSAIDs.',
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
      },
    });
  };

  try {
    const result = await processClinicalRecord({
      imageBase64: MESSY_MEDICAL_NOTE_IMAGE_BASE64,
      specialtyPriorAuthRules: 'Lumbar MRI requires failed conservative therapy.',
    });

    assert.equal(calls.length, 1);

    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.model, 'accounts/fireworks/models/qwen2p5-vl-72b-instruct');
    assert.equal(payload.response_format.type, 'json_schema');
    assert.equal(payload.response_format.json_schema.name, 'BatchIntakeRowSchema');
    assert.equal(payload.response_format.json_schema.schema.type, 'object');
    assert.ok(payload.response_format.json_schema.schema.required.includes('clinicalJustificationText'));

    assert.match(payload.messages[0].content, /^Specialty Prior Auth Rules:/);
    assert.match(payload.messages[0].content, /Lumbar MRI requires failed conservative therapy/);

    assert.equal(result.extraction.serviceDate, '2026-04-15');
    assert.equal(result.extraction.extractedRow.patientId, 'P-77');
    assert.equal(result.extraction.extractedRow.memberId, 'M-88');
    assert.match(result.extraction.clinicalJustificationText, /\[REDACTED_SSN\]/);
    assert.equal(result.extraction.extractedRow.chartSummary, result.extraction.clinicalJustificationText);
    assert.ok(result.simulatedSavings.effectiveFireworksRatePerMillion <= 0.2);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});

test('processClinicalRecord falls back to llama vision model on retryable Fireworks errors', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.FIREWORKS_API_KEY;
  const calls = [];
  let attempt = 0;

  process.env.FIREWORKS_API_KEY = 'fw_test_key_456';

  global.fetch = async (_url, init = {}) => {
    calls.push(JSON.parse(init.body));
    attempt += 1;

    if (attempt === 1) {
      return mockJsonResponse({ error: { message: 'Primary model overloaded' } }, 503);
    }

    return mockJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              patientId: 'P-901',
              memberId: 'M-901',
              procedureCode: '73721',
              serviceDate: '2026-04-14',
              dob: '1979-10-12',
              diagnosis: 'S83.241A',
              chartSummary: 'Knee MRI request with persistent locking after conservative treatment.',
            }),
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 110 },
    });
  };

  try {
    const result = await processClinicalRecord(MESSY_MEDICAL_NOTE_IMAGE_BASE64);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, 'accounts/fireworks/models/qwen2p5-vl-72b-instruct');
    assert.equal(calls[1].model, 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct');
    assert.equal(result.modelUsed, 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct');
    assert.equal(result.extraction.procedureCodes[0], '73721');
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});

test('logSimulatedSavings estimates Fireworks margin delta vs GPT-4o blended benchmark', () => {
  const summary = logSimulatedSavings({
    modelUsed: 'accounts/fireworks/models/qwen2p5-vl-72b-instruct',
    cacheStatus: 'hit',
    inputTokens: 15000,
    outputTokens: 2000,
  });

  assert.equal(summary.totalTokens, 17000);
  assert.ok(summary.fireworksCostUsd > 0);
  assert.ok(summary.gpt4oCostUsd > summary.fireworksCostUsd);
  assert.ok(summary.savingsPercent > 0);
});
