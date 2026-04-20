const REDACTION_PATTERNS = [
  {
    name: 'ssn',
    pattern: /\b(?:SSN\s*[:#-]?\s*)?\d{3}-\d{2}-\d{4}\b/gi,
    replacement: '[REDACTED_SSN]',
  },
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    name: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  {
    name: 'mrn',
    pattern: /\b(?:MRN|Member ID|Subscriber ID|Patient ID)\s*[:#-]?\s*[A-Z0-9-]{4,}\b/gi,
    replacement: '[REDACTED_IDENTIFIER]',
  },
  {
    name: 'dob',
    pattern: /\b(?:DOB|Date of Birth)\s*[:#-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    replacement: '[REDACTED_DOB]',
  },
  {
    name: 'npi',
    pattern: /\b(?:NPI\s*[:#-]?\s*)?\d{10}\b/gi,
    replacement: '[REDACTED_NPI]',
  },
];

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export function redactFreeText(value, { maxLength = 4000 } = {}) {
  const input = clean(value, maxLength);
  if (!input) {
    return '';
  }

  return REDACTION_PATTERNS.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), input);
}

export function redactLogPayload(payload = {}) {
  return {
    ...payload,
    text: redactFreeText(payload.text, { maxLength: 1000 }),
  };
}
