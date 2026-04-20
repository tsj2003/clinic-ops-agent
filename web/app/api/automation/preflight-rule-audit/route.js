import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { runJustificationAudit } from '@/lib/automation/rule-auditor';
import { runWithTimeout } from '@/lib/automation/timeout-guard';
import { buildCorrelationId } from '@/lib/observability/axiom-monitor';
import { getRunById } from '@/lib/run-store';

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

function verifySecret(request) {
  const expected = clean(process.env.PRE_SUBMISSION_AUDIT_WEBHOOK_SECRET, 300);
  if (!expected) {
    return true;
  }

  const received =
    clean(request.headers.get('x-preflight-audit-secret'), 300) ||
    clean(request.headers.get('x-webhook-secret'), 300);

  return received && received === expected;
}

export async function POST(request) {
  const requestId = getRequestId(request);

  if (!verifySecret(request)) {
    return jsonError({
      message: 'Invalid preflight audit secret.',
      requestId,
      status: 401,
      code: 'invalid_preflight_audit_secret',
    });
  }

  try {
    const startedAtMs = Date.now();
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body.runId || body.appRunId, 120);
    const correlationId = buildCorrelationId({
      correlationId: clean(body?.correlation_id || body?.correlationId || request.headers.get('x-correlation-id'), 200),
      requestId,
      runId,
    });

    let run = body.run && typeof body.run === 'object' ? body.run : null;
    if (!run && runId) {
      run = await getRunById(runId);
    }

    if (!run) {
      return jsonError({
        message: 'Run not found. Provide runId or inline run payload.',
        requestId,
        status: 404,
        code: 'run_not_found',
      });
    }

    const result = await runWithTimeout(
      () => runJustificationAudit({ run }),
      asNumber(process.env.PREFLIGHT_RULE_AUDIT_TIMEOUT_MS, 5000),
      { message: 'Preflight rule audit timed out (>5s SLA).' },
    );
    const latencyMs = Date.now() - startedAtMs;

    await emitAuditEvent({
      requestId,
      action: 'automation.preflight_rule_audit',
      outcome: 'success',
      route: '/api/automation/preflight-rule-audit',
      actor: 'rule-auditor',
      source: 'pre_submission_preflight',
      details: {
        runId: clean(run?.appRunId, 120) || runId,
        practiceId: clean(run?.workspace?.id || run?.workspace?.name || run?.intake?.practiceId, 120),
        correlation_id: correlationId,
        model_type: clean(result?.audit?.modelUsed, 200),
        cost_simulated: Number(result?.audit?.confidence) || 0,
        timestamp: new Date().toISOString(),
        hasGap: result?.audit?.hasGap === true,
        topRuleTitle: clean(result?.topRule?.title, 200),
        procedureCode: clean(result?.retrieval?.procedureCode, 40),
        payerId: clean(result?.retrieval?.payerId, 120),
        latencyMs,
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId: clean(run?.appRunId, 120) || runId,
        skipped: result?.skipped === true,
        hasGap: result?.audit?.hasGap === true,
        missingDataPoints: Array.isArray(result?.audit?.missingDataPoints) ? result.audit.missingDataPoints : [],
        summary: clean(result?.audit?.summary, 3000),
        emrPatch: result?.emrPatch || null,
        retrievalProof: {
          procedureCode: clean(result?.retrieval?.procedureCode, 40),
          payerId: clean(result?.retrieval?.payerId, 120),
          totalCandidates: Number(result?.retrieval?.totalCandidates) || 0,
          latencyMs,
          topRule: result?.topRule
            ? {
                id: clean(result.topRule.id, 200),
                title: clean(result.topRule.title, 300),
                sourceUrl: clean(result.topRule.sourceUrl, 1000),
                rerankScore: Number(result.topRule.rerankScore) || 0,
              }
            : null,
        },
      },
      requestId,
    );
  } catch (error) {
    const isTimeout = clean(error instanceof Error ? error.message : '', 300).toLowerCase().includes('timed out');
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to complete preflight rule audit.',
      requestId,
      status: isTimeout ? 504 : 500,
      code: isTimeout ? 'preflight_rule_audit_timeout' : 'preflight_rule_audit_failed',
    });
  }
}
