import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
import { listPilotCommitments } from '@/lib/pilot-commitment-store';

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

function summarize(commitments = []) {
  const counts = {
    prospect: 0,
    discovery: 0,
    proposal_sent: 0,
    verbal_committed: 0,
    signed_active: 0,
    on_hold: 0,
    closed_lost: 0,
  };

  let dueIn7Days = 0;
  let overdue = 0;
  let missingNextStep = 0;

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const commitment of commitments) {
    const status = safeTrim(commitment?.status) || 'prospect';
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }

    const nextStep = safeTrim(commitment?.nextStep);
    if (!nextStep && status !== 'closed_lost' && status !== 'signed_active') {
      missingNextStep += 1;
    }

    const targetDate = safeTrim(commitment?.targetStartDate);
    if (!targetDate) {
      continue;
    }

    const targetMs = Date.parse(`${targetDate}T00:00:00.000Z`);
    if (!Number.isFinite(targetMs)) {
      continue;
    }

    const diff = targetMs - now;
    if (diff < 0 && status !== 'signed_active' && status !== 'closed_lost') {
      overdue += 1;
    } else if (diff <= sevenDaysMs && status !== 'signed_active' && status !== 'closed_lost') {
      dueIn7Days += 1;
    }
  }

  const total = commitments.length;
  const conversionToSignedPercent = total ? Math.round((counts.signed_active / total) * 100) : 0;

  return {
    total,
    conversionToSignedPercent,
    dueIn7Days,
    overdue,
    missingNextStep,
    counts,
  };
}

function buildMarkdown(summary, commitments, generatedAt) {
  const lines = commitments.slice(0, 15).map((item) => {
    const clinicName = item?.clinicName || 'Unknown clinic';
    const status = item?.status || 'prospect';
    const lane = item?.lane || 'No lane';
    const nextStep = item?.nextStep || 'No next step';
    const date = item?.targetStartDate || 'No date';
    return `- ${clinicName} · ${status} · ${lane} · target ${date} · next: ${nextStep}`;
  });

  return [
    '# Pilot Commitment Snapshot — AuthPilot AI',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Funnel Summary',
    `- Total commitments: ${summary.total}`,
    `- Conversion to signed: ${summary.conversionToSignedPercent}%`,
    `- Signed active: ${summary.counts.signed_active}`,
    `- Verbal committed: ${summary.counts.verbal_committed}`,
    `- Proposal sent: ${summary.counts.proposal_sent}`,
    `- Discovery: ${summary.counts.discovery}`,
    `- Prospect: ${summary.counts.prospect}`,
    `- On hold: ${summary.counts.on_hold}`,
    `- Closed lost: ${summary.counts.closed_lost}`,
    '',
    '## Risk Flags',
    `- Overdue start dates: ${summary.overdue}`,
    `- Due within 7 days: ${summary.dueIn7Days}`,
    `- Missing next step: ${summary.missingNextStep}`,
    '',
    '## Top Active Commitments',
    ...(lines.length ? lines : ['- none']),
    '',
    '## Next 7-Day Commitments',
    '- Close at least one proposal-stage deal.',
    '- Update every active deal with owner + date-bound next step.',
    '- Export operating review after pipeline statuses are refreshed.',
    '',
  ].join('\n');
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-commitment-snapshot', limit: 12, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parsePositiveIntParam(searchParams.get('limit'), 200, 500);
    const generatedAt = new Date().toISOString();

    const { commitments } = await listPilotCommitments(limit);
    const safeCommitments = Array.isArray(commitments) ? commitments : [];
    const summary = summarize(safeCommitments);
    const markdown = buildMarkdown(summary, safeCommitments, generatedAt);

    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-commitment-snapshot-${generatedAt.slice(0, 10)}.md"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to generate commitment snapshot markdown.',
      requestId,
      status: 500,
      code: 'admin_commitment_snapshot_failed',
    });
  }
}
