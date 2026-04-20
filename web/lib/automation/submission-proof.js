import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { getScopedDataDir, isPilotVaultScope } from '@/lib/data-scope';

const SCREENSHOT_RETENTION_DAYS = 30;

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function toSafeSlug(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function nowIso() {
  return new Date().toISOString();
}

function toFileStamp(iso) {
  return clean(iso, 40).replace(/[:.]/g, '-');
}

function moduleDataDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return getScopedDataDir(moduleDir);
}

async function ensureProofDir() {
  const dir = path.join(moduleDataDir(), 'automation', 'submission-proof');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function enforceProofRetention(days = SCREENSHOT_RETENTION_DAYS) {
  const proofDir = await ensureProofDir();
  const entries = await fs.readdir(proofDir, { withFileTypes: true });
  const cutoffMs = Date.now() - Math.max(1, Number(days) || SCREENSHOT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolutePath = path.join(proofDir, entry.name);
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.mtimeMs < cutoffMs) {
        await fs.unlink(absolutePath);
      }
    } catch (error) {
      // best effort cleanup
    }
  }
}

function extractUhcTrackingText(content = '') {
  const text = clean(content, 40_000);
  const patterns = [
    /tracking\s*(?:id|number)\s*[:#]?\s*([A-Z0-9-]{6,})/i,
    /reference\s*(?:id|number)\s*[:#]?\s*([A-Z0-9-]{6,})/i,
    /confirmation\s*(?:id|number)\s*[:#]?\s*([A-Z0-9-]{6,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return clean(match[1], 120);
    }
  }
  return '';
}

export async function captureSubmissionProof({ page, payerKey = 'payer', runId = '', emrTaskId = '' } = {}) {
  if (!page) {
    throw new Error('Playwright page is required to capture submission proof.');
  }

  if (!isPilotVaultScope()) {
    throw new Error('Submission proof capture is allowed only in pilot-vault scope.');
  }

  await enforceProofRetention();

  const capturedAt = nowIso();
  const stamp = toFileStamp(capturedAt);
  const fileName = `${toSafeSlug(payerKey)}-${toSafeSlug(runId)}-${toSafeSlug(emrTaskId)}-${stamp}.png`;
  const proofDir = await ensureProofDir();
  const absolutePath = path.join(proofDir, fileName);

  await page.screenshot({ path: absolutePath, fullPage: true });
  const content = await page.content();
  const payerReferenceId = extractUhcTrackingText(content) || `MANUAL-${toSafeSlug(runId)}-${stamp}`;

  return {
    payerReferenceId,
    capturedAt,
    screenshotPath: absolutePath,
    screenshotFileName: fileName,
    retentionDays: SCREENSHOT_RETENTION_DAYS,
  };
}
