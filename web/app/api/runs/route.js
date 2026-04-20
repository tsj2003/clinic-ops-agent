import { NextResponse } from 'next/server';

import { enforceRateLimit, enforceWriteAuth, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { maybeRefundForInaccurateApproval } from '@/lib/automation/billing-engine';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody, withRequestId } from '@/lib/api-response';
import { validateRunsPatchPayload } from '@/lib/api-schemas';
import { listRuns, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'runs-read', limit: 80, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 10, 200);

  try {
    const result = await listRuns(limit);
    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load run history.',
      requestId,
      status: 500,
      code: 'runs_list_failed',
      details: { storage: 'unavailable', runs: [] },
    });
  }
}

export async function PATCH(request) {
  const requestId = getRequestId(request);
  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'runs-write', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const payload = await parseJsonBody(request, requestId);
    const validation = validateRunsPatchPayload(payload);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_patch_payload',
      });
    }

    const result = await updateRunCaseLifecycle(validation.data.appRunId, {
      status: validation.data.status,
      notes: validation.data.notes,
      eventNote: validation.data.eventNote,
      actor: validation.data.actor,
      source: validation.data.source,
      emrSync: validation.data.emrSync,
    });

    const refundResult = await maybeRefundForInaccurateApproval({
      runId: validation.data.appRunId,
      status: validation.data.status,
      notes: validation.data.notes,
      actor: validation.data.actor,
      requestId,
    }).catch((error) => ({
      ok: false,
      skipped: true,
      reason: error instanceof Error ? error.message : 'Refund trigger failed.',
    }));

    await emitAuditEvent({
      requestId,
      action: 'runs.patch',
      outcome: 'success',
      route: '/api/runs',
      actor: validation.data.actor,
      source: validation.data.source,
      details: {
        appRunId: validation.data.appRunId,
        nextStatus: validation.data.status || '',
        emrSyncExternalId: validation.data.emrSync?.externalEmrId || '',
        refundTriggered: refundResult?.ok === true,
        refundSkippedReason: safeTrim(refundResult?.reason),
      },
    });

    return jsonSuccess(
      {
        ...result,
        refund: refundResult,
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

    const message = error instanceof Error ? error.message : 'Unable to update case lifecycle.';
    const status = /not found/i.test(message) ? 404 : 400;

    await emitAuditEvent({
      requestId,
      action: 'runs.patch',
      outcome: 'error',
      route: '/api/runs',
      actor: 'staff',
      source: 'ui',
      details: {
        errorMessage: message,
      },
    });

    return jsonError({
      message,
      requestId,
      status,
      code: status === 404 ? 'run_not_found' : 'run_update_failed',
      details: withRequestId({ storage: 'unavailable' }, requestId),
    });
  }
}
