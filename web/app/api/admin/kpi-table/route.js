import { enforceRateLimit, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
import { buildKpiBaselineOutcomeRollup } from '@/lib/kpi-baseline-rollup';
import { listPilotCommitments } from '@/lib/pilot-commitment-store';
import { listRunsForAnalytics } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireInternalAccess(request, requestId) {
  const expectedKey = safeTrim(process.env.INTERNAL_API_KEY);
  if (!expectedKey) {
    return null;
  }

  const providedKey = safeTrim(request.headers.get('x-internal-api-key'));
  if (providedKey !== expectedKey) {
    return jsonError({
      message: 'Unauthorized request. Missing or invalid internal API key.',
      requestId,
      status: 401,
      code: 'unauthorized',
    });
  }

  return null;
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-kpi-table', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const [{ runs, storage: runStorage }, { commitments, storage: commitmentStorage }] = await Promise.all([
      listRunsForAnalytics(500),
      listPilotCommitments(500),
    ]);

    const rollup = buildKpiBaselineOutcomeRollup({
      runs: Array.isArray(runs) ? runs : [],
      commitments: Array.isArray(commitments) ? commitments : [],
    });

    return jsonSuccess(
      {
        ...rollup,
        storage: {
          runs: runStorage,
          commitments: commitmentStorage,
        },
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to build KPI baseline/current rollup.',
      requestId,
      status: 500,
      code: 'admin_kpi_table_failed',
    });
  }
}
