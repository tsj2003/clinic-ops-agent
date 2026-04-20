import path from 'path';

const ALLOWED_SCOPES = new Set(['synthetic-demo', 'pilot-vault']);

function clean(value) {
  return String(value || '').trim();
}

export function getDataScope() {
  const configured = clean(process.env.AUTHPILOT_DATA_SCOPE) || 'synthetic-demo';
  if (!ALLOWED_SCOPES.has(configured)) {
    throw new Error(
      `Invalid AUTHPILOT_DATA_SCOPE: ${configured || '(empty)'}. Allowed values: synthetic-demo, pilot-vault.`,
    );
  }
  return configured;
}

export function getScopedDataDir(moduleDir) {
  const scope = getDataScope();
  return path.resolve(moduleDir, '..', '..', '.data', scope);
}

export function getScopedCollectionName(baseName, overrideEnvKey) {
  const override = clean(process.env[overrideEnvKey]);
  if (override) {
    return override;
  }
  const scopeSuffix = getDataScope().replace(/-/g, '_');
  return `${baseName}_${scopeSuffix}`;
}

export function isPilotVaultScope() {
  return getDataScope() === 'pilot-vault';
}
