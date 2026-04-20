import { enforceRateLimit } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
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

function buildSelectedTenant(tenants = [], requestedTenantId = '') {
  const requested = clean(requestedTenantId, 120);
  if (requested) {
    const found = (Array.isArray(tenants) ? tenants : []).find((item) => item?.tenantId === requested);
    if (found) {
      return found;
    }
  }

  return (Array.isArray(tenants) ? tenants : [])[0] || null;
}

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'intake-poller-status-read', limit: 120, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const orchestrator = getPollingOrchestrator();
    const { searchParams } = new URL(request.url);
    const tenantId = clean(searchParams.get('tenantId'), 120);

    const snapshot = orchestrator.getStatusSnapshot({ includeLastResults: true });
    const selectedTenant = buildSelectedTenant(snapshot.tenants, tenantId);

    return jsonSuccess(
      {
        ok: true,
        running: snapshot.running === true,
        tenantCount: asNumber(snapshot.tenantCount, 0),
        aggregate: buildAggregate(snapshot.tenants),
        selectedTenant,
        tenants: snapshot.tenants,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load intake poller status.',
      requestId,
      status: 500,
      code: 'intake_poller_status_failed',
    });
  }
}
