import { enforceRateLimit, parsePositiveIntParam } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
import {
  buildVitalsFromLifecycleEvents,
  fetchLifecycleEventsFromAxiom,
  getAxiomMonitorConfig,
} from '@/lib/observability/axiom-monitor';
import { listRunsForAnalytics } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildFallbackVitals(runs = []) {
  const completed = runs.filter((run) => String(run?.status || '').toLowerCase() === 'completed');

  const tatHours = completed
    .map((run) => {
      const started = Date.parse(run?.startedAt || '');
      const submitted = Date.parse(run?.operatorPacket?.emr_sync?.submission_timestamp || run?.completedAt || '');
      if (!Number.isFinite(started) || !Number.isFinite(submitted) || submitted < started) {
        return 0;
      }
      return (submitted - started) / (1000 * 60 * 60);
    })
    .filter((value) => value > 0);

  const averageTatHours = tatHours.length
    ? Number((tatHours.reduce((sum, value) => sum + value, 0) / tatHours.length).toFixed(2))
    : 0;

  const totalEightMinuteBlocksSaved = Math.round(
    completed.reduce((sum, run) => {
      const estimatedMinutes = (asNumber(run?.roi?.estimatedHoursSaved) * 60) / 8;
      return sum + (Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0);
    }, 0),
  );

  const fireworksSavingsUsd = Number(
    completed
      .reduce((sum, run) => sum + asNumber(run?.roi?.estimatedRecoveredRevenueUsd, 0) * 0.06, 0)
      .toFixed(2),
  );

  return {
    averageTatHours,
    targetTatHours: 26,
    totalEightMinuteBlocksSaved,
    fireworksSavingsUsd,
    trackedRuns: completed.length,
    source: 'fallback_run_store',
  };
}

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'observability-vitals-read', limit: 80, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const hours = parsePositiveIntParam(searchParams.get('hours'), 72, 24 * 14);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 500, 2000);

    const axiomConfig = getAxiomMonitorConfig();
    if (axiomConfig) {
      const queried = await fetchLifecycleEventsFromAxiom({ hours, limit });
      if (queried.ok) {
        const vitals = buildVitalsFromLifecycleEvents(queried.events);
        return jsonSuccess(
          {
            ...vitals,
            source: 'axiom',
            generatedAt: new Date().toISOString(),
          },
          requestId,
        );
      }
    }

    const { runs } = await listRunsForAnalytics(Math.min(500, limit));
    return jsonSuccess(
      {
        ...buildFallbackVitals(runs),
        generatedAt: new Date().toISOString(),
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load observability vitals.',
      requestId,
      status: 500,
      code: 'observability_vitals_failed',
    });
  }
}
