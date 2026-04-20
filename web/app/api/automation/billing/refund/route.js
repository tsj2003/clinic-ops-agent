import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { triggerRefundWindowCredit } from '@/lib/automation/billing-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 400) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'billing-refund-write', limit: 25, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body?.runId, 120);

    if (!runId) {
      return jsonError({
        message: 'runId is required.',
        requestId,
        status: 400,
        code: 'missing_run_id',
      });
    }

    const result = await triggerRefundWindowCredit({
      runId,
      payerReferenceId: clean(body?.payerReferenceId, 120),
      reason: clean(body?.reason || 'approval_inaccurate', 200),
      actor: clean(body?.actor || 'clinician', 120),
      requestId,
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to issue billing credit.',
      requestId,
      status: 500,
      code: 'billing_refund_failed',
    });
  }
}
