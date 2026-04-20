import { NextResponse } from 'next/server';

const RATE_LIMIT_STATE_KEY = '__authpilotRateLimitState';

function getRateLimitStore() {
  if (!globalThis[RATE_LIMIT_STATE_KEY]) {
    globalThis[RATE_LIMIT_STATE_KEY] = new Map();
  }
  return globalThis[RATE_LIMIT_STATE_KEY];
}

export function safeTrim(value) {
  return String(value || '').trim();
}

export function safeTrimToMax(value, maxLength = 5000) {
  const trimmed = safeTrim(value);
  if (!trimmed) {
    return '';
  }
  return trimmed.slice(0, Math.max(1, Number(maxLength) || 1));
}

export function isValidHttpUrl(value) {
  const input = safeTrim(value);
  if (!input) {
    return false;
  }

  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parsePositiveIntParam(value, fallback, max = 200) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.trunc(parsed));
}

export function enforceWriteAuth(request) {
  const expectedKey = safeTrim(process.env.INTERNAL_API_KEY);
  if (expectedKey) {
    const providedKey = safeTrim(request.headers.get('x-internal-api-key'));
    if (providedKey !== expectedKey) {
      return NextResponse.json(
        { error: 'Unauthorized request. Missing or invalid internal API key.' },
        { status: 401 },
      );
    }
  }

  const originHeader = safeTrim(request.headers.get('origin'));
  if (!originHeader) {
    return null;
  }

  try {
    const requestHost = new URL(request.url).host;
    const originHost = new URL(originHeader).host;
    if (requestHost !== originHost) {
      return NextResponse.json({ error: 'Cross-origin write requests are not allowed.' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid origin header on write request.' }, { status: 400 });
  }

  return null;
}

export function enforceRateLimit(request, { key, limit = 20, windowMs = 60_000 }) {
  const routeKey = safeTrim(key) || 'default';
  const now = Date.now();
  const forwardedFor = safeTrim(request.headers.get('x-forwarded-for'));
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown';
  const bucketKey = `${routeKey}:${ip}`;

  const store = getRateLimitStore();
  const bucket = store.get(bucketKey);

  if (!bucket || now >= bucket.resetAt) {
    store.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Please retry shortly.',
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
        },
      },
    );
  }

  bucket.count += 1;
  store.set(bucketKey, bucket);
  return null;
}
