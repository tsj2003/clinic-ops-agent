import { randomUUID } from 'crypto';

import { processClinicalRecord } from '../ai/fireworks-client.js';
import { getRelevantPayerRules } from '../ai/mixedbread-client.js';
import { emitObservabilityEvent } from '../observability.js';
import { redactFreeText } from '../privacy.js';
import { listRunsForAnalytics, saveRun } from '../run-store.js';

const HIGH_SIGNAL_AUTH_CPTS = new Set(['27447', '27130', '72148', '29881']);
const ATHENA_QPS_LIMIT = 150;
const DEFAULT_TIME_RECOVERY_MINUTES = 8;

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

function normalizeDate(value = '') {
  const raw = clean(value, 80);
  if (!raw) {
    return '';
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return raw;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function plusDaysIso(days = 3) {
  const ms = Date.now() + Math.max(0, asNumber(days, 3)) * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, asNumber(ms, 0))));
}

function normalizeCode(value = '') {
  return clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePayerId(value = '') {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSafeLogText(value = '') {
  return redactFreeText(clean(value, 4000), { maxLength: 4000 });
}

function resolveBoolean(value, fallback = false) {
  const normalized = clean(value, 20).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}

function addDaysIso(baseDateIso = '', days = 0) {
  const base = normalizeDate(baseDateIso) || new Date().toISOString().slice(0, 10);
  const parsed = Date.parse(`${base}T00:00:00.000Z`);
  const ms = parsed + Math.max(0, asNumber(days, 0)) * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function buildWindowDates({ startDate = '', windowDays = 3 } = {}) {
  const start = normalizeDate(startDate) || plusDaysIso(3);
  const inclusiveEnd = addDaysIso(start, Math.max(1, asNumber(windowDays, 3)) - 1);
  const exclusiveEnd = addDaysIso(start, Math.max(1, asNumber(windowDays, 3)));
  return {
    startDate: start,
    endDateInclusive: inclusiveEnd,
    endDateExclusive: exclusiveEnd,
  };
}

function readHardenedSecretVault() {
  const raw = clean(process.env.HARDENED_SECRET_VAULT, 120_000);
  if (!raw) {
    return {};
  }
  return asObject(parseJsonSafe(raw));
}

function readVaultValue({ key = '', tenantId = '', vault = {} } = {}) {
  const normalizedKey = clean(key, 120);
  const normalizedTenant = clean(tenantId, 120);
  const vaultObject = asObject(vault);

  const direct = clean(vaultObject[normalizedKey], 5000);
  if (direct) {
    return direct;
  }

  const tenantSection = asObject(vaultObject.tenants);
  const tenant = asObject(tenantSection[normalizedTenant]);
  const tenantValue = clean(tenant[normalizedKey], 5000);
  if (tenantValue) {
    return tenantValue;
  }

  const defaults = asObject(vaultObject.default);
  return clean(defaults[normalizedKey], 5000);
}

class TokenBucketThrottler {
  constructor({
    ratePerSecond = ATHENA_QPS_LIMIT,
    burstCapacity = ATHENA_QPS_LIMIT,
    now = () => Date.now(),
    sleepFn = sleep,
  } = {}) {
    this.ratePerSecond = Math.max(1, asNumber(ratePerSecond, ATHENA_QPS_LIMIT));
    this.burstCapacity = Math.max(1, asNumber(burstCapacity, ATHENA_QPS_LIMIT));
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.sleepFn = typeof sleepFn === 'function' ? sleepFn : sleep;

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

function createAthenaTokenBucketThrottler() {
  return new TokenBucketThrottler({
    ratePerSecond: asNumber(process.env.ATHENAHEALTH_QPS_LIMIT, ATHENA_QPS_LIMIT),
    burstCapacity: asNumber(process.env.ATHENAHEALTH_QPS_BURST, ATHENA_QPS_LIMIT),
  });
}

function isEncryptedReference(value = '') {
  return /^(enc:|aws-sm:\/\/|gcp-sm:\/\/|azure-kv:\/\/|vault:\/\/|sm:\/\/)/i.test(clean(value));
}

function resolveSecureConfigValue({
  key = '',
  vaultRefKey = '',
  required = false,
  tenantId = '',
  tenantOverrides = {},
  vault = null,
} = {}) {
  const effectiveVault = asObject(vault || readHardenedSecretVault());
  const overrideObj = asObject(tenantOverrides);
  const fromVault = readVaultValue({ key, tenantId, vault: effectiveVault });
  const fromVaultRef = readVaultValue({ key: vaultRefKey, tenantId, vault: effectiveVault });

  const direct =
    clean(overrideObj[key], 5000) ||
    clean(fromVault, 5000) ||
    clean(process.env[key], 5000);
  const vaultRef =
    clean(overrideObj[vaultRefKey], 5000) ||
    clean(fromVaultRef, 5000) ||
    clean(process.env[vaultRefKey], 5000);
  const production = clean(process.env.NODE_ENV, 40).toLowerCase() === 'production';

  if (production && direct && !isEncryptedReference(direct) && !vaultRef && !fromVault) {
    throw new Error(`${key} must be sourced from HARDENED_SECRET_VAULT in production.`);
  }

  if (vaultRef) {
    return {
      value: '',
      source: 'vault-reference',
      reference: vaultRef,
      unresolved: true,
    };
  }

  if (direct) {
    return {
      value: direct,
      source: fromVault ? 'hardened-secret-vault' : isEncryptedReference(direct) ? 'vault-reference' : 'env',
      reference: isEncryptedReference(direct) ? direct : '',
      unresolved: isEncryptedReference(direct),
    };
  }

  if (required) {
    throw new Error(`Missing required polling configuration: ${key}`);
  }

  return {
    value: '',
    source: 'missing',
    reference: '',
    unresolved: false,
  };
}

function buildEmrPollingConfig({ tenantId = '', tenantOverrides = null } = {}) {
  const overrides = asObject(tenantOverrides);
  const vault = readHardenedSecretVault();

  const athenaBase = resolveSecureConfigValue({
    key: 'ATHENAHEALTH_BASE_URL',
    vaultRefKey: 'ATHENAHEALTH_BASE_URL_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });
  const athenaPractice = resolveSecureConfigValue({
    key: 'ATHENAHEALTH_PRACTICE_ID',
    vaultRefKey: 'ATHENAHEALTH_PRACTICE_ID_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });
  const athenaDepartment = resolveSecureConfigValue({
    key: 'ATHENAHEALTH_DEPARTMENT_ID',
    vaultRefKey: 'ATHENAHEALTH_DEPARTMENT_ID_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });
  const athenaToken = resolveSecureConfigValue({
    key: 'ATHENAHEALTH_ACCESS_TOKEN',
    vaultRefKey: 'ATHENAHEALTH_ACCESS_TOKEN_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });

  const epicBase = resolveSecureConfigValue({
    key: 'EPIC_FHIR_BASE_URL',
    vaultRefKey: 'EPIC_FHIR_BASE_URL_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });
  const epicDepartment = resolveSecureConfigValue({
    key: 'EPIC_DEPARTMENT_ID',
    vaultRefKey: 'EPIC_DEPARTMENT_ID_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });
  const epicToken = resolveSecureConfigValue({
    key: 'EPIC_ACCESS_TOKEN',
    vaultRefKey: 'EPIC_ACCESS_TOKEN_VAULT_REF',
    tenantId,
    tenantOverrides: overrides,
    vault,
  });

  const practiceId = clean(overrides.practiceId || overrides.PRACTICE_ID || athenaPractice.value, 120);

  return {
    tenantId: clean(tenantId, 120) || clean(practiceId, 120) || 'default',
    athena: {
      baseUrl: clean(athenaBase.value, 1200),
      practiceId: clean(athenaPractice.value, 120),
      departmentId: clean(athenaDepartment.value, 120),
      accessToken: clean(athenaToken.value, 5000),
      unresolvedSecrets:
        athenaBase.unresolved ||
        athenaPractice.unresolved ||
        athenaDepartment.unresolved ||
        athenaToken.unresolved,
    },
    epic: {
      baseUrl: clean(epicBase.value, 1200),
      departmentId: clean(epicDepartment.value, 120),
      accessToken: clean(epicToken.value, 5000),
      unresolvedSecrets:
        epicBase.unresolved || epicDepartment.unresolved || epicToken.unresolved,
    },
    practice: {
      practiceId,
      organizationId: clean(
        overrides.organizationId ||
          overrides.ATHENAHEALTH_ORGANIZATION_ID ||
          overrides.EPIC_ORGANIZATION_ID ||
          process.env.ATHENAHEALTH_ORGANIZATION_ID ||
          process.env.EPIC_ORGANIZATION_ID,
        120,
      ),
      departmentId: clean(overrides.departmentId || athenaDepartment.value || epicDepartment.value, 120),
    },
  };
}

function normalizeAthenaAppointment(item = {}) {
  const source = asObject(item);
  const cptCandidates = [
    source.procedurecode,
    source.procedureCode,
    source.cpt,
    source.cptcode,
    source.reasoncode,
    ...(asArray(source.procedurecodes)),
    ...(asArray(source.procedures).map((entry) => asObject(entry).code || asObject(entry).cpt)),
  ];

  const cptCodes = cptCandidates
    .map((value) => normalizeCode(value))
    .filter(Boolean)
    .slice(0, 10);

  return {
    sourceSystem: 'athenahealth',
    appointmentId: clean(source.appointmentid || source.appointmentId || source.id, 120),
    encounterId: clean(source.encounterid || source.encounterId, 120),
    patientId: clean(source.patientid || source.patientId, 120),
    patientFirstName: clean(source.firstname || source.firstName, 120),
    patientLastName: clean(source.lastname || source.lastName, 120),
    payerName: clean(source.payername || source.insurance || source.payerName, 120),
    providerName: clean(source.providername || source.providerName, 120),
    providerId: clean(source.providerid || source.providerId, 120),
    departmentId: clean(source.departmentid || source.departmentId, 120),
    appointmentDate: normalizeDate(source.date || source.start || source.starttime || source.appointmentdate),
    cptCodes,
    primaryCptCode: cptCodes[0] || '',
    clinicalRecordImageBase64: clean(
      source.clinicalRecordImageBase64 || source.clinical_record_image_base64,
      2_500_000,
    ),
    chartSummary: clean(source.chartSummary || source.clinicalsummary || source.note, 6000),
    raw: source,
  };
}

function normalizeEpicAppointment(item = {}) {
  const source = asObject(item);

  const coding = asArray(asObject(source.serviceType).coding);
  const appointmentTypeCodes = asArray(asObject(source.appointmentType).coding);
  const reasonCodes = asArray(source.reasonCode)
    .flatMap((entry) => asArray(asObject(entry).coding).map((codingItem) => asObject(codingItem).code));

  const cptCandidates = [
    ...coding.map((entry) => asObject(entry).code),
    ...appointmentTypeCodes.map((entry) => asObject(entry).code),
    ...reasonCodes,
  ];

  const cptCodes = cptCandidates
    .map((value) => normalizeCode(value))
    .filter(Boolean)
    .slice(0, 10);

  const patientRef = clean(asObject(source.participant?.[0]?.actor).reference, 300);

  return {
    sourceSystem: 'epic',
    appointmentId: clean(source.id, 120),
    encounterId: clean(asObject(source.encounter).reference, 120),
    patientId: clean(patientRef.replace(/^Patient\//i, ''), 120),
    patientFirstName: '',
    patientLastName: '',
    payerName: clean(asObject(source.extension?.find?.(() => false)).payerName, 120),
    providerName: clean(asObject(source.participant?.[1]?.actor).display, 120),
    providerId: clean(asObject(source.participant?.[1]?.actor).reference, 120),
    departmentId: clean(asObject(source.serviceProvider).reference, 120),
    appointmentDate: normalizeDate(source.start || source.created),
    cptCodes,
    primaryCptCode: cptCodes[0] || '',
    clinicalRecordImageBase64: '',
    chartSummary: '',
    raw: source,
  };
}

function getAppointmentCodes(appointmentOrCode = '') {
  if (typeof appointmentOrCode === 'string') {
    return [normalizeCode(appointmentOrCode)].filter(Boolean);
  }

  const appointment = asObject(appointmentOrCode);
  return [...asArray(appointment.cptCodes), appointment.primaryCptCode, appointment.procedureCode]
    .map((value) => normalizeCode(value))
    .filter(Boolean);
}

export function requiresAuth(appointmentOrCode = '') {
  const codes = getAppointmentCodes(appointmentOrCode);
  return codes.some((code) => HIGH_SIGNAL_AUTH_CPTS.has(code));
}

function redactAppointmentForAgents(appointment = {}) {
  const source = asObject(appointment);
  return {
    ...source,
    chartSummary: normalizeSafeLogText(source.chartSummary),
    raw: {
      ...asObject(source.raw),
      specialtyPriorAuthRules: normalizeSafeLogText(asObject(source.raw).specialtyPriorAuthRules),
      note: normalizeSafeLogText(asObject(source.raw).note, 6000),
      chartSummary: normalizeSafeLogText(asObject(source.raw).chartSummary, 6000),
    },
  };
}

export async function pollAthenaAppointments({
  startDate = '',
  endDate = '',
  fetchImpl = fetch,
  config = null,
  throttler = null,
} = {}) {
  const effectiveConfig = config || buildEmrPollingConfig().athena;
  if (!effectiveConfig?.baseUrl || !effectiveConfig?.practiceId || !effectiveConfig?.accessToken) {
    return {
      ok: false,
      skipped: true,
      reason: effectiveConfig?.unresolvedSecrets
        ? 'Athena polling configuration references HARDENED_SECRET_VAULT but runtime resolver is unavailable.'
        : 'Athena polling configuration is incomplete.',
      appointments: [],
    };
  }

  const rateThrottler = throttler || createAthenaTokenBucketThrottler();
  const baseUrl = clean(effectiveConfig.baseUrl, 1200).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/${clean(effectiveConfig.practiceId, 80)}/appointments`;
  const window = buildWindowDates({ startDate, windowDays: 3 });
  const effectiveEndDate = normalizeDate(endDate) || window.endDateInclusive;

  const params = new URLSearchParams({
    startdate: window.startDate,
    enddate: effectiveEndDate,
    ...(clean(effectiveConfig.departmentId, 80)
      ? { departmentid: clean(effectiveConfig.departmentId, 80) }
      : {}),
  });

  await rateThrottler.removeTokens(1);
  const response = await fetchImpl(`${endpoint}?${params.toString()}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${clean(effectiveConfig.accessToken, 5000)}`,
      accept: 'application/json',
    },
  });

  const payload = asObject(parseJsonSafe(await response.text()));

  if (!response.ok) {
    return {
      ok: false,
      skipped: true,
      reason: clean(payload?.error || payload?.message || `Athena polling failed (${response.status}).`, 500),
      appointments: [],
    };
  }

  const appointments = asArray(payload.appointments || payload).map((item) => normalizeAthenaAppointment(item));
  return {
    ok: true,
    skipped: false,
    windowStartDate: window.startDate,
    windowEndDate: effectiveEndDate,
    appointments,
  };
}

export async function pollEpicAppointments({
  startDate = '',
  endDate = '',
  fetchImpl = fetch,
  config = null,
} = {}) {
  const effectiveConfig = config || buildEmrPollingConfig().epic;
  if (!effectiveConfig?.baseUrl || !effectiveConfig?.accessToken) {
    return {
      ok: false,
      skipped: true,
      reason: effectiveConfig?.unresolvedSecrets
        ? 'Epic polling configuration references HARDENED_SECRET_VAULT but runtime resolver is unavailable.'
        : 'Epic polling configuration is incomplete.',
      appointments: [],
    };
  }

  const baseUrl = clean(effectiveConfig.baseUrl, 1200).replace(/\/+$/, '');
  const window = buildWindowDates({ startDate, windowDays: 3 });
  const effectiveEndExclusive = normalizeDate(endDate) || window.endDateExclusive;

  const query = new URLSearchParams({
    date: `ge${window.startDate}`,
  });
  query.append('date', `lt${effectiveEndExclusive}`);

  const getUrl = `${baseUrl}/Appointment?${query.toString()}`;
  const response = await fetchImpl(getUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${clean(effectiveConfig.accessToken, 5000)}`,
      accept: 'application/fhir+json,application/json',
    },
  });

  const payload = asObject(parseJsonSafe(await response.text()));

  if (!response.ok) {
    return {
      ok: false,
      skipped: true,
      reason: clean(payload?.issue?.[0]?.diagnostics || payload?.message || `Epic polling failed (${response.status}).`, 500),
      appointments: [],
    };
  }

  const entries = asArray(payload.entry).map((entry) => asObject(entry).resource).filter(Boolean);
  const appointments = entries.map((entry) => normalizeEpicAppointment(entry));

  return {
    ok: true,
    skipped: false,
    windowStartDate: window.startDate,
    windowEndDate: effectiveEndExclusive,
    appointments,
  };
}

function collectExistingEncounterKeys(runs = []) {
  const keys = new Set();
  for (const run of asArray(runs)) {
    const sourceSystem = clean(run?.operatorPacket?.source_system, 40).toLowerCase();
    const appointmentId = clean(
      run?.operatorPacket?.source_appointment_id || run?.intake?.appointmentId,
      120,
    );
    if (sourceSystem && appointmentId) {
      keys.add(`${sourceSystem}:${appointmentId}`);
    }
  }
  return keys;
}

async function evaluateRagReadiness({ appointment = {}, extraction = null } = {}) {
  const cptCode = clean(
    extraction?.extraction?.procedureCodes?.[0] ||
      extraction?.extraction?.procedureCode ||
      appointment.primaryCptCode,
    40,
  );
  const payerId = normalizePayerId(appointment.payerName);

  if (!cptCode || !payerId) {
    return {
      status: 'CLINICAL_GAP_DETECTED',
      hasGap: true,
      reason: 'Missing CPT or payer context for RAG readiness evaluation.',
      retrieval: null,
    };
  }

  try {
    const retrieval = await getRelevantPayerRules(cptCode, payerId, {
      clinicalContext: clean(appointment.chartSummary || extraction?.extraction?.clinicalJustificationText, 1000),
      topK: 8,
    });

    const hasPolicy = Boolean(clean(retrieval?.topOne?.id, 180));
    const hasClinicalEvidence = Boolean(
      clean(extraction?.extraction?.clinicalJustificationText || appointment.chartSummary, 200),
    );
    const hasGap = !hasPolicy || !hasClinicalEvidence;

    return {
      status: hasGap ? 'CLINICAL_GAP_DETECTED' : 'SUBMITTED_PENDING_PROOF',
      hasGap,
      reason: hasGap
        ? !hasPolicy
          ? 'No payer policy match found for the appointment CPT.'
          : 'Clinical evidence is missing for pre-auth packet generation.'
        : 'High-signal CPT matched and evidence is available for proactive packet prep.',
      retrieval,
    };
  } catch (error) {
    return {
      status: 'CLINICAL_GAP_DETECTED',
      hasGap: true,
      reason: error instanceof Error ? error.message : 'RAG readiness evaluation failed.',
      retrieval: null,
    };
  }
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

function buildZeroTouchRun({
  appointment = {},
  extraction = null,
  readiness = null,
  practiceId = '',
  departmentId = '',
  organizationId = '',
} = {}) {
  const now = nowIso();
  const runId = randomUUID();
  const cptCode = clean(
    extraction?.extraction?.procedureCodes?.[0] ||
      extraction?.extraction?.procedureCode ||
      appointment.primaryCptCode,
    40,
  );
  const chartSummary = clean(
    extraction?.extraction?.clinicalJustificationText || appointment.chartSummary,
    6000,
  );

  const lifecycleStatus = clean(readiness?.status, 80) === 'SUBMITTED_PENDING_PROOF'
    ? 'submitted'
    : 'collecting_evidence';

  return {
    appRunId: runId,
    status: 'completed',
    mode: 'zero_touch_polling',
    startedAt: now,
    completedAt: now,
    workflow: {
      name: 'Zero-Touch EMR Polling Intake',
      url: '',
      goal: 'Autonomously ingest future appointments requiring prior authorization.',
      contactName: '',
      contactUrl: '',
      contactGoal: '',
      caseId: clean(`${appointment.sourceSystem}-${appointment.appointmentId}`, 120),
      procedure: clean(cptCode || appointment.primaryCptCode, 120),
    },
    workspace: {
      id: clean(practiceId || appointment.raw?.practiceid || 'practice-zero-touch', 120),
      name: clean(practiceId || 'Zero-Touch Intake', 120),
    },
    intake: {
      patientId: clean(appointment.patientId, 120),
      firstName: clean(appointment.patientFirstName, 120),
      lastName: clean(appointment.patientLastName, 120),
      memberId: '',
      dob: '',
      procedureCode: clean(cptCode, 40),
      serviceDate: normalizeDate(appointment.appointmentDate),
      diagnosis: clean(extraction?.extraction?.diagnosisCodes?.[0] || '', 120),
      chartSummary: normalizeSafeLogText(chartSummary),
      payerName: clean(appointment.payerName, 120),
      lineOfBusiness: '',
      memberState: '',
      specialty: '',
      departmentId: clean(departmentId || appointment.departmentId, 120),
      organizationId: clean(organizationId, 120),
      practiceId: clean(practiceId, 120),
      appointmentId: clean(appointment.appointmentId, 120),
      sourceSystem: clean(appointment.sourceSystem, 40),
    },
    proof: {
      runtimeMode: 'zero_touch_polling',
      policy: { status: 'pending', runId: '', sourceUrl: '', streamUrl: '', error: '' },
      contact: { status: 'pending', runId: '', sourceUrl: '', streamUrl: '', error: '' },
    },
    readiness: {
      ready: readiness?.hasGap !== true,
      confidence: readiness?.hasGap ? 60 : 88,
      summary: clean(readiness?.reason, 1000),
      supporting_evidence: readiness?.hasGap
        ? []
        : ['High-signal CPT detected from upcoming appointment schedule'],
      missing_evidence: readiness?.hasGap
        ? ['Clinical packet has incomplete evidence for immediate submission']
        : [],
      policy_name: clean(readiness?.retrieval?.topOne?.title, 220),
    },
    operatorPacket: {
      case_id: clean(`${appointment.sourceSystem}-${appointment.appointmentId}`, 120),
      payer_name: clean(appointment.payerName, 120),
      diagnosis: clean(extraction?.extraction?.diagnosisCodes?.[0] || '', 120),
      procedure: clean(cptCode, 120),
      procedure_code: clean(cptCode, 40),
      service_date: normalizeDate(appointment.appointmentDate),
      submission_ready: readiness?.hasGap !== true,
      recommended_action: readiness?.hasGap ? 'collect_missing_evidence' : 'submit_to_portal',
      source_system: clean(appointment.sourceSystem, 40),
      source_appointment_id: clean(appointment.appointmentId, 120),
      source_encounter_id: clean(appointment.encounterId, 120),
      emr_sync: {
        connector: clean(appointment.sourceSystem, 40),
        status: clean(readiness?.status, 80) || 'CLINICAL_GAP_DETECTED',
        operation: 'zero_touch_ingestion',
        packet_id: clean(`${appointment.sourceSystem}-${appointment.appointmentId}`, 120),
        patient_id: clean(appointment.patientId, 120),
        provider_id: clean(appointment.providerId, 120),
        department_id: clean(departmentId || appointment.departmentId, 120),
        last_synced_at: now,
      },
    },
    caseLifecycle: {
      status: lifecycleStatus,
      notes: clean(readiness?.reason, 1000),
      updatedAt: now,
      history: [
        {
          status: lifecycleStatus,
          note: clean(`Zero-touch ingestion created from ${appointment.sourceSystem} appointment ${appointment.appointmentId}.`, 1000),
          actor: 'emr-polling-service',
          source: 'zero_touch_ingestion',
          createdAt: now,
        },
      ],
    },
    metrics: {
      totalSteps: 1,
      eventCount: 1,
      elapsedSeconds: 0,
    },
    logs: {
      thinking: [],
      execution: [],
    },
  };
}

export async function runZeroTouchEmrPolling({
  tenantId = '',
  tenantOverrides = null,
  includeAthena = true,
  includeEpic = true,
  pollAthena = null,
  pollEpic = null,
  fireworkExtractor = null,
  ragEvaluator = null,
  listRuns = null,
  saveRunFn = null,
  emitEventFn = null,
  yottaClient = null,
  startDate = '',
  endDate = '',
  jitterMs = null,
} = {}) {
  const config = buildEmrPollingConfig({ tenantId, tenantOverrides });
  const athenaPoller = typeof pollAthena === 'function' ? pollAthena : pollAthenaAppointments;
  const epicPoller = typeof pollEpic === 'function' ? pollEpic : pollEpicAppointments;
  const extractor = typeof fireworkExtractor === 'function' ? fireworkExtractor : processClinicalRecord;
  const readinessEvaluator =
    typeof ragEvaluator === 'function' ? ragEvaluator : evaluateRagReadiness;
  const listRunsFn = typeof listRuns === 'function' ? listRuns : listRunsForAnalytics;
  const persistRun = typeof saveRunFn === 'function' ? saveRunFn : saveRun;
  const emitEvent = typeof emitEventFn === 'function' ? emitEventFn : emitObservabilityEvent;

  const runSnapshot = await listRunsFn(3000);
  const existingKeys = collectExistingEncounterKeys(runSnapshot?.runs || []);
  const yotta = await createYottaClient(yottaClient);

  const athenaResult = includeAthena
    ? await athenaPoller({
      startDate,
      endDate,
      config: config.athena,
      throttler: createAthenaTokenBucketThrottler(),
    })
    : { ok: true, skipped: true, appointments: [] };
  const epicResult = includeEpic
    ? await epicPoller({ startDate, endDate, config: config.epic })
    : { ok: true, skipped: true, appointments: [] };

  const candidates = [
    ...asArray(athenaResult.appointments),
    ...asArray(epicResult.appointments),
  ];

  const authCandidates = candidates.filter((appointment) => requiresAuth(appointment));

  const results = [];
  const interRequestDelayMs =
    jitterMs !== null
      ? Math.max(0, asNumber(jitterMs, 0))
      : Math.max(1, Math.ceil(1000 / ATHENA_QPS_LIMIT));

  for (let index = 0; index < authCandidates.length; index += 1) {
    const appointment = authCandidates[index];
    const dedupeKey = `${clean(appointment.sourceSystem, 40).toLowerCase()}:${clean(appointment.appointmentId, 120)}`;
    const duplicate = existingKeys.has(dedupeKey);

    if (duplicate) {
      await emitEvent({
        service: 'authpilot-web',
        signal: 'zero_touch_ingestion_event',
        tenantId: clean(config.tenantId, 120),
        sourceSystem: clean(appointment.sourceSystem, 40),
        appointmentId: clean(appointment.appointmentId, 120),
        cptCode: clean(appointment.primaryCptCode, 40),
        duplicate: true,
        createdRun: false,
        physician_time_recovered_minutes: DEFAULT_TIME_RECOVERY_MINUTES,
        timestamp: nowIso(),
      }).catch(() => null);

      await yottaTrack({
        client: yotta,
        event: 'authpilot.recovered_physician_time',
        properties: {
          tenantId: clean(config.tenantId, 120),
          sourceSystem: clean(appointment.sourceSystem, 40),
          appointmentId: clean(appointment.appointmentId, 120),
          duplicate: true,
          minutesRecovered: DEFAULT_TIME_RECOVERY_MINUTES,
        },
      }).catch(() => null);

      results.push({
        sourceSystem: appointment.sourceSystem,
        appointmentId: appointment.appointmentId,
        cptCode: appointment.primaryCptCode,
        duplicate: true,
        createdRun: false,
        status: 'duplicate_skipped',
      });

      continue;
    }

    const sanitizedForAgents = redactAppointmentForAgents(appointment);
    let extraction = null;
    let extractionError = '';
    try {
      extraction = await extractor({
        imageBase64: clean(sanitizedForAgents.clinicalRecordImageBase64, 2_500_000),
        specialtyPriorAuthRules: clean(
          sanitizedForAgents.raw?.specialtyPriorAuthRules || sanitizedForAgents.chartSummary,
          10_000,
        ),
      });
    } catch (error) {
      extractionError = error instanceof Error ? error.message : 'Extraction failed.';
    }

    const readiness = await readinessEvaluator({
      appointment: sanitizedForAgents,
      extraction,
      extractionError,
    });

    const run = buildZeroTouchRun({
      appointment,
      extraction,
      readiness,
      practiceId: config.practice.practiceId,
      departmentId: config.practice.departmentId,
      organizationId: config.practice.organizationId,
    });

    const saved = await persistRun(run);
    existingKeys.add(dedupeKey);

    await emitEvent({
      service: 'authpilot-web',
      signal: 'zero_touch_ingestion_event',
      tenantId: clean(config.tenantId, 120),
      sourceSystem: clean(appointment.sourceSystem, 40),
      appointmentId: clean(appointment.appointmentId, 120),
      runId: clean(saved?.run?.appRunId || run.appRunId, 120),
      cptCode: clean(appointment.primaryCptCode, 40),
      duplicate: false,
      createdRun: true,
      initial_status: clean(readiness?.status, 80),
      physician_time_recovered_minutes: DEFAULT_TIME_RECOVERY_MINUTES,
      timestamp: nowIso(),
      extraction_error: normalizeSafeLogText(extractionError),
      rag_reason: normalizeSafeLogText(readiness?.reason),
    }).catch(() => null);

    await yottaTrack({
      client: yotta,
      event: 'authpilot.recovered_physician_time',
      properties: {
        tenantId: clean(config.tenantId, 120),
        runId: clean(saved?.run?.appRunId || run.appRunId, 120),
        sourceSystem: clean(appointment.sourceSystem, 40),
        appointmentId: clean(appointment.appointmentId, 120),
        minutesRecovered: DEFAULT_TIME_RECOVERY_MINUTES,
        cptCode: clean(appointment.primaryCptCode, 40),
      },
    }).catch(() => null);

    results.push({
      sourceSystem: appointment.sourceSystem,
      appointmentId: appointment.appointmentId,
      cptCode: appointment.primaryCptCode,
      duplicate: false,
      createdRun: true,
      runId: saved?.run?.appRunId || run.appRunId,
      status: clean(readiness?.status, 80),
    });

    if (index < authCandidates.length - 1) {
      await sleep(interRequestDelayMs);
    }
  }

  return {
    ok: true,
    tenantId: clean(config.tenantId, 120),
    windowStartDate: buildWindowDates({ startDate, windowDays: 3 }).startDate,
    windowEndDate: normalizeDate(endDate) || buildWindowDates({ startDate, windowDays: 3 }).endDateInclusive,
    scanned: candidates.length,
    highSignalMatches: authCandidates.length,
    createdRuns: results.filter((item) => item.createdRun).length,
    duplicates: results.filter((item) => item.duplicate).length,
    athena: {
      ok: athenaResult.ok === true,
      skipped: athenaResult.skipped === true,
      reason: clean(athenaResult.reason, 300),
      appointments: asArray(athenaResult.appointments).length,
    },
    epic: {
      ok: epicResult.ok === true,
      skipped: epicResult.skipped === true,
      reason: clean(epicResult.reason, 300),
      appointments: asArray(epicResult.appointments).length,
    },
    results,
  };
}

export class PollingOrchestrator {
  constructor({
    runFn = runZeroTouchEmrPolling,
    defaultIntervalMs = 15 * 60 * 1000,
  } = {}) {
    this.runFn = typeof runFn === 'function' ? runFn : runZeroTouchEmrPolling;
    this.defaultIntervalMs = Math.max(1000, asNumber(defaultIntervalMs, 15 * 60 * 1000));
    this.tenants = new Map();
    this.running = false;
  }

  registerTenant({
    tenantId = '',
    intervalMs = null,
    includeAthena = true,
    includeEpic = true,
    tenantOverrides = null,
    startDate = '',
    endDate = '',
  } = {}) {
    const id = clean(tenantId, 120);
    if (!id) {
      throw new Error('tenantId is required for polling orchestrator registration.');
    }

    const definition = {
      tenantId: id,
      includeAthena: resolveBoolean(includeAthena, true),
      includeEpic: resolveBoolean(includeEpic, true),
      tenantOverrides: asObject(tenantOverrides),
      startDate: clean(startDate, 40),
      endDate: clean(endDate, 40),
      intervalMs: Math.max(1000, asNumber(intervalMs, this.defaultIntervalMs)),
      timerId: null,
      lastResult: null,
      lastRunAt: '',
      lastError: '',
      inFlight: false,
    };

    this.tenants.set(id, definition);
    if (this.running) {
      this.#startTenantTimer(id);
    }

    return { ok: true, tenantId: id };
  }

  async runTenantCycle(tenantId = '', overrides = {}) {
    const id = clean(tenantId, 120);
    const definition = this.tenants.get(id);
    if (!definition) {
      return {
        ok: false,
        skipped: true,
        reason: `Unknown tenantId: ${id}`,
      };
    }

    if (definition.inFlight) {
      return {
        ok: false,
        skipped: true,
        reason: 'Tenant poll already in progress.',
      };
    }

    definition.inFlight = true;
    definition.lastRunAt = nowIso();

    try {
      const result = await this.runFn({
        tenantId: definition.tenantId,
        tenantOverrides: definition.tenantOverrides,
        includeAthena: definition.includeAthena,
        includeEpic: definition.includeEpic,
        startDate: definition.startDate,
        endDate: definition.endDate,
        ...asObject(overrides),
      });
      definition.lastResult = result;
      definition.lastError = '';
      return result;
    } catch (error) {
      definition.lastError = error instanceof Error ? error.message : 'Unknown tenant polling failure.';
      return {
        ok: false,
        skipped: false,
        tenantId: definition.tenantId,
        error: definition.lastError,
      };
    } finally {
      definition.inFlight = false;
    }
  }

  listTenantStates({ includeLastResult = false } = {}) {
    return Array.from(this.tenants.values()).map((tenant) => ({
      tenantId: tenant.tenantId,
      intervalMs: tenant.intervalMs,
      includeAthena: tenant.includeAthena,
      includeEpic: tenant.includeEpic,
      lastRunAt: tenant.lastRunAt,
      inFlight: tenant.inFlight,
      lastError: tenant.lastError,
      lastResultSummary: tenant.lastResult
        ? {
          ok: tenant.lastResult.ok === true,
          scanned: asNumber(tenant.lastResult.scanned, 0),
          createdRuns: asNumber(tenant.lastResult.createdRuns, 0),
        }
        : null,
      ...(includeLastResult ? { lastResult: tenant.lastResult || null } : {}),
    }));
  }

  getStatusSnapshot({ includeLastResults = false } = {}) {
    return {
      running: this.running,
      tenantCount: this.tenants.size,
      tenants: this.listTenantStates({ includeLastResult: includeLastResults }),
    };
  }

  start() {
    this.running = true;
    for (const tenantId of this.tenants.keys()) {
      this.#startTenantTimer(tenantId);
    }
    return { ok: true, running: true, tenants: this.tenants.size };
  }

  stop() {
    this.running = false;
    for (const tenant of this.tenants.values()) {
      if (tenant.timerId) {
        clearInterval(tenant.timerId);
        tenant.timerId = null;
      }
    }
    return { ok: true, running: false };
  }

  #startTenantTimer(tenantId) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      return;
    }

    if (tenant.timerId) {
      clearInterval(tenant.timerId);
      tenant.timerId = null;
    }

    tenant.timerId = setInterval(() => {
      this.runTenantCycle(tenantId).catch(() => null);
    }, tenant.intervalMs);
  }
}

let pollingOrchestratorSingleton = null;

export function getPollingOrchestrator({ runFn = null, defaultIntervalMs = null } = {}) {
  if (!pollingOrchestratorSingleton) {
    pollingOrchestratorSingleton = new PollingOrchestrator({
      runFn: runFn || runZeroTouchEmrPolling,
      defaultIntervalMs: defaultIntervalMs || 15 * 60 * 1000,
    });
  }
  return pollingOrchestratorSingleton;
}

export function resetPollingOrchestratorForTest() {
  if (pollingOrchestratorSingleton) {
    pollingOrchestratorSingleton.stop();
  }
  pollingOrchestratorSingleton = null;
}

export { TokenBucketThrottler, createAthenaTokenBucketThrottler };
