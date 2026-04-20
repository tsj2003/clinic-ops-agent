import { createHmac } from 'crypto';

import { createAthenaTokenBucketThrottler } from './emr-polling-service.js';
import { redactFreeText } from '../privacy.js';

const DEFAULT_DIFY_BASE_URL = 'https://api.dify.ai';
const DEFAULT_EMITRR_BASE_URL = 'https://api.emitrr.com';
const DEFAULT_FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_FIREWORKS_MODEL = 'accounts/fireworks/models/llama-v3p3-70b-instruct';
const DEFAULT_EMITRR_SMS_QPS = 10;
const DEFAULT_SAFE_LINK_TTL_SECONDS = 15 * 60;

const PROCEDURE_VALUE_USD = {
  '27447': 42000,
  '27130': 45000,
  '72148': 1500,
  '29881': 12000,
  '62323': 950,
  '62321': 920,
  '73721': 1100,
};

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(text = '') {
  const raw = clean(text, 500_000);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeCode(value = '') {
  return clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function readHardenedSecretVault() {
  return asObject(parseJson(clean(process.env.HARDENED_SECRET_VAULT, 120_000)));
}

function readVaultValue({ key = '', tenantId = '', vault = {} } = {}) {
  const normalizedKey = clean(key, 120);
  const normalizedTenant = clean(tenantId, 120);
  const sourceVault = asObject(vault);

  const direct = clean(sourceVault[normalizedKey], 5000);
  if (direct) {
    return direct;
  }

  const tenantValue = clean(asObject(asObject(sourceVault.tenants)[normalizedTenant])[normalizedKey], 5000);
  if (tenantValue) {
    return tenantValue;
  }

  return clean(asObject(sourceVault.default)[normalizedKey], 5000);
}

function resolveFromVaultOrEnv({ key = '', tenantId = '', overrides = {}, vault = {} } = {}) {
  const overrideValue = clean(asObject(overrides)[key], 5000);
  if (overrideValue) {
    return overrideValue;
  }
  return clean(readVaultValue({ key, tenantId, vault }), 5000) || clean(process.env[key], 5000);
}

function buildSafeLink({ runId = '', baseUrl = '', ttlSeconds = DEFAULT_SAFE_LINK_TTL_SECONDS } = {}) {
  const normalizedRunId = clean(runId, 120);
  const normalizedBaseUrl = clean(baseUrl, 1200).replace(/\/+$/, '');
  const secret = clean(process.env.FULFILLMENT_SAFE_LINK_SECRET || process.env.INTERNAL_API_KEY, 5000);
  if (!normalizedRunId || !normalizedBaseUrl || !secret) {
    return '';
  }

  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, asNumber(ttlSeconds, DEFAULT_SAFE_LINK_TTL_SECONDS));
  const payload = `${normalizedRunId}:${expiresAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  const params = new URLSearchParams({
    runId: normalizedRunId,
    exp: String(expiresAt),
    sig: signature,
  });

  return `${normalizedBaseUrl}/fulfillment/safe-view?${params.toString()}`;
}

function replaceTemplatePlaceholders(template = '', values = {}) {
  let next = clean(template, 2000);

  const replacements = {
    FirstName: clean(values.firstName, 120),
    ProcedureLabel: clean(values.procedureLabel, 220),
    SafeLink: clean(values.safeLink, 1200),
  };

  for (const [key, value] of Object.entries(replacements)) {
    next = next.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return next;
}

function normalizeSmsBody(text = '') {
  let normalized = clean(text, 2000);
  if (!normalized) {
    return '';
  }

  normalized = redactFreeText(normalized, { maxLength: 2000 });
  normalized = normalized.replace(/\b(?:DOB|Date of Birth|MRN|Member ID|Subscriber ID|Patient ID|SSN)\b[^\n]*/gi, '[REDACTED]');
  normalized = normalized.replace(/\b(?:diagnosis|dx code|icd-10|icd10)\b[^\n]*/gi, '[REDACTED]');

  return clean(normalized, 1600);
}

function estimateProcedureValueUsd(cptCode = '') {
  const normalized = normalizeCode(cptCode);
  return PROCEDURE_VALUE_USD[normalized] || 600;
}

function normalizeReadiness(value = '') {
  const normalized = clean(value, 80).toLowerCase();
  if (normalized.includes('not ready') || normalized.includes('barrier') || normalized.includes('unsafe')) {
    return 'barrier';
  }
  if (normalized.includes('ready') || normalized.includes('confirmed')) {
    return 'ready';
  }
  return 'unknown';
}

async function emitDifyFulfillmentStateTransition({
  tenantId = '',
  workflowConfig = {},
  run = {},
  state = '',
  metadata = {},
  fetchImpl = fetch,
} = {}) {
  const normalizedState = clean(state, 80).toLowerCase();
  if (!normalizedState) {
    return { ok: false, skipped: true, reason: 'missing_state' };
  }

  const vault = readHardenedSecretVault();
  const overrides = asObject(workflowConfig);
  const effectiveTenantId = clean(tenantId || run?.workspace?.id || run?.intake?.practiceId, 120) || 'default';

  const difyBaseUrl =
    clean(overrides.difyBaseUrl, 1200) ||
    resolveFromVaultOrEnv({ key: 'DIFY_BASE_URL', tenantId: effectiveTenantId, overrides, vault }) ||
    DEFAULT_DIFY_BASE_URL;
  const difyApiKey =
    clean(overrides.difyApiKey, 5000) ||
    resolveFromVaultOrEnv({ key: 'DIFY_API_KEY', tenantId: effectiveTenantId, overrides, vault });
  const transitionPath = clean(overrides.difyTransitionPath, 300) || '/v1/workflows/state-transition';

  if (!difyApiKey) {
    return { ok: false, skipped: true, reason: 'missing_dify_api_key' };
  }

  const response = await fetchImpl(`${difyBaseUrl.replace(/\/+$/, '')}${transitionPath}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${difyApiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      workflowKey: clean(overrides.difyWorkflowKey || 'fulfillment_orchestrator', 120),
      tenantId: effectiveTenantId,
      runId: clean(run?.appRunId, 120),
      state: normalizedState,
      at: nowIso(),
      metadata: asObject(metadata),
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: clean(payload?.error || payload?.message || `Dify transition failed (${response.status}).`, 500),
      raw: payload,
    };
  }

  return {
    ok: true,
    skipped: false,
    state: normalizedState,
    raw: payload,
  };
}

class TokenBucketThrottler {
  constructor({ ratePerSecond = 10, burstCapacity = 10, now = () => Date.now(), sleepFn = null } = {}) {
    this.ratePerSecond = Math.max(1, asNumber(ratePerSecond, 10));
    this.burstCapacity = Math.max(1, asNumber(burstCapacity, 10));
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.sleepFn =
      typeof sleepFn === 'function'
        ? sleepFn
        : (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(1, asNumber(ms, 1))));
    this.tokens = this.burstCapacity;
    this.lastRefillTs = this.now();
  }

  refill() {
    const current = this.now();
    const elapsedMs = Math.max(0, current - this.lastRefillTs);
    if (elapsedMs <= 0) {
      return;
    }
    const refillTokens = (elapsedMs / 1000) * this.ratePerSecond;
    this.tokens = Math.min(this.burstCapacity, this.tokens + refillTokens);
    this.lastRefillTs = current;
  }

  async removeTokens(count = 1) {
    const needed = Math.max(1, asNumber(count, 1));
    while (true) {
      this.refill();
      if (this.tokens >= needed) {
        this.tokens -= needed;
        return;
      }
      const deficit = needed - this.tokens;
      const waitMs = Math.max(1, Math.ceil((deficit / this.ratePerSecond) * 1000));
      await this.sleepFn(waitMs);
    }
  }
}

export async function loadFulfillmentWorkflowConfig({
  tenantId = '',
  overrides = {},
  fetchImpl = fetch,
  difyConfigKey = 'fulfillment_orchestrator',
} = {}) {
  const vault = readHardenedSecretVault();
  const effectiveOverrides = asObject(overrides);

  const difyBaseUrl =
    resolveFromVaultOrEnv({ key: 'DIFY_BASE_URL', tenantId, overrides: effectiveOverrides, vault }) ||
    DEFAULT_DIFY_BASE_URL;
  const difyApiKey = resolveFromVaultOrEnv({ key: 'DIFY_API_KEY', tenantId, overrides: effectiveOverrides, vault });
  const difyWorkflowPath =
    resolveFromVaultOrEnv({ key: 'DIFY_FULFILLMENT_CONFIG_PATH', tenantId, overrides: effectiveOverrides, vault }) ||
    '/v1/workflows/config';

  if (!difyApiKey) {
    return {
      ok: false,
      reason: 'missing_dify_api_key',
      config: {},
    };
  }

  const url = `${clean(difyBaseUrl, 1200).replace(/\/+$/, '')}${difyWorkflowPath}?key=${encodeURIComponent(
    clean(difyConfigKey, 120),
  )}&tenantId=${encodeURIComponent(clean(tenantId, 120) || 'default')}`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${clean(difyApiKey, 5000)}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      reason: clean(payload?.error || payload?.message || `Dify config fetch failed (${response.status}).`, 400),
      config: {},
    };
  }

  const config = asObject(payload?.config || payload?.data || payload);
  return {
    ok: true,
    config,
  };
}

export async function dispatchPatientNudge({
  run = {},
  tenantId = '',
  workflowConfig = {},
  fetchImpl = fetch,
  throttler = null,
} = {}) {
  const vault = readHardenedSecretVault();
  const overrides = asObject(workflowConfig);

  const emitrrBaseUrl =
    clean(overrides.emitrrBaseUrl, 1200) ||
    resolveFromVaultOrEnv({ key: 'EMITRR_BASE_URL', tenantId, overrides, vault }) ||
    DEFAULT_EMITRR_BASE_URL;
  const emitrrApiKey =
    clean(overrides.emitrrApiKey, 5000) ||
    resolveFromVaultOrEnv({ key: 'EMITRR_API_KEY', tenantId, overrides, vault });
  const emitrrPath = clean(overrides.emitrrSmsPath, 300) || '/v1/messages/sms';

  const toPhone = clean(
    run?.intake?.patientPhone || run?.operatorPacket?.patient_phone || run?.operatorPacket?.phone || '',
    30,
  );

  if (!emitrrApiKey || !toPhone) {
    return {
      ok: false,
      skipped: true,
      reason: !emitrrApiKey ? 'Emitrr API key missing.' : 'Patient phone number missing.',
    };
  }

  const safeLink =
    clean(overrides.safeLink, 1200) ||
    buildSafeLink({
      runId: run?.appRunId,
      baseUrl: clean(overrides.safeLinkBaseUrl || process.env.APP_BASE_URL, 1200),
      ttlSeconds: asNumber(overrides.safeLinkTtlSeconds, DEFAULT_SAFE_LINK_TTL_SECONDS),
    });

  const template =
    clean(overrides.patientNudgeTemplate, 2000) ||
    'Good news {FirstName}! Your {ProcedureLabel} procedure is approved. View prep instructions: {SafeLink}';

  const rawMessage = replaceTemplatePlaceholders(template, {
    firstName: run?.intake?.firstName,
    procedureLabel: run?.operatorPacket?.procedure || run?.intake?.procedureCode,
    safeLink,
  });
  const smsBody = normalizeSmsBody(rawMessage);

  const smsThrottler =
    throttler ||
    new TokenBucketThrottler({
      ratePerSecond: asNumber(overrides.emitrrSmsQps, DEFAULT_EMITRR_SMS_QPS),
      burstCapacity: Math.max(1, asNumber(overrides.emitrrSmsBurst, DEFAULT_EMITRR_SMS_QPS)),
    });
  await smsThrottler.removeTokens(1);

  const response = await fetchImpl(`${emitrrBaseUrl.replace(/\/+$/, '')}${emitrrPath}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${emitrrApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: toPhone,
      channel: 'sms',
      body: smsBody,
      metadata: {
        runId: clean(run?.appRunId, 120),
        tenantId: clean(tenantId || run?.workspace?.id, 120),
        workflow: 'patient_nudge',
      },
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: clean(payload?.error || payload?.message || `Emitrr SMS failed (${response.status}).`, 500),
      safeLink,
      smsBody,
    };
  }

  return {
    ok: true,
    safeLink,
    smsBody,
    messageId: clean(payload?.messageId || payload?.id, 120),
    status: clean(payload?.status || 'queued', 80),
    raw: payload,
  };
}

export async function analyzePatientReadinessWithFireworks({
  replyText = '',
  run = {},
  fetchImpl = fetch,
  workflowConfig = {},
  tenantId = '',
} = {}) {
  const redactedReply = redactFreeText(clean(replyText, 20_000), { maxLength: 20_000 });
  const vault = readHardenedSecretVault();
  const overrides = asObject(workflowConfig);

  const apiKey =
    clean(overrides.fireworksApiKey, 5000) ||
    resolveFromVaultOrEnv({ key: 'FIREWORKS_API_KEY', tenantId, overrides, vault });

  if (!apiKey) {
    const fallbackBarrier = /(blood thinner|warfarin|xarelto|plavix|cannot|can't|not ready|reschedule|no ride|confused)/i.test(
      redactedReply,
    );
    return {
      ok: true,
      provider: 'local-fallback',
      readiness: fallbackBarrier ? 'barrier' : 'ready',
      barrierDetected: fallbackBarrier,
      reason: fallbackBarrier
        ? 'Patient reply indicates a possible prep barrier requiring manual review.'
        : 'No prep barrier keywords detected.',
      confidence: fallbackBarrier ? 0.75 : 0.6,
      redactedReply,
    };
  }

  const model = clean(overrides.patientLiaisonModel || process.env.FIREWORKS_PATIENT_LIAISON_MODEL, 220) || DEFAULT_FIREWORKS_MODEL;
  const response = await fetchImpl(`${DEFAULT_FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 350,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PatientPrepReadinessSchema',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['readiness', 'barrierDetected', 'reason', 'confidence'],
            properties: {
              readiness: { type: 'string' },
              barrierDetected: { type: 'boolean' },
              reason: { type: 'string' },
              confidence: { type: 'number' },
              recommendation: { type: 'string' },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are the Patient Liaison agent. Determine if patient prep readiness includes a barrier requiring manual action. Output strict JSON.',
        },
        {
          role: 'user',
          content: [
            `Run ID: ${clean(run?.appRunId, 120) || 'unknown'}`,
            `Procedure: ${clean(run?.operatorPacket?.procedure || run?.intake?.procedureCode, 160) || 'unknown'}`,
            `Patient reply (redacted): ${redactedReply}`,
          ].join('\n\n'),
        },
      ],
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      provider: 'fireworks',
      barrierDetected: false,
      readiness: 'unknown',
      reason: clean(payload?.error?.message || payload?.message || `Readiness analysis failed (${response.status}).`, 500),
      confidence: 0,
      redactedReply,
    };
  }

  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    '{}';
  const parsed = parseJson(content);
  const readiness = normalizeReadiness(parsed.readiness);
  const barrierDetected = parsed.barrierDetected === true || readiness === 'barrier';

  return {
    ok: true,
    provider: 'fireworks',
    model,
    readiness,
    barrierDetected,
    reason: clean(parsed.reason || parsed.recommendation || '', 600),
    confidence: asNumber(parsed.confidence, 0),
    recommendation: clean(parsed.recommendation, 500),
    redactedReply,
  };
}

export async function lockAthenaAppointment({
  run = {},
  payerReferenceId = '',
  workflowConfig = {},
  tenantId = '',
  fetchImpl = fetch,
  throttler = null,
} = {}) {
  const vault = readHardenedSecretVault();
  const overrides = asObject(workflowConfig);

  const practiceId =
    clean(overrides.athenaPracticeId, 120) ||
    clean(run?.intake?.practiceId || run?.workspace?.id, 120) ||
    resolveFromVaultOrEnv({ key: 'ATHENAHEALTH_PRACTICE_ID', tenantId, overrides, vault });
  const baseUrl =
    clean(overrides.athenaBaseUrl, 1200) ||
    resolveFromVaultOrEnv({ key: 'ATHENAHEALTH_BASE_URL', tenantId, overrides, vault });
  const accessToken =
    clean(overrides.athenaAccessToken, 5000) ||
    resolveFromVaultOrEnv({ key: 'ATHENAHEALTH_ACCESS_TOKEN', tenantId, overrides, vault });
  const appointmentId = clean(
    run?.operatorPacket?.source_appointment_id || run?.intake?.appointmentId,
    120,
  );

  if (!practiceId || !baseUrl || !accessToken || !appointmentId) {
    return {
      ok: false,
      skipped: true,
      reason: 'Athena schedule lock is missing required configuration or appointmentId.',
    };
  }

  const scheduleStatus = clean(overrides.athenaConfirmedStatus || 'CONFIRMED', 80);
  const notesTemplate = clean(overrides.athenaNoteTemplate, 500) || 'AuthPilot lock: payer ref {PayerReferenceId}';
  const note = normalizeSmsBody(
    notesTemplate.replace(/\{PayerReferenceId\}/g, clean(payerReferenceId, 120) || 'not_set'),
  );

  const rateThrottler = throttler || createAthenaTokenBucketThrottler();
  await rateThrottler.removeTokens(1);

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/${practiceId}/appointments/booked/${appointmentId}`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      status: scheduleStatus,
      notes: note,
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: clean(payload?.error || payload?.message || `Athena schedule lock failed (${response.status}).`, 500),
      raw: payload,
    };
  }

  return {
    ok: true,
    connector: 'athenahealth',
    appointmentId,
    status: scheduleStatus,
    note,
    raw: payload,
  };
}

export async function lockEpicSchedule({
  run = {},
  payerReferenceId = '',
  workflowConfig = {},
  tenantId = '',
  fetchImpl = fetch,
} = {}) {
  const vault = readHardenedSecretVault();
  const overrides = asObject(workflowConfig);

  const baseUrl =
    clean(overrides.epicBaseUrl, 1200) ||
    resolveFromVaultOrEnv({ key: 'EPIC_FHIR_BASE_URL', tenantId, overrides, vault });
  const accessToken =
    clean(overrides.epicAccessToken, 5000) ||
    resolveFromVaultOrEnv({ key: 'EPIC_ACCESS_TOKEN', tenantId, overrides, vault });
  const appointmentId = clean(
    run?.operatorPacket?.source_appointment_id || run?.intake?.appointmentId,
    120,
  );

  if (!baseUrl || !accessToken || !appointmentId) {
    return {
      ok: false,
      skipped: true,
      reason: 'Epic schedule lock is missing required configuration or appointmentId.',
    };
  }

  const epicPath = clean(overrides.epicScheduleUpdatePath, 400) || `/Appointment/${appointmentId}`;
  const scheduleStatus = clean(overrides.epicReadyStatus || 'booked', 80);
  const commentTemplate = clean(overrides.epicCommentTemplate, 500) || 'Ready for procedure. Payer reference: {PayerReferenceId}';
  const comment = normalizeSmsBody(
    commentTemplate.replace(/\{PayerReferenceId\}/g, clean(payerReferenceId, 120) || 'not_set'),
  );

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${epicPath}`, {
    method: clean(overrides.epicScheduleUpdateMethod, 10).toUpperCase() || 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/fhir+json',
      accept: 'application/fhir+json,application/json',
    },
    body: JSON.stringify({
      resourceType: 'Appointment',
      id: appointmentId,
      status: scheduleStatus,
      comment,
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: clean(payload?.issue?.[0]?.diagnostics || payload?.message || `Epic schedule lock failed (${response.status}).`, 500),
      raw: payload,
    };
  }

  return {
    ok: true,
    connector: 'epic',
    appointmentId,
    status: scheduleStatus,
    comment,
    raw: payload,
  };
}

async function createYottaClient(providedClient = null) {
  if (providedClient) {
    return providedClient;
  }

  const apiKey = clean(process.env.YOTTA_LABS_API_KEY, 5000);
  if (!apiKey) {
    return null;
  }

  try {
    const sdk = await dynamicImport('yotta-labs');
    const YottaLabs = sdk?.YottaLabs || sdk?.default?.YottaLabs || sdk?.default;
    if (!YottaLabs) {
      return null;
    }
    return new YottaLabs({
      apiKey,
      baseUrl: clean(process.env.YOTTA_LABS_BASE_URL, 1200),
    });
  } catch {
    return null;
  }
}

async function yottaTrack({ client = null, event = '', properties = {} } = {}) {
  if (!client) {
    return { ok: false, skipped: true, reason: 'missing_client' };
  }
  if (typeof client?.track === 'function') {
    return client.track({ event, properties });
  }
  if (typeof client?.events?.ingest === 'function') {
    return client.events.ingest({ event, properties });
  }
  return { ok: false, skipped: true, reason: 'unsupported_client' };
}

export async function runAutonomousProcedureFulfillment({
  run = {},
  tenantId = '',
  workflowConfig = {},
  patientReply = '',
  emitrrFetch = fetch,
  fireworksFetch = fetch,
  emrFetch = fetch,
  difyFetch = fetch,
  yottaClient = null,
} = {}) {
  const normalizedTenantId = clean(tenantId || run?.workspace?.id || run?.intake?.practiceId, 120) || 'default';
  const states = [];
  const governance = [];

  states.push({ state: 'approved', at: nowIso(), ok: true });
  governance.push(
    await emitDifyFulfillmentStateTransition({
      tenantId: normalizedTenantId,
      workflowConfig,
      run,
      state: 'approved',
      metadata: {
        procedureCode: clean(run?.operatorPacket?.procedure_code || run?.intake?.procedureCode, 40),
      },
      fetchImpl: difyFetch,
    }),
  );

  const nudge = await dispatchPatientNudge({
    run,
    tenantId: normalizedTenantId,
    workflowConfig,
    fetchImpl: emitrrFetch,
  });
  states.push({
    state: 'patient_nudge',
    at: nowIso(),
    ok: nudge.ok === true,
    detail: clean(nudge.reason || nudge.status, 240),
  });
  governance.push(
    await emitDifyFulfillmentStateTransition({
      tenantId: normalizedTenantId,
      workflowConfig,
      run,
      state: 'patient_nudge',
      metadata: {
        ok: nudge.ok === true,
        messageId: clean(nudge.messageId, 120),
      },
      fetchImpl: difyFetch,
    }),
  );

  const readiness = await analyzePatientReadinessWithFireworks({
    replyText: patientReply,
    run,
    fetchImpl: fireworksFetch,
    workflowConfig,
    tenantId: normalizedTenantId,
  });

  states.push({
    state: 'prep_verification',
    at: nowIso(),
    ok: readiness.ok === true,
    detail: clean(readiness.reason, 280),
    barrierDetected: readiness.barrierDetected === true,
  });
  governance.push(
    await emitDifyFulfillmentStateTransition({
      tenantId: normalizedTenantId,
      workflowConfig,
      run,
      state: 'prep_verification',
      metadata: {
        barrierDetected: readiness.barrierDetected === true,
        readiness: clean(readiness.readiness, 80),
      },
      fetchImpl: difyFetch,
    }),
  );

  if (readiness.barrierDetected) {
    return {
      ok: true,
      halted: true,
      haltReason: 'prep_barrier_detected',
      states,
      governance,
      nudge,
      readiness,
      scheduleLock: null,
      revenueLock: null,
    };
  }

  const connector = clean(
    run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.source_system || 'athenahealth',
    80,
  ).toLowerCase();

  const payerReferenceId = clean(
    run?.operatorPacket?.emr_sync?.payer_reference_id || run?.emrSync?.payer_reference_id || '',
    120,
  );

  const scheduleLock = connector.includes('epic')
    ? await lockEpicSchedule({
      run,
      payerReferenceId,
      workflowConfig,
      tenantId: normalizedTenantId,
      fetchImpl: emrFetch,
    })
    : await lockAthenaAppointment({
      run,
      payerReferenceId,
      workflowConfig,
      tenantId: normalizedTenantId,
      fetchImpl: emrFetch,
    });

  states.push({
    state: 'schedule_lock',
    at: nowIso(),
    ok: scheduleLock.ok === true,
    detail: clean(scheduleLock.reason || scheduleLock.status, 280),
  });
  governance.push(
    await emitDifyFulfillmentStateTransition({
      tenantId: normalizedTenantId,
      workflowConfig,
      run,
      state: 'schedule_lock',
      metadata: {
        ok: scheduleLock.ok === true,
        connector: clean(scheduleLock.connector || connector, 80),
        status: clean(scheduleLock.status, 80),
      },
      fetchImpl: difyFetch,
    }),
  );

  const cptCode = normalizeCode(run?.operatorPacket?.procedure_code || run?.intake?.procedureCode || '');
  const procedureValueUsd = estimateProcedureValueUsd(cptCode);
  const yotta = await createYottaClient(yottaClient);

  const revenueLock = await yottaTrack({
    client: yotta,
    event: 'authpilot.procedure_revenue_locked',
    properties: {
      runId: clean(run?.appRunId, 120),
      tenantId: normalizedTenantId,
      cptCode,
      procedureValueUsd,
      payerReferenceId,
      lockedAt: nowIso(),
    },
  }).catch(() => ({ ok: false, skipped: true, reason: 'yotta_track_failed' }));

  return {
    ok: true,
    halted: false,
    states,
    governance,
    nudge,
    readiness,
    scheduleLock,
    revenueLock,
    procedureValueUsd,
  };
}

export class FulfillmentOrchestrator {
  constructor({ runFn = runAutonomousProcedureFulfillment } = {}) {
    this.runFn = typeof runFn === 'function' ? runFn : runAutonomousProcedureFulfillment;
  }

  async run({ run = {}, tenantId = '', workflowConfig = {}, patientReply = '', deps = {} } = {}) {
    return this.runFn({
      run,
      tenantId,
      workflowConfig,
      patientReply,
      emitrrFetch: deps.emitrrFetch || fetch,
      fireworksFetch: deps.fireworksFetch || fetch,
      emrFetch: deps.emrFetch || fetch,
      difyFetch: deps.difyFetch || fetch,
      yottaClient: deps.yottaClient || null,
    });
  }
}

let fulfillmentOrchestratorSingleton = null;

export function getFulfillmentOrchestrator({ runFn = null } = {}) {
  if (!fulfillmentOrchestratorSingleton) {
    fulfillmentOrchestratorSingleton = new FulfillmentOrchestrator({
      runFn: runFn || runAutonomousProcedureFulfillment,
    });
  }
  return fulfillmentOrchestratorSingleton;
}

export function resetFulfillmentOrchestratorForTest() {
  fulfillmentOrchestratorSingleton = null;
}
