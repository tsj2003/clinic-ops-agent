import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { runConnectorPrototype, validateConnectorPrototypePayload } from '@/lib/connector-prototype';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'connector-prototype', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  const authError = enforceWriteAuth(request);
  if (authError) {
    authError.headers.set('x-request-id', requestId);
    return authError;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const validation = validateConnectorPrototypePayload(body);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_connector_prototype_payload',
      });
    }

    const result = await runConnectorPrototype(validation.data);
    const actorId = validation.data.operatorId || (validation.data.mode === 'live' ? 'unknown-operator' : 'staff');

    await emitAuditEvent({
      requestId,
      action: 'connector-prototype.post',
      outcome: result.dryRun ? 'dry_run' : 'executed',
      route: '/api/integrations/connector-prototype',
      actor: actorId,
      source: 'ui',
      details: {
        connector: validation.data.connector,
        mode: validation.data.mode,
        dryRun: String(result.dryRun),
        executedCount: String(result.executed.length),
        packetId: validation.data.packetId || '',
        externalEmrId: result.primaryExternalId?.externalEmrId || '',
      },
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    await emitAuditEvent({
      requestId,
      action: 'connector-prototype.post',
      outcome: 'error',
      route: '/api/integrations/connector-prototype',
      actor: 'staff',
      source: 'ui',
      details: {
        errorMessage: error instanceof Error ? error.message : 'Unexpected connector prototype error',
      },
    });

    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to build connector prototype requests.',
      requestId,
      status: 500,
      code: 'connector_prototype_failed',
    });
  }
}
