import { enforceRateLimit } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
import { getRevenueSnapshot } from '@/lib/automation/billing-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseLimit(raw, fallback = 60, max = 300) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.trunc(parsed));
}

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'billing-revenue-read', limit: 100, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'), 60, 300);
    const snapshot = await getRevenueSnapshot({ limit });
    return jsonSuccess(snapshot, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load revenue snapshot.',
      requestId,
      status: 500,
      code: 'billing_revenue_load_failed',
    });
  }
}
