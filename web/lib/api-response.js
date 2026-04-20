import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export function getRequestId(request) {
  const incoming = String(request.headers.get('x-request-id') || '').trim();
  return incoming || randomUUID();
}

export function withRequestId(payload, requestId) {
  return {
    ...(payload || {}),
    requestId,
  };
}

export function jsonSuccess(payload, requestId, init = {}) {
  const response = NextResponse.json(withRequestId(payload, requestId), init);
  response.headers.set('x-request-id', requestId);
  return response;
}

export function jsonError({ message, requestId, status = 500, code = 'internal_error', details = null }) {
  const response = NextResponse.json(
    {
      error: String(message || 'Unexpected server error.'),
      code,
      requestId,
      ...(details ? { details } : {}),
    },
    { status },
  );
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function parseJsonBody(request, requestId) {
  try {
    return await request.json();
  } catch {
    throw {
      message: 'Request body must be valid JSON.',
      code: 'invalid_json',
      status: 400,
      requestId,
    };
  }
}
