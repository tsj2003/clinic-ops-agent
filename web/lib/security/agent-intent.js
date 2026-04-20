import fs from 'fs/promises';
import path from 'path';
import { createHash, verify as cryptoVerify } from 'crypto';
import { fileURLToPath } from 'url';

import { redactFreeText } from '../privacy.js';
import { getAgentPublicRecord, getAgentPublicRegistry } from './agent-identity.js';

const SECURITY_CACHE_KEY = '__authpilotSecurityContextCache';
const REVOKED_SET_KEY = '__authpilotRevokedDidSet';
const LEDGER_QUEUE_KEY = '__authpilotIntentLedgerQueue';
const LAST_LEDGER_HASH_KEY = '__authpilotIntentLedgerLastHash';

function clean(value, max = 8000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function moduleDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function securityDir() {
  return path.resolve(moduleDir(), '..', '..', '.data', 'pilot-vault', 'security');
}

function revocationPath() {
  return path.join(securityDir(), 'revoked-agent-identities.json');
}

function intentLedgerPath() {
  return path.join(securityDir(), 'intent-ledger.ndjson');
}

function sanitizeLedgerRecordType(value = '') {
  const normalized = clean(value, 80).toLowerCase();
  return normalized || 'intent_verification';
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function intentPayload(envelope = {}) {
  return {
    did: clean(envelope.did, 240),
    agentName: clean(envelope.agentName, 120).toLowerCase(),
    action: clean(envelope.action, 120),
    params: asObject(envelope.params),
    runId: clean(envelope.runId, 120),
    requestId: clean(envelope.requestId, 120),
    timestampMs: Number(envelope.timestampMs) || 0,
    nonce: clean(envelope.nonce, 120),
    digest: clean(envelope.digest, 120),
  };
}

function computePayloadDigest(payload = {}) {
  const normalized = {
    ...asObject(payload),
    digest: '',
  };
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

function parseVault() {
  const raw = clean(process.env.HARDENED_SECRET_VAULT, 300_000);
  if (!raw) {
    return {};
  }
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

function readPassportsFromSecureConfig() {
  const vault = parseVault();
  const fromVault = asObject(vault.agentPassports || vault.AGENT_PASSPORTS || vault.agent_passports);

  const fromEnvRaw = clean(process.env.AGENT_PASSPORTS_JSON, 200_000);
  let fromEnv = {};
  if (fromEnvRaw) {
    try {
      fromEnv = asObject(JSON.parse(fromEnvRaw));
    } catch {
      fromEnv = {};
    }
  }

  return {
    ...fromVault,
    ...fromEnv,
  };
}

async function readRevocationsFromDisk() {
  try {
    const raw = await fs.readFile(revocationPath(), 'utf-8');
    const parsed = asObject(JSON.parse(raw));
    return {
      revoked: asArray(parsed.revoked),
      updatedAt: clean(parsed.updatedAt, 80),
    };
  } catch {
    return {
      revoked: [],
      updatedAt: '',
    };
  }
}

async function writeRevocationsToDisk(payload = {}) {
  await fs.mkdir(securityDir(), { recursive: true });
  await fs.writeFile(revocationPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function getRevokedSet() {
  if (!globalThis[REVOKED_SET_KEY]) {
    globalThis[REVOKED_SET_KEY] = new Set();
  }
  return globalThis[REVOKED_SET_KEY];
}

function getCache() {
  if (!globalThis[SECURITY_CACHE_KEY]) {
    globalThis[SECURITY_CACHE_KEY] = {
      loadedAtMs: 0,
      passports: {},
      publicRegistry: {},
      revocationsLoaded: false,
    };
  }
  return globalThis[SECURITY_CACHE_KEY];
}

async function refreshSecurityCacheIfStale({ nowMs = Date.now() } = {}) {
  const cache = getCache();
  const ttlMs = Math.max(250, Number(process.env.AGENT_SECURITY_CACHE_TTL_MS) || 1000);

  if (nowMs - cache.loadedAtMs < ttlMs) {
    return cache;
  }

  cache.passports = readPassportsFromSecureConfig();
  cache.publicRegistry = await getAgentPublicRegistry();
  cache.loadedAtMs = nowMs;

  if (!cache.revocationsLoaded) {
    const fromDisk = await readRevocationsFromDisk();
    const revokedSet = getRevokedSet();
    for (const item of fromDisk.revoked) {
      const did = clean(item?.did, 240);
      if (did) {
        revokedSet.add(did);
      }
    }
    cache.revocationsLoaded = true;
  }

  return cache;
}

function resolveAllowedActions(passports = {}, { did = '', agentName = '' } = {}) {
  const didPassport = asObject(passports[did]);
  if (asArray(didPassport.actions).length) {
    return asArray(didPassport.actions).map((item) => clean(item, 120)).filter(Boolean);
  }

  const namePassport = asObject(passports[clean(agentName, 120).toLowerCase()]);
  return asArray(namePassport.actions).map((item) => clean(item, 120)).filter(Boolean);
}

function strictModeEnabled() {
  return clean(process.env.SECURITY_AGENT_INTENT_STRICT, 20).toLowerCase() === 'true';
}

async function readLastLedgerHash() {
  const cached = clean(globalThis[LAST_LEDGER_HASH_KEY], 200);
  if (cached) {
    return cached;
  }

  try {
    const raw = await fs.readFile(intentLedgerPath(), 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (!lines.length) {
      return '';
    }
    const last = asObject(JSON.parse(lines[lines.length - 1]));
    const hash = clean(last.hash, 200);
    globalThis[LAST_LEDGER_HASH_KEY] = hash;
    return hash;
  } catch {
    return '';
  }
}

async function appendImmutableSecurityLedgerRecord({
  recordType = 'intent_verification',
  did = '',
  agentName = '',
  action = '',
  runId = '',
  requestId = '',
  timestampMs = 0,
  digest = '',
  params = {},
  metadata = {},
} = {}) {
  const queue = globalThis[LEDGER_QUEUE_KEY] || Promise.resolve();
  globalThis[LEDGER_QUEUE_KEY] = queue
    .then(async () => {
      await fs.mkdir(securityDir(), { recursive: true });
      const previousHash = await readLastLedgerHash();

      const entry = {
        recordedAt: nowIso(),
        recordType: sanitizeLedgerRecordType(recordType),
        did: clean(did, 240),
        agentName: clean(agentName, 120),
        action: clean(action, 120),
        runId: clean(runId, 120),
        requestId: clean(requestId, 120),
        timestampMs: Number(timestampMs) || 0,
        digest: clean(digest, 120),
        paramsRedacted: redactFreeText(clean(JSON.stringify(asObject(params)), 20_000), { maxLength: 20_000 }),
        metadataRedacted: redactFreeText(clean(JSON.stringify(asObject(metadata)), 20_000), { maxLength: 20_000 }),
        previousHash,
      };

      entry.hash = createHash('sha256').update(stableStringify(entry)).digest('hex');

      await fs.appendFile(intentLedgerPath(), `${JSON.stringify(entry)}\n`, 'utf-8');
      globalThis[LAST_LEDGER_HASH_KEY] = entry.hash;
    })
    .catch(() => null);

  return globalThis[LEDGER_QUEUE_KEY];
}

async function appendIntentLedgerRecord(record = {}) {
  return appendImmutableSecurityLedgerRecord({
    recordType: 'intent_verification',
    did: record.did,
    agentName: record.agentName,
    action: record.action,
    runId: record.runId,
    requestId: record.requestId,
    timestampMs: record.timestampMs,
    digest: record.digest,
    params: record.params,
  });
}

export async function revokeAgentIdentity({ did = '', agentName = '' } = {}) {
  const normalizedDid = clean(did, 240);
  let effectiveDid = normalizedDid;

  if (!effectiveDid && clean(agentName, 120)) {
    const publicRecord = await getAgentPublicRecord({ agentName: clean(agentName, 120) });
    effectiveDid = clean(publicRecord?.did, 240);
  }

  if (!effectiveDid) {
    throw new Error('did or agentName is required for revoke operation.');
  }

  const revokedSet = getRevokedSet();
  revokedSet.add(effectiveDid);

  const existing = await readRevocationsFromDisk();
  const next = {
    revoked: [
      ...asArray(existing.revoked).filter((item) => clean(item?.did, 240) !== effectiveDid),
      {
        did: effectiveDid,
        revokedAt: nowIso(),
      },
    ],
    updatedAt: nowIso(),
  };

  await writeRevocationsToDisk(next);

  return {
    ok: true,
    did: effectiveDid,
    revokedCount: next.revoked.length,
  };
}

export async function isAgentRevoked({ did = '' } = {}) {
  const normalizedDid = clean(did, 240);
  if (!normalizedDid) {
    return false;
  }

  const revokedSet = getRevokedSet();
  if (revokedSet.has(normalizedDid)) {
    return true;
  }

  const cache = getCache();
  if (cache.revocationsLoaded) {
    return false;
  }

  const disk = await readRevocationsFromDisk();
  const found = asArray(disk.revoked).some((item) => clean(item?.did, 240) === normalizedDid);
  if (found) {
    revokedSet.add(normalizedDid);
  }
  return found;
}

export async function verifyAgentIntent({ envelope = {}, requiredAction = '' } = {}) {
  const started = process.hrtime.bigint();

  const payload = intentPayload(envelope);
  const signature = clean(envelope.signature, 20_000);
  const algorithm = clean(envelope.algorithm, 40).toLowerCase() || 'ed25519';

  if (!payload.did || !payload.agentName || !payload.action || !payload.timestampMs || !payload.nonce || !signature) {
    return {
      ok: false,
      code: 'invalid_intent_envelope',
      message: 'Intent envelope is missing required fields.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const nowMs = Date.now();
  const skewMs = Math.max(10_000, Number(process.env.AGENT_INTENT_MAX_SKEW_MS) || 5 * 60 * 1000);
  if (Math.abs(nowMs - payload.timestampMs) > skewMs) {
    return {
      ok: false,
      code: 'intent_timestamp_out_of_bounds',
      message: 'Intent timestamp is outside allowed skew window.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  await refreshSecurityCacheIfStale({ nowMs });

  if (await isAgentRevoked({ did: payload.did })) {
    return {
      ok: false,
      code: 'agent_revoked',
      message: 'Agent identity has been revoked.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const cache = getCache();
  const publicRecord = asObject(cache.publicRegistry?.[payload.did]) || (await getAgentPublicRecord({ did: payload.did }));
  const publicKeyPem = clean(publicRecord?.publicKeyPem, 50_000);
  if (!publicKeyPem) {
    return {
      ok: false,
      code: 'unknown_agent_identity',
      message: 'Agent public identity is not registered.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const verifyStarted = process.hrtime.bigint();

  const expectedDigest = computePayloadDigest(payload);
  if (payload.digest !== expectedDigest) {
    return {
      ok: false,
      code: 'intent_digest_mismatch',
      message: 'Intent digest mismatch.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  if (algorithm !== 'ed25519') {
    return {
      ok: false,
      code: 'unsupported_intent_algorithm',
      message: 'Unsupported intent signing algorithm.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const verified = cryptoVerify(
    null,
    Buffer.from(stableStringify(payload)),
    publicKeyPem,
    Buffer.from(signature, 'base64'),
  );

  if (!verified) {
    return {
      ok: false,
      code: 'intent_signature_invalid',
      message: 'Intent signature verification failed.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const allowedActions = resolveAllowedActions(cache.passports, {
    did: payload.did,
    agentName: payload.agentName,
  });

  const required = clean(requiredAction, 120);
  const effectiveAction = required || payload.action;

  if (!allowedActions.length && strictModeEnabled()) {
    return {
      ok: false,
      code: 'agent_passport_missing',
      message: 'No declared passport actions found for agent identity.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  if (allowedActions.length && !allowedActions.includes(effectiveAction)) {
    return {
      ok: false,
      code: 'agent_action_not_allowed',
      message: `Agent action not allowed by declared passport: ${effectiveAction}`,
      overheadNs: Number(process.hrtime.bigint() - started),
      allowedActions,
    };
  }

  if (required && payload.action !== required) {
    return {
      ok: false,
      code: 'agent_action_mismatch',
      message: 'Signed intent action does not match required action.',
      overheadNs: Number(process.hrtime.bigint() - started),
    };
  }

  const verifiedResult = {
    ok: true,
    code: 'verified',
    did: payload.did,
    agentName: payload.agentName,
    action: payload.action,
    allowedActions,
    overheadNs: Number(process.hrtime.bigint() - verifyStarted),
  };

  void appendIntentLedgerRecord(payload);
  return verifiedResult;
}

export async function verifyAgentIntentOrThrow({ envelope = {}, requiredAction = '' } = {}) {
  const verified = await verifyAgentIntent({ envelope, requiredAction });
  if (!verified.ok) {
    const error = new Error(verified.message || 'Agent intent verification failed.');
    error.code = verified.code;
    throw error;
  }
  return verified;
}

export { appendImmutableSecurityLedgerRecord };
