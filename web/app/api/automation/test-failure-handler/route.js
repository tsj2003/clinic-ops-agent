import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { emitObservabilityEvent } from '@/lib/observability';
import {
  autoHealPortalSelector,
  classifyTestFailure,
  coordinateFailureWithAg2,
} from '@/lib/automation/testsprite-auto-heal';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 3000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function verifyWebhookSecret(request) {
  const expected = clean(process.env.TESTSPRITE_WEBHOOK_SECRET, 200);
  if (!expected) {
    return true;
  }

  const received =
    clean(request.headers.get('x-testsprite-webhook-secret'), 200) ||
    clean(request.headers.get('x-webhook-secret'), 200);

  return received && received === expected;
}

export async function POST(request) {
  const requestId = getRequestId(request);

  if (!verifyWebhookSecret(request)) {
    return jsonError({
      message: 'Invalid TestSprite webhook secret.',
      requestId,
      status: 401,
      code: 'invalid_testsprite_webhook_secret',
    });
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body.runId || body.appRunId, 120);

    if (!runId) {
      return jsonError({
        message: 'runId is required in TestSprite failure payload.',
        requestId,
        status: 400,
        code: 'missing_run_id',
      });
    }

    const run = await getRunById(runId);
    if (!run) {
      return jsonError({
        message: 'Run not found for TestSprite failure payload.',
        requestId,
        status: 404,
        code: 'run_not_found',
      });
    }

    const classification = classifyTestFailure(body);
    const ag2 = await coordinateFailureWithAg2({ payload: body, classification });

    const shouldAutoHeal =
      classification.type === 'portal_layout_changed' &&
      (ag2.actions.includes('auto_heal_selector') || ag2.decision === 'auto_heal_selector');

    const shouldAlertOperator =
      ag2.actions.includes('alert_operator') ||
      ag2.decision === 'alert_operator' ||
      classification.type === 'portal_layout_changed';

    if (shouldAlertOperator) {
      await emitObservabilityEvent({
        service: 'authpilot-web',
        signal: 'operator_alert',
        channel: 'portal_regression',
        severity: classification.severity,
        runId,
        classification: classification.type,
        message: clean(body.message || body.error || classification.reason, 500),
      }).catch(() => null);
    }

    let healing = null;
    if (shouldAutoHeal) {
      healing = await autoHealPortalSelector({
        portal: clean(body.portal || 'uhc', 60),
        elementKey: clean(body.elementKey || body.selectorKey || 'form.submit', 200),
        brokenSelector: clean(body.selector || body.brokenSelector, 1000),
        domSnapshot: clean(body.domSnapshot || body.dom || '', 300_000),
        intent: clean(
          body.intent ||
            'Navigate to payer portal, log in, find prior auth form, upload clinical PDF, and submit.',
          1000,
        ),
      });
    }

    const lifecycle = await updateRunCaseLifecycle(runId, {
      status: classification.lifecycleStatus,
      actor: 'testsprite-regression',
      source: 'testsprite_webhook',
      eventNote: `TestSprite failure classified as ${classification.type}. ${clean(classification.reason, 300)}`,
      emrSync: {
        connector: clean(run?.operatorPacket?.emr_sync?.connector || run?.emrSync?.connector || 'athena', 40),
        status: classification.emrStatus,
        operation: 'testsprite_regression_failure',
        packetId: run?.operatorPacket?.case_id || runId,
        message: clean(body.message || body.error || classification.reason, 1200),
        lastSyncedAt: new Date().toISOString(),
      },
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.testsprite_failure_handler',
      outcome: 'success',
      route: '/api/automation/test-failure-handler',
      actor: 'testsprite',
      source: 'testsprite_webhook',
      details: {
        runId,
        classification: classification.type,
        decision: clean(ag2.decision, 80),
        healed: Boolean(healing?.ok),
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        classification,
        coordination: ag2,
        healing,
        run: lifecycle.run,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process TestSprite failure payload.',
      requestId,
      status: 500,
      code: 'testsprite_failure_handler_failed',
    });
  }
}
