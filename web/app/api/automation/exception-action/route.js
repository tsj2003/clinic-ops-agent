import { emitAuditEvent } from '@/lib/audit-log';
import { dispatchExceptionAction } from '@/lib/automation/composio-bridge';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { buildCorrelationId } from '@/lib/observability/axiom-monitor';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function normalizeAction(value = '') {
  const normalized = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (['nudge_doctor_slack', 'retry_with_healed_selector', 'request_submission_proof'].includes(normalized)) {
    return normalized;
  }
  return '';
}

export async function POST(request) {
  const requestId = getRequestId(request);

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body?.runId, 120);
    const action = normalizeAction(body?.action);
    const note = clean(body?.note, 1000);

    if (!runId || !action) {
      return jsonError({
        message: 'runId and valid action are required.',
        requestId,
        status: 400,
        code: 'invalid_exception_action_payload',
      });
    }

    const run = await getRunById(runId);
    if (!run) {
      return jsonError({
        message: 'Run not found.',
        requestId,
        status: 404,
        code: 'run_not_found',
      });
    }

    const correlationId = buildCorrelationId({
      correlationId: clean(body?.correlation_id || body?.correlationId || request.headers.get('x-correlation-id'), 200),
      requestId,
      runId,
    });

    const composio = await dispatchExceptionAction({
      run,
      actionType: action,
      note,
    });

    let lifecycle = null;
    if (action === 'retry_with_healed_selector') {
      lifecycle = await updateRunCaseLifecycle(runId, {
        status: 'ready_for_submission',
        actor: clean(body?.operatorId || 'staff-operator', 120),
        source: 'exception_command_center',
        eventNote: 'Operator requested retry with healed selector.',
        emrSync: {
          connector: clean(run?.operatorPacket?.emr_sync?.connector || run?.emrSync?.connector || 'athena', 40),
          status: 'RETRY_SELECTOR_REQUESTED',
          operation: 'exception_one_click_retry',
          message: clean(note || 'Retry requested with healed selector.', 1000),
          packetId: run?.operatorPacket?.case_id || runId,
          lastSyncedAt: new Date().toISOString(),
        },
      });
    }

    await emitAuditEvent({
      requestId,
      action: 'automation.exception_action',
      outcome: composio?.ok ? 'success' : 'skipped',
      route: '/api/automation/exception-action',
      actor: clean(body?.operatorId || 'staff-operator', 120),
      source: 'ui',
      details: {
        runId,
        practiceId: clean(run?.workspace?.id || run?.workspace?.name || run?.intake?.practiceId, 120),
        correlation_id: correlationId,
        model_type: 'exception_command_center',
        cost_simulated: 0,
        timestamp: new Date().toISOString(),
        exception_action: action,
        composio_dispatched: composio?.ok === true && composio?.skipped !== true,
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        action,
        composio,
        run: lifecycle?.run || run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process exception action.',
      requestId,
      status: 500,
      code: 'exception_action_failed',
    });
  }
}
