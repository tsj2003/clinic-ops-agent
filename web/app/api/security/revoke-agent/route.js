import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { revokeAgentIdentity } from '@/lib/security/agent-intent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 240) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'security-revoke-agent-write', limit: 40, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const did = clean(body?.did, 240);
    const agentName = clean(body?.agentName, 120).toLowerCase();

    if (!did && !agentName) {
      return jsonError({
        message: 'did or agentName is required.',
        requestId,
        status: 400,
        code: 'missing_revoke_target',
      });
    }

    const result = await revokeAgentIdentity({ did, agentName });
    return jsonSuccess(
      {
        ok: true,
        revokedDid: result.did,
        revokedCount: result.revokedCount,
        effectiveWithinMs: 1000,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to revoke agent identity.',
      requestId,
      status: 500,
      code: 'revoke_agent_failed',
    });
  }
}
