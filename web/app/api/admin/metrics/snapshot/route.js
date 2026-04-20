import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
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

function inWindow(run, cutoffMs) {
  const startedAtMs = Date.parse(run?.startedAt || '');
  return Number.isFinite(startedAtMs) && startedAtMs >= cutoffMs;
}

function summarizeForWindow(runs, days) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const scopedRuns = runs.filter((run) => inWindow(run, cutoffMs));
  const completed = scopedRuns.filter((run) => run?.status === 'completed');
  const failed = scopedRuns.filter((run) => run?.status === 'failed');

  const avgConfidence = completed.length
    ? Math.round(completed.reduce((sum, run) => sum + (Number(run?.readiness?.confidence) || 0), 0) / completed.length)
    : 0;

  const totalHoursSaved = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedHoursSaved) || 0), 0);
  const totalRecovered = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedRecoveredRevenueUsd) || 0), 0);
  const avgDaysSaved = completed.length
    ? completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedDaysToAuthSaved) || 0), 0) / completed.length
    : 0;

  return {
    days,
    totalRuns: scopedRuns.length,
    completedRuns: completed.length,
    failedRuns: failed.length,
    successRatePercent: scopedRuns.length ? Math.round((completed.length / scopedRuns.length) * 100) : 0,
    readinessRatePercent: completed.length
      ? Math.round((completed.filter((run) => run?.readiness?.ready === true).length / completed.length) * 100)
      : 0,
    avgConfidence,
    totalHoursSaved: Number(totalHoursSaved.toFixed(2)),
    avgDaysToAuthSaved: Number(avgDaysSaved.toFixed(2)),
    totalRecoveredRevenueUsd: Number(totalRecovered.toFixed(2)),
  };
}

function buildMarkdown(summary, generatedAt) {
  return [
    '# AuthPilot KPI Snapshot',
    '',
    `Generated: ${generatedAt}`,
    `Window: last ${summary.days} day(s)`,
    '',
    '## Run Summary',
    `- Total runs: ${summary.totalRuns}`,
    `- Completed runs: ${summary.completedRuns}`,
    `- Failed runs: ${summary.failedRuns}`,
    `- Success rate: ${summary.successRatePercent}%`,
    `- Readiness rate: ${summary.readinessRatePercent}%`,
    `- Average confidence: ${summary.avgConfidence}`,
    '',
    '## ROI Snapshot (Estimated)',
    `- Total hours saved: ${summary.totalHoursSaved}`,
    `- Avg days-to-auth saved: ${summary.avgDaysToAuthSaved}`,
    `- Total recovered revenue: $${summary.totalRecoveredRevenueUsd}`,
    '',
    '## Notes',
    '- KPI values are based on saved run data and estimated ROI fields.',
    '- Confirm financial outcomes against billing data before external publication.',
    '',
  ].join('\n');
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-metrics-snapshot', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parsePositiveIntParam(searchParams.get('days'), 7, 90);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 300, 500);

    const { runs } = await listRunsForAnalytics(limit);
    const generatedAt = new Date().toISOString();
    const summary = summarizeForWindow(Array.isArray(runs) ? runs : [], days);
    const markdown = buildMarkdown(summary, generatedAt);

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-kpi-snapshot-${generatedAt.slice(0, 10)}.md"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to generate KPI snapshot markdown.',
      requestId,
      status: 500,
      code: 'admin_metrics_snapshot_failed',
    });
  }
}
