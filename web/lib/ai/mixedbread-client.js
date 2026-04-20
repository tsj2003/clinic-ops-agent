import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { MixedbreadAIClient } from '@mixedbread-ai/sdk';

const DEFAULT_EMBED_MODEL = 'mixedbread-ai/mxbai-embed-large-v1';
const DEFAULT_RERANK_MODEL = 'mixedbread-ai/mxbai-rerank-large-v2';
const MIXEDBREAD_BASE_URL = 'https://api.mixedbread.ai/v1';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value) {
  const text = clean(value, 500_000);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function policyLibraryRoot() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDir, '..', '..', '.data', 'policy-library');
  assertPolicyLibraryIsolation(root);
  return root;
}

function policyChunkPath() {
  return clean(process.env.POLICY_LIBRARY_CHUNKS_PATH || path.join(policyLibraryRoot(), 'policy-chunks.json'), 2000);
}

function policyVectorPath() {
  return clean(process.env.POLICY_VECTOR_INDEX_PATH || path.join(policyLibraryRoot(), 'vector-index.json'), 2000);
}

function assertPolicyLibraryIsolation(targetPath = '') {
  const normalized = clean(targetPath, 2000).toLowerCase().replace(/\\/g, '/');
  if (!normalized) {
    return;
  }

  if (normalized.includes('/pilot-vault')) {
    throw new Error('Policy ingestion path must remain isolated from /pilot-vault to prevent PHI leakage.');
  }
}

function normalizePolicyChunk(chunk = {}) {
  const normalized = asObject(chunk);
  const procedureCodes = asArray(normalized.procedureCodes || normalized.cptCodes || normalized.codes)
    .map((code) => clean(code, 40).toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  return {
    id: clean(normalized.id || normalized.chunkId || `${clean(normalized.payerId, 120)}-${procedureCodes[0] || 'general'}-${clean(normalized.title, 80)}`, 180),
    payerId: clean(normalized.payerId || normalized.payer || '', 120).toLowerCase(),
    procedureCodes,
    title: clean(normalized.title || normalized.policyName || 'Policy Chunk', 300),
    sourceUrl: clean(normalized.sourceUrl || normalized.policyUrl || '', 1000),
    text: clean(normalized.text || normalized.content || '', 12_000),
    updatedAt: clean(normalized.updatedAt || new Date().toISOString(), 80),
  };
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseJson(raw);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export class LocalHnswPolicyStore {
  constructor({ indexPath = '' } = {}) {
    this.indexPath = clean(indexPath || policyVectorPath(), 2000);
    assertPolicyLibraryIsolation(this.indexPath);
    this.vectors = [];
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }
    const existing = await readJsonFile(this.indexPath);
    this.vectors = asArray(existing?.vectors).map((item) => ({
      id: clean(item.id, 180),
      values: asArray(item.values).map((value) => toNumber(value)),
      metadata: asObject(item.metadata),
    }));
    this.loaded = true;
  }

  async persist() {
    await writeJsonFile(this.indexPath, {
      vectors: this.vectors,
      updatedAt: new Date().toISOString(),
      backend: 'local-hnsw-lite',
    });
  }

  async upsert(records = []) {
    await this.load();

    for (const record of asArray(records)) {
      const id = clean(record.id, 180);
      if (!id) {
        continue;
      }
      const values = asArray(record.values).map((value) => toNumber(value));
      if (!values.length) {
        continue;
      }

      const metadata = asObject(record.metadata);
      const existingIndex = this.vectors.findIndex((item) => item.id === id);
      if (existingIndex >= 0) {
        this.vectors[existingIndex] = { id, values, metadata };
      } else {
        this.vectors.push({ id, values, metadata });
      }
    }

    await this.persist();
    return { ok: true, count: this.vectors.length, backend: 'local-hnsw-lite' };
  }

  async query(vector = [], { topK = 10, filter = null } = {}) {
    await this.load();
    const queryVector = asArray(vector).map((value) => toNumber(value));
    if (!queryVector.length) {
      return [];
    }

    const filterObject = asObject(filter);

    const scored = this.vectors
      .filter((item) => {
        if (!Object.keys(filterObject).length) {
          return true;
        }
        return Object.entries(filterObject).every(([key, value]) => {
          const candidate = item.metadata?.[key];
          if (Array.isArray(candidate)) {
            return candidate.map((v) => String(v).toLowerCase()).includes(String(value).toLowerCase());
          }
          return String(candidate || '').toLowerCase() === String(value || '').toLowerCase();
        });
      })
      .map((item) => ({
        id: item.id,
        score: cosineSimilarity(queryVector, item.values),
        metadata: item.metadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(topK) || 10));

    return scored;
  }
}

class PineconePolicyStore {
  constructor({ apiKey, indexHost, namespace = '' } = {}) {
    this.apiKey = clean(apiKey, 5000);
    this.indexHost = clean(indexHost, 1200).replace(/\/+$/, '');
    this.namespace = clean(namespace || process.env.PINECONE_NAMESPACE || 'payer-policy-rules', 120);
  }

  async upsert(records = []) {
    const vectors = asArray(records).map((record) => ({
      id: clean(record.id, 180),
      values: asArray(record.values).map((value) => toNumber(value)),
      metadata: asObject(record.metadata),
    }));

    const response = await fetch(`${this.indexHost}/vectors/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        namespace: this.namespace,
        vectors,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(clean(body || 'Pinecone upsert failed.', 500));
    }

    return { ok: true, count: vectors.length, backend: 'pinecone' };
  }

  async query(vector = [], { topK = 10, filter = null } = {}) {
    const response = await fetch(`${this.indexHost}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        namespace: this.namespace,
        topK: Math.max(1, Number(topK) || 10),
        includeMetadata: true,
        vector: asArray(vector).map((value) => toNumber(value)),
        ...(Object.keys(asObject(filter)).length ? { filter: asObject(filter) } : {}),
      }),
    });

    const raw = await response.text();
    const payload = parseJson(raw);

    if (!response.ok) {
      throw new Error(clean(payload?.message || payload?.error || 'Pinecone query failed.', 500));
    }

    return asArray(payload.matches).map((match) => ({
      id: clean(match.id, 180),
      score: toNumber(match.score),
      metadata: asObject(match.metadata),
    }));
  }
}

export function createMixedbreadClient() {
  const apiKey = clean(process.env.MIXEDBREAD_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('MIXEDBREAD_API_KEY is required for policy embeddings.');
  }

  const sdkClient = new MixedbreadAIClient({ apiKey });
  return {
    apiKey,
    sdkClient,
  };
}

async function embedWithSdk(client, inputs = [], model = DEFAULT_EMBED_MODEL) {
  const target = client?.sdkClient?.embeddings;
  if (typeof target !== 'function') {
    return null;
  }

  try {
    const payload = await target({
      model,
      input: asArray(inputs),
    });
    return payload;
  } catch {
    return null;
  }
}

async function rerankWithSdk(client, query = '', documents = [], model = DEFAULT_RERANK_MODEL, topK = 5) {
  const target = client?.sdkClient?.reranking;
  if (typeof target !== 'function') {
    return null;
  }

  try {
    const payload = await target({
      model,
      query,
      input: asArray(documents),
      topK,
    });
    return payload;
  } catch {
    return null;
  }
}

async function mixedbreadFetch(client, endpoint = '', body = {}) {
  const response = await fetch(`${MIXEDBREAD_BASE_URL}/${clean(endpoint, 120).replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${client.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  const payload = parseJson(raw);
  if (!response.ok) {
    throw new Error(clean(payload?.error || payload?.message || `Mixedbread request failed (${response.status})`, 500));
  }
  return payload;
}

export async function generateEmbeddings(inputs = [], { model = DEFAULT_EMBED_MODEL } = {}) {
  const normalizedInputs = asArray(inputs).map((value) => clean(value, 20_000)).filter(Boolean);
  if (!normalizedInputs.length) {
    return [];
  }

  const client = createMixedbreadClient();
  const forceFetch = clean(process.env.MIXEDBREAD_USE_FETCH_ONLY, 20).toLowerCase() === 'true';

  let payload = null;
  if (!forceFetch) {
    payload = await embedWithSdk(client, normalizedInputs, model);
  }

  if (!payload) {
    payload = await mixedbreadFetch(client, 'embeddings', {
      model,
      input: normalizedInputs,
    });
  }

  const data = asArray(payload?.data || payload?.embeddings || payload?.results);
  if (!data.length && Array.isArray(payload)) {
    return payload;
  }

  return data.map((item) => {
    if (Array.isArray(item)) {
      return item.map((value) => toNumber(value));
    }
    return asArray(item.embedding || item.values || item.vector).map((value) => toNumber(value));
  }).filter((vector) => vector.length > 0);
}

export async function rerankDocuments(query = '', documents = [], {
  model = DEFAULT_RERANK_MODEL,
  topK = 5,
} = {}) {
  const normalizedQuery = clean(query, 4000);
  const normalizedDocs = asArray(documents).map((doc) => clean(doc, 20_000)).filter(Boolean);
  if (!normalizedQuery || !normalizedDocs.length) {
    return [];
  }

  const client = createMixedbreadClient();
  const forceFetch = clean(process.env.MIXEDBREAD_USE_FETCH_ONLY, 20).toLowerCase() === 'true';

  let payload = null;
  if (!forceFetch) {
    payload = await rerankWithSdk(client, normalizedQuery, normalizedDocs, model, topK);
  }

  if (!payload) {
    payload = await mixedbreadFetch(client, 'reranking', {
      model,
      query: normalizedQuery,
      input: normalizedDocs,
      topK: Math.max(1, Number(topK) || 5),
    });
  }

  const ranked = asArray(payload?.data || payload?.results || payload?.ranked || payload);

  return ranked.map((item) => ({
    index: Number(item.index ?? item.document_index ?? item.id ?? -1),
    score: toNumber(item.score ?? item.relevance_score ?? item.similarity, 0),
  })).filter((item) => item.index >= 0);
}

export function connectPolicyVectorStore() {
  const pineconeApiKey = clean(process.env.PINECONE_API_KEY, 5000);
  const pineconeHost = clean(process.env.PINECONE_INDEX_HOST, 1200);

  if (pineconeApiKey && pineconeHost) {
    return new PineconePolicyStore({
      apiKey: pineconeApiKey,
      indexHost: pineconeHost,
    });
  }

  return new LocalHnswPolicyStore({});
}

export async function loadPolicyChunks() {
  const chunkFile = policyChunkPath();
  assertPolicyLibraryIsolation(chunkFile);
  const payload = await readJsonFile(chunkFile);
  return asArray(payload?.chunks || payload).map((chunk) => normalizePolicyChunk(chunk)).filter((chunk) => chunk.id && chunk.text);
}

export async function ingestPolicyLibrary({ chunks = [] } = {}) {
  const normalized = asArray(chunks).map((chunk) => normalizePolicyChunk(chunk)).filter((chunk) => chunk.id && chunk.text);
  if (!normalized.length) {
    return { ok: true, inserted: 0, backend: 'none' };
  }

  const vectors = await generateEmbeddings(normalized.map((chunk) => chunk.text));
  const store = connectPolicyVectorStore();

  const records = normalized
    .map((chunk, index) => ({
      id: chunk.id,
      values: asArray(vectors[index]),
      metadata: {
        payerId: chunk.payerId,
        procedureCodes: chunk.procedureCodes,
        title: chunk.title,
        sourceUrl: chunk.sourceUrl,
        text: chunk.text,
        updatedAt: chunk.updatedAt,
      },
    }))
    .filter((record) => record.id && record.values.length);

  const result = await store.upsert(records);

  return {
    ok: true,
    inserted: records.length,
    backend: result.backend || 'local-hnsw-lite',
  };
}

function buildRetrievalQuery({ procedureCode = '', payerId = '', clinicalContext = '' } = {}) {
  const normalizedCode = clean(procedureCode, 40).toUpperCase();
  const normalizedPayer = clean(payerId, 120).toLowerCase();
  return [
    `Payer: ${normalizedPayer || 'unknown'}`,
    `Procedure Code: ${normalizedCode || 'unknown'}`,
    clean(clinicalContext, 4000),
    'Return exact legal medical necessity policy criteria for this procedure.',
  ].filter(Boolean).join('\n');
}

export async function getRelevantPayerRules(procedureCode = '', payerId = '', options = {}) {
  const normalizedCode = clean(procedureCode, 40).toUpperCase();
  const normalizedPayer = clean(payerId, 120).toLowerCase();

  if (!normalizedCode || !normalizedPayer) {
    throw new Error('procedureCode and payerId are required for policy retrieval.');
  }

  const query = buildRetrievalQuery({
    procedureCode: normalizedCode,
    payerId: normalizedPayer,
    clinicalContext: clean(options.clinicalContext, 4000),
  });

  const queryEmbedding = await generateEmbeddings([query]);
  const store = options.vectorStore || connectPolicyVectorStore();

  const candidateMatches = await store.query(queryEmbedding[0] || [], {
    topK: Math.max(3, Number(options.topK) || 10),
    filter: {
      payerId: normalizedPayer,
    },
  });

  const candidates = candidateMatches.map((match) => ({
    id: clean(match.id, 180),
    score: toNumber(match.score),
    title: clean(match.metadata?.title, 300),
    sourceUrl: clean(match.metadata?.sourceUrl, 1000),
    text: clean(match.metadata?.text, 12_000),
    procedureCodes: asArray(match.metadata?.procedureCodes).map((code) => clean(code, 40).toUpperCase()),
    payerId: clean(match.metadata?.payerId, 120).toLowerCase(),
  }));

  const rerankInput = candidates.map((candidate) => candidate.text || `${candidate.title}\n${candidate.sourceUrl}`);
  const reranked = await rerankDocuments(query, rerankInput, {
    topK: Math.max(1, Math.min(5, candidates.length)),
  });

  const rankedCandidates = (reranked.length
    ? reranked.map((rank) => ({
        ...candidates[rank.index],
        rerankScore: rank.score,
      })).filter(Boolean)
    : candidates.map((candidate) => ({ ...candidate, rerankScore: candidate.score })))
    .sort((a, b) => b.rerankScore - a.rerankScore);

  const topOne = rankedCandidates.find((item) => item.payerId === normalizedPayer && item.procedureCodes.includes(normalizedCode)) || rankedCandidates[0] || null;

  return {
    query,
    procedureCode: normalizedCode,
    payerId: normalizedPayer,
    totalCandidates: rankedCandidates.length,
    topOne,
    candidates: rankedCandidates,
  };
}

export async function bootstrapPolicyVectorStore() {
  const chunks = await loadPolicyChunks();
  return ingestPolicyLibrary({ chunks });
}
