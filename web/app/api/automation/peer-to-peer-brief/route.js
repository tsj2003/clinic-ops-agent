import path from 'path';

import { enforceRateLimit, enforceWriteAuth, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { generateCombatBriefOnDenial } from '@/lib/automation/combat-brief';
import { derivePeerToPeerPayload } from '@/lib/automation/peer-to-peer-brief';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { getRunById, updateRunCaseLifecycle } from '@/lib/run-store';

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

  const rateLimited = enforceRateLimit(request, { key: 'peer-to-peer-brief', limit: 12, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const runId = safeTrim(body?.runId).slice(0, 120);
    const operatorId = safeTrim(body?.operatorId || body?.userId || 'staff-operator').slice(0, 120);

    if (!runId) {
      return jsonError({
        message: 'runId is required.',
        requestId,
        status: 400,
        code: 'invalid_peer_to_peer_payload',
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

    const denial = derivePeerToPeerPayload(run, body);
    if (!denial.applicable) {
      return jsonError({
        message: 'A DENIED signal is required before generating a peer-to-peer brief.',
        requestId,
        status: 409,
        code: 'peer_to_peer_not_applicable',
      });
    }

    const result = await generateCombatBriefOnDenial({
      run,
      denialReason: denial.denialReason,
      denialStatus: denial.denialStatus,
      payerReferenceId: denial.payerReferenceId,
      source: 'manual_exception_command_center',
    });

    const lifecycle = await updateRunCaseLifecycle(runId, {
      status: 'escalated',
      actor: operatorId,
      source: 'peer_to_peer_brief',
      eventNote: `Manual peer-to-peer brief generated${result?.brief?.storage?.pdfPath ? ` (${path.basename(result.brief.storage.pdfPath)})` : ''}.`,
      emrSync: {
        connector: safeTrim(run?.operatorPacket?.emr_sync?.connector || run?.emrSync?.connector || 'athena').slice(0, 40),
        status: 'DENIED',
        operation: 'peer_to_peer_brief',
        payerReferenceId: denial.payerReferenceId,
        message: safeTrim(result?.brief?.argument || denial.denialReason).slice(0, 1000),
        operatorId,
        packetId: safeTrim(run?.operatorPacket?.case_id || runId).slice(0, 120),
        lastSyncedAt: new Date().toISOString(),
      },
    });

    await emitAuditEvent({
      requestId,
      action: 'automation.peer_to_peer_brief',
      outcome: result?.ok ? 'success' : 'error',
      route: '/api/automation/peer-to-peer-brief',
      actor: operatorId || 'staff-operator',
      source: 'ui',
      details: {
        runId,
        payerReferenceId: denial.payerReferenceId,
        policyId: safeTrim(result?.brief?.policy?.policy_id).slice(0, 180),
        pdfPath: safeTrim(result?.brief?.storage?.pdfPath).slice(0, 500),
      },
    });

    return jsonSuccess(
      {
        ok: true,
        runId,
        brief: result?.brief || null,
        retrieval: result?.retrieval || null,
        run: lifecycle?.run || run,
      },
      requestId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate peer-to-peer brief.';
    return jsonError({
      message,
      requestId,
      status: 500,
      code: 'peer_to_peer_brief_failed',
    });
  }
}
