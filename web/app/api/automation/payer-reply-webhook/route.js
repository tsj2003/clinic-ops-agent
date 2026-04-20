import { emitAuditEvent } from '@/lib/audit-log';
import {
  analyzePayerReplyWithFireworks,
  buildMissingDocumentAttachment,
  normalizeInboundWebhookPayload,
  replyToPayerMessage,
} from '@/lib/automation/agent-mail';
import { detectDeniedSignal, generateCombatBriefOnDenial } from '@/lib/automation/combat-brief';
import { dispatchAuthOutcome } from '@/lib/automation/composio-bridge';
import { closeLoopEmrTask } from '@/lib/automation/emr-close-loop';
import { buildCorrelationId } from '@/lib/observability/axiom-monitor';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { createSignedIntentEnvelope } from '@/lib/security/agent-identity';
import { verifyAgentIntentOrThrow } from '@/lib/security/agent-intent';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function verifyWebhookSecret(request) {
  const expected = clean(process.env.AGENTMAIL_WEBHOOK_SECRET, 200);
  if (!expected) {
    return true;
  }

  const received =
    clean(request.headers.get('x-agentmail-webhook-secret'), 200) ||
    clean(request.headers.get('x-webhook-secret'), 200);

  return received && received === expected;
}

function buildReplyText({ requestedDocument = '', emrReferenceNumber = '', autoReplyDraft = '' } = {}) {
  if (clean(autoReplyDraft, 2000)) {
    return clean(autoReplyDraft, 10_000);
  }

  const doc = clean(requestedDocument, 300) || 'the requested clinical document';
  const ref = clean(emrReferenceNumber, 120);

  return [
    `Thank you for the follow-up. We have attached ${doc} for this authorization request.`,
    ref ? `EMR Reference Number: ${ref}` : '',
    'Please let us know if any additional information is required.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function POST(request) {
  const requestId = getRequestId(request);

  if (!verifyWebhookSecret(request)) {
    return jsonError({
      message: 'Invalid AgentMail webhook secret.',
      status: 401,
      requestId,
      code: 'invalid_webhook_secret',
    });
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const inbound = normalizeInboundWebhookPayload(body);

    if (!inbound.runId) {
      return jsonError({
        message: 'Unable to resolve runId from webhook payload.',
        status: 400,
        requestId,
        code: 'missing_run_id',
      });
    }

    if (!inbound.inboxId || !inbound.messageId) {
      return jsonError({
        message: 'Webhook payload must include inboxId and messageId.',
        status: 400,
        requestId,
        code: 'missing_message_context',
      });
    }

    const run = await getRunById(inbound.runId);
    if (!run) {
      return jsonError({
        message: 'Run not found for inbound payer reply.',
        status: 404,
        requestId,
        code: 'run_not_found',
      });
    }

    const analysis = await analyzePayerReplyWithFireworks({
      subject: inbound.subject,
      text: inbound.text,
      from: inbound.from,
      runId: inbound.runId,
    });

    const attachment = await buildMissingDocumentAttachment({
      run,
      requestedDocument: analysis.requestedDocument,
    });

    const replyText = buildReplyText(analysis);
    const replyResult = await replyToPayerMessage({
      inboxId: inbound.inboxId,
      messageId: inbound.messageId,
      to: inbound.from,
      replyText,
      attachment,
    });

    const connectorHint = clean(
      run?.operatorPacket?.emr_sync?.connector ||
        run?.operatorPacket?.emr_connector_hint ||
        run?.emrSync?.connector ||
        'athena',
      60,
    ).toLowerCase();
    const correlationId = buildCorrelationId({
      correlationId: clean(body?.correlation_id || body?.correlationId || request.headers.get('x-correlation-id'), 200),
      requestId,
      runId: inbound.runId,
    });
    const practiceId = clean(run?.workspace?.id || run?.workspace?.name || run?.intake?.practiceId, 120);

    const emrWriteIntent = await createSignedIntentEnvelope({
      agentName: 'email',
      action: 'emr.write',
      runId: inbound.runId,
      requestId,
      params: {
        connector: connectorHint,
        reference: clean(analysis.emrReferenceNumber, 120),
      },
    });

    try {
      await verifyAgentIntentOrThrow({
        envelope: emrWriteIntent,
        requiredAction: 'emr.write',
      });
    } catch (error) {
      return jsonError({
        message: error instanceof Error ? error.message : 'Agent intent verification failed for EMR write.',
        status: 403,
        requestId,
        code: 'invalid_agent_intent',
      });
    }

    const emrPatch = await closeLoopEmrTask({
      connector: connectorHint,
      run,
      payerReferenceId: analysis.emrReferenceNumber,
      proof: {
        screenshotPath: attachment.absolutePath,
        capturedAt: new Date().toISOString(),
      },
      emrStatus: 'INFO_SUBMITTED_WAITING',
      note: `Additional information submitted via AgentMail. Requested: ${clean(analysis.requestedDocument, 200)}`,
    });

    const lifecycle = await updateRunCaseLifecycle(inbound.runId, {
      status: 'submitted',
      actor: 'agentmail-bot',
      source: 'agentmail_webhook',
      eventNote: `Payer requested additional information; auto-reply sent with ${clean(analysis.requestedDocument, 200)}.`,
      emrSync: {
        connector: connectorHint,
        status: 'INFO_SUBMITTED_WAITING',
        payerReferenceId: clean(analysis.emrReferenceNumber, 120),
        operation: 'payer_follow_up_reply',
        message: 'Additional information sent to payer via AgentMail.',
        packetId: run?.operatorPacket?.case_id || run?.appRunId || inbound.runId,
        lastSyncedAt: new Date().toISOString(),
      },
    });

    const composioDispatch = await dispatchAuthOutcome({
      run,
      authStatus: 'INFO_REQUESTED',
      referenceId: analysis.emrReferenceNumber,
      clinicalGap: analysis.requestedDocument,
    }).catch((error) => ({
      ok: false,
      skipped: true,
      reason: error instanceof Error ? error.message : 'Composio dispatch failed.',
    }));

    const deniedDetected = detectDeniedSignal({
      subject: inbound.subject,
      text: `${inbound.text}\n${analysis.autoReplyDraft}`,
    });

    const combatBrief = deniedDetected
      ? await generateCombatBriefOnDenial({
          run,
          denialStatus: 'DENIED',
          denialReason: `${inbound.subject} | ${inbound.text}`,
          payerReferenceId: analysis.emrReferenceNumber,
          source: 'agentmail_liaison',
        }).catch((error) => ({
          ok: false,
          skipped: true,
          reason: error instanceof Error ? error.message : 'Combat brief generation failed.',
        }))
      : { ok: false, skipped: true, reason: 'No denial signal in payer message.' };

    await emitAuditEvent({
      requestId,
      action: 'automation.payer_reply_webhook',
      outcome: 'success',
      route: '/api/automation/payer-reply-webhook',
      actor: 'agentmail-bot',
      source: 'agentmail',
      details: {
        runId: inbound.runId,
        practiceId,
        correlation_id: correlationId,
        model_type: clean(analysis?.modelUsed, 200),
        cost_simulated: Number(analysis?.simulatedSavings?.estimatedCostSavingsUsd) || 0,
        fireworks_vs_gpt4o_savings_usd: Number(analysis?.simulatedSavings?.estimatedCostSavingsUsd) || 0,
        timestamp: new Date().toISOString(),
        requestedDocument: clean(analysis.requestedDocument, 200),
        emrReferenceNumber: clean(analysis.emrReferenceNumber, 120),
        inboxId: inbound.inboxId,
        composioDispatched: composioDispatch?.ok === true && composioDispatch?.skipped !== true,
        combatBriefGenerated:
          combatBrief?.ok === true &&
          combatBrief?.duplicate !== true &&
          combatBrief?.skipped !== true,
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId: inbound.runId,
        requestedDocument: analysis.requestedDocument,
        emrReferenceNumber: analysis.emrReferenceNumber,
        reply: replyResult,
        emrPatch,
        composioDispatch,
        combatBrief,
        run: lifecycle.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process payer reply webhook.',
      status: 500,
      requestId,
      code: 'payer_reply_webhook_failed',
    });
  }
}
