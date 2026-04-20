import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSignedIntentEnvelope,
  didForAgent,
  initializeAgentIdentities,
} from '../lib/security/agent-identity.js';
import {
  revokeAgentIdentity,
  verifyAgentIntent,
} from '../lib/security/agent-intent.js';
import {
  createEphemeralDaytonaWorkspace,
  destroyEphemeralDaytonaWorkspace,
} from '../lib/security/daytona-sandbox.js';
import { runBlockingReasoningAdjudication } from '../lib/security/reasoning-adjudicator.js';

const passportConfig = {
  portal: { actions: ['payer.submit', 'emr.write'] },
  email: { actions: ['email.send', 'emr.write'] },
  voice: { actions: ['voice.call', 'billing.charge'] },
  extraction: { actions: ['extraction.run'] },
};

test('agent identities follow did:web naming and can verify signed intent under 1ms (warm path)', async () => {
  process.env.AGENT_PASSPORTS_JSON = JSON.stringify(passportConfig);
  process.env.SECURITY_AGENT_INTENT_STRICT = 'true';

  const init = await initializeAgentIdentities({
    agentNames: ['portal', 'email', 'voice', 'extraction'],
    forceRotate: true,
  });

  assert.equal(init.ok, true);
  assert.equal(init.initialized.length, 4);
  assert.equal(init.initialized[0].did.startsWith('did:web:authpilot.ai:agents:'), true);
  assert.equal(didForAgent('portal'), 'did:web:authpilot.ai:agents:portal');

  const envelope = await createSignedIntentEnvelope({
    agentName: 'portal',
    action: 'payer.submit',
    runId: 'run-security-1',
    requestId: 'req-security-1',
    params: { payerKey: 'uhc' },
  });

  const warmup = await verifyAgentIntent({ envelope, requiredAction: 'payer.submit' });
  assert.equal(warmup.ok, true);

  const verified = await verifyAgentIntent({ envelope, requiredAction: 'payer.submit' });
  assert.equal(verified.ok, true);
  assert.equal(verified.overheadNs < 1_000_000, true);
});

test('passport enforcement blocks unauthorized action for signed agent intent', async () => {
  process.env.AGENT_PASSPORTS_JSON = JSON.stringify(passportConfig);
  process.env.SECURITY_AGENT_INTENT_STRICT = 'true';

  const envelope = await createSignedIntentEnvelope({
    agentName: 'email',
    action: 'billing.charge',
    runId: 'run-security-2',
    requestId: 'req-security-2',
    params: { amountUsd: 50 },
  });

  const verified = await verifyAgentIntent({ envelope, requiredAction: 'billing.charge' });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'agent_action_not_allowed');
});

test('kill switch revokes agent DID and blocks future intent verification within one second', async () => {
  process.env.AGENT_PASSPORTS_JSON = JSON.stringify(passportConfig);
  process.env.SECURITY_AGENT_INTENT_STRICT = 'true';

  const envelope = await createSignedIntentEnvelope({
    agentName: 'extraction',
    action: 'extraction.run',
    runId: 'run-security-3',
    requestId: 'req-security-3',
    params: { mode: 'vlm' },
  });

  const revoke = await revokeAgentIdentity({ did: envelope.did });
  assert.equal(revoke.ok, true);

  const verified = await verifyAgentIntent({ envelope, requiredAction: 'extraction.run' });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'agent_revoked');
});

test('daytona sandbox isolates run-scoped resources and supports immediate teardown', async () => {
  const sandbox = await createEphemeralDaytonaWorkspace({
    runId: 'run-security-4',
    agentName: 'portal',
    clinicalArtifacts: ['/tmp/packet.pdf'],
    credentialRefs: ['vault://uhc/portal-creds'],
  });

  assert.equal(sandbox.ok, true);
  assert.equal(sandbox.scopedAccess.allowedClinicalArtifacts.length, 1);
  assert.equal(sandbox.scopedAccess.allowedCredentialRefs.length, 1);

  const destroyed = await destroyEphemeralDaytonaWorkspace({
    workspaceId: sandbox.workspaceId,
  });

  assert.equal(destroyed.ok, true);
});

test('reasoning adjudication blocks signing when strict citation fields are missing', async () => {
  const result = await runBlockingReasoningAdjudication({
    run: {
      appRunId: 'run-security-5',
      intake: {
        procedureCode: '99214',
        payerName: 'UHC',
        diagnosis: 'chronic pain',
        chartSummary: 'Patient has persistent pain and treatment history.',
      },
    },
    integrityThreshold: 0.95,
    retrievePolicyFn: async () => ({
      topOne: {
        id: 'uhc-99214-policy',
        title: 'UHC Policy',
        text: 'Coverage criteria text',
        sourceUrl: 'https://example.com/policy',
      },
      totalCandidates: 1,
    }),
    photonClient: {
      inference: {
        chat: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  integrityScore: 0.99,
                  decision: 'approve',
                  rationale: 'Looks good.',
                  claims: [
                    {
                      claim: 'Medical necessity documented.',
                      note_timestamp: '',
                      page_number: '3',
                      policy_id: 'uhc-99214-policy',
                    },
                  ],
                  reasoningPath: { steps: ['evaluate-policy'] },
                }),
              },
            },
          ],
        }),
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.integrityScore, 0);
  assert.equal(result.blocked, true);
});

test('reasoning adjudication downgrades integrity score when adversarial probe finds contradiction', async () => {
  const result = await runBlockingReasoningAdjudication({
    run: {
      appRunId: 'run-security-6',
      intake: {
        procedureCode: '99213',
        payerName: 'UHC',
        diagnosis: 'knee pain',
        chartSummary: 'No pain observed this morning but severe pain reported overnight.',
      },
    },
    integrityThreshold: 0.95,
    retrievePolicyFn: async () => ({
      topOne: {
        id: 'uhc-99213-policy',
        title: 'UHC Policy 99213',
        text: 'Coverage criteria text',
        sourceUrl: 'https://example.com/policy-99213',
      },
      totalCandidates: 1,
    }),
    photonClient: {
      inference: {
        chat: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  integrityScore: 0.99,
                  decision: 'approve',
                  rationale: 'Evidence and policy match.',
                  claims: [
                    {
                      claim: 'Persistent pain qualifies under policy criteria.',
                      note_timestamp: '2026-04-15T08:12:00Z',
                      page_number: '2',
                      policy_id: 'uhc-99213-policy',
                    },
                  ],
                  reasoningPath: { steps: ['policy-align'] },
                }),
              },
            },
          ],
        }),
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.integrityScore <= 0.8, true);
  assert.equal(result.blocked, true);
});
