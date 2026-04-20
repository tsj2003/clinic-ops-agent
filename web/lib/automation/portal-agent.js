import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getPortalCredentialSecret } from './secret-vault.js';

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function jitterMs(min = 350, max = 900) {
  const lo = Math.max(10, Number(min) || 10);
  const hi = Math.max(lo, Number(max) || lo);
  return Math.floor(lo + Math.random() * (hi - lo));
}

async function humanPause(page, min = 350, max = 900) {
  await page.waitForTimeout(jitterMs(min, max));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deepMerge(base = {}, override = {}) {
  const baseObj = asObject(base);
  const overrideObj = asObject(override);
  const merged = { ...baseObj };

  for (const [key, value] of Object.entries(overrideObj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge(baseObj[key], value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

function defaultSelectorOverridePath() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'automation', 'selector-overrides', 'uhc-selectors.json');
}

function loadSelectorOverrides() {
  const fromEnv = clean(process.env.UHC_SELECTOR_OVERRIDES_JSON, 50_000);
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv);
    } catch {
      return {};
    }
  }

  const overridePath = clean(process.env.UHC_SELECTOR_OVERRIDE_PATH || defaultSelectorOverridePath(), 2000);
  if (!overridePath) {
    return {};
  }

  try {
    if (!fs.existsSync(overridePath)) {
      return {};
    }
    const raw = fs.readFileSync(overridePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return asObject(parsed.selectors || parsed);
  } catch {
    return {};
  }
}

export function getDefaultUhcSelectors() {
  return {
    login: {
      username: '#username, input[name="username"], input[type="email"]',
      password: '#password, input[name="password"], input[type="password"]',
      submit: 'button[type="submit"], button:has-text("Sign in")',
    },
    nav: {
      priorAuthLink: 'a:has-text("Prior Authorization"), a:has-text("Prior auth")',
      newRequestButton: 'button:has-text("New Request"), button:has-text("Create Request")',
    },
    form: {
      memberId: 'input[name="memberId"], input[id*="member" i]',
      procedureCode: 'input[name="procedureCode"], input[id*="procedure" i], input[id*="cpt" i]',
      serviceDate: 'input[name="serviceDate"], input[id*="serviceDate" i], input[id*="dos" i]',
      diagnosis: 'input[name="diagnosis"], textarea[name="diagnosis"]',
      attachmentInput: 'input[type="file"]',
      submit: 'button:has-text("Submit"), button:has-text("Send")',
    },
    confirmation: {
      container: 'text=/submitted|confirmation|tracking|reference/i',
    },
  };
}

export function getUhcSelectors() {
  return deepMerge(getDefaultUhcSelectors(), loadSelectorOverrides());
}

function buildUhcSelectors() {
  return getUhcSelectors();
}

function normalizeClinicalGapPayload(clinicalGap = {}, run = {}) {
  const gap = asObject(clinicalGap);
  const missingDataPoints = Array.isArray(gap.missingDataPoints)
    ? gap.missingDataPoints.map((item) => clean(item, 300)).filter(Boolean)
    : [];

  const emrStatus = clean(
    gap.emrStatus ||
      run?.operatorPacket?.emr_sync?.status ||
      run?.emrSync?.status,
    120,
  ).toUpperCase();
  const lifecycleStatus = clean(run?.caseLifecycle?.status, 120).toLowerCase();

  const hasGap =
    gap.hasGap === true ||
    emrStatus === 'PORTAL_ACTION_REQUIRED' ||
    emrStatus === 'CLINICAL_GAP_DETECTED' ||
    lifecycleStatus === 'collecting_evidence' ||
    missingDataPoints.length > 0;

  return {
    hasGap,
    status: emrStatus || (hasGap ? 'CLINICAL_GAP_DETECTED' : 'READY_FOR_PORTAL_SUBMISSION'),
    summary: clean(
      gap.summary ||
        run?.readiness?.summary ||
        run?.operatorPacket?.emr_sync?.message ||
        run?.emrSync?.message,
      1000,
    ),
    missingDataPoints,
  };
}

export function shouldBlockPortalSubmission({ run = {}, clinicalGap = {} } = {}) {
  const payload = normalizeClinicalGapPayload(clinicalGap, run);
  return {
    blocked: payload.hasGap,
    clinicalGap: payload,
    reason: payload.hasGap
      ? 'Clinical gap detected; portal submission is blocked until evidence is remediated.'
      : '',
  };
}

async function fillIfPresent(page, selector, value) {
  const text = clean(value, 2000);
  if (!text) {
    return;
  }

  const locator = page.locator(selector).first();
  if ((await locator.count()) > 0) {
    await locator.fill(text);
  }
}

async function loginUhc(page, { credentials = {}, portalBaseUrl = '' } = {}) {
  const loginUrl = clean(portalBaseUrl || process.env.UHC_PORTAL_LOGIN_URL || 'https://www.uhcprovider.com/', 2000);
  const selectors = buildUhcSelectors();

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await humanPause(page, 450, 950);

  await fillIfPresent(page, selectors.login.username, credentials.username);
  await humanPause(page, 300, 650);
  await fillIfPresent(page, selectors.login.password, credentials.password);
  await humanPause(page, 300, 700);

  const submit = page.locator(selectors.login.submit).first();
  if ((await submit.count()) > 0) {
    await submit.click();
    await humanPause(page, 1200, 2000);
  }
}

async function navigateToPriorAuthForm(page) {
  const selectors = buildUhcSelectors();

  const priorAuthLink = page.locator(selectors.nav.priorAuthLink).first();
  if ((await priorAuthLink.count()) > 0) {
    await priorAuthLink.click();
    await humanPause(page, 900, 1600);
  }

  const newRequestButton = page.locator(selectors.nav.newRequestButton).first();
  if ((await newRequestButton.count()) > 0) {
    await newRequestButton.click();
    await humanPause(page, 1000, 1800);
  }
}

async function fillPriorAuthRequest(page, run = {}, attachmentPath = '') {
  const selectors = buildUhcSelectors();
  const packet = run?.operatorPacket || {};

  await fillIfPresent(page, selectors.form.memberId, packet.member_id || run?.intake?.memberId);
  await humanPause(page, 220, 460);
  await fillIfPresent(page, selectors.form.procedureCode, packet.procedure_code || run?.intake?.procedureCode);
  await humanPause(page, 220, 460);
  await fillIfPresent(page, selectors.form.serviceDate, packet.service_date || run?.intake?.serviceDate);
  await humanPause(page, 220, 460);
  await fillIfPresent(page, selectors.form.diagnosis, packet.diagnosis || run?.intake?.diagnosis);
  await humanPause(page, 300, 550);

  const upload = page.locator(selectors.form.attachmentInput).first();
  if ((await upload.count()) > 0 && clean(attachmentPath, 2000)) {
    await upload.setInputFiles(attachmentPath);
    await humanPause(page, 800, 1200);
  }
}

async function submitPriorAuth(page) {
  const selectors = buildUhcSelectors();
  const submit = page.locator(selectors.form.submit).first();
  if ((await submit.count()) > 0) {
    await submit.click();
  }
  await humanPause(page, 1200, 2200);
}

export class PortalSessionManager {
  constructor({ headless = true } = {}) {
    this.headless = headless;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async open() {
    const { chromium } = await import('playwright');

    try {
      this.browser = await chromium.launch({ headless: this.headless });
    } catch (error) {
      if (this.headless) {
        this.browser = await chromium.launch({ headless: false });
      } else {
        throw error;
      }
    }

    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1024 } });
    this.page = await this.context.newPage();
    return this.page;
  }

  async close() {
    try {
      await this.context?.close();
    } catch {
      // best effort cleanup
    }
    try {
      await this.browser?.close();
    } catch {
      // best effort cleanup
    }
  }
}

export async function runUhcPortalSubmission({
  run = {},
  attachmentPath = '',
  headless = true,
  portalBaseUrl = '',
  clinicalGap = {},
  sessionFactory = null,
  executeFlow = null,
} = {}) {
  const guard = shouldBlockPortalSubmission({ run, clinicalGap });
  if (guard.blocked) {
    return {
      ok: false,
      blocked: true,
      requiresManualAction: true,
      jellyBeanAlert: 'CLINICAL_GAP_DETECTED',
      error: guard.reason,
      clinicalGap: guard.clinicalGap,
      mode: headless ? 'headless' : 'headful',
      page: null,
    };
  }

  const session = new PortalSessionManager({ headless });
  const effectiveSession = typeof sessionFactory === 'function' ? sessionFactory({ headless, run }) : session;
  const credentials = getPortalCredentialSecret('uhc');
  const flowExecutor =
    typeof executeFlow === 'function'
      ? executeFlow
      : async ({ page, credentials: flowCredentials, flowPortalBaseUrl, flowRun, flowAttachmentPath }) => {
          await loginUhc(page, { credentials: flowCredentials, portalBaseUrl: flowPortalBaseUrl });
          await navigateToPriorAuthForm(page);
          await fillPriorAuthRequest(page, flowRun, flowAttachmentPath);
          await submitPriorAuth(page);
        };

  if (credentials.source === 'vault-reference' && !clean(credentials.username) && !clean(credentials.password)) {
    throw new Error('UHC portal credential secret is configured as vault reference and requires runtime resolver.');
  }

  try {
    const page = await effectiveSession.open();
    await flowExecutor({
      page,
      credentials: asObject(credentials),
      flowPortalBaseUrl: portalBaseUrl,
      flowRun: asObject(run),
      flowAttachmentPath: attachmentPath,
      clinicalGap: guard.clinicalGap,
    });

    return {
      ok: true,
      page,
      mode: effectiveSession.headless ? 'headless' : 'headful',
      message: 'Portal submission flow reached confirmation state.',
      clinicalGap: guard.clinicalGap,
    };
  } catch (error) {
    return {
      ok: false,
      page: effectiveSession.page,
      mode: effectiveSession.headless ? 'headless' : 'headful',
      error: error instanceof Error ? error.message : 'Portal automation failed.',
      requiresManualAction: true,
      jellyBeanAlert: 'MANUAL_ACTION_REQUIRED',
      clinicalGap: guard.clinicalGap,
    };
  } finally {
    // caller may still need page for proof capture; close manually in caller.
  }
}
