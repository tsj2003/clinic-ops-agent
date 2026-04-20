import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
import { buildTruthFirstCaseStudyMarkdown, summarizeRunWindow } from '@/lib/case-study-truth';
import { listPilotCommitments } from '@/lib/pilot-commitment-store';
import { buildPilotProofReadiness } from '@/lib/pilot-proof-readiness';
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

  const rateLimited = enforceRateLimit(request, { key: 'admin-case-study', limit: 10, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parsePositiveIntParam(searchParams.get('days'), 7, 90);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 300, 500);

    const [{ runs }, { commitments }] = await Promise.all([
      listRunsForAnalytics(limit),
      listPilotCommitments(limit),
    ]);
    const safeRuns = Array.isArray(runs) ? runs : [];
    const safeCommitments = Array.isArray(commitments) ? commitments : [];
    const runSummary = summarizeRunWindow(safeRuns, days);
    const proofReport = buildPilotProofReadiness({ commitments: safeCommitments, runs: safeRuns });
    const markdown = buildTruthFirstCaseStudyMarkdown({
      runSummary,
      proofReport,
      generatedAt: new Date().toISOString(),
    });
    const stamp = new Date().toISOString().slice(0, 10);

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-case-study-draft-${stamp}.md"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to generate case study draft.',
      requestId,
      status: 500,
      code: 'admin_case_study_failed',
    });
  }
}
