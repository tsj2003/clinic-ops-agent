import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
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

function summarize(runs, days) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const scoped = runs.filter((run) => {
    const ts = Date.parse(run?.startedAt || '');
    return Number.isFinite(ts) && ts >= cutoffMs;
  });

  const completed = scoped.filter((run) => run?.status === 'completed');
  const failed = scoped.filter((run) => run?.status === 'failed');
  const readyRuns = completed.filter((run) => run?.readiness?.ready === true);

  const avgConfidence = completed.length
    ? Math.round(completed.reduce((sum, run) => sum + (Number(run?.readiness?.confidence) || 0), 0) / completed.length)
    : 0;

  const totalRecovered = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedRecoveredRevenueUsd) || 0), 0);
  const totalHoursSaved = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedHoursSaved) || 0), 0);

  const failureCounts = scoped.reduce((acc, run) => {
    const code = safeTrim(run?.failure?.code) || 'none';
    acc.set(code, (acc.get(code) || 0) + 1);
    return acc;
  }, new Map());

  const topFailureCodes = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => ({ code, count }));

  return {
    days,
    totalRuns: scoped.length,
    completedRuns: completed.length,
    failedRuns: failed.length,
    successRatePercent: scoped.length ? Math.round((completed.length / scoped.length) * 100) : 0,
    readinessRatePercent: completed.length ? Math.round((readyRuns.length / completed.length) * 100) : 0,
    avgConfidence,
    totalRecoveredRevenueUsd: Number(totalRecovered.toFixed(2)),
    totalHoursSaved: Number(totalHoursSaved.toFixed(2)),
    topFailureCodes,
  };
}

function summarizeCommitmentFunnel(commitments = []) {
  const counts = {
    prospect: 0,
    discovery: 0,
    proposal_sent: 0,
    verbal_committed: 0,
    signed_active: 0,
    on_hold: 0,
    closed_lost: 0,
  };

  for (const commitment of commitments) {
    const status = safeTrim(commitment?.status) || 'prospect';
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }

  const total = commitments.length;
  const conversionToSignedPercent = total ? Math.round((counts.signed_active / total) * 100) : 0;

  return {
    total,
    signedActive: counts.signed_active,
    verbalCommitted: counts.verbal_committed,
    proposalSent: counts.proposal_sent,
    discovery: counts.discovery,
    prospect: counts.prospect,
    onHold: counts.on_hold,
    closedLost: counts.closed_lost,
    conversionToSignedPercent,
  };
}

function buildMarkdown(summary, commitmentFunnel, generatedAt) {
  const failureLines = summary.topFailureCodes.length
    ? summary.topFailureCodes.map((item) => `- ${item.code}: ${item.count}`).join('\n')
    : '- none: 0';

  const primaryDecision =
    summary.successRatePercent >= 80 && summary.readinessRatePercent >= 60
      ? 'Scale lane coverage and push conversion to signed pilot.'
      : summary.failedRuns > summary.completedRuns
        ? 'Stabilize reliability and tighten run quality before expansion.'
        : 'Maintain wedge scope and improve readiness quality before scaling.';

  return [
    '# Weekly Operating Review — AuthPilot AI',
    '',
    `Generated: ${generatedAt}`,
    `Window: last ${summary.days} day(s)`,
    '',
    '## Core Metrics',
    `- Total runs: ${summary.totalRuns}`,
    `- Completed runs: ${summary.completedRuns}`,
    `- Failed runs: ${summary.failedRuns}`,
    `- Success rate: ${summary.successRatePercent}%`,
    `- Readiness rate: ${summary.readinessRatePercent}%`,
    `- Average confidence: ${summary.avgConfidence}`,
    `- Estimated recovered revenue: $${summary.totalRecoveredRevenueUsd}`,
    `- Estimated total hours saved: ${summary.totalHoursSaved}`,
    '',
    '## Top Failure Codes',
    failureLines,
    '',
    '## Pilot Commitment Funnel',
    `- Total commitments: ${commitmentFunnel.total}`,
    `- Signed active: ${commitmentFunnel.signedActive}`,
    `- Verbal committed: ${commitmentFunnel.verbalCommitted}`,
    `- Proposal sent: ${commitmentFunnel.proposalSent}`,
    `- Discovery: ${commitmentFunnel.discovery}`,
    `- Prospect: ${commitmentFunnel.prospect}`,
    `- On hold: ${commitmentFunnel.onHold}`,
    `- Closed lost: ${commitmentFunnel.closedLost}`,
    `- Conversion to signed: ${commitmentFunnel.conversionToSignedPercent}%`,
    '',
    '## Decisions',
    `- Primary decision: ${primaryDecision}`,
    '- Keep one-lane scope unless success/readiness gates hold for two consecutive reviews.',
    '- Prioritize fixes for top failure code before adding new demo commitments.',
    '',
    '## Commitments (Next 7 Days)',
    '- Run at least one live wedge demo and one KPI snapshot export.',
    '- Update pilot commitment tracker with stage progression and next-step date.',
    '- Capture one customer quote tied to workflow speed or clarity impact.',
    '',
  ].join('\n');
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-operating-review', limit: 12, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parsePositiveIntParam(searchParams.get('days'), 7, 90);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 300, 500);
    const generatedAt = new Date().toISOString();

    const { runs } = await listRunsForAnalytics(limit);
    const { commitments } = await listPilotCommitments(300);
    const summary = summarize(Array.isArray(runs) ? runs : [], days);
    const commitmentFunnel = summarizeCommitmentFunnel(Array.isArray(commitments) ? commitments : []);
    const markdown = buildMarkdown(summary, commitmentFunnel, generatedAt);

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-operating-review-${generatedAt.slice(0, 10)}.md"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to generate operating review markdown.',
      requestId,
      status: 500,
      code: 'admin_operating_review_failed',
    });
  }
}
