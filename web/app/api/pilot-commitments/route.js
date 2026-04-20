import { enforceRateLimit, enforceWriteAuth, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import {
  validatePilotCommitmentCreatePayload,
  validatePilotCommitmentPatchPayload,
} from '@/lib/pilot-commitment-schemas';
import {
  deletePilotCommitment,
  listPilotCommitments,
  savePilotCommitment,
  updatePilotCommitment,
} from '@/lib/pilot-commitment-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'pilot-commitments-read', limit: 80, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 200);

  try {
    const result = await listPilotCommitments(limit);
    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load pilot commitments.',
      requestId,
      status: 500,
      code: 'pilot_commitment_list_failed',
      details: { storage: 'unavailable', commitments: [] },
    });
  }
}

export async function POST(request) {
  const requestId = getRequestId(request);
  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'pilot-commitments-write', limit: 40, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const validation = validatePilotCommitmentCreatePayload(body);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_pilot_commitment_payload',
      });
    }

    const result = await savePilotCommitment(validation.data);
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.post',
      outcome: 'success',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: {
        commitmentId: result?.commitment?.id || '',
        clinicName: result?.commitment?.clinicName || validation.data.clinicName,
      },
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save pilot commitment.';
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.post',
      outcome: 'error',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: { errorMessage: message },
    });

    return jsonError({
      message,
      requestId,
      status: 400,
      code: 'pilot_commitment_save_failed',
    });
  }
}

export async function PATCH(request) {
  const requestId = getRequestId(request);
  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'pilot-commitments-write', limit: 40, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const validation = validatePilotCommitmentPatchPayload(body);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_pilot_commitment_patch',
      });
    }

    const result = await updatePilotCommitment(validation.id, validation.patch);
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.patch',
      outcome: 'success',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: {
        commitmentId: result?.commitment?.id || validation.id,
        status: result?.commitment?.status || validation.patch.status,
      },
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update pilot commitment.';
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.patch',
      outcome: 'error',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: { errorMessage: message },
    });

    return jsonError({
      message,
      requestId,
      status: 400,
      code: 'pilot_commitment_update_failed',
    });
  }
}

export async function DELETE(request) {
  const requestId = getRequestId(request);
  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'pilot-commitments-write', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = safeTrim(searchParams.get('id'));
    if (!id) {
      return jsonError({
        message: 'id is required.',
        requestId,
        status: 400,
        code: 'invalid_pilot_commitment_id',
      });
    }

    const result = await deletePilotCommitment(id);
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.delete',
      outcome: 'success',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: { commitmentId: id },
    });

    return jsonSuccess(result, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete pilot commitment.';
    await emitAuditEvent({
      requestId,
      action: 'pilot_commitments.delete',
      outcome: 'error',
      route: '/api/pilot-commitments',
      actor: 'staff',
      source: 'ui',
      details: { errorMessage: message },
    });

    return jsonError({
      message,
      requestId,
      status: 400,
      code: 'pilot_commitment_delete_failed',
    });
  }
}
