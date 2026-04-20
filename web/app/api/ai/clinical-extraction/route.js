import { enforceRateLimit, enforceWriteAuth, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { processClinicalRecord } from '@/lib/ai/fireworks-client';
import { buildCorrelationId } from '@/lib/observability/axiom-monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'ai-clinical-extraction', limit: 40, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const imageBase64 = safeTrim(body?.imageBase64);
    const specialtyPriorAuthRules = safeTrim(body?.specialtyPriorAuthRules);
    const runId = safeTrim(body?.runId || body?.appRunId);
    const practiceId = safeTrim(body?.practiceId || body?.workspaceId || body?.organizationId);
    const correlationId = buildCorrelationId({
      correlationId: safeTrim(body?.correlation_id || body?.correlationId || request.headers.get('x-correlation-id')),
      requestId,
      runId,
    });

    if (!imageBase64) {
      return jsonError({
        message: 'imageBase64 is required.',
        requestId,
        status: 400,
        code: 'invalid_extraction_payload',
      });
    }

    const result = await processClinicalRecord({
      imageBase64,
      specialtyPriorAuthRules,
      primaryModel: safeTrim(body?.primaryModel),
      fallbackModel: safeTrim(body?.fallbackModel),
    });

    await emitAuditEvent({
      requestId,
      action: 'ai.clinical_extraction',
      outcome: 'success',
      route: '/api/ai/clinical-extraction',
      actor: safeTrim(body?.operatorId) || 'staff-operator',
      source: 'ui',
      details: {
        runId,
        practiceId,
        correlation_id: correlationId,
        model_type: result.modelUsed,
        cost_simulated: Number(result?.simulatedSavings?.estimatedCostSavingsUsd) || 0,
        fireworks_vs_gpt4o_savings_usd: Number(result?.simulatedSavings?.estimatedCostSavingsUsd) || 0,
        manual_minutes_saved: Number(result?.simulatedSavings?.manualMinutesSaved) || 0,
        modelUsed: result.modelUsed,
        cacheStatus: result.cache?.status || '',
        totalTokens: String(result.simulatedSavings?.totalTokens || 0),
      },
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Clinical extraction failed.',
      requestId,
      status: 500,
      code: 'clinical_extraction_failed',
    });
  }
}
