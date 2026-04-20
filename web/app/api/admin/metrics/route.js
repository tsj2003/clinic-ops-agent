import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
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

function summarizeFailures(runs) {
  const counts = new Map();
  for (const run of runs) {
    const code = safeTrim(run?.failure?.code) || 'none';
    counts.set(code, (counts.get(code) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }));
}

function summarizeFailureStages(runs) {
  const counts = new Map();
  for (const run of runs) {
    const stage = safeTrim(run?.failure?.stage) || 'none';
    counts.set(stage, (counts.get(stage) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => ({ stage, count }));
}

function summarizeReadiness(runs) {
  const completed = runs.filter((run) => run?.status === 'completed');
  const readyRuns = completed.filter((run) => run?.readiness?.ready === true);
  const totalConfidence = completed.reduce((sum, run) => sum + (Number(run?.readiness?.confidence) || 0), 0);

  return {
    completedRuns: completed.length,
    readyRuns: readyRuns.length,
    readyRatePercent: completed.length ? Math.round((readyRuns.length / completed.length) * 100) : 0,
    avgConfidence: completed.length ? Math.round(totalConfidence / completed.length) : 0,
  };
}

function summarizeLatency(runs) {
  const latencies = runs
    .map((run) => Number(run?.metrics?.elapsedSeconds) || 0)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  if (!latencies.length) {
    return {
      medianSeconds: 0,
      p95Seconds: 0,
      avgSeconds: 0,
    };
  }

  const medianIndex = Math.floor(latencies.length / 2);
  const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
  const avgSeconds = Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);

  return {
    medianSeconds: latencies[medianIndex],
    p95Seconds: latencies[p95Index],
    avgSeconds,
  };
}

function summarizeModes(runs) {
  const modeCounts = new Map();
  for (const run of runs) {
    const mode = safeTrim(run?.mode) || 'unknown';
    modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);
  }
  return [...modeCounts.entries()].map(([mode, count]) => ({ mode, count }));
}

function summarizeWindow(runs, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const inWindow = runs.filter((run) => {
    const startedAtMs = Date.parse(run?.startedAt || '');
    return Number.isFinite(startedAtMs) && startedAtMs >= cutoff;
  });

  const completed = inWindow.filter((run) => run?.status === 'completed').length;
  const failed = inWindow.filter((run) => run?.status === 'failed').length;
  const successRatePercent = inWindow.length ? Math.round((completed / inWindow.length) * 100) : 0;

  return {
    days,
    totalRuns: inWindow.length,
    completedRuns: completed,
    failedRuns: failed,
    successRatePercent,
    failureRatePercent: inWindow.length ? 100 - successRatePercent : 0,
  };
}

function buildDailySeries(runs, days) {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  const endUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startUtc = endUtc - (days - 1) * dayMs;

  const buckets = new Map();
  for (let i = 0; i < days; i += 1) {
    const bucketDate = new Date(startUtc + i * dayMs).toISOString().slice(0, 10);
    buckets.set(bucketDate, {
      date: bucketDate,
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      readyRuns: 0,
    });
  }

  for (const run of runs) {
    const startedAt = Date.parse(run?.startedAt || '');
    if (!Number.isFinite(startedAt)) {
      continue;
    }

    const dayKey = new Date(startedAt).toISOString().slice(0, 10);
    const bucket = buckets.get(dayKey);
    if (!bucket) {
      continue;
    }

    bucket.totalRuns += 1;
    if (run?.status === 'completed') {
      bucket.completedRuns += 1;
      if (run?.readiness?.ready === true) {
        bucket.readyRuns += 1;
      }
    }
    if (run?.status === 'failed') {
      bucket.failedRuns += 1;
    }
  }

  return [...buckets.values()];
}

function buildReadinessTrend(dailySeries) {
  return dailySeries.map((point) => {
    const completed = Number(point.completedRuns) || 0;
    const ready = Number(point.readyRuns) || 0;
    return {
      date: point.date,
      readyRuns: ready,
      completedRuns: completed,
      readyRatePercent: completed > 0 ? Math.round((ready / completed) * 100) : 0,
    };
  });
}

function summarizeThroughput(runs, days) {
  if (!runs.length || days <= 0) {
    return {
      avgRunsPerDay: 0,
      avgCompletedPerDay: 0,
      avgFailedPerDay: 0,
    };
  }

  const completedRuns = runs.filter((run) => run?.status === 'completed').length;
  const failedRuns = runs.filter((run) => run?.status === 'failed').length;

  return {
    avgRunsPerDay: Number((runs.length / days).toFixed(2)),
    avgCompletedPerDay: Number((completedRuns / days).toFixed(2)),
    avgFailedPerDay: Number((failedRuns / days).toFixed(2)),
  };
}

function summarizeRoi(runs) {
  const completedRuns = runs.filter((run) => run?.status === 'completed');
  if (!completedRuns.length) {
    return {
      avgHoursSavedPerRun: 0,
      totalHoursSaved: 0,
      avgDaysToAuthSaved: 0,
      totalRecoveredRevenueUsd: 0,
      avgRecoveredRevenueUsdPerRun: 0,
      avgDenialRiskReductionPercent: 0,
      model: 'v1_estimated_roi',
    };
  }

  const totals = completedRuns.reduce(
    (acc, run) => {
      const roi = run?.roi || {};
      acc.hoursSaved += Number(roi.estimatedHoursSaved) || 0;
      acc.daysSaved += Number(roi.estimatedDaysToAuthSaved) || 0;
      acc.recoveredRevenue += Number(roi.estimatedRecoveredRevenueUsd) || 0;
      acc.denialReduction += Number(roi.estimatedDenialRiskReductionPercent) || 0;
      return acc;
    },
    { hoursSaved: 0, daysSaved: 0, recoveredRevenue: 0, denialReduction: 0 },
  );

  const divisor = completedRuns.length;
  return {
    avgHoursSavedPerRun: Number((totals.hoursSaved / divisor).toFixed(2)),
    totalHoursSaved: Number(totals.hoursSaved.toFixed(2)),
    avgDaysToAuthSaved: Number((totals.daysSaved / divisor).toFixed(2)),
    totalRecoveredRevenueUsd: Number(totals.recoveredRevenue.toFixed(2)),
    avgRecoveredRevenueUsdPerRun: Number((totals.recoveredRevenue / divisor).toFixed(2)),
    avgDenialRiskReductionPercent: Math.round(totals.denialReduction / divisor),
    model: 'v1_estimated_roi',
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

  let dueIn7Days = 0;
  let overdueStartCount = 0;
  let missingNextStepCount = 0;
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const commitment of commitments) {
    const status = safeTrim(commitment?.status) || 'prospect';
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }

    const nextStep = safeTrim(commitment?.nextStep);
    if (!nextStep && status !== 'signed_active' && status !== 'closed_lost') {
      missingNextStepCount += 1;
    }

    const targetDate = safeTrim(commitment?.targetStartDate);
    if (!targetDate || status === 'signed_active' || status === 'closed_lost') {
      continue;
    }

    const targetMs = Date.parse(`${targetDate}T00:00:00.000Z`);
    if (!Number.isFinite(targetMs)) {
      continue;
    }

    const diff = targetMs - now;
    if (diff < 0) {
      overdueStartCount += 1;
    } else if (diff <= sevenDaysMs) {
      dueIn7Days += 1;
    }
  }

  const total = commitments.length;
  const openPipeline =
    counts.prospect + counts.discovery + counts.proposal_sent + counts.verbal_committed + counts.signed_active + counts.on_hold;

  const conversionToSignedPercent = total ? Math.round((counts.signed_active / total) * 100) : 0;
  const proposalToSignedBase = counts.proposal_sent + counts.verbal_committed + counts.signed_active;
  const proposalToSignedPercent = proposalToSignedBase ? Math.round((counts.signed_active / proposalToSignedBase) * 100) : 0;

  return {
    total,
    openPipeline,
    signedActive: counts.signed_active,
    verbalCommitted: counts.verbal_committed,
    proposalSent: counts.proposal_sent,
    discovery: counts.discovery,
    prospect: counts.prospect,
    onHold: counts.on_hold,
    closedLost: counts.closed_lost,
    conversionToSignedPercent,
    proposalToSignedPercent,
    dueIn7Days,
    overdueStartCount,
    missingNextStepCount,
    stageBreakdown: [
      { stage: 'prospect', count: counts.prospect },
      { stage: 'discovery', count: counts.discovery },
      { stage: 'proposal_sent', count: counts.proposal_sent },
      { stage: 'verbal_committed', count: counts.verbal_committed },
      { stage: 'signed_active', count: counts.signed_active },
      { stage: 'on_hold', count: counts.on_hold },
      { stage: 'closed_lost', count: counts.closed_lost },
    ],
  };
}

function buildObservabilityHealth() {
  const axiomToken = safeTrim(process.env.AXIOM_API_TOKEN);
  const axiomDataset = safeTrim(process.env.AXIOM_DATASET);
  const tinyfishApiKey = safeTrim(process.env.TINYFISH_API_KEY);

  return {
    tinyfish: {
      mode: safeTrim(process.env.TINYFISH_MODE) || 'mock',
      hasApiKey: Boolean(tinyfishApiKey),
      baseUrl: safeTrim(process.env.TINYFISH_API_BASE_URL) || 'https://agent.tinyfish.ai',
    },
    observability: {
      provider: 'axiom',
      configured: Boolean(axiomToken && axiomDataset),
      dataset: axiomDataset || '',
    },
    audit: {
      signalName: 'audit_event',
      writeAuthConfigured: Boolean(safeTrim(process.env.INTERNAL_API_KEY)),
    },
  };
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-metrics', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parsePositiveIntParam(searchParams.get('days'), 7, 90);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 200, 500);
    const { storage, runs } = await listRunsForAnalytics(limit);
    const { storage: commitmentStorage, commitments } = await listPilotCommitments(300);

    const totalRuns = runs.length;
    const completedRuns = runs.filter((run) => run?.status === 'completed').length;
    const failedRuns = runs.filter((run) => run?.status === 'failed').length;
    const dailySeries = buildDailySeries(runs, days);
    const readinessTrend = buildReadinessTrend(dailySeries);

    const rollup = {
      totalRuns,
      completedRuns,
      failedRuns,
      successRatePercent: totalRuns ? Math.round((completedRuns / totalRuns) * 100) : 0,
      failureRatePercent: totalRuns ? Math.round((failedRuns / totalRuns) * 100) : 0,
      readiness: summarizeReadiness(runs),
      roi: summarizeRoi(runs),
      latency: summarizeLatency(runs),
      modes: summarizeModes(runs),
      topFailureCodes: summarizeFailures(runs),
      failureStages: summarizeFailureStages(runs),
      window: summarizeWindow(runs, days),
      dailySeries,
      readinessTrend,
      throughput: summarizeThroughput(runs, days),
      commitmentFunnel: {
        storage: commitmentStorage,
        ...summarizeCommitmentFunnel(Array.isArray(commitments) ? commitments : []),
      },
    };

    return jsonSuccess(
      {
        storage,
        filters: { days, limit },
        generatedAt: new Date().toISOString(),
        health: buildObservabilityHealth(),
        rollup,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to build admin metrics.',
      requestId,
      status: 500,
      code: 'admin_metrics_failed',
    });
  }
}
