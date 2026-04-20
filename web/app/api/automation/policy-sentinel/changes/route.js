import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
import { listPolicySentinelChanges } from '@/lib/automation/policy-sentinel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'policy-sentinel-changes', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const payerId = safeTrim(searchParams.get('payerId')).toLowerCase();
    const status = safeTrim(searchParams.get('status')).toUpperCase();
    const limit = parsePositiveIntParam(searchParams.get('limit'), 12, 100);

    const result = await listPolicySentinelChanges({
      payerId,
      status,
      limit,
    });

    return jsonSuccess(
      {
        ok: true,
        summary: result.summary,
        filters: result.filters,
        changes: result.changes,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load Policy Sentinel changes.',
      requestId,
      status: 500,
      code: 'policy_sentinel_changes_failed',
    });
  }
}
