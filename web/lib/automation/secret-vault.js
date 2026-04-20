function clean(value, max = 6000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function looksEncryptedReference(value) {
  return /^(enc:|aws-sm:\/\/|gcp-sm:\/\/|azure-kv:\/\/|vault:\/\/|sm:\/\/)/i.test(clean(value));
}

function isProduction() {
  return clean(process.env.NODE_ENV).toLowerCase() === 'production';
}

export function getPortalCredentialSecret(system = 'uhc') {
  const key = `${clean(system, 40).toUpperCase()}_PORTAL_CREDENTIALS`;
  const value = clean(process.env[key]);
  if (!value) {
    throw new Error(`Missing portal credential secret reference: ${key}`);
  }

  if (isProduction() && !looksEncryptedReference(value)) {
    throw new Error(`${key} must be provided via hardened secret vault reference.`);
  }

  // In non-production, allow direct JSON for developer testing only.
  if (!looksEncryptedReference(value) && value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      return {
        username: clean(parsed.username, 240),
        password: clean(parsed.password, 240),
        otpSeed: clean(parsed.otpSeed, 240),
        source: 'inline-dev-json',
      };
    } catch {
      throw new Error(`${key} dev JSON is invalid.`);
    }
  }

  // For encrypted refs, return opaque marker; resolver can be added without changing API.
  return {
    username: '',
    password: '',
    otpSeed: '',
    source: 'vault-reference',
    reference: value,
  };
}
