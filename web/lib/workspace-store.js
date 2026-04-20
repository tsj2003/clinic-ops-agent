import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { listRunsForAnalytics } from './run-store.js';
import { getScopedCollectionName, getScopedDataDir } from './data-scope.js';

const LOCAL_WORKSPACE_LIMIT = 100;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = getScopedDataDir(moduleDir);
const localWorkspacePath = path.join(dataDir, 'workspace-profiles.json');

const DEFAULT_CONFIG = {
  workflowName: '',
  workflowUrl: '',
  workflowGoal: '',
  contactWorkflowName: '',
  contactWorkflowUrl: '',
  contactWorkflowGoal: '',
};

const DEFAULT_INTAKE = {
  payerName: '',
  lineOfBusiness: '',
  memberState: '',
  specialty: '',
  procedureLabel: '',
  diagnosis: '',
  caseLabel: '',
  policyPageUrl: '',
  contactPageUrl: '',
  chartSummary: '',
  evidenceFiles: '',
};

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(200, Math.trunc(parsed));
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function sanitizeConfig(config = {}) {
  return {
    workflowName: String(config.workflowName || DEFAULT_CONFIG.workflowName).trim(),
    workflowUrl: String(config.workflowUrl || DEFAULT_CONFIG.workflowUrl).trim(),
    workflowGoal: String(config.workflowGoal || DEFAULT_CONFIG.workflowGoal).trim(),
    contactWorkflowName: String(config.contactWorkflowName || DEFAULT_CONFIG.contactWorkflowName).trim(),
    contactWorkflowUrl: String(config.contactWorkflowUrl || DEFAULT_CONFIG.contactWorkflowUrl).trim(),
    contactWorkflowGoal: String(config.contactWorkflowGoal || DEFAULT_CONFIG.contactWorkflowGoal).trim(),
  };
}

function sanitizeIntake(intake = {}) {
  return {
    payerName: String(intake.payerName || DEFAULT_INTAKE.payerName).trim(),
    lineOfBusiness: String(intake.lineOfBusiness || DEFAULT_INTAKE.lineOfBusiness).trim(),
    memberState: String(intake.memberState || DEFAULT_INTAKE.memberState).trim().toUpperCase(),
    specialty: String(intake.specialty || DEFAULT_INTAKE.specialty).trim(),
    procedureLabel: String(intake.procedureLabel || DEFAULT_INTAKE.procedureLabel).trim(),
    diagnosis: String(intake.diagnosis || DEFAULT_INTAKE.diagnosis).trim(),
    caseLabel: String(intake.caseLabel || DEFAULT_INTAKE.caseLabel).trim(),
    policyPageUrl: String(intake.policyPageUrl || DEFAULT_INTAKE.policyPageUrl).trim(),
    contactPageUrl: String(intake.contactPageUrl || DEFAULT_INTAKE.contactPageUrl).trim(),
    chartSummary: String(intake.chartSummary || DEFAULT_INTAKE.chartSummary).trim(),
    evidenceFiles: String(intake.evidenceFiles || DEFAULT_INTAKE.evidenceFiles).trim(),
  };
}

async function ensureLocalWorkspaceDir() {
  await fs.mkdir(path.dirname(localWorkspacePath), { recursive: true });
}

async function readLocalWorkspaces() {
  try {
    const raw = await fs.readFile(localWorkspacePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeLocalWorkspaces(workspaces) {
  await ensureLocalWorkspaceDir();
  await fs.writeFile(localWorkspacePath, `${JSON.stringify(workspaces, null, 2)}\n`, 'utf-8');
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
    const collectionName = getScopedCollectionName('workspace_profiles', 'MONGODB_WORKSPACE_COLLECTION');
    return client.db(dbName).collection(collectionName);
  } catch {
    return null;
  }
}

function normalizeWorkspace(input = {}) {
  const now = new Date().toISOString();
  const clinicName = sanitizeName(input.clinicName || input.name);
  if (!clinicName) {
    throw new Error('Clinic workspace name is required.');
  }

  return {
    id: String(input.id || randomUUID()),
    clinicName,
    config: sanitizeConfig(input.config),
    intake: sanitizeIntake(input.intake),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${Math.round(value)}%`;
}

function normalizeFailureCode(value) {
  return String(value || '')
    .trim()
    .replace(/_/g, ' ');
}

function buildWorkspaceAnalytics(workspace, runs = []) {
  const workspaceRuns = runs.filter((run) => run.workspace?.id === workspace.id);
  const totalRuns = workspaceRuns.length;
  const completedRuns = workspaceRuns.filter((run) => run.status === 'completed').length;
  const failedRuns = workspaceRuns.filter((run) => run.status === 'failed').length;
  const lastRun = workspaceRuns[0] || null;
  const lastSuccessfulRun = workspaceRuns.find((run) => run.status === 'completed') || null;
  const averageElapsedSeconds =
    totalRuns > 0
      ? Math.round(
          workspaceRuns.reduce((sum, run) => sum + (Number(run.metrics?.elapsedSeconds) || 0), 0) / totalRuns,
        )
      : 0;
  const averageConfidence =
    totalRuns > 0
      ? Math.round(
          workspaceRuns.reduce((sum, run) => sum + (Number(run.readiness?.confidence) || 0), 0) / totalRuns,
        )
      : 0;
  const failureRatePercent = totalRuns > 0 ? Math.round((failedRuns / totalRuns) * 100) : 0;

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    failureRatePercent,
    failureRateLabel: formatPercent(failureRatePercent),
    successRatePercent: totalRuns > 0 ? 100 - failureRatePercent : 0,
    successRateLabel: totalRuns > 0 ? formatPercent(100 - failureRatePercent) : 'No runs yet',
    averageElapsedSeconds,
    averageConfidence,
    lastRunAt: lastRun?.startedAt || '',
    lastRunStatus: lastRun?.status || 'idle',
    lastRunSummary: lastRun?.readiness?.summary || lastRun?.failureReason || '',
    lastSuccessfulRunAt: lastSuccessfulRun?.startedAt || '',
    lastSuccessfulProcedure:
      lastSuccessfulRun?.workflow?.procedure || lastSuccessfulRun?.intake?.procedureLabel || '',
    lastFailureCode: normalizeFailureCode(lastRun?.failure?.code),
    lastFailureStage: String(lastRun?.failure?.stage || '').trim(),
  };
}

function enrichWorkspace(workspace, runs) {
  return {
    ...workspace,
    analytics: buildWorkspaceAnalytics(workspace, runs),
  };
}

async function loadAnalyticsRuns() {
  try {
    const runHistory = await listRunsForAnalytics(200);
    return Array.isArray(runHistory.runs) ? runHistory.runs : [];
  } catch {
    return [];
  }
}

export async function listWorkspaces(limit = 20) {
  const normalizedLimit = normalizeLimit(limit);
  const collection = await getMongoCollection();
  const runs = await loadAnalyticsRuns();

  if (collection) {
    const workspaces = await collection
      .find({}, { sort: { updatedAt: -1 }, limit: normalizedLimit })
      .toArray();
    return {
      storage: 'mongodb',
      workspaces: workspaces.map(({ _id, ...workspace }) => enrichWorkspace(workspace, runs)),
    };
  }

  const workspaces = await readLocalWorkspaces();
  return {
    storage: 'local',
    workspaces: workspaces.slice(0, normalizedLimit).map((workspace) => enrichWorkspace(workspace, runs)),
  };
}

export async function saveWorkspace(input) {
  const normalized = normalizeWorkspace(input);
  const collection = await getMongoCollection();

  if (collection) {
    const existing = await collection.findOne({ id: normalized.id });
    if (existing?.createdAt) {
      normalized.createdAt = existing.createdAt;
    }

    await collection.updateOne({ id: normalized.id }, { $set: normalized }, { upsert: true });
    return { storage: 'mongodb', workspace: normalized };
  }

  const existing = await readLocalWorkspaces();
  const existingItem = existing.find((item) => item.id === normalized.id);
  if (existingItem?.createdAt) {
    normalized.createdAt = existingItem.createdAt;
  }

  const deduped = [normalized, ...existing.filter((item) => item.id !== normalized.id)].slice(0, LOCAL_WORKSPACE_LIMIT);
  await writeLocalWorkspaces(deduped);
  return { storage: 'local', workspace: normalized };
}

export async function deleteWorkspace(id) {
  const workspaceId = String(id || '').trim();
  if (!workspaceId) {
    throw new Error('Workspace id is required.');
  }

  const collection = await getMongoCollection();
  if (collection) {
    await collection.deleteOne({ id: workspaceId });
    return { storage: 'mongodb', deleted: true };
  }

  const existing = await readLocalWorkspaces();
  const next = existing.filter((item) => item.id !== workspaceId);
  await writeLocalWorkspaces(next);
  return { storage: 'local', deleted: true };
}
