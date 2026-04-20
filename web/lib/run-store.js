import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getScopedCollectionName, getScopedDataDir } from './data-scope.js';

const LOCAL_HISTORY_LIMIT = 25;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 200;
const DEFAULT_RETENTION_DAYS = 90;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = getScopedDataDir(moduleDir);
const localHistoryPath = path.join(dataDir, 'run-history.json');

function normalizeLimit(limit, maxLimit = MAX_LIST_LIMIT) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(maxLimit, Math.trunc(parsed));
}

function getRetentionDays() {
  const configured = Number(process.env.RUN_RETENTION_DAYS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.min(3650, Math.trunc(configured));
}

function getRetentionCutoffMs() {
  return Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
}

function runTimestampMs(run) {
  const completed = Date.parse(run?.completedAt || '');
  if (Number.isFinite(completed)) {
    return completed;
  }
  const started = Date.parse(run?.startedAt || '');
  return Number.isFinite(started) ? started : null;
}

function applyRetentionFilter(runs = []) {
  const cutoffMs = getRetentionCutoffMs();
  return (Array.isArray(runs) ? runs : []).filter((run) => {
    const ts = runTimestampMs(run);
    if (!Number.isFinite(ts)) {
      return true;
    }
    return ts >= cutoffMs;
  });
}

const LIFECYCLE_STATUSES = new Set([
  'new',
  'collecting_evidence',
  'ready_for_submission',
  're_planning_required',
  'submitted',
  'escalated',
  'portal_layout_changed',
]);

async function ensureLocalHistoryDir() {
  await fs.mkdir(path.dirname(localHistoryPath), { recursive: true });
}

async function readLocalRuns() {
  try {
    const raw = await fs.readFile(localHistoryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeLocalRuns(runs) {
  await ensureLocalHistoryDir();
  await fs.writeFile(localHistoryPath, `${JSON.stringify(runs, null, 2)}\n`, 'utf-8');
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
    const collectionName = getScopedCollectionName('run_history', 'MONGODB_COLLECTION');
    return client.db(dbName).collection(collectionName);
  } catch {
    return null;
  }
}

function compactLogs(logs = []) {
  return logs.slice(-30).map((log) => ({
    id: log.id,
    time: log.time,
    text: log.text,
    level: log.level,
  }));
}

function sanitizeLifecycleStatus(status, fallback = 'new') {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return LIFECYCLE_STATUSES.has(normalized) ? normalized : fallback;
}

function sanitizeLifecycleNotes(notes) {
  return String(notes || '').trim().slice(0, 4000);
}

function sanitizeEmrSync(sync = {}, previous = {}) {
  const now = new Date().toISOString();
  const merged = {
    ...previous,
    ...sync,
  };

  return {
    connector: String(merged.connector || merged.emrSystem || '').trim().toLowerCase(),
    emr_system: String(merged.emrSystem || merged.connector || '').trim().toLowerCase(),
    external_emr_id: String(merged.externalEmrId || merged.external_emr_id || '').trim(),
    operation: String(merged.operation || '').trim(),
    status: String(merged.status || '').trim() || 'synced',
    packet_id: String(merged.packetId || merged.packet_id || '').trim(),
    operator_id: String(merged.operatorId || merged.operator_id || '').trim(),
    patient_id: String(merged.patientId || merged.patient_id || '').trim(),
    department_id: String(merged.departmentId || merged.department_id || '').trim(),
    payer_reference_id: String(merged.payerReferenceId || merged.payer_reference_id || '').trim(),
    submission_timestamp: String(merged.submissionTimestamp || merged.submission_timestamp || '').trim(),
    proof_screenshot_path: String(merged.proofScreenshotPath || merged.proof_screenshot_path || '').trim(),
    jelly_bean_alert: String(merged.jellyBeanAlert || merged.jelly_bean_alert || '').trim(),
    agent_mail_inbox: String(merged.agentMailInbox || merged.agent_mail_inbox || '').trim().toLowerCase(),
    message: String(merged.message || '').trim().slice(0, 2000),
    last_synced_at: String(merged.lastSyncedAt || merged.last_synced_at || '').trim() || now,
  };
}

function inferLifecycleStatus(run) {
  if (run?.status === 'failed' || run?.failure) {
    return 'escalated';
  }
  if (run?.readiness?.ready) {
    return 'ready_for_submission';
  }
  if (Array.isArray(run?.readiness?.missing_evidence) && run.readiness.missing_evidence.length > 0) {
    return 'collecting_evidence';
  }
  return 'new';
}

function buildLifecycleEvent({ status, note = '', actor = 'system', source = 'system', createdAt = new Date().toISOString() }) {
  return {
    status: sanitizeLifecycleStatus(status),
    note: sanitizeLifecycleNotes(note),
    actor: String(actor || 'system').trim() || 'system',
    source: String(source || 'system').trim() || 'system',
    createdAt,
  };
}

function normalizeCaseLifecycle(run) {
  const fallbackStatus = inferLifecycleStatus(run);
  const existing = run?.caseLifecycle || {};
  const status = sanitizeLifecycleStatus(existing.status, fallbackStatus);
  const notes = sanitizeLifecycleNotes(existing.notes);
  const history = Array.isArray(existing.history) ? existing.history : [];
  const normalizedHistory = history
    .map((event) => buildLifecycleEvent(event))
    .filter((event) => event.status);

  if (!normalizedHistory.length) {
    normalizedHistory.push(
      buildLifecycleEvent({
        status,
        note:
          notes ||
          (status === 'ready_for_submission'
            ? 'Case automatically marked ready after a successful readiness run.'
            : status === 'collecting_evidence'
              ? 'Case automatically marked as collecting evidence after missing evidence was detected.'
              : status === 'escalated'
                ? 'Case automatically escalated after a failed run.'
                : 'Case created.'),
        source: 'system',
      }),
    );
  }

  return {
    status,
    notes,
    updatedAt: existing.updatedAt || normalizedHistory[normalizedHistory.length - 1]?.createdAt || new Date().toISOString(),
    history: normalizedHistory,
  };
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(Number(value))) {
    return min;
  }
  return Math.min(max, Math.max(min, Number(value)));
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildRoiEstimate(run) {
  const readiness = run?.readiness || {};
  const status = String(run?.status || '').toLowerCase();
  const confidence = clampNumber(readiness?.confidence || 0, 0, 100);
  const confidenceFactor = confidence / 100;
  const supportingEvidenceCount = Array.isArray(readiness?.supporting_evidence) ? readiness.supporting_evidence.length : 0;
  const missingEvidenceCount = Array.isArray(readiness?.missing_evidence) ? readiness.missing_evidence.length : 0;
  const ready = readiness?.ready === true;

  if (status !== 'completed' || confidence <= 0) {
    return {
      estimatedHoursSaved: 0,
      estimatedDaysToAuthSaved: 0,
      estimatedRecoveredRevenueUsd: 0,
      estimatedDenialRiskReductionPercent: 0,
      confidence,
      model: 'v1_estimated_roi',
    };
  }

  const baseHours = ready ? 1.2 : 0.65;
  const estimatedHoursSaved = roundTo(baseHours * (0.55 + confidenceFactor * 0.45));

  const estimatedDaysToAuthSaved = roundTo((ready ? 1.6 : 0.7) * (0.45 + confidenceFactor * 0.55));

  const evidenceSignal = Math.max(0, supportingEvidenceCount - missingEvidenceCount);
  const estimatedRecoveredRevenueUsd = roundTo((ready ? 140 : 70) * (0.5 + confidenceFactor * 0.5) + evidenceSignal * 18);

  const estimatedDenialRiskReductionPercent = Math.round(
    clampNumber((ready ? 18 : 8) + confidenceFactor * (ready ? 32 : 20), 0, 75),
  );

  return {
    estimatedHoursSaved,
    estimatedDaysToAuthSaved,
    estimatedRecoveredRevenueUsd,
    estimatedDenialRiskReductionPercent,
    confidence,
    model: 'v1_estimated_roi',
  };
}

function canonicalizeValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item)).filter(Boolean).join(' | ');
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .map((key) => `${key}:${canonicalizeValue(value[key])}`)
      .filter(Boolean)
      .join(' | ');
  }

  return normalizeText(value);
}

function buildSnapshots(run) {
  const policyResult = run.artifact?.policyResult || {};
  const contactResult = run.artifact?.contactResult || {};

  const policy = {
    sourceKey: normalizeText(policyResult.page_url || run.workflow?.url || ''),
    pageUrl: policyResult.page_url || run.workflow?.url || '',
    policyName: policyResult.policy_name || run.readiness?.policy_name || '',
    evidenceRequirementsText: canonicalizeValue(policyResult.evidence_requirements),
    mentionsConservativeManagement: Boolean(policyResult.mentions_conservative_management),
  };

  policy.fingerprint = canonicalizeValue({
    sourceKey: policy.sourceKey,
    pageUrl: policy.pageUrl,
    policyName: policy.policyName,
    evidenceRequirementsText: policy.evidenceRequirementsText,
    mentionsConservativeManagement: policy.mentionsConservativeManagement,
  });

  const routing = {
    sourceKey: normalizeText(contactResult.source_page_url || run.workflow?.contactUrl || ''),
    sourcePageUrl: contactResult.source_page_url || run.workflow?.contactUrl || '',
    providerPrecertPhone: normalizeText(contactResult.provider_precert_phone),
    providerPrecertNotes: normalizeText(contactResult.provider_precert_notes),
  };

  routing.fingerprint = canonicalizeValue({
    sourceKey: routing.sourceKey,
    sourcePageUrl: routing.sourcePageUrl,
    providerPrecertPhone: routing.providerPrecertPhone,
    providerPrecertNotes: routing.providerPrecertNotes,
  });

  return { policy, routing };
}

function withSnapshotFields(run) {
  if (run?.snapshot?.policy && run?.snapshot?.routing) {
    return run;
  }

  return {
    ...run,
    snapshot: buildSnapshots(run),
  };
}

function runsAreComparable(currentRun, candidateRun) {
  const current = withSnapshotFields(currentRun);
  const candidate = withSnapshotFields(candidateRun);

  return (
    Boolean(current.snapshot.policy.sourceKey && current.snapshot.policy.sourceKey === candidate.snapshot.policy.sourceKey) ||
    Boolean(current.snapshot.routing.sourceKey && current.snapshot.routing.sourceKey === candidate.snapshot.routing.sourceKey)
  );
}

function computeSnapshotDiff(currentRun, previousRun) {
  const current = withSnapshotFields(currentRun);
  const previous = previousRun ? withSnapshotFields(previousRun) : null;

  if (!current.snapshot.policy.fingerprint && !current.snapshot.routing.fingerprint) {
    return {
      status: 'unavailable',
      hasChanges: false,
      previousRunId: '',
      previousStartedAt: '',
      summary: 'No structured payer snapshot was available for diffing on this run.',
      policyChanges: [],
      routingChanges: [],
    };
  }

  if (!previous) {
    return {
      status: 'first_snapshot',
      hasChanges: false,
      previousRunId: '',
      previousStartedAt: '',
      summary: 'No previous payer snapshot is available yet. This run becomes the baseline.',
      policyChanges: [],
      routingChanges: [],
    };
  }

  const policyChanges = [];
  const routingChanges = [];

  if (current.snapshot.policy.pageUrl && previous.snapshot.policy.pageUrl && current.snapshot.policy.pageUrl !== previous.snapshot.policy.pageUrl) {
    policyChanges.push('Policy source URL changed.');
  }
  if (current.snapshot.policy.policyName && previous.snapshot.policy.policyName && current.snapshot.policy.policyName !== previous.snapshot.policy.policyName) {
    policyChanges.push('Policy title changed.');
  }
  if (current.snapshot.policy.evidenceRequirementsText !== previous.snapshot.policy.evidenceRequirementsText) {
    policyChanges.push('Evidence requirements changed.');
  }
  if (
    current.snapshot.policy.mentionsConservativeManagement !== previous.snapshot.policy.mentionsConservativeManagement
  ) {
    policyChanges.push('Conservative management requirement signal changed.');
  }

  if (
    current.snapshot.routing.sourcePageUrl &&
    previous.snapshot.routing.sourcePageUrl &&
    current.snapshot.routing.sourcePageUrl !== previous.snapshot.routing.sourcePageUrl
  ) {
    routingChanges.push('Routing source page changed.');
  }
  if (
    current.snapshot.routing.providerPrecertPhone &&
    previous.snapshot.routing.providerPrecertPhone &&
    current.snapshot.routing.providerPrecertPhone !== previous.snapshot.routing.providerPrecertPhone
  ) {
    routingChanges.push('Provider precert phone changed.');
  }
  if (
    current.snapshot.routing.providerPrecertNotes &&
    previous.snapshot.routing.providerPrecertNotes &&
    current.snapshot.routing.providerPrecertNotes !== previous.snapshot.routing.providerPrecertNotes
  ) {
    routingChanges.push('Provider routing notes changed.');
  }

  const hasChanges = policyChanges.length > 0 || routingChanges.length > 0;

  return {
    status: hasChanges ? 'changed' : 'stable',
    hasChanges,
    previousRunId: previous.appRunId || '',
    previousStartedAt: previous.startedAt || '',
    summary: hasChanges
      ? `${policyChanges.length + routingChanges.length} payer-facing change(s) detected since the previous saved snapshot.`
      : 'No payer-facing changes were detected since the previous saved snapshot.',
    policyChanges,
    routingChanges,
  };
}

function normalizeRun(run) {
  const thinkingLogs = compactLogs(run.logs?.thinking || []);
  const executionLogs = compactLogs(run.logs?.execution || []);
  const matchedEvidence = run.readiness?.supporting_evidence?.length || 0;
  const missingEvidence = run.readiness?.missing_evidence?.length || 0;
  const eventCount = run.metrics?.eventCount || thinkingLogs.length + executionLogs.length;
  const snapshot = buildSnapshots(run);

  return {
    appRunId: run.appRunId,
    status: run.status || 'completed',
    mode: run.mode || 'mock',
    startedAt: run.startedAt || new Date().toISOString(),
    completedAt: run.completedAt || new Date().toISOString(),
    failureReason: run.failureReason || '',
    failure: run.failure || null,
    workflow: run.workflow || {},
    workspace: run.workspace || null,
    intake: run.intake || null,
    artifact: run.artifact || null,
    operatorPacket: run.operatorPacket || null,
    emrSync: run.emrSync || run.operatorPacket?.emr_sync || null,
    caseLifecycle: normalizeCaseLifecycle(run),
    readiness: run.readiness || null,
    proof: run.proof || null,
    snapshot,
    snapshotDiff: run.snapshotDiff || null,
    roi: run.roi || buildRoiEstimate(run),
    metrics: {
      elapsedSeconds: run.metrics?.elapsedSeconds || 0,
      eventCount,
      totalSteps: run.metrics?.totalSteps || 0,
      matchedEvidence,
      missingEvidence,
    },
    logs: {
      thinking: thinkingLogs,
      execution: executionLogs,
    },
  };
}

function applyCaseLifecycleUpdate(run, updates = {}) {
  const existing = normalizeCaseLifecycle(run);
  const nextStatus = sanitizeLifecycleStatus(updates.status, existing.status);
  const nextNotes = updates.notes !== undefined ? sanitizeLifecycleNotes(updates.notes) : existing.notes;
  const actor = String(updates.actor || 'staff').trim() || 'staff';
  const source = String(updates.source || 'manual_update').trim() || 'manual_update';
  const eventNote = sanitizeLifecycleNotes(
    updates.eventNote !== undefined ? updates.eventNote : nextNotes || `Case moved to ${nextStatus.replaceAll('_', ' ')}.`,
  );
  const now = new Date().toISOString();
  const history = Array.isArray(existing.history) ? [...existing.history] : [];
  const previous = history[history.length - 1];

  if (!previous || previous.status !== nextStatus || previous.note !== eventNote) {
    history.push(
      buildLifecycleEvent({
        status: nextStatus,
        note: eventNote,
        actor,
        source,
        createdAt: now,
      }),
    );
  }

  return {
    ...run,
    caseLifecycle: {
      status: nextStatus,
      notes: nextNotes,
      updatedAt: now,
      history,
    },
  };
}

function applyEmrSyncUpdate(run, emrSync = {}) {
  const packet = run?.operatorPacket && typeof run.operatorPacket === 'object' ? run.operatorPacket : {};
  const nextSync = sanitizeEmrSync(emrSync, packet.emr_sync || run?.emrSync || {});

  return {
    ...run,
    operatorPacket: {
      ...packet,
      emr_sync: nextSync,
    },
    emrSync: nextSync,
  };
}

export async function saveRun(run) {
  const normalized = normalizeRun(run);
  const collection = await getMongoCollection();

  if (collection) {
    const cutoffIso = new Date(getRetentionCutoffMs()).toISOString();
    await collection.deleteMany({
      $and: [
        { completedAt: { $ne: '' } },
        { completedAt: { $lt: cutoffIso } },
      ],
    });

    const previousRuns = await collection
      .find(
        {
          appRunId: { $ne: normalized.appRunId },
          $or: [{ 'workflow.url': normalized.workflow.url }, { 'workflow.contactUrl': normalized.workflow.contactUrl }],
        },
        { sort: { startedAt: -1 }, limit: 12 },
      )
      .toArray();
    const previousComparable = previousRuns.map(({ _id, ...item }) => item).find((item) => runsAreComparable(normalized, item));
    normalized.snapshotDiff = computeSnapshotDiff(normalized, previousComparable);
    await collection.updateOne(
      { appRunId: normalized.appRunId },
      {
        $set: normalized,
      },
      { upsert: true },
    );
    return { storage: 'mongodb', run: normalized };
  }

  const existing = applyRetentionFilter(await readLocalRuns());
  const previousComparable = existing.find((item) => item.appRunId !== normalized.appRunId && runsAreComparable(normalized, item));
  normalized.snapshotDiff = computeSnapshotDiff(normalized, previousComparable);
  const deduped = applyRetentionFilter([normalized, ...existing.filter((item) => item.appRunId !== normalized.appRunId)]).slice(0, LOCAL_HISTORY_LIMIT);
  await writeLocalRuns(deduped);
  return { storage: 'local', run: normalized };
}

export async function updateRunCaseLifecycle(appRunId, updates = {}) {
  const runId = String(appRunId || '').trim();
  if (!runId) {
    throw new Error('Run id is required.');
  }

  const collection = await getMongoCollection();
  const hasLifecycleUpdate = updates.status !== undefined || updates.notes !== undefined || updates.eventNote !== undefined;
  const hasEmrSyncUpdate = updates.emrSync && typeof updates.emrSync === 'object';

  if (collection) {
    const existing = await collection.findOne({ appRunId: runId });
    if (!existing) {
      throw new Error('Run not found.');
    }
    const { _id, ...item } = existing;
    let updated = item;
    if (hasLifecycleUpdate) {
      updated = applyCaseLifecycleUpdate(updated, updates);
    }
    if (hasEmrSyncUpdate) {
      updated = applyEmrSyncUpdate(updated, updates.emrSync);
    }

    const updatePayload = {};
    if (hasLifecycleUpdate) {
      updatePayload.caseLifecycle = updated.caseLifecycle;
    }
    if (hasEmrSyncUpdate) {
      updatePayload.operatorPacket = updated.operatorPacket || null;
      updatePayload.emrSync = updated.emrSync || null;
    }
    if (!Object.keys(updatePayload).length) {
      updatePayload.caseLifecycle = normalizeCaseLifecycle(updated);
    }

    await collection.updateOne({ appRunId: runId }, { $set: updatePayload });
    return { storage: 'mongodb', run: updated };
  }

  const runs = await readLocalRuns();
  const index = runs.findIndex((item) => item.appRunId === runId);
  if (index === -1) {
    throw new Error('Run not found.');
  }

  let updated = runs[index];
  if (hasLifecycleUpdate) {
    updated = applyCaseLifecycleUpdate(updated, updates);
  }
  if (hasEmrSyncUpdate) {
    updated = applyEmrSyncUpdate(updated, updates.emrSync);
  }
  const nextRuns = [...runs];
  nextRuns[index] = updated;
  await writeLocalRuns(nextRuns);
  return { storage: 'local', run: updated };
}

export { applyCaseLifecycleUpdate, normalizeCaseLifecycle };

export async function listRuns(limit = 10) {
  const normalizedLimit = normalizeLimit(limit);
  const collection = await getMongoCollection();

  if (collection) {
    const cutoffIso = new Date(getRetentionCutoffMs()).toISOString();
    await collection.deleteMany({
      $and: [
        { completedAt: { $ne: '' } },
        { completedAt: { $lt: cutoffIso } },
      ],
    });

    const runs = await collection
      .find({}, { sort: { startedAt: -1 }, limit: normalizedLimit })
      .toArray();
    return {
      storage: 'mongodb',
      runs: applyRetentionFilter(runs.map(({ _id, ...run }) => run)),
    };
  }

  const runs = applyRetentionFilter(await readLocalRuns());
  return {
    storage: 'local',
    runs: runs.slice(0, normalizedLimit),
  };
}

export async function listRunsForAnalytics(limit = 200) {
  const normalizedLimit = normalizeLimit(limit, MAX_LIST_LIMIT);
  return listRuns(normalizedLimit);
}

export async function getRunById(appRunId) {
  const runId = String(appRunId || '').trim();
  if (!runId) {
    return null;
  }

  const collection = await getMongoCollection();
  if (collection) {
    const existing = await collection.findOne({ appRunId: runId });
    if (!existing) {
      return null;
    }
    const { _id, ...run } = existing;
    return run;
  }

  const runs = await readLocalRuns();
  return runs.find((item) => item.appRunId === runId) || null;
}
