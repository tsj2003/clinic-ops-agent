import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getScopedCollectionName, getScopedDataDir } from './data-scope.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const LOCAL_COMMITMENT_LIMIT = 300;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = getScopedDataDir(moduleDir);
const localPath = path.join(dataDir, 'pilot-commitments.json');

const ALLOWED_STATUSES = new Set([
  'prospect',
  'discovery',
  'proposal_sent',
  'verbal_committed',
  'signed_active',
  'on_hold',
  'closed_lost',
]);

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(MAX_LIST_LIMIT, Math.trunc(parsed));
}

function clean(value, max = 240) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function cleanLong(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function cleanEmail(value) {
  return clean(value, 220).toLowerCase();
}

function cleanStatus(value, fallback = 'prospect') {
  const normalized = clean(value, 64).toLowerCase().replace(/\s+/g, '_');
  return ALLOWED_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeDate(value) {
  const raw = clean(value, 32);
  if (!raw) {
    return '';
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toISOString().slice(0, 10);
}

function deriveMomentum(commitment) {
  const status = cleanStatus(commitment.status, 'prospect');
  if (status === 'signed_active') {
    return 'locked';
  }
  if (status === 'verbal_committed') {
    return 'close_now';
  }
  if (status === 'proposal_sent') {
    return 'follow_up';
  }
  if (status === 'closed_lost') {
    return 'closed';
  }
  return 'build';
}

function enrichCommitment(commitment) {
  return {
    ...commitment,
    momentum: deriveMomentum(commitment),
  };
}

function normalizeCommitment(input = {}, existing = null) {
  const now = new Date().toISOString();
  const clinicName = clean(input.clinicName, 120);
  if (!clinicName) {
    throw new Error('clinicName is required.');
  }

  return {
    id: clean(input.id, 120) || clean(existing?.id, 120) || randomUUID(),
    clinicName,
    lane: clean(input.lane, 120),
    championName: clean(input.championName, 120),
    championEmail: cleanEmail(input.championEmail),
    status: cleanStatus(input.status, cleanStatus(existing?.status, 'prospect')),
    targetStartDate: normalizeDate(input.targetStartDate || existing?.targetStartDate),
    baselineDenialRatePercent: clean(input.baselineDenialRatePercent, 20),
    baselineDaysToAuth: clean(input.baselineDaysToAuth, 20),
    currentDenialRatePercent: clean(input.currentDenialRatePercent, 20),
    currentDaysToAuth: clean(input.currentDaysToAuth, 20),
    currentHoursSavedPerCase: clean(input.currentHoursSavedPerCase, 20),
    currentRecoveredRevenueUsd: clean(input.currentRecoveredRevenueUsd, 20),
    signedAt: normalizeDate(input.signedAt || existing?.signedAt),
    signedEvidenceUrl: clean(input.signedEvidenceUrl, 500),
    weeklyReviewDay: clean(input.weeklyReviewDay, 40),
    nextStep: clean(input.nextStep, 220),
    notes: cleanLong(input.notes),
    lastContactAt: input.lastContactAt ? new Date(input.lastContactAt).toISOString() : existing?.lastContactAt || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

async function ensureLocalDir() {
  await fs.mkdir(path.dirname(localPath), { recursive: true });
}

async function readLocalCommitments() {
  try {
    const raw = await fs.readFile(localPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeLocalCommitments(commitments) {
  await ensureLocalDir();
  await fs.writeFile(localPath, `${JSON.stringify(commitments, null, 2)}\n`, 'utf-8');
}

async function getMongoCollection() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    return null;
  }

  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const { MongoClient } = await dynamicImport('mongodb');
    if (!globalThis.__authpilotMongoClientPromise) {
      const client = new MongoClient(uri, {
        maxPoolSize: 5,
      });
      globalThis.__authpilotMongoClientPromise = client.connect();
    }

    const client = await globalThis.__authpilotMongoClientPromise;
    const dbName = process.env.MONGODB_DB_NAME || 'authpilot';
    const collectionName = getScopedCollectionName(
      'pilot_commitments',
      'MONGODB_PILOT_COMMITMENTS_COLLECTION',
    );
    return client.db(dbName).collection(collectionName);
  } catch {
    return null;
  }
}

export async function listPilotCommitments(limit = DEFAULT_LIST_LIMIT) {
  const normalizedLimit = normalizeLimit(limit);
  const collection = await getMongoCollection();

  if (collection) {
    const commitments = await collection
      .find({}, { sort: { updatedAt: -1 }, limit: normalizedLimit })
      .toArray();

    return {
      storage: 'mongodb',
      commitments: commitments.map(({ _id, ...commitment }) => enrichCommitment(commitment)),
    };
  }

  const commitments = await readLocalCommitments();
  return {
    storage: 'local',
    commitments: commitments.slice(0, normalizedLimit).map((commitment) => enrichCommitment(commitment)),
  };
}

export async function savePilotCommitment(input) {
  const collection = await getMongoCollection();

  if (collection) {
    const id = clean(input?.id, 120);
    const existing = id ? await collection.findOne({ id }) : null;
    const normalized = normalizeCommitment(input, existing);
    await collection.updateOne({ id: normalized.id }, { $set: normalized }, { upsert: true });
    return {
      storage: 'mongodb',
      commitment: enrichCommitment(normalized),
    };
  }

  const existing = await readLocalCommitments();
  const current = clean(input?.id, 120) ? existing.find((item) => item.id === clean(input.id, 120)) : null;
  const normalized = normalizeCommitment(input, current || null);

  const deduped = [normalized, ...existing.filter((item) => item.id !== normalized.id)].slice(0, LOCAL_COMMITMENT_LIMIT);
  await writeLocalCommitments(deduped);

  return {
    storage: 'local',
    commitment: enrichCommitment(normalized),
  };
}

export async function updatePilotCommitment(id, patch = {}) {
  const commitmentId = clean(id, 120);
  if (!commitmentId) {
    throw new Error('id is required.');
  }

  const collection = await getMongoCollection();

  if (collection) {
    const existing = await collection.findOne({ id: commitmentId });
    if (!existing) {
      throw new Error('Pilot commitment not found.');
    }

    const normalized = normalizeCommitment(
      {
        ...existing,
        ...patch,
        id: commitmentId,
      },
      existing,
    );

    await collection.updateOne({ id: commitmentId }, { $set: normalized }, { upsert: false });
    return {
      storage: 'mongodb',
      commitment: enrichCommitment(normalized),
    };
  }

  const commitments = await readLocalCommitments();
  const existing = commitments.find((item) => item.id === commitmentId);
  if (!existing) {
    throw new Error('Pilot commitment not found.');
  }

  const normalized = normalizeCommitment(
    {
      ...existing,
      ...patch,
      id: commitmentId,
    },
    existing,
  );

  const next = [normalized, ...commitments.filter((item) => item.id !== commitmentId)].slice(0, LOCAL_COMMITMENT_LIMIT);
  await writeLocalCommitments(next);

  return {
    storage: 'local',
    commitment: enrichCommitment(normalized),
  };
}

export async function deletePilotCommitment(id) {
  const commitmentId = clean(id, 120);
  if (!commitmentId) {
    throw new Error('id is required.');
  }

  const collection = await getMongoCollection();

  if (collection) {
    await collection.deleteOne({ id: commitmentId });
    return { storage: 'mongodb', deleted: true };
  }

  const commitments = await readLocalCommitments();
  const next = commitments.filter((item) => item.id !== commitmentId);
  await writeLocalCommitments(next);
  return { storage: 'local', deleted: true };
}
