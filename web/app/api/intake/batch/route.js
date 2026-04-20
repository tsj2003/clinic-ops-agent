import { Readable } from 'stream';
import Busboy from 'busboy';

import { enforceRateLimit, enforceWriteAuth } from '@/lib/api-guards';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { emitAuditEvent } from '@/lib/audit-log';
import { listInternalBatchFields } from '@/lib/batch-intake-engine';
import { createBatchId, commitBatchProcessor, preflightBatchProcessor } from '@/lib/batch-processor';
import { validateBatchIntakeSchema } from '@/lib/api-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

async function parseMultipartRequest(request) {
  const headers = Object.fromEntries(request.headers.entries());
  const bb = Busboy({ headers });

  return new Promise((resolve, reject) => {
    const fields = {};
    let fileName = '';
    let fileContent = '';

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (_name, stream, info) => {
      fileName = clean(info?.filename, 240) || fileName;
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        fileContent = Buffer.concat(chunks).toString('utf-8');
      });
    });

    bb.on('error', (error) => reject(error));
    bb.on('finish', () => {
      let mapping = {};
      const mappingRaw = clean(fields.mapping, 50_000);
      if (mappingRaw) {
        try {
          mapping = JSON.parse(mappingRaw);
        } catch {
          mapping = {};
        }
      }

      resolve({
        batchId: clean(fields.batchId),
        filename: fileName || clean(fields.filename) || 'batch-intake-upload',
        userId: clean(fields.userId),
        practiceId: clean(fields.practiceId),
        connector: clean(fields.connector),
        defaultDepartmentId: clean(fields.defaultDepartmentId),
        defaultOrganizationId: clean(fields.defaultOrganizationId),
        commit: clean(fields.commit).toLowerCase() === 'true',
        formatHint: clean(fields.formatHint).toLowerCase(),
        rawText: fileContent,
        mapping,
        sourceRows: [],
      });
    });

    if (!request.body) {
      reject(new Error('Multipart request body is missing.'));
      return;
    }

    Readable.fromWeb(request.body).pipe(bb);
  });
}

export async function POST(request) {
  const requestId = getRequestId(request);

  const unauthorized = enforceWriteAuth(request);
  if (unauthorized) {
    unauthorized.headers.set('x-request-id', requestId);
    return unauthorized;
  }

  const rateLimited = enforceRateLimit(request, { key: 'intake-batch-write', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  let body;
  try {
    const contentType = clean(request.headers.get('content-type')).toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      body = await parseMultipartRequest(request);
    } else {
      const parsed = await parseJsonBody(request, requestId);
      const validated = validateBatchIntakeSchema(parsed);
      if (!validated.ok) {
        return jsonError({
          message: validated.message,
          requestId,
          status: 400,
          code: 'invalid_batch_intake_payload',
        });
      }
      body = validated.data;
    }

    const batchId = body.batchId || createBatchId();
    const filename = body.filename || 'batch-intake-upload';
    const userId = body.userId || 'staff-operator';
    const practiceId = body.practiceId || '';
    const connector = body.connector || 'athena';
    const defaultDepartmentId = body.defaultDepartmentId || process.env.ATHENAHEALTH_DEFAULT_DEPARTMENT_ID || '';
    const defaultOrganizationId = body.defaultOrganizationId || process.env.EPIC_DEFAULT_ORGANIZATION_ID || '';

    if (!body.commit) {
      const preflight = await preflightBatchProcessor({
        rawText: body.rawText,
        formatHint: body.formatHint,
        mapping: body.mapping,
        practiceId,
      });

      await emitAuditEvent({
        requestId,
        action: 'batch_ingestion_event',
        outcome: 'success',
        route: '/api/intake/batch',
        actor: userId,
        source: 'ui',
        details: {
          batch_id: batchId,
          filename,
          row_count: String(preflight.validationResults.length),
          operator_id: userId,
          mode: 'preflight',
        },
      });

      return jsonSuccess(
        {
          batchId,
          filename,
          commit: false,
          schema: listInternalBatchFields(),
          format: preflight.format,
          headers: preflight.headers,
          mapping: preflight.mapping,
          fuzzyDictionary: preflight.fuzzyDictionary,
          successCount: preflight.successCount,
          errorCount: preflight.errorCount,
          validationResults: preflight.validationResults,
          sourceRows: preflight.sourceRows,
        },
        requestId,
      );
    }

    const sourceRows = Array.isArray(body.sourceRows) ? body.sourceRows : [];
    if (!sourceRows.length) {
      return jsonError({
        message: 'sourceRows is required for commit mode. Run pre-flight first.',
        requestId,
        status: 400,
        code: 'batch_commit_missing_source_rows',
      });
    }

    const committed = await commitBatchProcessor({
      batchId,
      filename,
      operatorId: userId,
      practiceId,
      connector,
      defaultDepartmentId,
      defaultOrganizationId,
      sourceRows,
      mapping: body.mapping,
    });

    await emitAuditEvent({
      requestId,
      action: 'batch_ingestion_event',
      outcome: 'success',
      route: '/api/intake/batch',
      actor: userId,
      source: 'ui',
      details: {
        batch_id: batchId,
        filename,
        row_count: String(committed.validationResults.length),
        operator_id: userId,
        mode: 'commit',
      },
    });

    return jsonSuccess(
      {
        batchId,
        filename,
        commit: true,
        successCount: committed.successCount,
        errorCount: committed.errorCount,
        validationResults: committed.validationResults,
        createdRuns: committed.createdRuns,
      },
      requestId,
    );
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to process batch intake upload.',
      requestId,
      status: 400,
      code: 'batch_intake_failed',
    });
  }
}
