import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { redactFreeText } from '../privacy.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(moduleDir, '..', 'data');
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SUCCESS_CHARGE_USD = 50;
const DEFAULT_HOURLY_OPERATOR_RATE_USD = 38;

function resolveLedgerPath() {
  return clean(process.env.BILLING_LEDGER_PATH, 2000) || path.join(dataDir, 'billing-ledger.json');
}

const PROCEDURE_VALUE_USD = {
  '72148': 1500,
  '62323': 950,
  '62321': 920,
  '70553': 1650,
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

function normalizeStatus(value = '') {
  return clean(value, 80).toUpperCase().replace(/\s+/g, '_');
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function createLedger() {
  return {
    charges: [],
    refunds: [],
    events: [],
  };
}

async function ensureLedgerDir() {
  await fs.mkdir(path.dirname(resolveLedgerPath()), { recursive: true });
}

async function readLedger() {
  try {
    const raw = await fs.readFile(resolveLedgerPath(), 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return createLedger();
    }
    return {
      charges: asArray(parsed?.charges),
      refunds: asArray(parsed?.refunds),
      events: asArray(parsed?.events),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createLedger();
    }
    throw error;
  }
}

async function writeLedger(ledger = createLedger()) {
  await ensureLedgerDir();
  await fs.writeFile(resolveLedgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
}

function normalizeProcedureCode(run = {}, fallback = '') {
  return clean(
    fallback || run?.operatorPacket?.procedure_code || run?.intake?.procedureCode || run?.operatorPacket?.procedure,
    40,
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeInsuranceType(run = {}, fallback = '') {
  return clean(fallback || run?.operatorPacket?.line_of_business || run?.intake?.lineOfBusiness || 'UNKNOWN', 80).toUpperCase();
}

function estimateProcedureValueUsd(cpt = '') {
  const normalized = clean(cpt, 20);
  return PROCEDURE_VALUE_USD[normalized] || 600;
}

function resolvePracticeId(run = {}, fallback = '') {
  return clean(fallback || run?.workspace?.id || run?.intake?.practiceId || run?.workspace?.name, 120);
}

function resolveRunId(run = {}, fallback = '') {
  return clean(fallback || run?.appRunId, 120);
}

function resolvePayerReferenceId(run = {}, fallback = '') {
  return clean(
    fallback || run?.operatorPacket?.emr_sync?.payer_reference_id || run?.emrSync?.payer_reference_id || run?.emrSync?.payerReferenceId,
    120,
  );
}

function shouldBillApproved(status = '') {
  return normalizeStatus(status) === 'APPROVED';
}

async function createParasailClient(providedClient = null) {
  if (providedClient) {
    return providedClient;
  }

  const apiKey = clean(process.env.PARASAIL_API_KEY, 5000);
  if (!apiKey) {
    return null;
  }

  try {
    const sdk = await dynamicImport('parasail-js');
    const Parasail = sdk?.Parasail || sdk?.default?.Parasail || sdk?.default;
    if (!Parasail) {
      return null;
    }
    return new Parasail({
      apiKey,
      baseUrl: clean(process.env.PARASAIL_BASE_URL, 1200),
    });
  } catch {
    return null;
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

async function parasailCharge({ client = null, payload = {}, idempotencyKey = '' } = {}) {
  if (typeof client?.charges?.create === 'function') {
    return client.charges.create(payload, { idempotencyKey });
  }
  if (typeof client?.createCharge === 'function') {
    return client.createCharge(payload, { idempotencyKey });
  }
  return {
    id: `sim-charge-${Date.now().toString(36)}`,
    status: 'simulated_success',
  };
}

async function parasailRefund({ client = null, payload = {}, idempotencyKey = '' } = {}) {
  if (typeof client?.credits?.create === 'function') {
    return client.credits.create(payload, { idempotencyKey });
  }
  if (typeof client?.createCredit === 'function') {
    return client.createCredit(payload, { idempotencyKey });
  }
  return {
    id: `sim-refund-${Date.now().toString(36)}`,
    status: 'simulated_success',
  };
}

async function yottaTrack({ client = null, event = '', properties = {} } = {}) {
  if (typeof client?.track === 'function') {
    return client.track({
      event,
      properties,
    });
  }
  if (typeof client?.events?.ingest === 'function') {
    return client.events.ingest({
      event,
      properties,
    });
  }
  return { ok: false, skipped: true };
}

function yottaRevenuePayload({ runId = '', practiceId = '', procedureCode = '', insuranceType = '', lockedRevenueUsd = 0 } = {}) {
  return {
    runId: clean(runId, 120),
    practiceId: clean(practiceId, 120),
    procedureCode: clean(procedureCode, 40),
    insuranceType: clean(insuranceType, 80),
    lockedRevenueUsd: numeric(lockedRevenueUsd, 0),
  };
}

async function emitBillingAuditEvent(payload = {}) {
  try {
    const mod = await import('../audit-log.js');
    if (typeof mod?.emitAuditEvent === 'function') {
      await mod.emitAuditEvent(payload);
    }
  } catch {
    // Best-effort audit bridge (safe for node:test runtime without Next.js alias support).
  }
}

export async function triggerRevenueEvent({
  run = {},
  runId = '',
  practiceId = '',
  coordinatorStatus = '',
  procedureCode = '',
  insuranceType = '',
  payerReferenceId = '',
  parasailClient = null,
  yottaClient = null,
  requestId = '',
  source = 'automation',
} = {}) {
  if (!shouldBillApproved(coordinatorStatus)) {
    return {
      ok: false,
      skipped: true,
      reason: 'Revenue event can only be triggered for APPROVED status.',
    };
  }

  const normalizedRunId = resolveRunId(run, runId);
  const normalizedPracticeId = resolvePracticeId(run, practiceId);
  const normalizedProcedure = normalizeProcedureCode(run, procedureCode);
  const normalizedInsurance = normalizeInsuranceType(run, insuranceType);
  const normalizedReference = resolvePayerReferenceId(run, payerReferenceId);

  if (!normalizedRunId || !normalizedPracticeId || !normalizedProcedure) {
    return {
      ok: false,
      skipped: true,
      reason: 'runId, practiceId, and procedure code are required for billing trigger.',
    };
  }

  const idempotencyKey = clean(normalizedReference || `approval-${normalizedRunId}`, 120);
  const ledger = await readLedger();
  const duplicate = ledger.charges.find((charge) => clean(charge.idempotencyKey, 120) === idempotencyKey);
  if (duplicate) {
    return {
      ok: true,
      duplicate: true,
      charge: duplicate,
    };
  }

  const parasail = await createParasailClient(parasailClient);
  const yotta = await createYottaClient(yottaClient);

  const simulatedChargeUsd = numeric(process.env.PARASAIL_SUCCESS_CHARGE_USD, DEFAULT_SUCCESS_CHARGE_USD);
  const procedureValueUsd = estimateProcedureValueUsd(normalizedProcedure);

  const chargePayload = {
    practiceId: normalizedPracticeId,
    runId: normalizedRunId,
    procedureCode: normalizedProcedure,
    insuranceType: normalizedInsurance,
    amountUsd: simulatedChargeUsd,
    mode: 'SUCCESS_CHARGE',
    metadata: {
      payer_reference_id: normalizedReference,
    },
  };

  const parasailResponse = await parasailCharge({
    client: parasail,
    payload: chargePayload,
    idempotencyKey,
  });

  const recordedAt = nowIso();
  const chargeRecord = {
    id: clean(parasailResponse?.id || `sim-charge-${Date.now().toString(36)}`, 120),
    runId: normalizedRunId,
    practiceId: normalizedPracticeId,
    procedureCode: normalizedProcedure,
    insuranceType: normalizedInsurance,
    payerReferenceId: normalizedReference,
    idempotencyKey,
    chargeAmountUsd: simulatedChargeUsd,
    procedureValueUsd,
    status: clean(parasailResponse?.status || 'pending', 80).toLowerCase(),
    source: clean(source, 120),
    createdAt: recordedAt,
    refundedAt: '',
  };

  ledger.charges.push(chargeRecord);

  const yottaPayload = yottaRevenuePayload({
    runId: normalizedRunId,
    practiceId: normalizedPracticeId,
    procedureCode: normalizedProcedure,
    insuranceType: normalizedInsurance,
    lockedRevenueUsd: procedureValueUsd,
  });

  await yottaTrack({
    client: yotta,
    event: 'authpilot.approved_auth_locked_revenue',
    properties: yottaPayload,
  }).catch(() => null);

  ledger.events.push({
    type: 'revenue_locked',
    runId: normalizedRunId,
    practiceId: normalizedPracticeId,
    payerReferenceId: normalizedReference,
    amountUsd: simulatedChargeUsd,
    procedureValueUsd,
    timestamp: recordedAt,
  });

  await writeLedger(ledger);

  await emitBillingAuditEvent({
    requestId,
    action: 'billing.trigger_revenue_event',
    outcome: 'success',
    route: '/lib/automation/billing-engine',
    actor: 'billing-engine',
    source,
    details: {
      runId: normalizedRunId,
      practiceId: normalizedPracticeId,
      model_type: 'parasail_success_charge',
      cost_simulated: simulatedChargeUsd,
      payer_reference_id: normalizedReference,
      procedure_code: normalizedProcedure,
    },
  });

  return {
    ok: true,
    charge: chargeRecord,
    parasailResponse: asObject(parasailResponse),
  };
}

export async function triggerRefundWindowCredit({
  runId = '',
  payerReferenceId = '',
  reason = 'approval_inaccurate',
  actor = 'clinician',
  requestId = '',
  parasailClient = null,
  nowMs = Date.now(),
} = {}) {
  const normalizedRunId = clean(runId, 120);
  if (!normalizedRunId) {
    throw new Error('runId is required for refund credit.');
  }

  const ledger = await readLedger();
  const matched = [...ledger.charges]
    .reverse()
    .find((charge) => {
      const runMatch = clean(charge.runId, 120) === normalizedRunId;
      const refMatch = !clean(payerReferenceId, 120) || clean(charge.payerReferenceId, 120) === clean(payerReferenceId, 120);
      return runMatch && refMatch;
    });

  if (!matched) {
    return {
      ok: false,
      skipped: true,
      reason: 'No billed approval found for this run.',
    };
  }

  if (clean(matched.refundedAt, 80)) {
    return {
      ok: true,
      duplicate: true,
      refund: ledger.refunds.find((refund) => clean(refund.chargeId, 120) === clean(matched.id, 120)) || null,
    };
  }

  const chargedAtMs = Date.parse(clean(matched.createdAt, 80));
  if (!Number.isFinite(chargedAtMs) || nowMs - chargedAtMs > REFUND_WINDOW_MS) {
    return {
      ok: false,
      skipped: true,
      reason: 'Refund window expired.',
    };
  }

  const parasail = await createParasailClient(parasailClient);
  const idempotencyKey = clean(`refund:${matched.id}:${normalizedRunId}`, 120);
  const payload = {
    practiceId: clean(matched.practiceId, 120),
    runId: normalizedRunId,
    chargeId: clean(matched.id, 120),
    amountUsd: numeric(matched.chargeAmountUsd, 0),
    reason: clean(reason, 200),
  };

  const parasailResponse = await parasailRefund({
    client: parasail,
    payload,
    idempotencyKey,
  });

  const refundedAt = nowIso();
  const refundRecord = {
    id: clean(parasailResponse?.id || `sim-refund-${Date.now().toString(36)}`, 120),
    chargeId: clean(matched.id, 120),
    runId: normalizedRunId,
    practiceId: clean(matched.practiceId, 120),
    amountUsd: numeric(matched.chargeAmountUsd, 0),
    reason: clean(reason, 200),
    actor: clean(actor, 120),
    status: clean(parasailResponse?.status || 'pending', 80).toLowerCase(),
    idempotencyKey,
    createdAt: refundedAt,
  };

  ledger.refunds.push(refundRecord);
  ledger.charges = ledger.charges.map((charge) =>
    clean(charge.id, 120) === clean(matched.id, 120)
      ? {
          ...charge,
          status: 'refunded',
          refundedAt,
        }
      : charge,
  );
  ledger.events.push({
    type: 'refund_issued',
    runId: normalizedRunId,
    practiceId: clean(matched.practiceId, 120),
    amountUsd: numeric(matched.chargeAmountUsd, 0),
    timestamp: refundedAt,
  });

  await writeLedger(ledger);

  await emitBillingAuditEvent({
    requestId,
    action: 'billing.trigger_refund_credit',
    outcome: 'success',
    route: '/lib/automation/billing-engine',
    actor: clean(actor, 120) || 'clinician',
    source: 'command-center',
    details: {
      runId: normalizedRunId,
      practiceId: clean(matched.practiceId, 120),
      model_type: 'parasail_refund_credit',
      cost_simulated: numeric(matched.chargeAmountUsd, 0),
      payer_reference_id: clean(matched.payerReferenceId, 120),
    },
  });

  return {
    ok: true,
    refund: refundRecord,
  };
}

export async function getRevenueSnapshot({ limit = 50 } = {}) {
  const ledger = await readLedger();
  const charges = [...ledger.charges]
    .sort((a, b) => Date.parse(clean(b.createdAt, 80)) - Date.parse(clean(a.createdAt, 80)))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));

  const approvedValueUsd = ledger.charges.reduce((sum, charge) => sum + numeric(charge.procedureValueUsd, 0), 0);
  const successfulAuthCount = ledger.charges.length;
  const manualMinutesEliminated = successfulAuthCount * 8;
  const laborSavingsUsd = Number(((manualMinutesEliminated / 60) * DEFAULT_HOURLY_OPERATOR_RATE_USD).toFixed(2));
  const pendingInvoices = charges.filter((charge) => {
    const status = clean(charge.status, 80).toLowerCase();
    return ['pending', 'submitted', 'simulated_success'].includes(status);
  });

  return {
    totalApprovedValueUsd: Number(approvedValueUsd.toFixed(2)),
    lockedRevenueUsd: Number(approvedValueUsd.toFixed(2)),
    authpilotSavings: {
      manualMinutesEliminated,
      laborSavingsUsd,
      hourlyRateUsd: DEFAULT_HOURLY_OPERATOR_RATE_USD,
    },
    pendingInvoices,
    charges,
    refunds: ledger.refunds,
    generatedAt: nowIso(),
  };
}

export async function maybeRefundForInaccurateApproval({
  runId = '',
  status = '',
  notes = '',
  requestId = '',
  actor = 'clinician',
} = {}) {
  const normalizedStatus = normalizeStatus(status);
  const note = redactFreeText(clean(notes, 2000), { maxLength: 2000 }).toLowerCase();
  const markedInaccurate = normalizedStatus === 'ESCALATED' && note.includes('inaccurate');
  if (!markedInaccurate || !clean(runId, 120)) {
    return {
      ok: false,
      skipped: true,
      reason: 'No inaccurate approval marker detected.',
    };
  }

  return triggerRefundWindowCredit({
    runId,
    reason: 'approval_inaccurate',
    actor,
    requestId,
  });
}
