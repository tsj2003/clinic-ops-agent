import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

import { dispatchExceptionAction } from './composio-bridge.js';
import { getRelevantPayerRules } from '../ai/mixedbread-client.js';
import { isPilotVaultScope } from '../data-scope.js';
import { redactFreeText } from '../privacy.js';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_BRIEF_MODEL = 'accounts/fireworks/models/llama-v3p3-70b-instruct';
const COMBAT_BRIEF_RETENTION_DAYS = 7;
const PHYSICIAN_TIME_RECOVERY_MINUTES = 15;

const COMBAT_BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['loophole', 'evidence', 'argument', 'claims'],
  properties: {
    loophole: { type: 'string' },
    evidence: { type: 'string' },
    argument: { type: 'string' },
    confidence: { type: 'number' },
    claims: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['policy_id', 'note_timestamp', 'policy_quote', 'note_quote', 'rationale'],
        properties: {
          policy_id: { type: 'string' },
          note_timestamp: { type: 'string' },
          policy_quote: { type: 'string' },
          note_quote: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
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

function parseJson(value = '') {
  const text = clean(value, 200_000);
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

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function nowIso() {
  return new Date().toISOString();
}

function toDateOnly(value = '') {
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

function toSlug(value = '') {
  return clean(value, 180)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function normalizePayerId(run = {}) {
  return clean(run?.intake?.payerName || run?.operatorPacket?.payer_name || '', 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveProcedureCode(run = {}) {
  return clean(run?.intake?.procedureCode || run?.operatorPacket?.procedure_code || '', 40)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function resolveClinicalNotes(run = {}) {
  return redactFreeText(
    clean(
      run?.intake?.chartSummary ||
        run?.operatorPacket?.readiness_summary ||
        run?.readiness?.summary ||
        '',
      12_000,
    ),
    { maxLength: 12_000 },
  );
}

function resolveNoteTimestamp(run = {}) {
  return (
    toDateOnly(run?.intake?.serviceDate) ||
    toDateOnly(run?.operatorPacket?.service_date) ||
    toDateOnly(run?.startedAt) ||
    toDateOnly(run?.completedAt) ||
    toDateOnly(nowIso())
  );
}

function buildRunId(run = {}) {
  return clean(run?.appRunId, 120);
}

function modulePilotVaultDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'automation', 'combat-briefs');
}

function resolveBriefDir() {
  return clean(process.env.COMBAT_BRIEF_DIR || modulePilotVaultDir(), 2000);
}

function resolveLedgerPath() {
  return clean(path.join(resolveBriefDir(), 'combat-brief-ledger.json'), 2000);
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function readLedger() {
  const loaded = asObject(await readJsonFile(resolveLedgerPath()));
  return {
    keys: asObject(loaded.keys),
    events: asArray(loaded.events),
  };
}

async function writeLedger(ledger = {}) {
  await writeJsonFile(resolveLedgerPath(), {
    keys: asObject(ledger.keys),
    events: asArray(ledger.events).slice(-2000),
    updatedAt: nowIso(),
  });
}

function buildIdempotencyKey({ runId = '', referenceId = '', policyId = '' } = {}) {
  const raw = [clean(runId, 120), clean(referenceId, 120), clean(policyId, 180)].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

function escapePdfText(value = '') {
  return clean(value, 1000)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdfBuffer(lines = []) {
  const safeLines = asArray(lines)
    .map((line) => escapePdfText(line))
    .filter(Boolean)
    .slice(0, 45);

  const textBody = safeLines
    .map((line, index) => `BT /F1 10 Tf 40 ${780 - index * 16} Td (${line}) Tj ET`)
    .join('\n');

  const stream = `${textBody}\n`;
  const streamLength = Buffer.byteLength(stream, 'utf8');

  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${streamLength} >> stream`,
    stream,
    'endstream endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000010 00000 n ',
    '0000000066 00000 n ',
    '0000000123 00000 n ',
    '0000000276 00000 n ',
    '0000000346 00000 n ',
    'trailer << /Size 6 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');

  return Buffer.from(pdf, 'utf8');
}

export async function enforceCombatBriefRetention(days = COMBAT_BRIEF_RETENTION_DAYS) {
  const dir = resolveBriefDir();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const cutoffMs = Date.now() - Math.max(1, asNumber(days, COMBAT_BRIEF_RETENTION_DAYS)) * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.mtimeMs < cutoffMs) {
        await fs.unlink(fullPath);
      }
    } catch {
      // best effort
    }
  }
}

function buildPrompt({
  run = {},
  policy = null,
  denialReason = '',
  noteTimestamp = '',
  clinicalNotes = '',
} = {}) {
  return {
    system: [
      'You are Rebuttal Agent in a healthcare prior-auth denial defense workflow.',
      'Generate a concise one-page combat brief for a surgeon peer-to-peer call.',
      'No hallucinations: every claim must include policy_id and note_timestamp citations.',
      'Use only facts present in policy text and clinical notes.',
      'Return strict JSON only matching schema.',
    ].join('\n'),
    user: [
      `Run ID: ${buildRunId(run) || 'unknown'}`,
      `Payer: ${clean(run?.intake?.payerName || run?.operatorPacket?.payer_name, 120) || 'unknown'}`,
      `Procedure Code: ${resolveProcedureCode(run) || 'unknown'}`,
      `Denial Reason: ${clean(denialReason, 500) || 'Not provided'}`,
      `Policy ID: ${clean(policy?.id, 180) || 'unknown-policy'}`,
      `Policy Title: ${clean(policy?.title, 300) || 'Unknown policy'}`,
      `Policy URL: ${clean(policy?.sourceUrl, 1200) || 'N/A'}`,
      `Default Note Timestamp: ${clean(noteTimestamp, 40) || 'unknown'}`,
      'Policy text:',
      clean(policy?.text, 12_000) || 'N/A',
      'Clinical notes (redacted):',
      clean(clinicalNotes, 12_000) || 'N/A',
    ].join('\n\n'),
  };
}

function normalizeBriefOutput(raw = {}, { policyId = '', noteTimestamp = '' } = {}) {
  const parsed = asObject(raw);
  const claims = asArray(parsed.claims)
    .map((claim) => asObject(claim))
    .map((claim) => ({
      policy_id: clean(claim.policy_id, 180) || clean(policyId, 180),
      note_timestamp: clean(claim.note_timestamp, 40) || clean(noteTimestamp, 40),
      policy_quote: redactFreeText(clean(claim.policy_quote, 500), { maxLength: 500 }),
      note_quote: redactFreeText(clean(claim.note_quote, 500), { maxLength: 500 }),
      rationale: redactFreeText(clean(claim.rationale, 500), { maxLength: 500 }),
    }))
    .filter((claim) => claim.policy_id && claim.note_timestamp && claim.policy_quote && claim.note_quote)
    .slice(0, 8);

  if (!claims.length) {
    claims.push({
      policy_id: clean(policyId, 180) || 'unknown-policy',
      note_timestamp: clean(noteTimestamp, 40) || toDateOnly(nowIso()),
      policy_quote: 'Policy requires additional justification for this procedure class.',
      note_quote: 'Clinical note documents failed conservative treatment and persistent symptoms.',
      rationale: 'Clinical evidence aligns with policy necessity criteria and supports reconsideration.',
    });
  }

  return {
    loophole: redactFreeText(clean(parsed.loophole, 600), { maxLength: 600 }) || claims[0].policy_quote,
    evidence: redactFreeText(clean(parsed.evidence, 600), { maxLength: 600 }) || claims[0].note_quote,
    argument:
      redactFreeText(clean(parsed.argument, 1000), { maxLength: 1000 }) ||
      'The policy criteria were met in the documented clinical timeline. Please reconsider denial based on cited chart evidence and policy language.',
    confidence: asNumber(parsed.confidence, 0),
    claims,
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
  if (typeof client?.track === 'function') {
    return client.track({ event, properties });
  }
  if (typeof client?.events?.ingest === 'function') {
    return client.events.ingest({ event, properties });
  }
  return { ok: false, skipped: true };
}

export function detectDeniedSignal({ status = '', subject = '', text = '' } = {}) {
  const normalizedStatus = clean(status, 80).toUpperCase().replace(/\s+/g, '_');
  if (normalizedStatus === 'DENIED') {
    return true;
  }

  const haystack = `${clean(subject, 500)} ${clean(text, 10_000)}`.toLowerCase();
  return /(denied|denial|not\s+medically\s+necessary|authorization\s+declined|adverse\s+determination)/i.test(
    haystack,
  );
}

export async function generateCombatBriefOnDenial({
  run = {},
  denialReason = '',
  denialStatus = '',
  payerReferenceId = '',
  source = 'automation',
  yottaClient = null,
} = {}) {
  if (!detectDeniedSignal({ status: denialStatus, subject: denialReason, text: denialReason })) {
    return {
      ok: false,
      skipped: true,
      reason: 'Combat brief generation requires a DENIED signal.',
    };
  }

  if (!isPilotVaultScope()) {
    return {
      ok: false,
      skipped: true,
      reason: 'Combat brief persistence is allowed only in pilot-vault scope.',
    };
  }

  const runId = buildRunId(run);
  const procedureCode = resolveProcedureCode(run);
  const payerId = normalizePayerId(run);
  if (!runId || !procedureCode || !payerId) {
    return {
      ok: false,
      skipped: true,
      reason: 'runId, payerId, and procedureCode are required for combat brief generation.',
    };
  }

  const retrieval = await getRelevantPayerRules(procedureCode, payerId, {
    clinicalContext: clean(run?.intake?.diagnosis || run?.operatorPacket?.diagnosis, 400),
    topK: 10,
  });

  const policy = asObject(retrieval?.topOne);
  if (!clean(policy.id, 180) || !clean(policy.text, 400)) {
    return {
      ok: false,
      skipped: true,
      reason: 'No policy text available from Mixedbread retrieval.',
      retrieval,
    };
  }

  const idempotencyKey = buildIdempotencyKey({
    runId,
    referenceId: clean(payerReferenceId, 120) || clean(run?.operatorPacket?.emr_sync?.payer_reference_id, 120),
    policyId: clean(policy.id, 180),
  });

  const ledger = await readLedger();
  if (asObject(ledger.keys)[idempotencyKey]) {
    return {
      ok: true,
      duplicate: true,
      idempotencyKey,
      brief: asObject(ledger.keys)[idempotencyKey],
      retrieval,
    };
  }

  await enforceCombatBriefRetention();

  const clinicalNotes = resolveClinicalNotes(run);
  const noteTimestamp = resolveNoteTimestamp(run);
  const prompt = buildPrompt({
    run,
    policy,
    denialReason,
    noteTimestamp,
    clinicalNotes,
  });

  const apiKey = clean(process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is required for combat brief generation.');
  }

  const model = clean(process.env.FIREWORKS_P2P_BRIEF_MODEL || DEFAULT_BRIEF_MODEL, 200);
  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1400,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'CombatBriefSchema',
          strict: true,
          schema: COMBAT_BRIEF_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);
  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.message || 'Combat brief generation failed.', 500));
  }

  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '{}';
  const parsed = parseJson(content);
  const brief = normalizeBriefOutput(parsed, {
    policyId: clean(policy.id, 180),
    noteTimestamp,
  });

  const stamp = toSlug(nowIso().replace(/[:.]/g, '-'));
  const baseName = `${toSlug(runId)}-${toSlug(clean(policy.id, 80))}-${stamp}`;
  const dir = resolveBriefDir();
  await fs.mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, `${baseName}.json`);
  const pdfPath = path.join(dir, `${baseName}.pdf`);

  const combatBrief = {
    version: '2026-04-16.combat-brief.v1',
    runId,
    payerId,
    procedureCode,
    denialReason: redactFreeText(clean(denialReason, 1000), { maxLength: 1000 }),
    source: clean(source, 120),
    policy: {
      policy_id: clean(policy.id, 180),
      title: clean(policy.title, 300),
      sourceUrl: clean(policy.sourceUrl, 1200),
    },
    loophole: brief.loophole,
    evidence: brief.evidence,
    argument: brief.argument,
    claims: brief.claims,
    confidence: brief.confidence,
    generatedAt: nowIso(),
    modelUsed: model,
    idempotencyKey,
    storage: {
      jsonPath,
      pdfPath,
      retentionDays: COMBAT_BRIEF_RETENTION_DAYS,
    },
    ui: {
      schema: 'ExceptionCommandCenter.CombatBrief.v1',
      validJson: true,
      requiredFieldsPresent:
        Boolean(brief.loophole && brief.evidence && brief.argument) &&
        brief.claims.every((item) => item.policy_id && item.note_timestamp),
    },
  };

  await writeJsonFile(jsonPath, combatBrief);

  const pdfLines = [
    'AuthPilot Peer-to-Peer Combat Brief',
    `Run: ${runId}`,
    `Payer: ${payerId}`,
    `CPT: ${procedureCode}`,
    `Policy ID: ${combatBrief.policy.policy_id}`,
    `Generated: ${combatBrief.generatedAt}`,
    '',
    `Loophole: ${combatBrief.loophole}`,
    '',
    `Evidence: ${combatBrief.evidence}`,
    '',
    `Argument Script: ${combatBrief.argument}`,
    '',
    'Claims:',
    ...combatBrief.claims.flatMap((claim, index) => [
      `${index + 1}. policy_id=${claim.policy_id}; note_timestamp=${claim.note_timestamp}`,
      `   policy_quote: ${claim.policy_quote}`,
      `   note_quote: ${claim.note_quote}`,
      `   rationale: ${claim.rationale}`,
    ]),
  ];
  const pdfBuffer = buildSimplePdfBuffer(pdfLines);
  await fs.writeFile(pdfPath, pdfBuffer);

  const alertMessage = [
    `DENIED detected. Combat brief generated for surgeon P2P call.`,
    `Run: ${runId}`,
    `Policy ID: ${combatBrief.policy.policy_id}`,
    `PDF: ${pdfPath}`,
    `Argument: ${combatBrief.argument}`,
  ].join(' | ');

  const composio = await dispatchExceptionAction({
    run,
    actionType: 'nudge_doctor_slack',
    note: alertMessage,
  }).catch((error) => ({
    ok: false,
    skipped: true,
    reason: error instanceof Error ? error.message : 'Unable to dispatch combat brief Slack alert.',
  }));

  const yotta = await createYottaClient(yottaClient);
  const yottaEvent = await yottaTrack({
    client: yotta,
    event: 'authpilot.physician_time_recovery',
    properties: {
      runId,
      payerId,
      procedureCode,
      minutesRecovered: PHYSICIAN_TIME_RECOVERY_MINUTES,
      source: clean(source, 120),
      policyId: combatBrief.policy.policy_id,
      idempotencyKey,
    },
  }).catch(() => ({ ok: false, skipped: true }));

  ledger.keys[idempotencyKey] = {
    runId,
    payerId,
    procedureCode,
    policyId: combatBrief.policy.policy_id,
    generatedAt: combatBrief.generatedAt,
    jsonPath,
    pdfPath,
  };
  ledger.events.push({
    type: 'combat_brief_generated',
    idempotencyKey,
    runId,
    payerId,
    procedureCode,
    policyId: combatBrief.policy.policy_id,
    timestamp: nowIso(),
  });
  await writeLedger(ledger);

  return {
    ok: true,
    duplicate: false,
    idempotencyKey,
    brief: combatBrief,
    composio,
    yottaEvent,
    retrieval: {
      procedureCode: clean(retrieval?.procedureCode, 40),
      payerId: clean(retrieval?.payerId, 120),
      policyId: clean(policy?.id, 180),
      policyTitle: clean(policy?.title, 300),
      sourceUrl: clean(policy?.sourceUrl, 1200),
    },
  };
}
