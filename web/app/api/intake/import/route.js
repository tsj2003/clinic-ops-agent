import { enforceRateLimit, enforceWriteAuth, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { parseBatchIntake } from '@/lib/intake-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'intake-import-write', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const rawText = safeTrim(body?.rawText);
    const format = safeTrim(body?.formatHint).toLowerCase();

    if (!rawText) {
      return jsonError({
        message: 'rawText is required.',
        requestId,
        status: 400,
        code: 'invalid_import_payload',
      });
    }

    const parsed = parseBatchIntake(rawText, format);
    return jsonSuccess(parsed, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to parse intake import file.',
      requestId,
      status: 400,
      code: 'intake_import_failed',
    });
  }
}
