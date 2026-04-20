import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { redactFreeText } from '../privacy.js';
import { getDefaultUhcSelectors } from './portal-agent.js';

const DEFAULT_TESTSPRITE_BASE_URL = 'https://api.testsprite.com/v1';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(text) {
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

function normalize(value) {
  return clean(value, 400).toLowerCase();
}

function selectorOverridePath() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return clean(
    process.env.UHC_SELECTOR_OVERRIDE_PATH ||
      path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'automation', 'selector-overrides', 'uhc-selectors.json'),
    2000,
  );
}

export function classifyTestFailure(payload = {}) {
  const body = asObject(payload);
  const message = normalize(body.message || body.error || body.failureReason || '');
  const code = normalize(body.code || body.failureCode || '');
  const selector = clean(body.selector || body.brokenSelector, 500);

  const isSelectorBreak =
    Boolean(selector) ||
    code.includes('selector') ||
    message.includes('selector') ||
    message.includes('not found') ||
    message.includes('element not visible') ||
    message.includes('timeout waiting for');

  if (isSelectorBreak) {
    return {
      type: 'portal_layout_changed',
      severity: 'high',
      emrStatus: 'PORTAL_LAYOUT_CHANGED',
      lifecycleStatus: 'portal_layout_changed',
      reason: 'Portal UI selector changed or became inaccessible.',
    };
  }

  const isDataIssue =
    code.includes('validation') ||
    message.includes('member id') ||
    message.includes('invalid input') ||
    message.includes('unauthorized member') ||
    message.includes('dob mismatch');

  if (isDataIssue) {
    return {
      type: 'data_error',
      severity: 'medium',
      emrStatus: 'SUBMITTED_PENDING_DATA_FIX',
      lifecycleStatus: 'collecting_evidence',
      reason: 'Input or member data issue detected during portal regression.',
    };
  }

  return {
    type: 'automation_failure',
    severity: 'medium',
    emrStatus: 'MANUAL_ACTION_REQUIRED',
    lifecycleStatus: 'escalated',
    reason: 'General regression failure requiring operator review.',
  };
}

export async function requestHealedSelector({
  portal = 'uhc',
  brokenSelector = '',
  domSnapshot = '',
  intent = '',
  elementKey = '',
} = {}) {
  const apiKey = clean(process.env.TESTSPRITE_API_KEY, 5000);
  if (!apiKey) {
    return {
      ok: false,
      reason: 'TESTSPRITE_API_KEY is missing.',
      healedSelector: '',
    };
  }

  const baseUrl = clean(process.env.TESTSPRITE_BASE_URL || DEFAULT_TESTSPRITE_BASE_URL, 2000).replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/healing/selectors`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      portal: clean(portal, 80),
      elementKey: clean(elementKey, 200),
      brokenSelector: clean(brokenSelector, 500),
      domSnapshot: clean(domSnapshot, 300_000),
      intent: clean(intent, 500),
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    return {
      ok: false,
      reason: clean(payload?.error || payload?.message || `Healing request failed (${response.status}).`, 500),
      healedSelector: '',
    };
  }

  return {
    ok: true,
    healedSelector: clean(payload.healedSelector || payload.selector || payload.newSelector, 1000),
    confidence: Number(payload.confidence) || 0,
    raw: payload,
  };
}

function setByPath(target, pathKey, value) {
  const parts = clean(pathKey, 300).split('.').filter(Boolean);
  if (!parts.length) {
    return target;
  }

  const root = asObject(target);
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
  return root;
}

export function buildHealedSelectorDiff({ elementKey = '', healedSelector = '' } = {}) {
  const defaults = getDefaultUhcSelectors();
  const pathKey = clean(elementKey, 300);
  const oldSelector = pathKey
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), defaults);

  return {
    elementKey: pathKey,
    oldSelector: clean(oldSelector, 1000),
    healedSelector: clean(healedSelector, 1000),
    summary: `Selector healed for ${pathKey || 'unknown element'}`,
  };
}

export async function persistHealedSelectorOverride({ elementKey = '', healedSelector = '', metadata = {} } = {}) {
  const overridePath = selectorOverridePath();
  const directory = path.dirname(overridePath);

  await fs.mkdir(directory, { recursive: true });

  let existing = {};
  try {
    const raw = await fs.readFile(overridePath, 'utf-8');
    existing = parseJson(raw);
  } catch {
    existing = {};
  }

  const selectors = asObject(existing.selectors || existing);
  const updatedSelectors = setByPath(selectors, elementKey, healedSelector);

  const next = {
    selectors: updatedSelectors,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...(asObject(existing.metadata)),
      ...asObject(metadata),
    },
  };

  await fs.writeFile(overridePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');

  return {
    ok: true,
    overridePath,
    selectors: updatedSelectors,
  };
}

export async function autoHealPortalSelector({
  portal = 'uhc',
  elementKey = '',
  brokenSelector = '',
  domSnapshot = '',
  intent = '',
} = {}) {
  const healing = await requestHealedSelector({
    portal,
    elementKey,
    brokenSelector,
    domSnapshot: redactFreeText(domSnapshot, { maxLength: 300_000 }),
    intent,
  });

  if (!healing.ok || !healing.healedSelector) {
    return {
      ok: false,
      healing,
      diff: buildHealedSelectorDiff({ elementKey, healedSelector: '' }),
    };
  }

  const diff = buildHealedSelectorDiff({
    elementKey,
    healedSelector: healing.healedSelector,
  });

  const persisted = await persistHealedSelectorOverride({
    elementKey,
    healedSelector: healing.healedSelector,
    metadata: {
      portal,
      confidence: healing.confidence,
      reason: 'testsprite_autonomous_healing',
    },
  });

  return {
    ok: true,
    healing,
    diff,
    persisted,
  };
}

export async function coordinateFailureWithAg2({ payload = {}, classification = {} } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return {
      provider: 'local-fallback',
      decision: 'alert_operator',
      reason: 'AG2 not configured. Local fallback engaged.',
      actions: ['alert_operator', 'flag_portal_layout_change'],
      payload,
      classification,
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clean(process.env.AG2_API_KEY, 5000)
        ? { authorization: `Bearer ${clean(process.env.AG2_API_KEY, 5000)}` }
        : {}),
    },
    body: JSON.stringify({
      role: 'Portal Failure Coordinator',
      objective:
        'Classify TestSprite failures, decide whether to alert operators immediately, and determine whether auto-healing should run.',
      classification,
      failure: payload,
    }),
  });

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    return {
      provider: 'ag2',
      decision: 'alert_operator',
      reason: clean(parsed?.error || parsed?.message || 'AG2 coordination request failed.', 300),
      actions: ['alert_operator'],
      payload,
      classification,
    };
  }

  return {
    provider: 'ag2',
    decision: clean(parsed.decision || 'alert_operator', 80),
    reason: clean(parsed.reason || parsed.rationale, 300),
    actions: Array.isArray(parsed.actions) ? parsed.actions.map((item) => clean(item, 80)).filter(Boolean) : [],
    payload,
    classification,
  };
}
