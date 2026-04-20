import { enforceRateLimit, enforceWriteAuth, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { runPolicySentinel } from '@/lib/automation/policy-sentinel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeTargets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      payerId: safeTrim(item?.payerId || item?.payer || item?.key).toLowerCase(),
      label: safeTrim(item?.label || item?.name || item?.payerId),
      searchUrl: safeTrim(item?.searchUrl || item?.url),
    }))
    .filter((item) => item.payerId && item.searchUrl);
}

export async function POST(request) {
  const requestId = getRequestId(request);
  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'policy-sentinel-run', limit: 6, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const operatorId = safeTrim(body?.operatorId || body?.userId || 'staff-operator').slice(0, 120);
    const targets = normalizeTargets(body?.targets);
    const minDelayMs = parsePositiveIntParam(body?.minDelayMs, 2000, 60_000);
    const maxDelayMs = parsePositiveIntParam(body?.maxDelayMs, 5000, 120_000);

    const summary = await runPolicySentinel({
      targets,
      minDelayMs,
      maxDelayMs,
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.policy_sentinel.run',
      outcome: summary?.ok ? 'success' : 'error',
      route: '/api/automation/policy-sentinel/run',
      actor: operatorId || 'staff-operator',
      source: 'ui',
      details: {
        targetsRequested: targets.length,
        changed: Number(summary?.changed) || 0,
        staleReloadRequired: Number(summary?.staleReloadRequired) || 0,
        reindexed: Number(summary?.reindexed) || 0,
        alertsSent: Number(summary?.alertsSent) || 0,
      },
    });

    return jsonSuccess(
      {
        ok: summary?.ok === true,
        summary,
      },
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run Policy Sentinel.';
    await emitAuditEvent({
      requestId,
      action: 'automation.policy_sentinel.run',
      outcome: 'error',
      route: '/api/automation/policy-sentinel/run',
      actor: 'staff-operator',
      source: 'ui',
      details: {
        errorMessage: message,
      },
    });

    return jsonError({
      message,
      requestId,
      status: 500,
      code: 'policy_sentinel_run_failed',
    });
  }
}
