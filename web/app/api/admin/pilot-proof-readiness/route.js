import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess } from '@/lib/api-response';
import { listPilotCommitments } from '@/lib/pilot-commitment-store';
import { buildPilotProofReadiness, buildPilotProofReadinessMarkdown } from '@/lib/pilot-proof-readiness';
import { listRunsForAnalytics } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireInternalAccess(request, requestId) {
  const expectedKey = safeTrim(process.env.INTERNAL_API_KEY);
  if (!expectedKey) {
    return null;
  }

  const providedKey = safeTrim(request.headers.get('x-internal-api-key'));
  if (providedKey !== expectedKey) {
    return jsonError({
      message: 'Unauthorized request. Missing or invalid internal API key.',
      requestId,
      status: 401,
      code: 'unauthorized',
    });
  }

  return null;
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-pilot-proof-readiness', limit: 12, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 300, 500);
    const format = safeTrim(searchParams.get('format')).toLowerCase();

    const [{ commitments, storage: commitmentStorage }, { runs, storage: runStorage }] = await Promise.all([
      listPilotCommitments(limit),
      listRunsForAnalytics(limit),
    ]);

    const report = buildPilotProofReadiness({
      commitments: Array.isArray(commitments) ? commitments : [],
      runs: Array.isArray(runs) ? runs : [],
    });

    if (format === 'json') {
      return jsonSuccess(
        {
          ...report,
          storage: {
            commitments: commitmentStorage,
            runs: runStorage,
          },
        },
        requestId,
      );
    }

    const markdown = buildPilotProofReadinessMarkdown(report);
    const stamp = new Date().toISOString().slice(0, 10);

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-pilot-proof-readiness-${stamp}.md"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to build pilot proof readiness export.',
      requestId,
      status: 500,
      code: 'admin_pilot_proof_readiness_failed',
    });
  }
}
