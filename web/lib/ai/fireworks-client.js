import { createHash } from 'crypto';

import { redactFreeText } from '../privacy.js';

const DEFAULT_FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_PRIMARY_MODEL = 'accounts/fireworks/models/qwen2p5-vl-72b-instruct';
const DEFAULT_FALLBACK_MODEL = 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct';
const FIREWORKS_INPUT_COST_PER_MILLION = 0.2;
const FIREWORKS_CACHED_INPUT_COST_PER_MILLION = 0.1;
const FIREWORKS_OUTPUT_COST_PER_MILLION = 0.2;
const GPT4O_BLENDED_COST_PER_MILLION = 12.5;

const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnosisCodes', 'procedureCodes', 'clinicalJustificationText'],
  properties: {
    diagnosisCodes: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 25,
    },
    procedureCodes: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 25,
    },
    clinicalJustificationText: { type: 'string' },
    serviceDate: { type: 'string' },
    patientId: { type: 'string' },
    memberId: { type: 'string' },
    dob: { type: 'string' },
    diagnosis: { type: 'string' },
    procedureCode: { type: 'string' },
  },
};

const promptCache = new Map();

function clean(value, max = 8_000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function cleanArray(values = [], maxItems = 30, maxLen = 40) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => clean(item, maxLen).toUpperCase())
    .filter(Boolean)
    .slice(0, maxItems);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDate(value) {
  const input = clean(value, 40);
  if (!input) {
    return '';
  }

  const direct = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return input;
  }

  const mmddyyyy = input.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mmddyyyy) {
    const month = mmddyyyy[1].padStart(2, '0');
    const day = mmddyyyy[2].padStart(2, '0');
    const year = mmddyyyy[3].length === 2 ? `20${mmddyyyy[3]}` : mmddyyyy[3];
    return `${year}-${month}-${day}`;
  }

  return input;
}

function getSystemPrompt({ specialtyPriorAuthRules = '' } = {}) {
  return [
    `Specialty Prior Auth Rules:\n${clean(specialtyPriorAuthRules, 12_000) || 'Follow payer policy and specialty guidance from the clinical note context.'}`,
    'You are AuthPilot AI extraction engine for medical prior authorization.',
    'Return only JSON object matching the provided json_schema.',
    'Extract diagnosisCodes, procedureCodes, and clinicalJustificationText with high recall from the clinical image.',
    'Do not include markdown fences or explanation.',
    'Use ICD-10 style for diagnosisCodes and CPT/HCPCS style for procedureCodes when inferable.',
    'If fields are uncertain, return empty strings/arrays but preserve valid schema output.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function cacheKeyForPrompt(prompt) {
  return createHash('sha256').update(prompt).digest('hex');
}

function getPromptCacheHint(prompt) {
  const key = cacheKeyForPrompt(prompt);
  const existing = promptCache.get(key);
  if (existing) {
    existing.hits += 1;
    return {
      cacheKey: key,
      cacheStatus: 'hit',
      hits: existing.hits,
    };
  }

  promptCache.set(key, { createdAt: Date.now(), hits: 0 });
  return {
    cacheKey: key,
    cacheStatus: 'miss',
    hits: 0,
  };
}

function parseJsonContent(content = '') {
  const text = clean(content, 120_000);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function normalizeExtraction(payload = {}) {
  const obj = asObject(payload);
  const diagnosisTokens = cleanArray([
    ...(Array.isArray(obj.diagnosisCodes) ? obj.diagnosisCodes : []),
    obj.diagnosis,
    ...(Array.isArray(obj.icd10Codes) ? obj.icd10Codes : []),
    ...(Array.isArray(obj.icdCodes) ? obj.icdCodes : []),
  ]);
  const procedureTokens = cleanArray([
    ...(Array.isArray(obj.procedureCodes) ? obj.procedureCodes : []),
    obj.procedureCode,
    ...(Array.isArray(obj.cptCodes) ? obj.cptCodes : []),
    ...(Array.isArray(obj.hcpcsCodes) ? obj.hcpcsCodes : []),
  ]);

  const clinicalJustificationText = redactFreeText(
    clean(obj.clinicalJustificationText || obj.chartSummary || obj.clinicalSummary || obj.summary, 8_000),
  );
  const serviceDate = normalizeDate(obj.serviceDate || obj.dateOfService || obj.dos);

  const extractedRow = {
    patientId: clean(obj.patientId, 120),
    memberId: clean(obj.memberId, 120),
    dob: normalizeDate(obj.dob || obj.dateOfBirth),
    diagnosis: clean(obj.diagnosis || diagnosisTokens[0], 120),
    procedureCode: clean(obj.procedureCode || procedureTokens[0], 120),
    serviceDate,
    chartSummary: clinicalJustificationText,
  };

  const requiredSignals = {
    diagnosisCodes: diagnosisTokens.length > 0,
    procedureCodes: procedureTokens.length > 0,
    clinicalJustificationText: Boolean(clinicalJustificationText),
  };
  const presentSignalCount = Object.values(requiredSignals).filter(Boolean).length;
  const partialSuccess = presentSignalCount > 0 && presentSignalCount < 3;

  return {
    diagnosisCodes: diagnosisTokens,
    procedureCodes: procedureTokens,
    clinicalJustificationText,
    serviceDate,
    partialSuccess,
    missingSignals: Object.entries(requiredSignals)
      .filter(([, present]) => !present)
      .map(([key]) => key),
    extractedRow,
  };
}

export function estimateTokenCost({ inputTokens = 0, outputTokens = 0, cacheStatus = 'miss' } = {}) {
  const totalTokens = Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0);
  const normalizedCacheStatus = clean(cacheStatus, 32).toLowerCase();
  const isCached = normalizedCacheStatus === 'hit';

  const fireworksInputRate = isCached ? FIREWORKS_CACHED_INPUT_COST_PER_MILLION : FIREWORKS_INPUT_COST_PER_MILLION;
  const fireworksInputCost = (Math.max(0, Number(inputTokens) || 0) / 1_000_000) * fireworksInputRate;
  const fireworksOutputCost = (Math.max(0, Number(outputTokens) || 0) / 1_000_000) * FIREWORKS_OUTPUT_COST_PER_MILLION;
  const fireworksCost = fireworksInputCost + fireworksOutputCost;

  const gpt4oCost = (totalTokens / 1_000_000) * GPT4O_BLENDED_COST_PER_MILLION;
  const savingsPercent = gpt4oCost > 0 ? ((gpt4oCost - fireworksCost) / gpt4oCost) * 100 : 0;
  const effectiveFireworksRatePerMillion = totalTokens > 0 ? (fireworksCost / totalTokens) * 1_000_000 : 0;

  return {
    totalTokens,
    fireworksCostUsd: Number(fireworksCost.toFixed(8)),
    gpt4oCostUsd: Number(gpt4oCost.toFixed(8)),
    savingsUsd: Number((gpt4oCost - fireworksCost).toFixed(8)),
    savingsPercent: Number(savingsPercent.toFixed(2)),
    fireworksInputRatePerMillion: Number(fireworksInputRate.toFixed(2)),
    effectiveFireworksRatePerMillion: Number(effectiveFireworksRatePerMillion.toFixed(4)),
    grossMarginTargetMet: effectiveFireworksRatePerMillion <= 0.2,
  };
}

export function logExtractionEconomics({ modelUsed = '', cacheStatus = 'miss', inputTokens = 0, outputTokens = 0 } = {}) {
  const simulatedSavings = estimateTokenCost({ inputTokens, outputTokens, cacheStatus });
  console.info(
    '[unit-economics] Fireworks extraction economics',
    JSON.stringify({
      modelUsed: clean(modelUsed, 200),
      cacheStatus: clean(cacheStatus, 40),
      totalTokens: simulatedSavings.totalTokens,
      fireworksCostUsd: simulatedSavings.fireworksCostUsd,
      gpt4oCostUsd: simulatedSavings.gpt4oCostUsd,
      effectiveFireworksRatePerMillion: simulatedSavings.effectiveFireworksRatePerMillion,
      savingsPercent: simulatedSavings.savingsPercent,
      grossMarginTargetMet: simulatedSavings.grossMarginTargetMet,
    }),
  );
  return simulatedSavings;
}

export const logSimulatedSavings = logExtractionEconomics;

function resolveBearerToken(value) {
  const raw = clean(value, 10_000);
  if (!raw) {
    return '';
  }
  return raw.replace(/^Bearer\s+/i, '').trim();
}

export function createFireworksClient({ apiKey, baseUrl } = {}) {
  const token =
    resolveBearerToken(apiKey) ||
    resolveBearerToken(process.env.FIREWORKS_API_KEY) ||
    resolveBearerToken(process.env.FIREWORKS_ACCESS_TOKEN);
  const resolvedBaseUrl = clean(baseUrl || process.env.FIREWORKS_BASE_URL || DEFAULT_FIREWORKS_BASE_URL, 500);

  if (!token) {
    throw new Error('FIREWORKS_API_KEY is required for vision extraction.');
  }

  if (!resolvedBaseUrl) {
    throw new Error('Fireworks base URL is required.');
  }

  return {
    baseUrl: resolvedBaseUrl.replace(/\/$/, ''),
    token,
  };
}

async function callFireworksVision({ client, model, imageBase64, systemPrompt, cacheHint }) {
  const response = await fetch(`${client.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${client.token}`,
      'content-type': 'application/json',
      'x-prompt-cache-key': cacheHint.cacheKey,
      'x-prompt-cache-status': cacheHint.cacheStatus,
      'x-fireworks-prompt-cache': 'true',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 900,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'BatchIntakeRowSchema',
          schema: EXTRACTION_JSON_SCHEMA,
          strict: true,
        },
      },
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract schema JSON from this clinical record image.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${clean(imageBase64, 2_500_000)}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { error: { message: raw.slice(0, 300) } };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorMessage: clean(payload?.error?.message || payload?.message || 'Fireworks request failed.', 500),
      payload,
    };
  }

  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    '';

  return {
    ok: true,
    payload,
    content,
    usage: asObject(payload?.usage),
  };
}

export async function processClinicalRecord(input = {}) {
  const options = typeof input === 'string' ? { imageBase64: input } : asObject(input);
  const imageBase64 = options.imageBase64 || options.base64Image || '';
  const specialtyPriorAuthRules = options.specialtyPriorAuthRules || '';
  const primaryModel = options.primaryModel || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = options.fallbackModel || DEFAULT_FALLBACK_MODEL;

  const client = createFireworksClient({
    apiKey: clean(options.apiKey, 10_000),
    baseUrl: clean(options.baseUrl, 500),
  });

  const encodedImage = clean(imageBase64, 2_500_000);
  if (!encodedImage) {
    throw new Error('imageBase64 is required for processClinicalRecord().');
  }

  const systemPrompt = getSystemPrompt({ specialtyPriorAuthRules });
  const cacheHint = getPromptCacheHint(systemPrompt);

  const first = await callFireworksVision({
    client,
    model: clean(primaryModel, 200) || DEFAULT_PRIMARY_MODEL,
    imageBase64: encodedImage,
    systemPrompt,
    cacheHint,
  });

  let result = first;
  let modelUsed = clean(primaryModel, 200) || DEFAULT_PRIMARY_MODEL;

  if (!first.ok) {
    const shouldFallback = [404, 408, 409, 429, 500, 502, 503, 504].includes(Number(first.status));
    if (!shouldFallback) {
      throw new Error(first.errorMessage || 'Fireworks extraction failed.');
    }

    const second = await callFireworksVision({
      client,
      model: clean(fallbackModel, 200) || DEFAULT_FALLBACK_MODEL,
      imageBase64: encodedImage,
      systemPrompt,
      cacheHint,
    });

    if (!second.ok) {
      throw new Error(second.errorMessage || 'Fireworks extraction failed after fallback.');
    }

    result = second;
    modelUsed = clean(fallbackModel, 200) || DEFAULT_FALLBACK_MODEL;
  }

  const parsed = parseJsonContent(result.content);
  const extraction = normalizeExtraction(parsed);

  const inputTokens = Number(result.usage?.prompt_tokens || result.usage?.input_tokens || 0);
  const outputTokens = Number(result.usage?.completion_tokens || result.usage?.output_tokens || 0);
  const simulatedSavings = logExtractionEconomics({
    modelUsed,
    cacheStatus: cacheHint.cacheStatus,
    inputTokens,
    outputTokens,
  });

  return {
    modelUsed,
    cache: {
      key: cacheHint.cacheKey,
      status: cacheHint.cacheStatus,
      hits: cacheHint.hits,
    },
    extraction,
    usage: {
      inputTokens,
      outputTokens,
    },
    simulatedSavings,
  };
}
