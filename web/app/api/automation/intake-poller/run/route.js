import { enforceRateLimit } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { getPollingOrchestrator } from '@/lib/automation/emr-polling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = clean(value, 40).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeAction(value = '') {
  const normalized = clean(value, 80).toLowerCase().replace(/[^a-z_]+/g, '_');
  if (['run', 'start', 'stop'].includes(normalized)) {
    return normalized;
  }
  return 'run';
}

function buildAggregate(tenants = []) {
  return (Array.isArray(tenants) ? tenants : []).reduce(
    (acc, tenant) => {
      const result = tenant?.lastResult || null;
      if (!result) {
        return acc;
      }

      acc.scanned += asNumber(result.scanned, 0);
      acc.highSignalMatches += asNumber(result.highSignalMatches, 0);
      acc.createdRuns += asNumber(result.createdRuns, 0);
      acc.duplicates += asNumber(result.duplicates, 0);
      return acc;
    },
    {
      scanned: 0,
      highSignalMatches: 0,
      createdRuns: 0,
      duplicates: 0,
    },
  );
}

export async function POST(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'intake-poller-run-write', limit: 24, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const action = normalizeAction(body?.action);
    const tenantId = clean(body?.tenantId, 120) || 'default';

    const orchestrator = getPollingOrchestrator();

    if (action !== 'stop') {
      orchestrator.registerTenant({
        tenantId,
        intervalMs: asNumber(body?.intervalMs, 15 * 60 * 1000),
        includeAthena: asBoolean(body?.includeAthena, true),
        includeEpic: asBoolean(body?.includeEpic, true),
        tenantOverrides: body?.tenantOverrides,
        startDate: clean(body?.startDate, 40),
        endDate: clean(body?.endDate, 40),
      });
    }

    let cycleResult = null;
    let actionResult = null;

    if (action === 'start') {
      actionResult = orchestrator.start();
      if (asBoolean(body?.runNow, false)) {
        cycleResult = await orchestrator.runTenantCycle(tenantId, {
          startDate: clean(body?.startDate, 40),
          endDate: clean(body?.endDate, 40),
          jitterMs: asNumber(body?.jitterMs, 0),
        });
      }
    } else if (action === 'stop') {
      actionResult = orchestrator.stop();
    } else {
      cycleResult = await orchestrator.runTenantCycle(tenantId, {
        startDate: clean(body?.startDate, 40),
        endDate: clean(body?.endDate, 40),
        jitterMs: asNumber(body?.jitterMs, 0),
      });
    }

    const snapshot = orchestrator.getStatusSnapshot({ includeLastResults: true });

    return jsonSuccess(
      {
        ok: true,
        action,
        tenantId,
        actionResult,
        result: cycleResult,
        running: snapshot.running === true,
        tenantCount: asNumber(snapshot.tenantCount, 0),
        aggregate: buildAggregate(snapshot.tenants),
        tenants: snapshot.tenants,
      },
      requestId,
    );
  } catch (error) {
    if (error?.code === 'invalid_json') {
      return jsonError({
        message: error.message,
        requestId,
        status: 400,
        code: error.code,
      });
    }

    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to run intake poller.',
      requestId,
      status: 500,
      code: 'intake_poller_run_failed',
    });
  }
}
