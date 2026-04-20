import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { triggerRevenueEvent } from '@/lib/automation/billing-engine';
import { createSignedIntentEnvelope } from '@/lib/security/agent-identity';
import { verifyAgentIntentOrThrow } from '@/lib/security/agent-intent';
import { getRunById } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'billing-trigger-write', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = clean(body?.runId, 120);
    const coordinatorStatus = clean(body?.coordinatorStatus || body?.status, 80).toUpperCase();

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

    const source = clean(body?.source || 'billing_trigger_api', 120);
    const selectedAgent = source.includes('voice') ? 'voice' : source.includes('email') ? 'email' : 'portal';

    const billingIntent = await createSignedIntentEnvelope({
      agentName: selectedAgent,
      action: 'billing.charge',
      runId,
      requestId,
      params: {
        coordinatorStatus,
        practiceId: clean(body?.practiceId, 120),
        procedureCode: clean(body?.procedureCode, 40),
      },
    });

    try {
      await verifyAgentIntentOrThrow({
        envelope: billingIntent,
        requiredAction: 'billing.charge',
      });
    } catch (error) {
      return jsonError({
        message: error instanceof Error ? error.message : 'Agent intent verification failed for billing charge.',
        requestId,
        status: 403,
        code: 'invalid_agent_intent',
      });
    }

    const result = await triggerRevenueEvent({
      run,
      runId,
      practiceId: clean(body?.practiceId, 120),
      coordinatorStatus,
      procedureCode: clean(body?.procedureCode, 40),
      insuranceType: clean(body?.insuranceType, 80),
      payerReferenceId: clean(body?.payerReferenceId, 120),
      requestId,
      source,
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to trigger revenue lock event.',
      requestId,
      status: 500,
      code: 'billing_trigger_failed',
    });
  }
}
