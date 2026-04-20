import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

import { chromium } from 'playwright';

import { ingestPolicyDocumentWholembed } from '../ai/mixedbread-ingestion.js';
import { dispatchExceptionAction } from './composio-bridge.js';
import { redactFreeText } from '../privacy.js';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_POLICY_DIFF_MODEL = 'accounts/fireworks/models/qwen2p5-vl-72b-instruct';
const DEFAULT_MIN_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 5000;

const POLICY_DIFF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['criteriaChanged', 'summary'],
  properties: {
    criteriaChanged: { type: 'boolean' },
    summary: { type: 'string' },
    changedClinicalCriteria: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    newRequirements: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    confidence: { type: 'number' },
  },
};

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function modulePilotVaultDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'policy-sentinel');
}

function resolveManifestPath() {
  return clean(
    process.env.POLICY_SENTINEL_MANIFEST_PATH ||
      path.join(modulePilotVaultDir(), 'policy-manifest.json'),
    2000,
  );
}

function resolveSnapshotDir() {
  return clean(
    process.env.POLICY_SENTINEL_SNAPSHOTS_DIR ||
      path.join(modulePilotVaultDir(), 'snapshots'),
    2000,
  );
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

function parseJson(raw = '') {
  const text = clean(raw, 400_000);
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

function sha256(value = '') {
  return createHash('sha256').update(clean(value, 5_000_000)).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, asNumber(ms, 0))));
}

function randomDelayMs(minMs = DEFAULT_MIN_DELAY_MS, maxMs = DEFAULT_MAX_DELAY_MS) {
  const min = Math.max(0, asNumber(minMs, DEFAULT_MIN_DELAY_MS));
  const max = Math.max(min, asNumber(maxMs, DEFAULT_MAX_DELAY_MS));
  if (max === min) {
    return min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function defaultTargets() {
  return [
    {
      payerId: 'unitedhealthcare',
      label: 'UnitedHealthcare Medical Policies',
      searchUrl: clean(
        process.env.POLICY_SENTINEL_UHC_URL ||
          'https://www.uhcprovider.com/en/policies-protocols/clinical-guidelines.html',
        1200,
      ),
    },
    {
      payerId: 'aetna',
      label: 'Aetna Clinical Policy Bulletins',
      searchUrl: clean(
        process.env.POLICY_SENTINEL_AETNA_URL ||
          'https://www.aetna.com/health-care-professionals/clinical-policy-bulletins/medical-clinical-policy-bulletins.html',
        1200,
      ),
    },
    {
      payerId: 'cigna',
      label: 'Cigna Coverage Policies',
      searchUrl: clean(
        process.env.POLICY_SENTINEL_CIGNA_URL ||
          'https://www.cigna.com/health-care-providers/coverage-and-claims/policies',
        1200,
      ),
    },
  ].filter((item) => item.payerId && item.searchUrl);
}

function normalizeTarget(target = {}) {
  const source = asObject(target);
  return {
    payerId: clean(source.payerId || source.payer || source.key, 120).toLowerCase(),
    label: clean(source.label || source.name || source.payerId, 240),
    searchUrl: clean(source.searchUrl || source.url, 1200),
  };
}

function normalizePolicyDocument(input = {}) {
  const source = asObject(input);
  return {
    title: clean(source.title || source.text || source.name, 300),
    pdfUrl: clean(source.pdfUrl || source.url || source.href, 2000),
    lastUpdated: normalizeDate(source.lastUpdated || source.updatedAt || source.date),
    procedureCategory: clean(source.procedureCategory || source.category || source.specialty || 'general', 120),
  };
}

function buildPolicyKey({ payerId = '', pdfUrl = '' } = {}) {
  return sha256([clean(payerId, 120).toLowerCase(), clean(pdfUrl, 2000)].join('|')).slice(0, 48);
}

function buildMetadataHash({ payerId = '', document = {} } = {}) {
  const normalized = normalizePolicyDocument(document);
  return sha256(
    [
      clean(payerId, 120).toLowerCase(),
      clean(normalized.title, 300),
      clean(normalized.pdfUrl, 2000),
      clean(normalized.lastUpdated, 80),
      clean(normalized.procedureCategory, 120).toLowerCase(),
    ].join('|'),
  );
}

function extractPdfTextFromBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer)
    ? buffer.toString('latin1')
    : Buffer.from(buffer || []).toString('latin1');

  const streamMatches = raw.match(/\(([^()]|\\\(|\\\))*\)\s*Tj/g) || [];
  const textFromStreams = streamMatches
    .map((entry) => entry.replace(/\)\s*Tj$/, '').replace(/^\(/, ''))
    .map((entry) => entry.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\n/g, ' '))
    .join(' ');

  const fallback = raw.replace(/[^\x20-\x7E]+/g, ' ');
  const combined = clean([textFromStreams, fallback].filter(Boolean).join(' '), 200_000);
  return combined.replace(/\s+/g, ' ').trim();
}

function normalizePolicyManifest(manifest = {}) {
  const source = asObject(manifest);
  return {
    version: clean(source.version, 80) || '2026-04-16.policy-sentinel.manifest.v1',
    policies: asObject(source.policies),
    changes: asArray(source.changes).slice(-2000),
    crawls: asArray(source.crawls).slice(-500),
    updatedAt: clean(source.updatedAt, 80),
  };
}

export async function loadPolicyManifest({ manifestPath = '' } = {}) {
  const target = clean(manifestPath || resolveManifestPath(), 2000);
  const loaded = await readJsonFile(target);
  return {
    path: target,
    ...normalizePolicyManifest(loaded),
  };
}

export function summarizePolicySentinelManifest(manifest = {}) {
  const normalized = normalizePolicyManifest(manifest);
  const policies = asObject(normalized.policies);
  const changes = asArray(normalized.changes);
  const crawls = asArray(normalized.crawls);

  return {
    path: clean(normalized.path, 2000),
    updatedAt: clean(normalized.updatedAt, 80),
    totalPoliciesTracked: Object.keys(policies).length,
    totalChangeEvents: changes.length,
    totalCrawls: crawls.length,
    staleReloadRequired: changes.filter((item) => clean(item?.status, 120) === 'STALE_RELOAD_REQUIRED').length,
    metadataChangedOnly: changes.filter((item) => clean(item?.status, 120) === 'METADATA_CHANGED').length,
    alertsSent: changes.filter((item) => item?.alert?.alerted === true).length,
    recentPayers: [...new Set(changes.map((item) => clean(item?.payerId, 120)).filter(Boolean))].slice(0, 12),
  };
}

export async function listPolicySentinelChanges({
  manifestPath = '',
  payerId = '',
  status = '',
  limit = 25,
} = {}) {
  const manifest = await loadPolicyManifest({ manifestPath });
  const normalizedPayerId = clean(payerId, 120).toLowerCase();
  const normalizedStatus = clean(status, 120).toUpperCase();
  const normalizedLimit = Math.max(1, Math.min(200, asNumber(limit, 25)));

  const changes = asArray(manifest.changes)
    .filter((item) => {
      if (!normalizedPayerId) {
        return true;
      }
      return clean(item?.payerId, 120).toLowerCase() === normalizedPayerId;
    })
    .filter((item) => {
      if (!normalizedStatus) {
        return true;
      }
      return clean(item?.status, 120).toUpperCase() === normalizedStatus;
    })
    .sort((left, right) => Date.parse(right?.timestamp || '') - Date.parse(left?.timestamp || ''))
    .slice(0, normalizedLimit);

  return {
    manifest,
    summary: summarizePolicySentinelManifest(manifest),
    filters: {
      payerId: normalizedPayerId,
      status: normalizedStatus,
      limit: normalizedLimit,
    },
    changes,
  };
}

async function savePolicyManifest(manifest = {}) {
  const payload = {
    version: clean(manifest.version, 80) || '2026-04-16.policy-sentinel.manifest.v1',
    policies: asObject(manifest.policies),
    changes: asArray(manifest.changes).slice(-2000),
    crawls: asArray(manifest.crawls).slice(-500),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(clean(manifest.path, 2000), payload);
  return payload;
}

async function storePolicyTextSnapshot({ policyKey = '', hash = '', text = '' } = {}) {
  const dir = path.join(resolveSnapshotDir(), clean(policyKey, 80));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${clean(hash, 120)}.txt`);
  await fs.writeFile(filePath, `${clean(text, 400_000)}\n`, 'utf-8');
  return filePath;
}

async function readPolicyTextSnapshot({ policyKey = '', hash = '' } = {}) {
  const filePath = path.join(resolveSnapshotDir(), clean(policyKey, 80), `${clean(hash, 120)}.txt`);
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export async function coordinateCrawlerAgentWithAg2({ targets = [] } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  const normalizedTargets = asArray(targets).map((item) => normalizeTarget(item)).filter((item) => item.payerId && item.searchUrl);

  if (!endpoint) {
    return {
      provider: 'local-fallback',
      targets: normalizedTargets,
      reason: 'AG2 not configured; using local target list.',
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
      role: 'Crawler Agent',
      objective: 'Prioritize payer medical policy URLs and return crawl-ready targets for policy sentinel monitoring.',
      targets: normalizedTargets,
      constraints: {
        maxTargets: 20,
        onlyHttps: true,
      },
    }),
  });

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    return {
      provider: 'ag2',
      targets: normalizedTargets,
      reason: clean(parsed?.reason || parsed?.error || parsed?.message || 'AG2 returned non-OK status.', 300),
    };
  }

  const returnedTargets = asArray(parsed.targets)
    .map((item) => normalizeTarget(item))
    .filter((item) => item.payerId && item.searchUrl);

  return {
    provider: 'ag2',
    targets: returnedTargets.length ? returnedTargets : normalizedTargets,
    reason: clean(parsed?.reason || parsed?.rationale, 300),
  };
}

export async function crawlPolicyTargetWithPlaywright(target = {}) {
  const normalizedTarget = normalizeTarget(target);
  if (!normalizedTarget.searchUrl || !normalizedTarget.payerId) {
    throw new Error('Target payerId and searchUrl are required for crawling.');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (compatible; AuthPilotPolicySentinel/1.0; +https://authpilot.ai/policy-sentinel)',
    });
    const page = await context.newPage();

    await page.goto(normalizedTarget.searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(20_000, asNumber(process.env.POLICY_SENTINEL_PAGE_TIMEOUT_MS, 45_000)),
    });

    const discovered = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));

      return links
        .map((anchor) => {
          const href = anchor.href || '';
          const title = (anchor.textContent || '').trim();
          const nearbyText = [
            anchor.closest('li')?.textContent || '',
            anchor.closest('tr')?.textContent || '',
            anchor.parentElement?.textContent || '',
          ]
            .filter(Boolean)
            .join(' ')
            .slice(0, 1200);

          const dateMatch = nearbyText.match(
            /(last\s*updated|updated|revision\s*date|effective\s*date)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
          );

          const categoryMatch = nearbyText.match(
            /(mri|oncology|cardiology|radiology|musculoskeletal|pain|sleep|genetic|surgery)/i,
          );

          return {
            pdfUrl: href,
            title,
            lastUpdated: dateMatch?.[2] || '',
            procedureCategory: categoryMatch?.[1] || 'general',
          };
        })
        .filter((item) => /\.pdf(\?|$)/i.test(item.pdfUrl));
    });

    await context.close();

    return {
      target: normalizedTarget,
      documents: asArray(discovered)
        .map((item) => normalizePolicyDocument(item))
        .filter((item) => item.pdfUrl),
    };
  } finally {
    await browser.close();
  }
}

async function downloadPdfBuffer(pdfUrl = '') {
  const response = await fetch(clean(pdfUrl, 2000), {
    method: 'GET',
    headers: {
      accept: 'application/pdf,*/*;q=0.9',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(clean(body || `Unable to download PDF (${response.status}).`, 500));
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function detectConservativeTreatmentDelta(diff = {}) {
  const text = [
    clean(diff.summary, 2000),
    ...asArray(diff.changedClinicalCriteria).map((item) => clean(item, 400)),
    ...asArray(diff.newRequirements).map((item) => clean(item, 400)),
  ]
    .join(' ')
    .toLowerCase();

  if (!text) {
    return '';
  }

  const hasPt = /physical\s*therapy|\bpt\b/.test(text);
  const hasWeekSignal = /\b(\d{1,2})\s*[- ]?week/.test(text);
  if (!hasPt || !hasWeekSignal) {
    return '';
  }

  const weekMatch = text.match(/(\d{1,2})\s*[- ]?week/);
  const weeks = weekMatch?.[1] ? `${weekMatch[1]} weeks` : 'updated duration';
  return `Conservative treatment requirement changed; policy now indicates ${weeks} of PT.`;
}

export async function performSemanticPolicyDiffWithFireworks({
  previousText = '',
  currentText = '',
  payerId = '',
  policyTitle = '',
  policyUrl = '',
  model = '',
} = {}) {
  const apiKey = clean(process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is required for policy semantic diffing.');
  }

  const chosenModel = clean(model, 200) || clean(process.env.FIREWORKS_POLICY_DIFF_MODEL, 200) || DEFAULT_POLICY_DIFF_MODEL;

  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: chosenModel,
      temperature: 0,
      max_tokens: 1000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'PolicySemanticDiffSchema',
          strict: true,
          schema: POLICY_DIFF_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a payer policy diff specialist.',
            'Compare prior and updated policy text and identify only meaningful clinical-criteria changes.',
            'Ignore formatting, pagination, branding, and layout-only differences.',
            'Return strict JSON only.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Payer: ${clean(payerId, 120)}`,
            `Policy: ${clean(policyTitle, 300)}`,
            `URL: ${clean(policyUrl, 1200)}`,
            'Previous policy text:',
            clean(previousText, 80_000) || '[none]',
            'Current policy text:',
            clean(currentText, 80_000) || '[none]',
          ].join('\n\n'),
        },
      ],
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.message || 'Policy semantic diff failed.', 500));
  }

  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '{}';
  const parsed = parseJson(content);

  return {
    criteriaChanged: Boolean(parsed.criteriaChanged),
    summary: redactFreeText(clean(parsed.summary, 2000), { maxLength: 2000 }),
    changedClinicalCriteria: asArray(parsed.changedClinicalCriteria)
      .map((item) => redactFreeText(clean(item, 400), { maxLength: 400 }))
      .filter(Boolean),
    newRequirements: asArray(parsed.newRequirements)
      .map((item) => redactFreeText(clean(item, 400), { maxLength: 400 }))
      .filter(Boolean),
    confidence: asNumber(parsed.confidence, 0),
    modelUsed: chosenModel,
  };
}

async function maybeDispatchClinicAlert({
  payerId = '',
  policyTitle = '',
  policyUrl = '',
  diff = {},
  runId = '',
  alertDispatcher = null,
} = {}) {
  const conservativeDelta = detectConservativeTreatmentDelta(diff);
  if (!conservativeDelta) {
    return {
      alerted: false,
      reason: 'No conservative treatment delta detected.',
    };
  }

  const message = redactFreeText(
    [
      `Policy Sentinel Alert: ${clean(payerId, 120).toUpperCase()} policy change may affect billability.`,
      `Policy: ${clean(policyTitle, 300)}`,
      `URL: ${clean(policyUrl, 1200)}`,
      `Impact: ${conservativeDelta}`,
      clean(diff.summary, 800),
    ]
      .filter(Boolean)
      .join(' | '),
    { maxLength: 1800 },
  );

  const dispatch =
    typeof alertDispatcher === 'function'
      ? alertDispatcher
      : async ({ synthesizedRunId, note }) =>
          dispatchExceptionAction({
            run: {
              appRunId: synthesizedRunId,
              operatorPacket: {
                emr_sync: {
                  status: 'UNBILLABLE_RISK',
                },
              },
            },
            actionType: 'nudge_doctor_slack',
            note,
          });

  const synthesizedRunId = clean(runId, 120) || `policy-sentinel-${Date.now().toString(36)}`;
  const result = await dispatch({
    synthesizedRunId,
    note: message,
  }).catch((error) => ({
    ok: false,
    skipped: true,
    reason: error instanceof Error ? error.message : 'Policy alert dispatch failed.',
  }));

  return {
    alerted: result?.ok === true && result?.skipped !== true,
    result,
    message,
  };
}

export async function runPolicySentinel({
  targets = [],
  manifestPath = '',
  crawler = null,
  semanticDiff = null,
  downloader = null,
  reindexer = null,
  alertDispatcher = null,
  minDelayMs = DEFAULT_MIN_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
} = {}) {
  const manifest = await loadPolicyManifest({ manifestPath });
  manifest.policies = asObject(manifest.policies);
  manifest.changes = asArray(manifest.changes);
  manifest.crawls = asArray(manifest.crawls);

  const requestedTargets = asArray(targets).length ? asArray(targets) : defaultTargets();
  const normalizedTargets = requestedTargets
    .map((item) => normalizeTarget(item))
    .filter((item) => item.payerId && item.searchUrl);

  const coordination = await coordinateCrawlerAgentWithAg2({
    targets: normalizedTargets,
  });

  const crawlTargets = asArray(coordination.targets)
    .map((item) => normalizeTarget(item))
    .filter((item) => item.payerId && item.searchUrl);

  const crawlFn = typeof crawler === 'function' ? crawler : crawlPolicyTargetWithPlaywright;
  const semanticDiffFn =
    typeof semanticDiff === 'function' ? semanticDiff : performSemanticPolicyDiffWithFireworks;
  const downloadFn = typeof downloader === 'function' ? downloader : downloadPdfBuffer;
  const reindexFn =
    typeof reindexer === 'function'
      ? reindexer
      : async (payload) => ingestPolicyDocumentWholembed(payload);

  const summary = {
    ok: true,
    startedAt: new Date().toISOString(),
    provider: coordination.provider,
    targets: crawlTargets.length,
    discoveredPolicies: 0,
    unchanged: 0,
    changed: 0,
    staleReloadRequired: 0,
    reindexed: 0,
    alertsSent: 0,
    errors: [],
    changes: [],
  };

  for (let index = 0; index < crawlTargets.length; index += 1) {
    if (index > 0) {
      await sleep(randomDelayMs(minDelayMs, maxDelayMs));
    }

    const target = crawlTargets[index];
    try {
      const crawlResult = await crawlFn(target);
      const documents = asArray(crawlResult?.documents)
        .map((item) => normalizePolicyDocument(item))
        .filter((item) => item.pdfUrl);
      summary.discoveredPolicies += documents.length;

      manifest.crawls.push({
        payerId: target.payerId,
        label: target.label,
        searchUrl: target.searchUrl,
        discoveredPolicies: documents.length,
        timestamp: new Date().toISOString(),
      });

      for (const document of documents) {
        const policyKey = buildPolicyKey({
          payerId: target.payerId,
          pdfUrl: document.pdfUrl,
        });
        const nextHash = buildMetadataHash({
          payerId: target.payerId,
          document,
        });

        const existing = asObject(manifest.policies[policyKey]);
        if (clean(existing.latestHash, 120) === nextHash) {
          summary.unchanged += 1;
          continue;
        }

        summary.changed += 1;
        const changeRecord = {
          type: 'policy_change_detected',
          policyKey,
          payerId: target.payerId,
          title: document.title,
          pdfUrl: document.pdfUrl,
          lastUpdated: document.lastUpdated,
          previousHash: clean(existing.latestHash, 120),
          latestHash: nextHash,
          status: 'METADATA_CHANGED',
          semantic: null,
          reindex: null,
          alert: null,
          timestamp: new Date().toISOString(),
        };

        const previousText = clean(existing.latestHash, 120)
          ? await readPolicyTextSnapshot({ policyKey, hash: clean(existing.latestHash, 120) })
          : '';

        const pdfBuffer = await downloadFn(document.pdfUrl);
        const currentText = extractPdfTextFromBuffer(pdfBuffer);
        const snapshotPath = await storePolicyTextSnapshot({
          policyKey,
          hash: nextHash,
          text: currentText,
        });

        const semantic = await semanticDiffFn({
          previousText,
          currentText,
          payerId: target.payerId,
          policyTitle: document.title,
          policyUrl: document.pdfUrl,
        });

        changeRecord.semantic = {
          criteriaChanged: semantic?.criteriaChanged === true,
          summary: redactFreeText(clean(semantic?.summary, 2000), { maxLength: 2000 }),
          changedClinicalCriteria: asArray(semantic?.changedClinicalCriteria)
            .map((item) => redactFreeText(clean(item, 300), { maxLength: 300 }))
            .filter(Boolean),
          newRequirements: asArray(semantic?.newRequirements)
            .map((item) => redactFreeText(clean(item, 300), { maxLength: 300 }))
            .filter(Boolean),
          confidence: asNumber(semantic?.confidence, 0),
          modelUsed: clean(semantic?.modelUsed, 200),
        };

        if (semantic?.criteriaChanged === true) {
          summary.staleReloadRequired += 1;
          changeRecord.status = 'STALE_RELOAD_REQUIRED';

          const reindex = await reindexFn({
            policyId: policyKey,
            payerId: target.payerId,
            procedureCategory: document.procedureCategory,
            title: document.title,
            sourceUrl: document.pdfUrl,
            manifestHash: nextHash,
            idempotencyKey: nextHash,
            policyText: currentText,
            updatedAt: document.lastUpdated,
          });

          changeRecord.reindex = asObject(reindex);
          if (reindex?.ok === true && reindex?.skipped !== true) {
            summary.reindexed += 1;
          }

          const alert = await maybeDispatchClinicAlert({
            payerId: target.payerId,
            policyTitle: document.title,
            policyUrl: document.pdfUrl,
            diff: changeRecord.semantic,
            runId: `policy-${policyKey.slice(0, 18)}-${nextHash.slice(0, 10)}`,
            alertDispatcher,
          });

          changeRecord.alert = alert;
          if (alert?.alerted) {
            summary.alertsSent += 1;
          }
        }

        manifest.policies[policyKey] = {
          payerId: target.payerId,
          title: document.title,
          pdfUrl: document.pdfUrl,
          procedureCategory: document.procedureCategory,
          lastUpdated: document.lastUpdated,
          latestHash: nextHash,
          previousHash: clean(existing.latestHash, 120),
          latestSnapshotPath: snapshotPath,
          lastSemanticStatus: clean(changeRecord.status, 120),
          lastSemanticSummary: clean(changeRecord.semantic?.summary, 1000),
          updatedAt: new Date().toISOString(),
        };

        manifest.changes.push(changeRecord);
        summary.changes.push(changeRecord);
      }
    } catch (error) {
      summary.errors.push({
        payerId: target.payerId,
        searchUrl: target.searchUrl,
        message: error instanceof Error ? error.message : 'Unknown sentinel crawler error.',
      });
    }
  }

  summary.ok = summary.errors.length === 0;
  summary.completedAt = new Date().toISOString();
  await savePolicyManifest(manifest);

  return summary;
}
