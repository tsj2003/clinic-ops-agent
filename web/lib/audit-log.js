import { emitObservabilityEvent } from '@/lib/observability';
import { buildCorrelationId, emitAgentLifecycleEvent } from '@/lib/observability/axiom-monitor';

function clean(value) {
  return String(value || '').trim();
}

export async function emitAuditEvent({
  requestId,
  action,
  outcome,
  route,
  actor = 'system',
  source = 'api',
  details = {},
}) {
  const payload = {
    service: 'authpilot-web',
    signal: 'audit_event',
    requestId: clean(requestId),
    action: clean(action),
    outcome: clean(outcome),
    route: clean(route),
    actor: clean(actor) || 'system',
    source: clean(source) || 'api',
    ...details,
  };

  const runId = clean(details?.runId || details?.appRunId, 120);
  const practiceId = clean(details?.practiceId || details?.practice_id || details?.workspaceId || details?.workspace_id, 120);
  const modelType = clean(details?.model_type || details?.modelUsed || details?.model || '', 200);
  const costSimulated = Number(details?.cost_simulated) || Number(details?.fireworks_vs_gpt4o_savings_usd) || 0;
  const correlationId = buildCorrelationId({
    correlationId: clean(details?.correlation_id || details?.correlationId, 200),
    requestId,
    runId,
  });

  try {
    await emitObservabilityEvent(payload);
    await emitAgentLifecycleEvent({
      agent: action,
      lifecycle: outcome,
      requestId,
      route,
      runId,
      practiceId,
      modelType,
      costSimulated,
      correlationId,
      metadata: {
        ...details,
        action: clean(action, 160),
        outcome: clean(outcome, 120),
      },
    });
  } catch {
    console.info('audit_event', payload);
  }
}
