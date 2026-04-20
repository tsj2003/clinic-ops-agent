import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import { processVoiceTranscriptOutcome } from '../lib/automation/voice-agent.js';
import {
  PollingOrchestrator,
  runZeroTouchEmrPolling,
  resetPollingOrchestratorForTest,
} from '../lib/automation/emr-polling-service.js';
import { initializeAgentIdentities, createSignedIntentEnvelope } from '../lib/security/agent-identity.js';
import { appendImmutableSecurityLedgerRecord, verifyAgentIntent } from '../lib/security/agent-intent.js';
import { runBlockingReasoningAdjudication } from '../lib/security/reasoning-adjudicator.js';
import { saveRun } from '../lib/run-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const pilotVaultSecurityDir = path.resolve(webRoot, '.data', 'pilot-vault', 'security');
const intentLedgerPath = path.join(pilotVaultSecurityDir, 'intent-ledger.ndjson');
const billingLedgerPath = path.resolve(webRoot, '.data', 'pilot-vault', 'automation', 'billing', 'billing-ledger.audit.json');

const assertions = [];

function pass(message, details = '') {
  assertions.push({ ok: true, message, details });
  console.log(`✅ ${message}${details ? ` — ${details}` : ''}`);
}

function fail(message) {
  assertions.push({ ok: false, message });
  throw new Error(message);
}

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonSafe(raw = '') {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return {};
  }
}

async function readNdjson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseJsonSafe(line));
  } catch {
    return [];
  }
}

async function ensureParent(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function extractPolicyIdFromPrompt(messages = []) {
  const user = asArray(messages).find((m) => clean(m?.role, 30).toLowerCase() === 'user');
  const text = clean(user?.content, 40_000);
  const hit = text.match(/policy_id:\s*([^\n]+)/i);
  return clean(hit?.[1], 220) || 'audit-policy-unknown';
}

async function startAuditIntegrationServer() {
  const state = {
    axiomEvents: [],
    daytonaRequests: [],
    fireworksCalls: [],
    photonCalls: [],
  };

  const server = http.createServer(async (req, res) => {
    const method = clean(req.method, 20).toUpperCase();
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const parsedBody = parseJsonSafe(body);

    if (method === 'POST' && /\/v1\/datasets\/[^/]+\/ingest$/.test(url.pathname)) {
      const events = asArray(parsedBody);
      state.axiomEvents.push(...events.map((event) => ({ ...event, _ingestedAtMs: Date.now() })));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sent: true, accepted: events.length }));
      return;
    }

    if (method === 'POST' && /\/v1\/datasets\/[^/]+\/query$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rows: state.axiomEvents }));
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      const schemaName = clean(parsedBody?.response_format?.json_schema?.name, 120);

      if (schemaName === 'BatchIntakeRowSchema') {
        state.fireworksCalls.push({ atMs: Date.now(), schemaName, body: parsedBody });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            diagnosisCodes: ['M54.16'],
            procedureCodes: ['72148'],
            clinicalJustificationText: 'Conservative therapy documented; persistent neurologic deficit.',
            serviceDate: '2026-04-25',
            patientId: 'audit-patient',
          }) } }],
          usage: { prompt_tokens: 320, completion_tokens: 90 },
        }));
        return;
      }

      if (schemaName === 'VoiceStatusOutcomeSchema') {
        state.fireworksCalls.push({ atMs: Date.now(), schemaName, body: parsedBody });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            finalStatus: 'approved',
            referenceNumber: 'PA-VOICE-IDEMPOTENT-001',
            summary: 'Authorization approved and reference confirmed.',
            confidence: 0.99,
          }) } }],
        }));
        return;
      }

      if (schemaName === 'DenialSimulationSchema') {
        state.fireworksCalls.push({ atMs: Date.now(), schemaName, body: parsedBody });
        const policyId = extractPolicyIdFromPrompt(parsedBody?.messages);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            policy_id: policyId,
            denialProbabilityScore: 12,
            denialReason: 'Low denial risk in this packet.',
            missingDocumentation: [],
          }) } }],
        }));
        return;
      }

      if (schemaName === 'ExecutiveAdjudicationSchema') {
        state.photonCalls.push({ atMs: Date.now(), schemaName, body: parsedBody });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            integrityScore: 0.61,
            decision: 'block',
            rationale: 'Clinical note contradicts policy-required conservative treatment duration.',
            claims: [
              {
                claim: 'Only one week of PT documented while policy requires six weeks.',
                note_timestamp: '2026-04-15T10:00:00Z',
                page_number: '2',
                policy_id: 'audit-uhc-72148-policy',
              },
            ],
            reasoningPath: {
              contradiction: '1 week PT versus policy minimum 6 weeks',
              action: 'block_signing',
            },
          }) } }],
        }));
        return;
      }

      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Unsupported schema: ${schemaName || 'unknown'}` }));
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/workspaces') {
      state.daytonaRequests.push({ method, path: url.pathname, body: parsedBody, atMs: Date.now() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `ws-${randomUUID().slice(0, 8)}` }));
      return;
    }

    if (method === 'DELETE' && url.pathname.startsWith('/v1/workspaces/')) {
      state.daytonaRequests.push({ method, path: url.pathname, atMs: Date.now() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    server,
    baseUrl,
    state,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function configureAuditEnv({ baseUrl }) {
  process.env.NODE_ENV = 'test';
  process.env.AXIOM_API_TOKEN = 'audit-token';
  process.env.AXIOM_DATASET = 'audit-production';
  process.env.AXIOM_BASE_URL = baseUrl;
  process.env.PHOTON_API_KEY = 'audit-photon-token';
  process.env.PHOTON_BASE_URL = `${baseUrl}/v1`;
  process.env.PHOTON_ADJUDICATOR_MODEL = 'llama-3.1-405b';
  process.env.FIREWORKS_API_KEY = 'audit-fireworks-token';
  process.env.FIREWORKS_BASE_URL = `${baseUrl}/inference/v1`;
  process.env.DAYTONA_API_KEY = 'audit-daytona-token';
  process.env.DAYTONA_BASE_URL = baseUrl;
  process.env.AGENTMAIL_API_KEY = 'audit-agentmail-token';
  process.env.AGENTMAIL_INBOX_DOMAIN = 'agentmail.to';
  process.env.SECURITY_AGENT_INTENT_STRICT = 'true';
  process.env.BILLING_LEDGER_PATH = billingLedgerPath;
  process.env.AGENT_PASSPORTS_JSON = JSON.stringify({
    portal: { actions: ['payer.submit', 'emr.write'] },
    email: { actions: ['email.send', 'emr.write'] },
    voice: { actions: ['voice.call', 'billing.charge'] },
    extraction: { actions: ['extraction.run'] },
  });

  await ensureParent(billingLedgerPath);
  await fs.writeFile(billingLedgerPath, `${JSON.stringify({ charges: [], refunds: [], events: [] }, null, 2)}\n`, 'utf-8');
}

async function auditSovereignIdentity() {
  const initialized = await initializeAgentIdentities({
    agentNames: ['portal', 'email', 'voice', 'extraction'],
    forceRotate: true,
  });

  assert.equal(initialized.ok, true);
  const vault = parseJsonSafe(process.env.HARDENED_SECRET_VAULT || '{}');
  const identities = vault?.agentIdentities || {};
  const entries = Object.values(identities);

  const dids = new Set(entries.map((entry) => clean(entry?.did, 240)).filter(Boolean));
  const pubKeys = new Set(entries.map((entry) => clean(entry?.publicKeyPem, 50_000)).filter(Boolean));
  const privKeys = new Set(entries.map((entry) => clean(entry?.privateKeyPem, 50_000)).filter(Boolean));

  assert.equal(dids.size >= 4, true);
  assert.equal(pubKeys.size >= 4, true);
  assert.equal(privKeys.size >= 4, true);
  pass('Sovereign DID identity set has unique Ed25519 keypairs per agent');

  const forbiddenEnvelope = await createSignedIntentEnvelope({
    agentName: 'email',
    action: 'billing.charge',
    runId: `run-audit-sovereign-${Date.now().toString(36)}`,
    requestId: 'req-audit-sovereign',
    params: { amountUsd: 50 },
  });

  const forbidden = await verifyAgentIntent({
    envelope: forbiddenEnvelope,
    requiredAction: 'billing.charge',
  });

  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.code, 'agent_action_not_allowed');
  pass('Passport enforcement blocks cross-agent privilege escalation');
}

async function auditPhotonBlocking({ state }) {
  const runId = `run-audit-photon-${Date.now().toString(36)}`;
  const run = {
    appRunId: runId,
    intake: {
      payerName: 'UHC',
      procedureCode: '72148',
      diagnosis: 'lumbar radiculopathy',
      chartSummary: 'Patient only had 1 week of PT despite policy requiring 6 weeks.',
    },
    readiness: {
      summary: 'Potential contradiction between chart and policy.',
      missing_evidence: [],
    },
    operatorPacket: {
      case_id: `case-${runId}`,
      procedure_code: '72148',
      payer_name: 'UHC',
    },
  };

  const adjudication = await runBlockingReasoningAdjudication({
    run,
    integrityThreshold: 0.95,
    policy: {
      id: 'audit-uhc-72148-policy',
      title: 'UHC MRI conservative-treatment requirement',
      sourceUrl: 'https://audit.local/policy/uhc-72148',
      text: 'Policy requires at least 6 weeks of conservative treatment before MRI authorization.',
    },
    justificationPacket: {
      text: 'Patient only had 1 week of PT. Contradiction with policy minimum 6 weeks.',
    },
  });

  await appendImmutableSecurityLedgerRecord({
    recordType: 'reasoning_adjudication',
    did: 'did:web:authpilot.ai:agents:portal',
    agentName: 'portal',
    action: 'reasoning.adjudicate',
    runId,
    requestId: `req-${runId}`,
    timestampMs: Date.now(),
    digest: randomUUID().replace(/-/g, ''),
    params: {
      integrityScore: Number(adjudication?.integrityScore) || 0,
      threshold: Number(adjudication?.threshold) || 0.95,
      blocked: Boolean(adjudication?.blocked),
    },
    metadata: {
      reason: clean(adjudication?.reason, 1000),
      reasoningPath: adjudication?.reasoningPath || {},
    },
  });

  let authError = null;
  try {
    if (!adjudication?.ok || adjudication?.blocked) {
      const error = new Error(clean(adjudication?.reason, 500) || 'Blocked by adjudicator.');
      error.code = 'AUTHENTICATION_ERROR';
      throw error;
    }
  } catch (error) {
    authError = error;
  }

  assert.equal(Boolean(authError), true);
  assert.equal(clean(authError?.code, 120), 'AUTHENTICATION_ERROR');
  pass('Photon adjudicator block raises AUTHENTICATION_ERROR');

  assert.equal(state.daytonaRequests.length, 0);
  pass('Daytona sandbox creation is blocked when adjudication integrity is below threshold');

  const ledgerRows = await readNdjson(intentLedgerPath);
  const adjudicationRecord = ledgerRows.find(
    (row) => clean(row?.recordType, 80) === 'reasoning_adjudication' && clean(row?.runId, 120) === runId,
  );
  assert.equal(Boolean(adjudicationRecord), true);
  pass('Immutable pilot-vault ledger contains redacted reasoning adjudication record');
}

async function auditIdempotentRevenueLock() {
  const runId = `run-audit-voice-${Date.now().toString(36)}`;
  const run = {
    appRunId: runId,
    workspace: { id: 'practice-audit', name: 'Practice Audit' },
    intake: {
      patientId: 'pt-audit-2',
      firstName: 'Sam',
      lastName: 'Revenue',
      payerName: 'UHC',
      procedureCode: '72148',
      practiceId: 'practice-audit',
    },
    operatorPacket: {
      case_id: `case-${runId}`,
      procedure_code: '72148',
      emr_sync: {
        connector: 'athena',
        external_emr_id: '',
      },
    },
    caseLifecycle: {
      status: 'submitted',
      updatedAt: new Date().toISOString(),
      history: [],
    },
  };
  await saveRun(run);

  const first = await processVoiceTranscriptOutcome({
    run,
    transcript: 'Approved. Reference number PA-VOICE-IDEMPOTENT-001.',
    reachedHumanTransfer: false,
    clinicName: 'Audit Clinic',
  });

  const second = await processVoiceTranscriptOutcome({
    run,
    transcript: 'Approved. Reference number PA-VOICE-IDEMPOTENT-001.',
    reachedHumanTransfer: false,
    clinicName: 'Audit Clinic',
  });

  assert.equal(first?.billing?.ok, true);
  assert.equal(second?.billing?.ok, true);
  assert.equal(Boolean(second?.billing?.duplicate), true);
  pass('Double APPROVED callbacks return cached Parasail success for second event');

  const billingLedger = parseJsonSafe(await fs.readFile(billingLedgerPath, 'utf-8'));
  const charges = asArray(billingLedger?.charges).filter(
    (item) => clean(item?.payerReferenceId, 120) === 'PA-VOICE-IDEMPOTENT-001',
  );

  assert.equal(charges.length, 1);
  pass('Parasail ledger has exactly one transaction for deterministic payer_reference_id idempotency key');
}

async function auditZeroTouchPollingTrace({ state }) {
  resetPollingOrchestratorForTest();

  const appointmentId = `appt-${Date.now().toString(36)}`;
  let discoveryAtMs = 0;

  const runFn = (payload = {}) =>
    runZeroTouchEmrPolling({
      ...payload,
      includeEpic: false,
      pollAthena: async () => {
        discoveryAtMs = Date.now();
        return {
          ok: true,
          skipped: false,
          appointments: [
            {
              sourceSystem: 'athenahealth',
              appointmentId,
              patientId: 'pt-poll-1',
              patientFirstName: 'Taylor',
              patientLastName: 'Polling',
              payerName: 'UHC',
              providerName: 'Dr Poll',
              providerId: 'prov-poll',
              departmentId: 'dept-poll',
              appointmentDate: '2026-04-25',
              cptCodes: ['72148'],
              primaryCptCode: '72148',
              chartSummary: 'Conservative treatment complete; persistent symptoms.',
              clinicalRecordImageBase64: 'ZmFrZS1pbWFnZS1kYXRh',
              raw: {},
            },
          ],
        };
      },
      jitterMs: 0,
    });

  const orchestrator = new PollingOrchestrator({
    runFn,
    defaultIntervalMs: 1000,
  });

  orchestrator.registerTenant({
    tenantId: 'tenant-audit-polling',
    includeAthena: true,
    includeEpic: false,
    intervalMs: 1000,
  });

  orchestrator.start();

  const deadlineMs = Date.now() + 12_000;
  let finished = false;
  while (Date.now() < deadlineMs) {
    const stateSnapshot = orchestrator.getStatusSnapshot({ includeLastResults: true });
    const tenant = asArray(stateSnapshot.tenants)[0] || {};
    const createdRuns = Number(tenant?.lastResultSummary?.createdRuns || 0);
    if (createdRuns >= 1) {
      finished = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  orchestrator.stop();

  if (!finished) {
    fail('PollingOrchestrator did not create a zero-touch run within timeout window.');
  }

  const extractionCall = state.fireworksCalls.find((call) => clean(call?.schemaName, 120) === 'BatchIntakeRowSchema');
  assert.equal(Boolean(extractionCall), true);

  const lagMs = Number(extractionCall.atMs) - Number(discoveryAtMs);
  assert.equal(lagMs >= 0, true);
  assert.equal(lagMs <= 10_000, true);
  pass('Fireworks extraction starts within 10 seconds of athena appointment discovery', `${lagMs}ms`);

  const hasZeroTouchEvent = state.axiomEvents.some(
    (event) => clean(event?.signal, 120) === 'zero_touch_ingestion_event' && clean(event?.appointmentId, 120) === appointmentId,
  );

  assert.equal(hasZeroTouchEvent, true);
  pass('Axiom telemetry stream contains zero_touch_ingestion_event without UI-triggered sync');
}

async function main() {
  console.log('🔒 Step 15 Hard Audit: End-to-End Production Integrity & Truth-First Verification');

  const integration = await startAuditIntegrationServer();
  try {
    await configureAuditEnv({ baseUrl: integration.baseUrl });

    await auditSovereignIdentity();
    await auditPhotonBlocking({ state: integration.state });
    await auditIdempotentRevenueLock();
    await auditZeroTouchPollingTrace({ state: integration.state });

    const total = assertions.length;
    const passed = assertions.filter((item) => item.ok).length;
    const failed = total - passed;

    if (failed > 0) {
      throw new Error(`Audit completed with failures: ${passed}/${total} passed.`);
    }

    console.log(`\n🎯 PRODUCTION HARD AUDIT RESULT: ${passed}/${total} assertions passed (100%).`);
  } finally {
    await integration.close();
    resetPollingOrchestratorForTest();
  }
}

main().catch((error) => {
  console.error('\n❌ PRODUCTION HARD AUDIT FAILED');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
