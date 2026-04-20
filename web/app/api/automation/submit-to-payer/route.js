import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { provisionRunInbox } from '@/lib/automation/agent-mail';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { generateClinicalJustificationPdf } from '@/lib/automation/clinical-pdf';
import { closeLoopEmrTask } from '@/lib/automation/emr-close-loop';
import { runDenialSimulationGate } from '@/lib/automation/denial-simulator';
import { runUhcPortalSubmission } from '@/lib/automation/portal-agent';
import { captureSubmissionProof } from '@/lib/automation/submission-proof';
import { buildCorrelationId } from '@/lib/observability/axiom-monitor';
import { createHash } from 'crypto';
import { createSignedIntentEnvelope, didForAgent } from '@/lib/security/agent-identity';
import { appendImmutableSecurityLedgerRecord, verifyAgentIntentOrThrow } from '@/lib/security/agent-intent';
import { createEphemeralDaytonaWorkspace, destroyEphemeralDaytonaWorkspace } from '@/lib/security/daytona-sandbox';
import { runBlockingReasoningAdjudication } from '@/lib/security/reasoning-adjudicator';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function parsePayload(body = {}) {
  const runId = clean(body.runId, 120);
  const operatorId = clean(body.operatorId || body.userId || 'staff-operator', 120);
  const payerKey = clean(body.payerKey || 'uhc', 60).toLowerCase();
  const connector = clean(body.connector || 'athena', 40).toLowerCase();
  const headless = body.headless !== false;

  if (!runId) {
    return { ok: false, message: 'runId is required.' };
  }

  return {
    ok: true,
    data: {
      runId,
      operatorId,
      payerKey,
      connector,
      headless,
    },
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function deriveClinicalGapPayload(run = {}) {
  const emrStatus = clean(run?.operatorPacket?.emr_sync?.status || run?.emrSync?.status, 120).toUpperCase();
  const lifecycleStatus = clean(run?.caseLifecycle?.status, 120).toLowerCase();
  const missingDataPoints = asArray(run?.readiness?.missing_evidence)
    .map((item) => clean(item, 300))
    .filter(Boolean);

  const hasGap =
    emrStatus === 'PORTAL_ACTION_REQUIRED' ||
    emrStatus === 'CLINICAL_GAP_DETECTED' ||
    lifecycleStatus === 'collecting_evidence' ||
    missingDataPoints.length > 0;

  return {
    hasGap,
    status: emrStatus || (hasGap ? 'CLINICAL_GAP_DETECTED' : 'READY_FOR_PORTAL_SUBMISSION'),
    summary: clean(
      run?.readiness?.summary || run?.operatorPacket?.emr_sync?.message || run?.emrSync?.message,
      1000,
    ),
    missingDataPoints,
  };
}

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'automation-submit-to-payer', limit: 8, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  let page = null;
  let sessionResult = null;
  let sandboxWorkspaceId = '';

  try {
    const body = await parseJsonBody(request, requestId);
    const parsed = parsePayload(body);
    if (!parsed.ok) {
      return jsonError({
        message: parsed.message,
        requestId,
        status: 400,
        code: 'invalid_submit_to_payer_payload',
      });
    }

    const { runId, operatorId, payerKey, connector, headless } = parsed.data;
    const run = await getRunById(runId);
    if (!run) {
      return jsonError({
        message: 'Run not found.',
        requestId,
        status: 404,
        code: 'run_not_found',
      });
    }

    const clinicalGap = deriveClinicalGapPayload(run);
    if (clinicalGap.hasGap) {
      return jsonError({
        message: 'Clinical gap detected. Portal submission is blocked until missing evidence is remediated.',
        requestId,
        status: 409,
        code: 'clinical_gap_detected',
      });
    }

    const practiceId = clean(run?.workspace?.id || run?.workspace?.name || run?.intake?.practiceId, 120);

    const denialSimulation = await runDenialSimulationGate({
      run,
      tenantId: practiceId,
      workflowConfig: body?.denialSimulationConfig,
    });

    if (denialSimulation?.requiresReplanning === true) {
      return jsonError({
        message: `Pre-submission denial simulation risk is ${Number(denialSimulation.denialProbabilityScore) || 0}% (> ${Number(denialSimulation.threshold) || 40}%). Re-planning required before payer submission.`,
        requestId,
        status: 409,
        code: 're_planning_required',
      });
    }

    let liaisonInbox = null;
    const correlationId = buildCorrelationId({
      correlationId: clean(body?.correlation_id || body?.correlationId || request.headers.get('x-correlation-id'), 200),
      requestId,
      runId,
    });

    const adjudication = await runBlockingReasoningAdjudication({
      run,
      policy: body?.adjudicationPolicy,
      integrityThreshold: Number(process.env.EXEC_ADJUDICATOR_INTEGRITY_THRESHOLD) || 0.95,
      justificationPacket: {
        text: [
          clean(run?.readiness?.summary, 3000),
          clean(run?.operatorPacket?.notes, 7000),
          clean(run?.intake?.chartSummary, 7000),
          clean(run?.intake?.diagnosis, 500),
        ].filter(Boolean).join('\n\n'),
      },
    });

    await appendImmutableSecurityLedgerRecord({
      recordType: 'reasoning_adjudication',
      did: didForAgent('portal'),
      agentName: 'portal',
      action: 'reasoning.adjudicate',
      runId,
      requestId,
      timestampMs: Date.now(),
      digest: createHash('sha256')
        .update(
          JSON.stringify({
            runId,
            integrityScore: Number(adjudication?.integrityScore) || 0,
            blocked: Boolean(adjudication?.blocked),
            policyId: clean(adjudication?.policy?.id, 220),
          }),
        )
        .digest('hex'),
      params: {
        integrityScore: Number(adjudication?.integrityScore) || 0,
        threshold: Number(adjudication?.threshold) || 0.95,
        blocked: Boolean(adjudication?.blocked),
        policyId: clean(adjudication?.policy?.id, 220),
        photonModel: clean(adjudication?.photon?.model, 160),
      },
      metadata: {
        reason: clean(adjudication?.reason, 1000),
        reasoningPath: adjudication?.reasoningPath || {},
        citations: asArray(adjudication?.claims).slice(0, 20),
      },
    });

    if (!adjudication?.ok || adjudication?.blocked) {
      const blockingReason = clean(
        adjudication?.reason || 'Executive adjudication integrity threshold not met.',
        600,
      );

      const updated = await updateRunCaseLifecycle(runId, {
        status: 'escalated',
        actor: operatorId,
        source: 'executive_adjudicator',
        eventNote: 'Reasoning integrity gate blocked automated signing and submission.',
        emrSync: {
          connector,
          status: 'MANUAL_ACTION_REQUIRED',
          agentMailInbox: clean(liaisonInbox?.email, 240),
          jellyBeanAlert: 'MANUAL_ACTION_REQUIRED',
          message: blockingReason,
          operatorId,
          packetId: run?.operatorPacket?.case_id || runId,
          lastSyncedAt: new Date().toISOString(),
        },
      });

      await emitAuditEvent({
        requestId,
        action: 'automation.submit_to_payer',
        outcome: 'AUTHENTICATION_ERROR',
        route: '/api/automation/submit-to-payer',
        actor: operatorId,
        source: 'ui',
        details: {
          runId,
          practiceId,
          correlation_id: correlationId,
          model_type: 'executive_adjudicator',
          cost_simulated: 0,
          timestamp: new Date().toISOString(),
          payerKey,
          connector,
          integrity_score: Number(adjudication?.integrityScore) || 0,
          integrity_threshold: Number(adjudication?.threshold) || 0.95,
          jelly_bean_alert: 'MANUAL_ACTION_REQUIRED',
        },
      });

      return jsonError({
        message: blockingReason,
        requestId,
        status: 401,
        code: 'AUTHENTICATION_ERROR',
        details: {
          runId,
          status: 'MANUAL_ACTION_REQUIRED',
          jellyBeanAlert: 'MANUAL_ACTION_REQUIRED',
          adjudication: {
            integrityScore: Number(adjudication?.integrityScore) || 0,
            threshold: Number(adjudication?.threshold) || 0.95,
            blocked: true,
            policyId: clean(adjudication?.policy?.id, 220),
          },
          run: updated.run,
        },
      });
    }

    liaisonInbox = await provisionRunInbox(runId);

    const attachment = await generateClinicalJustificationPdf(run);

    const payerSubmitIntent = await createSignedIntentEnvelope({
      agentName: 'portal',
      action: 'payer.submit',
      runId,
      requestId,
      params: {
        payerKey,
        connector,
        practiceId,
      },
    });

    try {
      await verifyAgentIntentOrThrow({
        envelope: payerSubmitIntent,
        requiredAction: 'payer.submit',
      });
    } catch (error) {
      return jsonError({
        message: error instanceof Error ? error.message : 'Agent intent verification failed for payer submission.',
        requestId,
        status: 403,
        code: 'invalid_agent_intent',
      });
    }

    const sandbox = await createEphemeralDaytonaWorkspace({
      runId,
      agentName: 'portal',
      clinicalArtifacts: [clean(attachment.absolutePath, 2000)],
      credentialRefs: [clean(process.env.UHC_PORTAL_CREDENTIALS, 500)],
    });
    sandboxWorkspaceId = clean(sandbox?.workspaceId, 120);

    sessionResult = await runUhcPortalSubmission({
      run,
      attachmentPath: attachment.absolutePath,
      headless,
      portalBaseUrl: clean(process.env.UHC_PORTAL_LOGIN_URL, 2000),
      clinicalGap,
    });
    page = sessionResult.page || null;

    if (!sessionResult.ok || !page) {
      const manualMessage = clean(sessionResult?.error || 'Portal automation failed due to layout or MFA block.', 500);
      const updated = await updateRunCaseLifecycle(runId, {
        status: 'escalated',
        actor: operatorId,
        source: 'portal_automation',
        eventNote: 'Portal automation failed. Escalated for manual action.',
        emrSync: {
          connector,
          status: 'MANUAL_ACTION_REQUIRED',
          agentMailInbox: clean(liaisonInbox?.email, 240),
          jellyBeanAlert: 'MANUAL_ACTION_REQUIRED',
          message: manualMessage,
          operatorId,
          packetId: run?.operatorPacket?.case_id || runId,
          lastSyncedAt: new Date().toISOString(),
        },
      });

      await emitAuditEvent({
        requestId,
        action: 'automation.submit_to_payer',
        outcome: 'manual_action_required',
        route: '/api/automation/submit-to-payer',
        actor: operatorId,
        source: 'ui',
        details: {
          runId,
          practiceId,
          correlation_id: correlationId,
          model_type: 'playwright_portal_agent',
          cost_simulated: 0,
          timestamp: new Date().toISOString(),
          payerKey,
          connector,
          jelly_bean_alert: 'MANUAL_ACTION_REQUIRED',
        },
      });

      return jsonSuccess(
        {
          ok: false,
          runId,
          status: 'MANUAL_ACTION_REQUIRED',
          jellyBeanAlert: 'MANUAL_ACTION_REQUIRED',
          message: manualMessage,
          run: updated.run,
        },
        requestId,
      );
    }

    const proof = await captureSubmissionProof({
      page,
      payerKey,
      runId,
      emrTaskId: clean(run?.operatorPacket?.emr_sync?.external_emr_id, 120),
    });

    const emrWriteIntent = await createSignedIntentEnvelope({
      agentName: 'portal',
      action: 'emr.write',
      runId,
      requestId,
      params: {
        connector,
        payerReferenceId: clean(proof?.payerReferenceId, 120),
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
        requestId,
        status: 403,
        code: 'invalid_agent_intent',
      });
    }

    const emrPatchResult = await closeLoopEmrTask({
      connector,
      run,
      payerReferenceId: proof.payerReferenceId,
      proof,
    });

    const submittedAt = new Date().toISOString();
    const updated = await updateRunCaseLifecycle(runId, {
      status: 'submitted',
      actor: operatorId,
      source: 'portal_automation',
      eventNote: `Submitted to ${payerKey.toUpperCase()} portal with tracking ${proof.payerReferenceId}.`,
      emrSync: {
        connector,
        status: emrPatchResult.ok ? 'SUBMITTED_TO_PAYER' : 'SUBMITTED_PENDING_EMR_PATCH',
        agentMailInbox: clean(liaisonInbox?.email, 240),
        payerReferenceId: proof.payerReferenceId,
        submissionTimestamp: submittedAt,
        proofScreenshotPath: proof.screenshotPath,
        operation: 'portal_submission',
        message: emrPatchResult.ok ? 'Portal submission and EMR close-loop succeeded.' : emrPatchResult.message,
        jellyBeanAlert: emrPatchResult.ok ? '' : 'MANUAL_ACTION_REQUIRED',
        operatorId,
        packetId: run?.operatorPacket?.case_id || runId,
        lastSyncedAt: submittedAt,
      },
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.submit_to_payer',
      outcome: emrPatchResult.ok ? 'success' : 'emr_patch_partial_failure',
      route: '/api/automation/submit-to-payer',
      actor: operatorId,
      source: 'ui',
      details: {
        runId,
        practiceId,
        correlation_id: correlationId,
        model_type: 'playwright_portal_agent',
        cost_simulated: 0,
        timestamp: submittedAt,
        payerKey,
        connector,
        payer_reference_id: proof.payerReferenceId,
        proof_file: proof.screenshotFileName,
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        payerReferenceId: proof.payerReferenceId,
        proof,
        emrPatch: emrPatchResult,
        run: updated.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to submit packet through payer automation.',
      requestId,
      status: 500,
      code: 'submit_to_payer_failed',
    });
  } finally {
    let browser = null;
    try {
      const context = page?.context?.();
      browser = context?.browser?.() || null;
      await context?.close();
    } catch {
      // best effort cleanup
    }
    try {
      await browser?.close();
    } catch {
      // best effort cleanup
    }
    try {
      if (sandboxWorkspaceId) {
        await destroyEphemeralDaytonaWorkspace({ workspaceId: sandboxWorkspaceId });
      }
    } catch {
      // best effort cleanup
    }
  }
}
