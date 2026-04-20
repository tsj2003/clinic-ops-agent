import { enforceRateLimit, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
import { listPilotCommitments } from '@/lib/pilot-commitment-store';
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

function csvCell(value) {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function buildCsv(rows) {
  return rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\n');
}

export async function GET(request) {
  const requestId = getRequestId(request);

  const unauthorized = requireInternalAccess(request, requestId);
  if (unauthorized) {
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'admin-metrics-export', limit: 12, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const dataset = safeTrim(searchParams.get('dataset')).toLowerCase() || 'runs';
    const limit = parsePositiveIntParam(searchParams.get('limit'), 250, 500);

    if (dataset === 'commitments') {
      const { commitments } = await listPilotCommitments(limit);

      const rows = [
        [
          'updatedAt',
          'id',
          'clinicName',
          'status',
          'momentum',
          'lane',
          'championName',
          'championEmail',
          'targetStartDate',
          'baselineDenialRatePercent',
          'baselineDaysToAuth',
          'weeklyReviewDay',
          'nextStep',
          'notes',
        ],
      ];

      for (const commitment of commitments) {
        rows.push([
          commitment?.updatedAt || '',
          commitment?.id || '',
          commitment?.clinicName || '',
          commitment?.status || '',
          commitment?.momentum || '',
          commitment?.lane || '',
          commitment?.championName || '',
          commitment?.championEmail || '',
          commitment?.targetStartDate || '',
          commitment?.baselineDenialRatePercent || '',
          commitment?.baselineDaysToAuth || '',
          commitment?.weeklyReviewDay || '',
          commitment?.nextStep || '',
          commitment?.notes || '',
        ]);
      }

      const csv = buildCsv(rows);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="authpilot-commitment-pipeline-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
      });
    }

    const { runs } = await listRunsForAnalytics(limit);

    const rows = [
      [
        'startedAt',
        'appRunId',
        'status',
        'mode',
        'workflowName',
        'caseId',
        'procedure',
        'elapsedSeconds',
        'ready',
        'confidence',
        'missingEvidenceCount',
        'matchedEvidenceCount',
        'estimatedHoursSaved',
        'estimatedDaysToAuthSaved',
        'estimatedRecoveredRevenueUsd',
        'estimatedDenialRiskReductionPercent',
        'failureCode',
        'failureStage',
      ],
    ];

    for (const run of runs) {
      rows.push([
        run?.startedAt || '',
        run?.appRunId || '',
        run?.status || '',
        run?.mode || '',
        run?.workflow?.name || '',
        run?.workflow?.caseId || '',
        run?.workflow?.procedure || '',
        Number(run?.metrics?.elapsedSeconds) || 0,
        run?.readiness?.ready === true ? 'true' : 'false',
        Number(run?.readiness?.confidence) || 0,
        Array.isArray(run?.readiness?.missing_evidence) ? run.readiness.missing_evidence.length : 0,
        Array.isArray(run?.readiness?.supporting_evidence) ? run.readiness.supporting_evidence.length : 0,
        Number(run?.roi?.estimatedHoursSaved) || 0,
        Number(run?.roi?.estimatedDaysToAuthSaved) || 0,
        Number(run?.roi?.estimatedRecoveredRevenueUsd) || 0,
        Number(run?.roi?.estimatedDenialRiskReductionPercent) || 0,
        run?.failure?.code || '',
        run?.failure?.stage || '',
      ]);
    }

    const csv = buildCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="authpilot-admin-metrics-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to export admin metrics CSV.',
      requestId,
      status: 500,
      code: 'admin_metrics_export_failed',
    });
  }
}
