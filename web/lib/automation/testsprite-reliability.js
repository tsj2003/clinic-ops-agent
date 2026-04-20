const DEFAULT_TESTSPRITE_BASE_URL = 'https://api.testsprite.com/v1';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(text) {
  const raw = clean(text, 200_000);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 1000) };
  }
}

function normalizeStatus(value) {
  return clean(value, 60).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(ms) || 1)));
}

function resolveBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = clean(value, 20).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function isTerminalStatus(status) {
  const normalized = normalizeStatus(status);
  return ['passed', 'failed', 'error', 'cancelled', 'canceled', 'completed'].includes(normalized);
}

function calculatePassRate(metrics = {}) {
  const passed = Number(metrics.passed || metrics.pass || 0);
  const failed = Number(metrics.failed || metrics.fail || 0);
  const total = Number(metrics.total || passed + failed);

  if (Number.isFinite(total) && total > 0) {
    return passed / total;
  }

  const ratio = Number(metrics.passRate || metrics.pass_rate || 0);
  if (ratio > 1) {
    return ratio / 100;
  }
  if (ratio >= 0) {
    return ratio;
  }
  return 0;
}

export function createTestSpriteClient() {
  const apiKey = clean(process.env.TESTSPRITE_API_KEY, 5000);
  const baseUrl = clean(process.env.TESTSPRITE_BASE_URL || DEFAULT_TESTSPRITE_BASE_URL, 2000).replace(/\/+$/, '');

  if (!apiKey) {
    throw new Error('TESTSPRITE_API_KEY is required for reliability gate execution.');
  }

  return {
    apiKey,
    baseUrl,
  };
}

async function request(client, path, init = {}) {
  const url = `${client.baseUrl}/${clean(path, 400).replace(/^\/+/, '')}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${client.apiKey}`,
      'content-type': 'application/json',
      ...(asObject(init.headers)),
    },
  });

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    throw new Error(clean(payload?.error || payload?.message || `TestSprite request failed (${response.status}).`, 500));
  }

  return payload;
}

export async function startRegressionRun({ suite = '', metadata = {} } = {}) {
  const client = createTestSpriteClient();
  const payload = await request(client, 'runs', {
    method: 'POST',
    body: JSON.stringify({
      suite: clean(suite || process.env.TESTSPRITE_SUITE || 'payer-portal-nightly', 200),
      metadata: asObject(metadata),
    }),
  });

  return {
    runId: clean(payload.runId || payload.id || payload.run_id, 120),
    status: normalizeStatus(payload.status || 'queued'),
    dashboardUrl: clean(payload.dashboardUrl || payload.url, 1000),
    raw: payload,
  };
}

export async function getRegressionRunStatus({ runId = '' } = {}) {
  const normalizedRunId = clean(runId, 120);
  if (!normalizedRunId) {
    throw new Error('runId is required to query TestSprite status.');
  }

  const client = createTestSpriteClient();
  const payload = await request(client, `runs/${normalizedRunId}`, {
    method: 'GET',
  });

  return {
    runId: normalizedRunId,
    status: normalizeStatus(payload.status),
    dashboardUrl: clean(payload.dashboardUrl || payload.url, 1000),
    metrics: asObject(payload.metrics),
    raw: payload,
  };
}

export async function waitForRegressionCompletion({ runId = '', pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAtMs = Date.now();
  const normalizedRunId = clean(runId, 120);
  if (!normalizedRunId) {
    throw new Error('runId is required for reliability polling.');
  }

  const timeoutLimitMs = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const pollInterval = Math.max(1, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);

  while (Date.now() - startedAtMs <= timeoutLimitMs) {
    const state = await getRegressionRunStatus({ runId: normalizedRunId });
    if (isTerminalStatus(state.status)) {
      return state;
    }
    await sleep(pollInterval);
  }

  throw new Error('TestSprite reliability gate timed out before completion.');
}

export function evaluateReliabilityGate({ status = '', metrics = {}, minPassRate = 0.95 } = {}) {
  const normalizedStatus = normalizeStatus(status);
  const passRate = calculatePassRate(metrics);
  const threshold = Math.min(1, Math.max(0, Number(minPassRate) || 0));
  const statusPassed = ['passed', 'completed'].includes(normalizedStatus);
  const gatePassed = statusPassed && passRate >= threshold;

  return {
    gatePassed,
    status: normalizedStatus,
    passRate: Number((passRate * 100).toFixed(2)),
    thresholdPercent: Number((threshold * 100).toFixed(2)),
    reason: gatePassed
      ? 'Reliability gate passed.'
      : normalizedStatus !== 'passed' && normalizedStatus !== 'completed'
        ? `Regression status is ${normalizedStatus || 'unknown'}.`
        : `Pass rate ${Number((passRate * 100).toFixed(2))}% is below threshold ${Number((threshold * 100).toFixed(2))}%.`,
  };
}

export async function runReliabilityGate({
  suite = '',
  metadata = {},
  minPassRate = 0.95,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  required,
} = {}) {
  const enforceGate = required !== undefined ? Boolean(required) : resolveBoolean(process.env.TESTSPRITE_GATE_REQUIRED, false);

  if (!clean(process.env.TESTSPRITE_API_KEY, 5000)) {
    return {
      skipped: true,
      required: enforceGate,
      gatePassed: !enforceGate,
      reason: enforceGate
        ? 'Reliability gate required but TESTSPRITE_API_KEY is missing.'
        : 'TESTSPRITE_API_KEY is missing; reliability gate skipped.',
    };
  }

  const started = await startRegressionRun({ suite, metadata });
  const completed = await waitForRegressionCompletion({
    runId: started.runId,
    pollIntervalMs,
    timeoutMs,
  });

  const evaluation = evaluateReliabilityGate({
    status: completed.status,
    metrics: completed.metrics,
    minPassRate,
  });

  return {
    skipped: false,
    required: enforceGate,
    runId: started.runId,
    dashboardUrl: completed.dashboardUrl || started.dashboardUrl,
    metrics: completed.metrics,
    ...evaluation,
  };
}
