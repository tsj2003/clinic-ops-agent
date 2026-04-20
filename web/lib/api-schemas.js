import { isValidHttpUrl, safeTrim } from '@/lib/api-guards';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function validateRunsPatchPayload(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'PATCH body must be a JSON object.' };
  }

  const appRunId = safeTrim(body.appRunId);
  if (!appRunId) {
    return { ok: false, message: 'appRunId is required.' };
  }

  const status = safeTrim(body.status);
  const allowedStatuses = new Set([
    '',
    'new',
    'collecting_evidence',
    'ready_for_submission',
    'submitted',
    'escalated',
  ]);
  if (!allowedStatuses.has(status)) {
    return { ok: false, message: 'Invalid status value.' };
  }

  const emrSyncBody = asObject(body.emrSync);
  let emrSync;
  if (emrSyncBody) {
    emrSync = {
      connector: safeTrim(emrSyncBody.connector),
      emrSystem: safeTrim(emrSyncBody.emrSystem),
      externalEmrId: safeTrim(emrSyncBody.externalEmrId),
      operation: safeTrim(emrSyncBody.operation),
      status: safeTrim(emrSyncBody.status),
      packetId: safeTrim(emrSyncBody.packetId),
      operatorId: safeTrim(emrSyncBody.operatorId),
      patientId: safeTrim(emrSyncBody.patientId),
      departmentId: safeTrim(emrSyncBody.departmentId),
      message: safeTrim(emrSyncBody.message),
      lastSyncedAt: safeTrim(emrSyncBody.lastSyncedAt),
    };
  }

  return {
    ok: true,
    data: {
      appRunId,
      status: status || undefined,
      notes: safeTrim(body.notes),
      eventNote: safeTrim(body.eventNote),
      actor: safeTrim(body.actor) || 'staff',
      source: safeTrim(body.source) || 'ui',
      emrSync,
    },
  };
}

export function validateWorkspaceSavePayload(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'POST body must be a JSON object.' };
  }

  const clinicName = safeTrim(body.clinicName || body.name);
  if (!clinicName) {
    return { ok: false, message: 'clinicName is required.' };
  }

  return {
    ok: true,
    data: {
      id: safeTrim(body.id),
      clinicName,
      config: asObject(body.config) || {},
      intake: asObject(body.intake) || {},
    },
  };
}

export function validateDiscoverSourcesPayload(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const input = {
    payerName: safeTrim(body.payerName),
    lineOfBusiness: safeTrim(body.lineOfBusiness),
    memberState: safeTrim(body.memberState),
    specialty: safeTrim(body.specialty),
    procedureLabel: safeTrim(body.procedureLabel),
    starterPolicyUrl: safeTrim(body.starterPolicyUrl),
    starterContactUrl: safeTrim(body.starterContactUrl),
    preferLive: body.preferLive !== false,
  };

  if (!input.payerName || !input.procedureLabel) {
    return { ok: false, message: 'Payer name and procedure are required for source discovery.' };
  }

  if (input.starterPolicyUrl && !isValidHttpUrl(input.starterPolicyUrl)) {
    return { ok: false, message: 'starterPolicyUrl must be a valid http(s) URL.' };
  }

  if (input.starterContactUrl && !isValidHttpUrl(input.starterContactUrl)) {
    return { ok: false, message: 'starterContactUrl must be a valid http(s) URL.' };
  }

  return { ok: true, data: input };
}

export function validateBatchIntakeSchema(payload) {
  const body = asObject(payload);
  if (!body) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const sourceRows = Array.isArray(body.sourceRows) ? body.sourceRows : [];
  if (!sourceRows.length && !safeTrim(body.rawText)) {
    return { ok: false, message: 'Provide sourceRows[] or rawText for batch intake.' };
  }

  return {
    ok: true,
    data: {
      batchId: safeTrim(body.batchId),
      filename: safeTrim(body.filename),
      userId: safeTrim(body.userId) || 'staff-operator',
      practiceId: safeTrim(body.practiceId),
      connector: safeTrim(body.connector),
      commit: body.commit === true,
      defaultDepartmentId: safeTrim(body.defaultDepartmentId),
      defaultOrganizationId: safeTrim(body.defaultOrganizationId),
      formatHint: safeTrim(body.formatHint).toLowerCase(),
      rawText: safeTrim(body.rawText),
      sourceRows,
      mapping: asObject(body.mapping) || {},
    },
  };
}

export function validateBatchIntakeRow(row, { index = 0 } = {}) {
  const body = asObject(row) || {};
  const required = {
    patientId: safeTrim(body.patientId),
    memberId: safeTrim(body.memberId),
    procedureCode: safeTrim(body.procedureCode),
    serviceDate: safeTrim(body.serviceDate),
    dob: safeTrim(body.dob),
    diagnosis: safeTrim(body.diagnosis),
    chartSummary: safeTrim(body.chartSummary),
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([field]) => field);

  const data = {
    patientId: required.patientId,
    firstName: safeTrim(body.firstName),
    lastName: safeTrim(body.lastName),
    dob: required.dob,
    memberId: required.memberId,
    procedureCode: required.procedureCode,
    procedureLabel: safeTrim(body.procedureLabel),
    serviceDate: required.serviceDate,
    diagnosis: required.diagnosis,
    chartSummary: required.chartSummary,
    payerName: safeTrim(body.payerName),
    lineOfBusiness: safeTrim(body.lineOfBusiness),
    memberState: safeTrim(body.memberState),
    specialty: safeTrim(body.specialty),
    departmentId: safeTrim(body.departmentId),
    organizationId: safeTrim(body.organizationId),
    practiceId: safeTrim(body.practiceId),
    caseLabel: safeTrim(body.caseLabel),
    policyPageUrl: safeTrim(body.policyPageUrl),
    contactPageUrl: safeTrim(body.contactPageUrl),
    evidenceFiles: safeTrim(body.evidenceFiles),
  };

  return {
    ok: missing.length === 0,
    data,
    errors: missing.map((field) => `Row ${index + 1}: ${field} is required.`),
  };
}

export const BatchIntakeRowSchema = {
  required: ['patientId', 'memberId', 'procedureCode', 'serviceDate', 'dob', 'diagnosis', 'chartSummary'],
  optional: [
    'firstName',
    'lastName',
    'payerName',
    'lineOfBusiness',
    'memberState',
    'specialty',
    'departmentId',
    'organizationId',
    'practiceId',
    'caseLabel',
    'policyPageUrl',
    'contactPageUrl',
    'evidenceFiles',
  ],
};
