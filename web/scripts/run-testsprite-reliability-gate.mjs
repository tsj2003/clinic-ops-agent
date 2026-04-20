import { runReliabilityGate } from '../lib/automation/testsprite-reliability.js';

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const minPassRate = asNumber(process.env.TESTSPRITE_MIN_PASS_RATE, 0.95);
const pollIntervalMs = asNumber(process.env.TESTSPRITE_POLL_INTERVAL_MS, 15_000);
const timeoutMs = asNumber(process.env.TESTSPRITE_TIMEOUT_MS, 15 * 60 * 1000);

const outcome = await runReliabilityGate({
  suite: process.env.TESTSPRITE_SUITE || 'payer-portal-nightly',
  metadata: {
    source: 'authpilot-web',
    branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || '',
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '',
  },
  minPassRate,
  pollIntervalMs,
  timeoutMs,
});

console.info('[reliability-gate]', JSON.stringify(outcome));

if (!outcome.gatePassed) {
  process.exit(1);
}
