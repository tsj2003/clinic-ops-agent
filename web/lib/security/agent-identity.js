import fs from 'fs/promises';
import path from 'path';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { fileURLToPath } from 'url';

const DEFAULT_AGENT_NAMES = ['extraction', 'portal', 'voice', 'email'];

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

function publicRegistryPath() {
  return path.join(securityDir(), 'agent-public-registry.json');
}

export function didForAgent(agentName = '') {
  const normalized = clean(agentName, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!normalized) {
    throw new Error('agentName is required to derive DID.');
  }
  return `did:web:authpilot.ai:agents:${normalized}`;
}

function readVault() {
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

function writeVault(vault = {}) {
  process.env.HARDENED_SECRET_VAULT = JSON.stringify(vault);
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

async function writeJsonFile(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function fingerprintPublicKey(publicKeyPem = '') {
  return createHash('sha256').update(clean(publicKeyPem, 20_000)).digest('hex').slice(0, 24);
}

function ensureVaultIdentityRoot(vault = {}) {
  const next = asObject(vault);
  if (!next.agentIdentities || typeof next.agentIdentities !== 'object' || Array.isArray(next.agentIdentities)) {
    next.agentIdentities = {};
  }
  return next;
}

function generateEd25519PemPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export async function initializeAgentIdentities({ agentNames = DEFAULT_AGENT_NAMES, forceRotate = false } = {}) {
  const names = asArray(agentNames).map((item) => clean(item, 120).toLowerCase()).filter(Boolean);
  if (!names.length) {
    throw new Error('At least one agent name is required.');
  }

  const vault = ensureVaultIdentityRoot(readVault());
  const registry = asObject(await readJsonFile(publicRegistryPath()));
  const nextRegistry = {
    updatedAt: nowIso(),
    agents: asObject(registry.agents),
  };

  const initialized = [];

  for (const agentName of names) {
    const existing = asObject(asObject(vault.agentIdentities)[agentName]);
    const hasExistingKeyPair = clean(existing.publicKeyPem, 50_000) && clean(existing.privateKeyPem, 50_000);

    const generated = !hasExistingKeyPair || forceRotate ? generateEd25519PemPair() : null;
    const did = clean(existing.did, 240) || didForAgent(agentName);

    const publicKeyPem = clean(generated?.publicKeyPem || existing.publicKeyPem, 50_000);
    const privateKeyPem = clean(generated?.privateKeyPem || existing.privateKeyPem, 50_000);

    if (!publicKeyPem || !privateKeyPem) {
      throw new Error(`Unable to initialize identity for agent: ${agentName}`);
    }

    vault.agentIdentities[agentName] = {
      agentName,
      did,
      publicKeyPem,
      privateKeyPem,
      createdAt: clean(existing.createdAt, 80) || nowIso(),
      rotatedAt: forceRotate || generated ? nowIso() : clean(existing.rotatedAt, 80),
      status: 'active',
    };

    nextRegistry.agents[did] = {
      agentName,
      did,
      publicKeyPem,
      fingerprint: fingerprintPublicKey(publicKeyPem),
      status: 'active',
      updatedAt: nowIso(),
    };

    initialized.push({
      agentName,
      did,
      fingerprint: fingerprintPublicKey(publicKeyPem),
      status: 'active',
    });
  }

  writeVault(vault);
  await writeJsonFile(publicRegistryPath(), nextRegistry);

  return {
    ok: true,
    initialized,
    count: initialized.length,
  };
}

export async function getAgentPublicRegistry() {
  const file = await readJsonFile(publicRegistryPath());
  return asObject(file.agents);
}

export async function getAgentPublicRecord({ did = '', agentName = '' } = {}) {
  const registry = await getAgentPublicRegistry();
  const normalizedDid = clean(did, 240);
  if (normalizedDid && asObject(registry[normalizedDid]).did) {
    return asObject(registry[normalizedDid]);
  }

  const normalizedAgent = clean(agentName, 120).toLowerCase();
  if (!normalizedAgent) {
    return null;
  }

  const hit = Object.values(registry).find((entry) => clean(entry?.agentName, 120).toLowerCase() === normalizedAgent);
  return hit ? asObject(hit) : null;
}

function getAgentPrivateKeyPem(agentName = '') {
  const normalizedAgent = clean(agentName, 120).toLowerCase();
  const vault = ensureVaultIdentityRoot(readVault());
  const identity = asObject(asObject(vault.agentIdentities)[normalizedAgent]);
  return clean(identity.privateKeyPem, 50_000);
}

async function ensureAgentIdentityExists(agentName = '') {
  const privateKeyPem = getAgentPrivateKeyPem(agentName);
  if (privateKeyPem) {
    return;
  }
  await initializeAgentIdentities({ agentNames: [agentName], forceRotate: false });
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

function intentPayloadDigest(intentPayload = {}) {
  const canonical = stableStringify(intentPayload);
  return createHash('sha256').update(canonical).digest('hex');
}

export async function createSignedIntentEnvelope({
  agentName = '',
  action = '',
  params = {},
  runId = '',
  requestId = '',
  timestampMs = Date.now(),
  nonce = '',
} = {}) {
  const normalizedAgent = clean(agentName, 120).toLowerCase();
  await ensureAgentIdentityExists(normalizedAgent);
  const did = didForAgent(normalizedAgent);
  const privateKeyPem = getAgentPrivateKeyPem(normalizedAgent);

  if (!privateKeyPem) {
    throw new Error(`Agent private key missing in HARDENED_SECRET_VAULT for ${normalizedAgent}.`);
  }

  const envelopePayload = {
    did,
    agentName: normalizedAgent,
    action: clean(action, 120),
    params: asObject(params),
    runId: clean(runId, 120),
    requestId: clean(requestId, 120),
    timestampMs: Number.isFinite(Number(timestampMs)) ? Number(timestampMs) : Date.now(),
    nonce: clean(nonce, 120) || createHash('sha256').update(`${normalizedAgent}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24),
    digest: '',
  };

  envelopePayload.digest = intentPayloadDigest(envelopePayload);

  const signature = cryptoSign(null, Buffer.from(stableStringify(envelopePayload)), privateKeyPem).toString('base64');

  return {
    ...envelopePayload,
    signature,
    algorithm: 'ed25519',
  };
}

export function sanitizeIntentEnvelopeForLogs(envelope = {}) {
  return {
    did: clean(envelope.did, 240),
    agentName: clean(envelope.agentName, 120),
    action: clean(envelope.action, 120),
    runId: clean(envelope.runId, 120),
    requestId: clean(envelope.requestId, 120),
    timestampMs: asObject({ value: envelope.timestampMs }).value,
    digest: clean(envelope.digest, 120),
    signaturePrefix: clean(envelope.signature, 20),
    algorithm: clean(envelope.algorithm, 40),
  };
}
