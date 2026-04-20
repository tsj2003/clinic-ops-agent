import { emitAuditEvent } from '@/lib/audit-log';
import { enforceRateLimit } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import {
  getFulfillmentOrchestrator,
  loadFulfillmentWorkflowConfig,
} from '@/lib/automation/fulfillment-orchestrator';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export async function POST(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, {
    key: 'fulfillment-run-write',
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body?.runId, 120);
    if (!runId) {
      return jsonError({
        message: 'runId is required.',
        requestId,
        status: 400,
        code: 'missing_run_id',
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

    const tenantId = clean(body?.tenantId || run?.workspace?.id || run?.intake?.practiceId, 120);
    const configResult = await loadFulfillmentWorkflowConfig({
      tenantId,
      difyConfigKey: clean(body?.difyConfigKey, 120) || 'fulfillment_orchestrator',
      overrides: body?.workflowConfig,
    });

    const orchestrator = getFulfillmentOrchestrator();
    const outcome = await orchestrator.run({
      run,
      tenantId,
      workflowConfig: configResult?.config || body?.workflowConfig || {},
      patientReply: clean(body?.patientReply, 10_000),
    });

    const lifecycle = await updateRunCaseLifecycle(runId, {
      status: outcome?.halted ? 'escalated' : 'submitted',
      actor: 'fulfillment-orchestrator',
      source: 'autonomous_fulfillment',
      eventNote: outcome?.halted
        ? `Patient prep barrier detected. ${clean(outcome?.readiness?.reason, 400)}`
        : 'Procedure fulfillment completed; schedule locked and patient nudge dispatched.',
      emrSync: {
        connector: clean(
          run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.source_system || '',
          60,
        ),
        status: outcome?.halted ? 'MANUAL_ACTION_REQUIRED' : 'READY_FOR_PROCEDURE',
        operation: 'autonomous_procedure_fulfillment',
        payerReferenceId: clean(
          run?.operatorPacket?.emr_sync?.payer_reference_id || run?.emrSync?.payer_reference_id || '',
          120,
        ),
        packetId: run?.operatorPacket?.case_id || run?.appRunId || runId,
        message: clean(outcome?.readiness?.reason || '', 1000),
        lastSyncedAt: new Date().toISOString(),
      },
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.fulfillment.run',
      outcome: outcome?.ok ? 'success' : 'failed',
      route: '/api/automation/fulfillment/run',
      actor: clean(body?.operatorId || 'fulfillment-orchestrator', 120),
      source: 'api',
      details: {
        runId,
        tenantId,
        halted: outcome?.halted === true,
        scheduleLockOk: outcome?.scheduleLock?.ok === true,
        patientNudgeOk: outcome?.nudge?.ok === true,
        procedureValueUsd: Number(outcome?.procedureValueUsd) || 0,
        timestamp: new Date().toISOString(),
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        tenantId,
        workflowConfigLoaded: configResult?.ok === true,
        workflowConfigReason: clean(configResult?.reason, 240),
        outcome,
        run: lifecycle.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to run fulfillment orchestrator.',
      requestId,
      status: 500,
      code: 'fulfillment_run_failed',
    });
  }
}
