import test from 'node:test';
import assert from 'node:assert/strict';

import { logExtractionEconomics, processClinicalRecord } from '../lib/ai/fireworks-client.js';

const SAMPLE_MESSY_CLINICAL_NOTE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAFqk6xkAAAAASUVORK5CYII=';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('processClinicalRecord returns partialSuccess when OCR only yields clinical text', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.FIREWORKS_API_KEY;

  process.env.FIREWORKS_API_KEY = 'fw_test_key_partial';

  global.fetch = async () =>
    mockJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              diagnosisCodes: [],
              procedureCodes: [],
              clinicalJustificationText:
                'Patient chart includes SSN 123-45-6789 and failed conservative therapy for 6 weeks.',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 120 },
    });

  try {
    const result = await processClinicalRecord(SAMPLE_MESSY_CLINICAL_NOTE_IMAGE_BASE64);

    assert.equal(result.extraction.partialSuccess, true);
    assert.deepEqual(result.extraction.missingSignals.sort(), ['diagnosisCodes', 'procedureCodes']);
    assert.match(result.extraction.clinicalJustificationText, /\[REDACTED_SSN\]/);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});

test('logExtractionEconomics models blended GPT-4o comparison and margin target', () => {
  const economics = logExtractionEconomics({
    modelUsed: 'accounts/fireworks/models/qwen2p5-vl-72b-instruct',
    cacheStatus: 'hit',
    inputTokens: 2_000_000,
    outputTokens: 200_000,
  });

  assert.ok(economics.fireworksCostUsd < economics.gpt4oCostUsd);
  assert.ok(economics.savingsPercent > 90);
  assert.equal(economics.grossMarginTargetMet, true);
});
