import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import {
  analyzePatientReadinessWithFireworks,
  loadFulfillmentWorkflowConfig,
} from '@/lib/automation/fulfillment-orchestrator';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function verifyWebhookSecret(request) {
  const expected = clean(process.env.EMITRR_WEBHOOK_SECRET, 200);
  if (!expected) {
    return true;
  }

  const provided =
    clean(request.headers.get('x-emitrr-webhook-secret'), 200) ||
    clean(request.headers.get('x-webhook-secret'), 200);

  return provided && provided === expected;
}

export async function POST(request) {
  const requestId = getRequestId(request);

  if (!verifyWebhookSecret(request)) {
    return jsonError({
      message: 'Invalid Emitrr webhook secret.',
      requestId,
      status: 401,
      code: 'invalid_emitrr_webhook_secret',
    });
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body?.runId || body?.metadata?.runId, 120);
    const tenantId = clean(body?.tenantId || body?.metadata?.tenantId, 120);
    const replyText = clean(body?.message || body?.text || body?.replyText, 20_000);

    if (!runId || !replyText) {
      return jsonError({
        message: 'runId and reply message are required.',
        requestId,
        status: 400,
        code: 'missing_webhook_payload_fields',
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

    const configResult = await loadFulfillmentWorkflowConfig({
      tenantId: tenantId || run?.workspace?.id || run?.intake?.practiceId,
      difyConfigKey: clean(body?.difyConfigKey, 120) || 'fulfillment_orchestrator',
      overrides: body?.workflowConfig,
    });

    const analysis = await analyzePatientReadinessWithFireworks({
      replyText,
      run,
      tenantId: tenantId || run?.workspace?.id || run?.intake?.practiceId,
      workflowConfig: configResult?.config || body?.workflowConfig || {},
    });

    const barrierDetected = analysis?.barrierDetected === true;
    const lifecycle = await updateRunCaseLifecycle(runId, {
      status: barrierDetected ? 'escalated' : 'submitted',
      actor: 'patient-liaison',
      source: 'emitrr_webhook',
      eventNote: barrierDetected
        ? `Patient prep barrier detected: ${clean(analysis?.reason, 320)}`
        : `Patient confirmed prep readiness: ${clean(analysis?.reason, 320)}`,
      emrSync: {
        connector: clean(
          run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.source_system || '',
          60,
        ),
        status: barrierDetected ? 'MANUAL_ACTION_REQUIRED' : 'READY_FOR_PROCEDURE',
        operation: 'patient_reply_readiness_analysis',
        packetId: run?.operatorPacket?.case_id || run?.appRunId || runId,
        message: clean(analysis?.reason, 1000),
        lastSyncedAt: new Date().toISOString(),
      },
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.fulfillment.patient_reply_webhook',
      outcome: 'success',
      route: '/api/automation/fulfillment/patient-reply-webhook',
      actor: 'patient-liaison',
      source: 'emitrr',
      details: {
        runId,
        tenantId: tenantId || run?.workspace?.id || run?.intake?.practiceId,
        barrierDetected,
        readiness: clean(analysis?.readiness, 80),
        confidence: Number(analysis?.confidence) || 0,
        timestamp: new Date().toISOString(),
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        barrierDetected,
        analysis,
        run: lifecycle.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process patient reply webhook.',
      requestId,
      status: 500,
      code: 'patient_reply_webhook_failed',
    });
  }
}
