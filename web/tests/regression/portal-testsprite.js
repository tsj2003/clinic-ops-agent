import { runReliabilityGate } from '../../lib/automation/testsprite-reliability.js';
import { getPortalCredentialSecret } from '../../lib/automation/secret-vault.js';

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function ensureHardenedVaultCredential(system = 'uhc') {
  const credentials = getPortalCredentialSecret(system);
  if (credentials.source !== 'vault-reference') {
    throw new Error(`${system.toUpperCase()} portal credentials must be loaded from HARDENED_SECRET_VAULT references.`);
  }
  return credentials;
}

function buildIntentMap() {
  return {
    prdIntent:
      'Navigate to Payer Portal X, log in, find the Prior Auth form, and upload a clinical PDF.',
    steps: [
      'Open payer portal login page',
      'Authenticate with hardened vault credentials',
      'Navigate to prior authorization workflow',
      'Locate the correct member authorization form',
      'Upload clinical PDF and submit',
    ],
    systems: {
      payer: clean(process.env.TESTSPRITE_PAYER_KEY || 'uhc', 40),
      runner: 'playwright',
      monitor: 'testsprite',
    },
  };
}

async function main() {
  ensureHardenedVaultCredential(clean(process.env.TESTSPRITE_PAYER_KEY || 'uhc', 40));

  const intent = buildIntentMap();

  const result = await runReliabilityGate({
    suite: clean(process.env.TESTSPRITE_SUITE || 'payer-portal-nightly', 200),
    metadata: {
      source: 'testsprite-regression',
      intent,
      callbackUrl: clean(process.env.TESTSPRITE_FAILURE_WEBHOOK_URL, 1200),
      branch: process.env.GITHUB_REF_NAME || process.env.VERCEL_GIT_COMMIT_REF || '',
      commitSha: process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '',
    },
    minPassRate: Number(process.env.TESTSPRITE_MIN_PASS_RATE || 0.98),
    required: true,
  });

  console.info('[testsprite-portal-regression]', JSON.stringify(result));

  if (!result.gatePassed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[testsprite-portal-regression] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
