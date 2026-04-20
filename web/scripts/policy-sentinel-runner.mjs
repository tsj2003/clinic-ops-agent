import { runPolicySentinel } from '../lib/automation/policy-sentinel.js';

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asBoolean(value, fallback = false) {
  const normalized = clean(value, 40).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const outcome = await runPolicySentinel({
  minDelayMs: Math.max(0, asNumber(process.env.POLICY_SENTINEL_MIN_DELAY_MS, 2000)),
  maxDelayMs: Math.max(0, asNumber(process.env.POLICY_SENTINEL_MAX_DELAY_MS, 5000)),
});

console.info('[policy-sentinel]', JSON.stringify(outcome));

const required = asBoolean(process.env.POLICY_SENTINEL_REQUIRED, false);
if (required && (!outcome.ok || outcome.errors.length > 0)) {
  process.exit(1);
}
