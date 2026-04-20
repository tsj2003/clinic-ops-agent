import { NextResponse } from 'next/server';

import { enforceRateLimit, enforceWriteAuth, parsePositiveIntParam, safeTrim } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { validateWorkspaceSavePayload } from '@/lib/api-schemas';
import { deleteWorkspace, listWorkspaces, saveWorkspace } from '@/lib/workspace-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'workspaces-read', limit: 80, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  const { searchParams } = new URL(request.url);
  const limit = parsePositiveIntParam(searchParams.get('limit'), 20, 200);

  try {
    const result = await listWorkspaces(limit);
    return jsonSuccess(result, requestId);
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to load workspace profiles.',
      requestId,
      status: 500,
      code: 'workspace_list_failed',
      details: { storage: 'unavailable', workspaces: [] },
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

  const rateLimited = enforceRateLimit(request, { key: 'workspaces-write', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const validation = validateWorkspaceSavePayload(body);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_workspace_payload',
      });
    }

    const result = await saveWorkspace(validation.data);
    await emitAuditEvent({
      requestId,
      action: 'workspaces.post',
      outcome: 'success',
      route: '/api/workspaces',
      actor: 'staff',
      source: 'ui',
      details: {
        workspaceId: result?.workspace?.id || validation.data.id || '',
        clinicName: validation.data.clinicName,
      },
    });
    return jsonSuccess(result, requestId);
  } catch (error) {
    if (error?.code === 'invalid_json') {
      return jsonError({
        message: error.message,
        requestId,
        status: 400,
        code: error.code,
      });
    }

    const message = error instanceof Error ? error.message : 'Unable to save workspace profile.';
    await emitAuditEvent({
      requestId,
      action: 'workspaces.post',
      outcome: 'error',
      route: '/api/workspaces',
      actor: 'staff',
      source: 'ui',
      details: {
        errorMessage: message,
      },
    });

    return jsonError({
      message,
      requestId,
      status: 400,
      code: 'workspace_save_failed',
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

  const rateLimited = enforceRateLimit(request, { key: 'workspaces-write', limit: 30, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = safeTrim(searchParams.get('id'));
    if (!id) {
      return jsonError({
        message: 'Workspace id is required.',
        requestId,
        status: 400,
        code: 'invalid_workspace_id',
      });
    }
    const result = await deleteWorkspace(id);
    await emitAuditEvent({
      requestId,
      action: 'workspaces.delete',
      outcome: 'success',
      route: '/api/workspaces',
      actor: 'staff',
      source: 'ui',
      details: {
        workspaceId: id,
      },
    });
    return jsonSuccess(result, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete workspace profile.';
    await emitAuditEvent({
      requestId,
      action: 'workspaces.delete',
      outcome: 'error',
      route: '/api/workspaces',
      actor: 'staff',
      source: 'ui',
      details: {
        errorMessage: message,
      },
    });

    return jsonError({
      message,
      requestId,
      status: 400,
      code: 'workspace_delete_failed',
    });
  }
}
