function clean(value) {
  return String(value || '').trim();
}

function isEncryptedReference(value) {
  const input = clean(value);
  if (!input) return false;
  return /^(enc:|aws-sm:\/\/|gcp-sm:\/\/|azure-kv:\/\/|vault:\/\/|sm:\/\/)/i.test(input);
}

function looksLikePlainKeyMaterial(value) {
  const input = clean(value);
  if (!input) return false;
  if (/BEGIN (RSA )?PRIVATE KEY|BEGIN PUBLIC KEY/i.test(input)) {
    return true;
  }
  if (input.length > 120 && /^[A-Za-z0-9+/=._:-]+$/.test(input) && !isEncryptedReference(input)) {
    return true;
  }
  return false;
}

function fail(message) {
  console.error(`[startup-validation] ${message}`);
  process.exit(1);
}

function validateRequired(name, { allowPlain = false } = {}) {
  const value = clean(process.env[name]);
  if (!value) {
    fail(`Missing required production secret: ${name}`);
  }

  if (!allowPlain && !isEncryptedReference(value)) {
    if (looksLikePlainKeyMaterial(value) || value.length >= 8) {
      fail(`${name} must be provided as encrypted reference (enc:/aws-sm://gcp-sm://azure-kv://vault://sm://).`);
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  process.exit(0);
}

const dataScope = clean(process.env.AUTHPILOT_DATA_SCOPE);
if (dataScope !== 'pilot-vault') {
  fail('AUTHPILOT_DATA_SCOPE must be set to pilot-vault in production.');
}

validateRequired('EPIC_RSA_PRIVATE_KEY', { allowPlain: false });
validateRequired('EPIC_RSA_PUBLIC_KEY', { allowPlain: false });
validateRequired('ATHENAHEALTH_CLIENT_ID', { allowPlain: false });
validateRequired('ATHENAHEALTH_CLIENT_SECRET', { allowPlain: false });
validateRequired('FIREWORKS_API_KEY', { allowPlain: false });
validateRequired('UHC_PORTAL_CREDENTIALS', { allowPlain: false });
validateRequired('AGENTMAIL_API_KEY', { allowPlain: false });
validateRequired('AGENTMAIL_WEBHOOK_SECRET', { allowPlain: false });

const voiceAgentEnabled = clean(process.env.VOICE_AGENT_ENABLED).toLowerCase() === 'true';
if (voiceAgentEnabled) {
  validateRequired('ELEVENLABS_API_KEY', { allowPlain: false });
  validateRequired('TWILIO_ACCOUNT_SID', { allowPlain: false });
  validateRequired('TWILIO_AUTH_TOKEN', { allowPlain: false });
  validateRequired('TWILIO_PHONE_NUMBER', { allowPlain: false });
  validateRequired('VOICE_AGENT_WEBHOOK_SECRET', { allowPlain: false });
}

const testspriteRegressionEnabled = clean(process.env.TESTSPRITE_REGRESSION_ENABLED).toLowerCase() === 'true';
if (testspriteRegressionEnabled) {
  validateRequired('TESTSPRITE_API_KEY', { allowPlain: false });
  validateRequired('TESTSPRITE_WEBHOOK_SECRET', { allowPlain: false });
}

const preflightRuleAuditorEnabled = clean(process.env.PREFLIGHT_RULE_AUDITOR_ENABLED).toLowerCase() === 'true';
if (preflightRuleAuditorEnabled) {
  validateRequired('MIXEDBREAD_API_KEY', { allowPlain: false });
  validateRequired('PRE_SUBMISSION_AUDIT_WEBHOOK_SECRET', { allowPlain: false });
}

const composioBridgeEnabled = clean(process.env.COMPOSIO_BRIDGE_ENABLED).toLowerCase() === 'true';
if (composioBridgeEnabled) {
  validateRequired('COMPOSIO_API_KEY', { allowPlain: false });
}

const axiomMonitorEnabled = clean(process.env.AXIOM_MONITOR_ENABLED).toLowerCase() === 'true';
if (axiomMonitorEnabled) {
  validateRequired('AXIOM_API_TOKEN', { allowPlain: false });
  if (!clean(process.env.AXIOM_DATASET)) {
    fail('Missing required production setting: AXIOM_DATASET');
  }
}

const billingEngineEnabled = clean(process.env.BILLING_ENGINE_ENABLED).toLowerCase() === 'true';
if (billingEngineEnabled) {
  validateRequired('PARASAIL_API_KEY', { allowPlain: false });
  validateRequired('YOTTA_LABS_API_KEY', { allowPlain: false });
}

const policySentinelEnabled = clean(process.env.POLICY_SENTINEL_ENABLED).toLowerCase() === 'true';
if (policySentinelEnabled) {
  validateRequired('MIXEDBREAD_API_KEY', { allowPlain: false });
  validateRequired('FIREWORKS_API_KEY', { allowPlain: false });
}

console.log('[startup-validation] Production secret validation passed.');
