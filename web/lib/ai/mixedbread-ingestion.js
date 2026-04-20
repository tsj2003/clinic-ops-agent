import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

import { connectPolicyVectorStore, generateEmbeddings } from './mixedbread-client.js';

const DEFAULT_WHOLEMBED_V3_MODEL = 'mixedbread-ai/wholembed-v3';
const DEFAULT_CHUNK_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP_CHARS = 250;

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

function modulePilotVaultDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'policy-sentinel');
}

function resolveReindexLedgerPath() {
  return clean(
    process.env.POLICY_SENTINEL_REINDEX_LEDGER_PATH ||
      path.join(modulePilotVaultDir(), 'reindex-ledger.json'),
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

function chunkText(text = '', {
  chunkChars = DEFAULT_CHUNK_CHARS,
  overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS,
} = {}) {
  const normalizedText = clean(text, 5_000_000);
  if (!normalizedText) {
    return [];
  }

  const size = Math.max(500, asNumber(chunkChars, DEFAULT_CHUNK_CHARS));
  const overlap = Math.max(0, Math.min(size - 50, asNumber(overlapChars, DEFAULT_CHUNK_OVERLAP_CHARS)));
  const step = Math.max(1, size - overlap);

  const chunks = [];
  for (let cursor = 0; cursor < normalizedText.length; cursor += step) {
    const slice = normalizedText.slice(cursor, cursor + size);
    if (!slice) {
      break;
    }
    chunks.push(slice);
    if (cursor + size >= normalizedText.length) {
      break;
    }
  }

  return chunks;
}

function buildChunkRecord({
  policyId = '',
  payerId = '',
  procedureCategory = '',
  sourceUrl = '',
  title = '',
  manifestHash = '',
  updatedAt = '',
  chunkTextValue = '',
  chunkIndex = 0,
} = {}) {
  const recordKey = [
    clean(policyId, 200),
    clean(manifestHash, 120),
    String(chunkIndex),
  ].join('|');

  const id = createHash('sha256').update(recordKey).digest('hex');

  return {
    id,
    text: clean(chunkTextValue, 20_000),
    metadata: {
      policyId: clean(policyId, 200),
      payerId: clean(payerId, 120).toLowerCase(),
      procedureCodes: clean(procedureCategory, 120)
        .split(',')
        .map((item) => clean(item, 40).toUpperCase())
        .filter(Boolean)
        .slice(0, 10),
      title: clean(title, 300),
      sourceUrl: clean(sourceUrl, 1200),
      updatedAt: clean(updatedAt, 80) || new Date().toISOString(),
      policyHash: clean(manifestHash, 120),
      chunkIndex,
      ingestionSource: 'policy_sentinel_wholembed_v3',
    },
  };
}

export async function loadReindexLedger({ ledgerPath = '' } = {}) {
  const target = clean(ledgerPath || resolveReindexLedgerPath(), 2000);
  const parsed = asObject(await readJsonFile(target));

  return {
    path: target,
    version: clean(parsed.version, 40) || '2026-04-16.policy-sentinel.reindex.v1',
    reindexed: asObject(parsed.reindexed),
    events: asArray(parsed.events),
    updatedAt: clean(parsed.updatedAt, 80),
  };
}

async function saveReindexLedger(ledger = {}) {
  const payload = {
    version: clean(ledger.version, 80) || '2026-04-16.policy-sentinel.reindex.v1',
    reindexed: asObject(ledger.reindexed),
    events: asArray(ledger.events).slice(-1000),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(clean(ledger.path, 2000), payload);
  return payload;
}

function wasAlreadyReindexed(ledger = {}, idempotencyKey = '') {
  const normalized = clean(idempotencyKey, 200);
  if (!normalized) {
    return false;
  }
  return Boolean(asObject(ledger.reindexed)[normalized]);
}

async function markReindexed(ledger = {}, {
  idempotencyKey = '',
  policyId = '',
  manifestHash = '',
  backend = '',
  records = 0,
  model = '',
} = {}) {
  const normalizedKey = clean(idempotencyKey, 200);
  if (!normalizedKey) {
    return;
  }

  ledger.reindexed = asObject(ledger.reindexed);
  ledger.events = asArray(ledger.events);

  ledger.reindexed[normalizedKey] = {
    policyId: clean(policyId, 200),
    manifestHash: clean(manifestHash, 120),
    backend: clean(backend, 120),
    records: asNumber(records, 0),
    model: clean(model, 200),
    ingestedAt: new Date().toISOString(),
  };

  ledger.events.push({
    type: 'wholembed_hot_reload',
    idempotencyKey: normalizedKey,
    policyId: clean(policyId, 200),
    manifestHash: clean(manifestHash, 120),
    backend: clean(backend, 120),
    records: asNumber(records, 0),
    model: clean(model, 200),
    timestamp: new Date().toISOString(),
  });

  await saveReindexLedger(ledger);
}

export async function ingestPolicyDocumentWholembed({
  policyId = '',
  payerId = '',
  procedureCategory = '',
  title = '',
  sourceUrl = '',
  manifestHash = '',
  idempotencyKey = '',
  policyText = '',
  updatedAt = '',
  model = '',
  embeddingFn = null,
  vectorStore = null,
  ledgerPath = '',
  chunkChars,
  overlapChars,
} = {}) {
  const normalizedPolicyId = clean(policyId, 200);
  const normalizedHash = clean(manifestHash, 120);
  const normalizedIdempotencyKey = clean(idempotencyKey, 200) || normalizedHash;
  const normalizedModel = clean(model, 200) || clean(process.env.MIXEDBREAD_WHOLEMBED_MODEL, 200) || DEFAULT_WHOLEMBED_V3_MODEL;

  if (!normalizedPolicyId || !normalizedHash || !clean(policyText, 50_000)) {
    throw new Error('policyId, manifestHash, and policyText are required for Mixedbread hot reload.');
  }

  const ledger = await loadReindexLedger({ ledgerPath });
  if (wasAlreadyReindexed(ledger, normalizedIdempotencyKey)) {
    return {
      ok: true,
      skipped: true,
      reason: 'Policy version already re-indexed (idempotent skip).',
      idempotencyKey: normalizedIdempotencyKey,
      policyId: normalizedPolicyId,
      manifestHash: normalizedHash,
    };
  }

  const chunks = chunkText(policyText, {
    chunkChars,
    overlapChars,
  });
  if (!chunks.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'No policy text chunks generated.',
      idempotencyKey: normalizedIdempotencyKey,
      policyId: normalizedPolicyId,
      manifestHash: normalizedHash,
    };
  }

  const records = chunks
    .map((item, index) =>
      buildChunkRecord({
        policyId: normalizedPolicyId,
        payerId,
        procedureCategory,
        sourceUrl,
        title,
        manifestHash: normalizedHash,
        updatedAt,
        chunkTextValue: item,
        chunkIndex: index,
      }),
    )
    .filter((item) => item.id && item.text);

  const embed = typeof embeddingFn === 'function'
    ? embeddingFn
    : async (inputs) => generateEmbeddings(inputs, { model: normalizedModel });

  const vectors = await embed(records.map((record) => record.text));
  const normalizedVectors = asArray(vectors)
    .map((vector) => asArray(vector).map((value) => asNumber(value)))
    .filter((vector) => vector.length > 0);

  const vectorRecords = records
    .map((record, index) => ({
      id: record.id,
      values: normalizedVectors[index] || [],
      metadata: record.metadata,
    }))
    .filter((record) => record.id && record.values.length);

  if (!vectorRecords.length) {
    throw new Error('Mixedbread embedding generation returned no vectors for policy hot reload.');
  }

  const store = vectorStore || connectPolicyVectorStore();
  const result = await store.upsert(vectorRecords);

  await markReindexed(ledger, {
    idempotencyKey: normalizedIdempotencyKey,
    policyId: normalizedPolicyId,
    manifestHash: normalizedHash,
    backend: clean(result?.backend, 120) || 'unknown',
    records: vectorRecords.length,
    model: normalizedModel,
  });

  return {
    ok: true,
    skipped: false,
    idempotencyKey: normalizedIdempotencyKey,
    policyId: normalizedPolicyId,
    manifestHash: normalizedHash,
    records: vectorRecords.length,
    backend: clean(result?.backend, 120) || 'local-hnsw-lite',
    model: normalizedModel,
  };
}
