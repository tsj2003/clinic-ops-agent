import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { getRunById } from '@/lib/run-store';
import { processVoiceTranscriptOutcome } from '@/lib/automation/voice-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function verifyWebhookSecret(request) {
  const expected = clean(process.env.VOICE_AGENT_WEBHOOK_SECRET, 200);
  if (!expected) {
    return true;
  }

  const provided = clean(request.headers.get('x-voice-webhook-secret') || request.headers.get('x-webhook-secret'), 200);
  return provided && provided === expected;
}

export async function POST(request) {
  const requestId = getRequestId(request);

  if (!verifyWebhookSecret(request)) {
    return jsonError({
      message: 'Invalid voice webhook secret.',
      requestId,
      status: 401,
      code: 'invalid_voice_webhook_secret',
    });
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body.runId, 120);

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

    const transcript = clean(body.transcript, 120_000);
    if (!transcript) {
      return jsonError({
        message: 'transcript is required.',
        requestId,
        status: 400,
        code: 'missing_transcript',
      });
    }

    const result = await processVoiceTranscriptOutcome({
      run,
      transcript,
      reachedHumanTransfer: body.reachedHumanTransfer === true,
      callSid: clean(body.callSid, 120),
      clinicName: clean(body.clinicName || process.env.CLINIC_NAME, 120),
      callbackNumber: clean(body.callbackNumber || process.env.CLINIC_CALLBACK_NUMBER, 30),
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.voice_status_webhook',
      outcome: 'success',
      route: '/api/automation/voice-status-webhook',
      actor: 'voice-agent',
      source: 'voice-webhook',
      details: {
        runId,
        finalStatus: clean(result.analysis?.finalStatus, 80),
        referenceNumber: clean(result.analysis?.referenceNumber, 120),
        emrStatus: clean(result.mapped?.emrStatus, 80),
        combatBriefGenerated:
          result?.combatBrief?.ok === true &&
          result?.combatBrief?.duplicate !== true &&
          result?.combatBrief?.skipped !== true,
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        finalStatus: result.analysis?.finalStatus,
        referenceNumber: result.analysis?.referenceNumber,
        emrStatus: result.mapped?.emrStatus,
        emrPatch: result.emrPatch,
        combatBrief: result.combatBrief || null,
        run: result.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process voice status webhook.',
      requestId,
      status: 500,
      code: 'voice_status_webhook_failed',
    });
  }
}
