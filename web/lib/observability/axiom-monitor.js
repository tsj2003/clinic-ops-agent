import { redactFreeText } from '../privacy.js';

const DEFAULT_AXIOM_BASE_URL = 'https://api.axiom.co';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function coerceNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeForAxiom(value) {
  if (typeof value === 'string') {
    return redactFreeText(clean(value, 20_000), { maxLength: 20_000 });
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAxiom(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nextValue]) => {
      acc[key] = sanitizeForAxiom(nextValue);
      return acc;
    }, {});
  }

  return value;
}

export function getAxiomMonitorConfig() {
  const token = clean(process.env.AXIOM_API_TOKEN, 5000);
  const dataset = clean(process.env.AXIOM_DATASET, 200);
  const baseUrl = clean(process.env.AXIOM_BASE_URL, 1200) || DEFAULT_AXIOM_BASE_URL;

  if (!token || !dataset) {
    return null;
  }

  return {
    token,
    dataset,
    baseUrl,
  };
}

export function buildCorrelationId({ correlationId = '', requestId = '', runId = '' } = {}) {
  const provided = clean(correlationId || requestId, 200);
  if (provided) {
    return provided;
  }

  const normalizedRunId = clean(runId, 120);
  if (normalizedRunId) {
    return `corr-${normalizedRunId}`;
  }

  return `corr-${Date.now().toString(36)}`;
}

export async function emitAxiomEvents(events = []) {
  const config = getAxiomMonitorConfig();
  if (!config) {
    return { sent: false, reason: 'missing_config' };
  }

  const payload = (Array.isArray(events) ? events : [events])
    .map((event) => sanitizeForAxiom(asObject(event)))
    .filter((event) => Object.keys(event).length > 0)
    .map((event) => ({
      ...event,
      recordedAt: new Date().toISOString(),
    }));

  if (!payload.length) {
    return { sent: false, reason: 'empty_payload' };
  }

  const response = await fetch(`${config.baseUrl}/v1/datasets/${config.dataset}/ingest`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Axiom ingest failed with status ${response.status}: ${text}`);
  }

  return response.json().catch(() => ({ sent: true }));
}

export async function emitAgentLifecycleEvent({
  agent = '',
  lifecycle = '',
  requestId = '',
  route = '',
  runId = '',
  practiceId = '',
  modelType = '',
  costSimulated = 0,
  correlationId = '',
  metadata = {},
} = {}) {
  const normalizedRunId = clean(runId, 120);
  const normalizedPracticeId = clean(practiceId, 120);
  const normalizedCorrelationId = buildCorrelationId({
    correlationId,
    requestId,
    runId: normalizedRunId,
  });

  const event = {
    service: 'authpilot-web',
    signal: 'agent_lifecycle',
    agent: clean(agent, 120),
    lifecycle: clean(lifecycle, 120),
    route: clean(route, 300),
    requestId: clean(requestId, 200),
    runId: normalizedRunId,
    practiceId: normalizedPracticeId,
    model_type: clean(modelType, 200),
    cost_simulated: coerceNumber(costSimulated, 0),
    correlation_id: normalizedCorrelationId,
    metadata: asObject(metadata),
  };

  return emitAxiomEvents([event]);
}

function resolveLifecycleTimestamp(event = {}) {
  const candidate = event?.metadata?.timestamp || event?.metadata?.submittedAt || event?.recordedAt || event?.timestamp;
  const parsed = Date.parse(clean(candidate, 80));
  return Number.isFinite(parsed) ? parsed : null;
}

function sumFireworksSavings(event = {}) {
  const fromMetadata = coerceNumber(event?.metadata?.fireworks_vs_gpt4o_savings_usd, NaN);
  if (Number.isFinite(fromMetadata)) {
    return fromMetadata;
  }

  const fromCostSimulated = coerceNumber(event?.cost_simulated, NaN);
  return Number.isFinite(fromCostSimulated) ? fromCostSimulated : 0;
}

export function buildVitalsFromLifecycleEvents(events = []) {
  const byRun = new Map();
  let totalEightMinuteBlocks = 0;
  let totalFireworksSavingsUsd = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const runId = clean(event?.runId, 120);
    if (!runId) {
      continue;
    }

    if (!byRun.has(runId)) {
      byRun.set(runId, {
        ingestAt: null,
        submitAt: null,
      });
    }

    const runRecord = byRun.get(runId);
    const lifecycle = clean(event?.lifecycle, 120).toLowerCase();
    const ts = resolveLifecycleTimestamp(event);

    if (lifecycle.includes('ingest') && ts && !runRecord.ingestAt) {
      runRecord.ingestAt = ts;
    }
    if ((lifecycle.includes('submission') || lifecycle.includes('submit')) && ts) {
      runRecord.submitAt = ts;
    }

    const manualMinutesSaved = coerceNumber(event?.metadata?.manual_minutes_saved, 0);
    totalEightMinuteBlocks += manualMinutesSaved > 0 ? manualMinutesSaved / 8 : 0;
    totalFireworksSavingsUsd += sumFireworksSavings(event);
  }

  const tatHours = [];
  for (const record of byRun.values()) {
    if (record.ingestAt && record.submitAt && record.submitAt >= record.ingestAt) {
      tatHours.push((record.submitAt - record.ingestAt) / (1000 * 60 * 60));
    }
  }

  const averageTatHours = tatHours.length
    ? Number((tatHours.reduce((sum, value) => sum + value, 0) / tatHours.length).toFixed(2))
    : 0;

  return {
    averageTatHours,
    targetTatHours: 26,
    totalEightMinuteBlocksSaved: Math.round(totalEightMinuteBlocks),
    fireworksSavingsUsd: Number(totalFireworksSavingsUsd.toFixed(2)),
    trackedRuns: byRun.size,
  };
}

export async function fetchLifecycleEventsFromAxiom({ hours = 72, limit = 500 } = {}) {
  const config = getAxiomMonitorConfig();
  if (!config) {
    return { ok: false, reason: 'missing_config', events: [] };
  }

  const endTime = new Date();
  const startTime = new Date(Date.now() - Math.max(1, Number(hours) || 1) * 60 * 60 * 1000);

  const queryBody = {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    apl: [
      `['${config.dataset}']`,
      '| where signal == "agent_lifecycle"',
      '| sort by recordedAt desc',
      `| limit ${Math.max(10, Math.min(2000, Number(limit) || 500))}`,
    ].join('\n'),
  };

  const response = await fetch(`${config.baseUrl}/v1/datasets/${config.dataset}/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(queryBody),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      reason: `query_failed_${response.status}`,
      detail: clean(text, 400),
      events: [],
    };
  }

  const payload = await response.json().catch(() => ({}));
  const events = Array.isArray(payload?.matches)
    ? payload.matches
    : Array.isArray(payload?.rows)
      ? payload.rows
      : Array.isArray(payload)
        ? payload
        : [];

  return {
    ok: true,
    events,
  };
}
