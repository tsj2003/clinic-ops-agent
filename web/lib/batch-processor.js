import { randomUUID } from 'crypto';

import { validateBatchIntakeRow } from './api-schemas.js';
import { buildBatchIdempotencyKey, getFuzzyDictionary, parseBatchInput } from './batch-intake-engine.js';
import { processClinicalRecord } from './ai/fireworks-client.js';
import { redactFreeText } from './privacy.js';
import { listRunsForAnalytics, saveRun } from './run-store.js';

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function buildBatchRun(row, context = {}) {
  const now = new Date().toISOString();
  const caseId = clean(row.caseLabel || `${context.practiceId || 'practice'}-${row.memberId}-${row.procedureCode}-${row.serviceDate}`, 120);
  const redactedSummary = redactFreeText(row.chartSummary || '');

  return {
    appRunId: randomUUID(),
    status: 'completed',
    mode: 'batch_intake',
    startedAt: now,
    completedAt: now,
    workflow: {
      name: 'Specialty Pilot Batch Intake',
      url: '',
      goal: 'Batch ingest referrals into AuthPilot run queue.',
      contactName: '',
      contactUrl: '',
      contactGoal: '',
      caseId,
      procedure: clean(row.procedureLabel || row.procedureCode, 220),
    },
    workspace: {
      id: context.practiceId,
      name: context.practiceId || 'Specialty Pilot',
    },
    intake: {
      patientId: clean(row.patientId, 120),
      firstName: clean(row.firstName, 120),
      lastName: clean(row.lastName, 120),
      dob: clean(row.dob, 40),
      memberId: clean(row.memberId, 120),
      procedureCode: clean(row.procedureCode, 120),
      serviceDate: clean(row.serviceDate, 40),
      diagnosis: clean(row.diagnosis, 240),
      chartSummary: redactedSummary,
      payerName: clean(row.payerName, 120),
      lineOfBusiness: clean(row.lineOfBusiness, 120),
      memberState: clean(row.memberState, 12),
      specialty: clean(row.specialty, 120),
      departmentId: clean(row.departmentId || context.defaultDepartmentId, 120),
      organizationId: clean(row.organizationId || context.defaultOrganizationId, 120),
      practiceId: clean(row.practiceId || context.practiceId, 120),
      caseLabel: caseId,
      policyPageUrl: clean(row.policyPageUrl, 500),
      contactPageUrl: clean(row.contactPageUrl, 500),
      evidenceFiles: clean(row.evidenceFiles, 1200),
      batchId: context.batchId,
      intakeIdempotencyKey: context.idempotencyKey,
    },
    artifact: null,
    proof: {
      runtimeMode: 'batch_intake',
      policy: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
      contact: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
    },
    readiness: {
      ready: true,
      confidence: 90,
      summary: 'Batch referral intake validated and queued for operator sync.',
      supporting_evidence: [`Procedure code: ${clean(row.procedureCode, 120)}`],
      missing_evidence: [],
      policy_name: clean(row.payerName, 120),
    },
    operatorPacket: {
      case_id: caseId,
      payer_name: clean(row.payerName, 120),
      line_of_business: clean(row.lineOfBusiness, 120),
      member_state: clean(row.memberState, 12),
      specialty: clean(row.specialty, 120),
      diagnosis: clean(row.diagnosis, 240),
      procedure: clean(row.procedureLabel || row.procedureCode, 220),
      submission_ready: true,
      recommended_action: 'submit_to_portal',
      supporting_evidence: [`Batch intake via ${context.batchId}`],
      missing_evidence: [],
      submission_checklist: ['Confirm eligibility', 'Sync to EMR', 'Submit in payer portal'],
      policy_url: clean(row.policyPageUrl, 500),
      contact_url: clean(row.contactPageUrl, 500),
      patient_id: clean(row.patientId, 120),
      first_name: clean(row.firstName, 120),
      last_name: clean(row.lastName, 120),
      dob: clean(row.dob, 40),
      member_id: clean(row.memberId, 120),
      procedure_code: clean(row.procedureCode, 120),
      service_date: clean(row.serviceDate, 40),
      department_id: clean(row.departmentId || context.defaultDepartmentId, 120),
      organization_id: clean(row.organizationId || context.defaultOrganizationId, 120),
      practice_id: clean(row.practiceId || context.practiceId, 120),
      source_batch_id: context.batchId,
      source_filename: clean(context.filename, 240),
      intake_idempotency_key: clean(context.idempotencyKey, 80),
      epic_document_reference_seed: {
        organization_id: clean(row.organizationId || context.defaultOrganizationId, 120),
        service_date: clean(row.serviceDate, 40),
      },
      emr_sync: {
        status: 'pending',
        packet_id: caseId,
        operator_id: clean(context.operatorId, 120),
        patient_id: clean(row.patientId, 120),
        department_id: clean(row.departmentId || context.defaultDepartmentId, 120),
      },
    },
    metrics: {
      totalSteps: 0,
      eventCount: 0,
      elapsedSeconds: 0,
    },
    logs: {
      thinking: [],
      execution: [],
    },
  };
}

function collectExistingKeys(runs = [], practiceId = '') {
  const scoped = new Set();
  for (const run of runs) {
    const runPractice = clean(run?.operatorPacket?.practice_id || run?.intake?.practiceId || '', 120);
    if (practiceId && runPractice && runPractice !== practiceId) {
      continue;
    }
    const key = clean(run?.operatorPacket?.intake_idempotency_key || run?.intake?.intakeIdempotencyKey || '', 128);
    if (key) {
      scoped.add(key);
    }
  }
  return scoped;
}

function validateRows({ rows = [], practiceId = '', existingKeys = new Set() }) {
  const validationResults = [];

  for (const row of rows) {
    const normalized = {
      ...row.normalized,
      practiceId: clean(row.normalized.practiceId || practiceId, 120),
    };

    const validation = validateBatchIntakeRow(normalized, { index: row.index });
    const idempotencyKey = buildBatchIdempotencyKey({
      practiceId: normalized.practiceId,
      memberId: normalized.memberId,
      procedureCode: normalized.procedureCode,
      serviceDate: normalized.serviceDate,
    });

    const duplicate = Boolean(idempotencyKey && existingKeys.has(idempotencyKey));
    const errors = [...(validation.errors || [])];
    if (duplicate) {
      errors.push(`Row ${row.index + 1}: DUPLICATE in this practice context.`);
    }

    validationResults.push({
      rowIndex: row.index,
      valid: validation.ok && !duplicate,
      duplicate,
      idempotencyKey,
      normalized: validation.data,
      errors,
      source: row.source,
    });
  }

  return validationResults;
}

async function enrichRowsWithVisionExtraction(rows = []) {
  const enriched = [];

  for (const row of rows) {
    const source = row.source || {};
    const imageBase64 = clean(
      source.clinicalRecordImageBase64 ||
        source.clinical_record_image_base64 ||
        source.recordImageBase64 ||
        source.record_image_base64,
      2_500_000,
    );

    if (!imageBase64) {
      enriched.push(row);
      continue;
    }

    try {
      const extracted = await processClinicalRecord({
        imageBase64,
        specialtyPriorAuthRules: clean(source.specialtyPriorAuthRules || source.specialty_prior_auth_rules, 10_000),
      });
      const extractedRow = extracted?.extraction?.extractedRow || {};

      enriched.push({
        ...row,
        normalized: {
          ...row.normalized,
          diagnosis: row.normalized.diagnosis || extractedRow.diagnosis || extracted.extraction.diagnosisCodes[0] || '',
          procedureCode: row.normalized.procedureCode || extractedRow.procedureCode || extracted.extraction.procedureCodes[0] || '',
          serviceDate: row.normalized.serviceDate || extractedRow.serviceDate || extracted.extraction.serviceDate || '',
          chartSummary: row.normalized.chartSummary || extractedRow.chartSummary || extracted.extraction.clinicalJustificationText || '',
        },
      });
    } catch {
      enriched.push(row);
    }
  }

  return enriched;
}

export async function preflightBatchProcessor({ rawText = '', formatHint = '', mapping = {}, practiceId = '' } = {}) {
  const parsed = parseBatchInput({ rawText, formatHint, mappingOverrides: mapping });
  const enrichedRows = await enrichRowsWithVisionExtraction(parsed.rows);
  const existing = await listRunsForAnalytics(3000);
  const existingKeys = collectExistingKeys(existing.runs || [], clean(practiceId, 120));
  const validationResults = validateRows({
    rows: enrichedRows,
    practiceId: clean(practiceId, 120),
    existingKeys,
  });

  const successCount = validationResults.filter((item) => item.valid).length;
  const errorCount = validationResults.length - successCount;

  return {
    format: parsed.format,
    headers: parsed.headers,
    mapping: parsed.mapping,
    fuzzyDictionary: getFuzzyDictionary(),
    successCount,
    errorCount,
    validationResults,
    sourceRows: enrichedRows.map((row) => row.source),
  };
}

export async function commitBatchProcessor({
  batchId,
  filename,
  operatorId,
  practiceId,
  connector,
  defaultDepartmentId,
  defaultOrganizationId,
  sourceRows = [],
  mapping = {},
} = {}) {
  const rebuiltRows = sourceRows.map((source, index) => ({
    index,
    source,
    normalized: parseBatchInput({ rawText: JSON.stringify([source]), formatHint: 'json', mappingOverrides: mapping }).rows[0].normalized,
  }));
  const enrichedRows = await enrichRowsWithVisionExtraction(rebuiltRows);

  const existing = await listRunsForAnalytics(3000);
  const existingKeys = collectExistingKeys(existing.runs || [], clean(practiceId, 120));
  const validationResults = validateRows({ rows: enrichedRows, practiceId: clean(practiceId, 120), existingKeys });

  const createdRuns = [];
  for (const item of validationResults) {
    if (!item.valid) {
      continue;
    }

    existingKeys.add(item.idempotencyKey);
    const run = buildBatchRun(item.normalized, {
      batchId,
      filename,
      operatorId,
      practiceId,
      connector,
      defaultDepartmentId,
      defaultOrganizationId,
      idempotencyKey: item.idempotencyKey,
    });
    const saved = await saveRun(run);
    createdRuns.push({
      appRunId: saved.run?.appRunId || run.appRunId,
      caseId: saved.run?.operatorPacket?.case_id || run.operatorPacket.case_id,
      idempotencyKey: item.idempotencyKey,
    });
  }

  const successCount = createdRuns.length;
  const errorCount = validationResults.length - successCount;

  return {
    successCount,
    errorCount,
    validationResults,
    createdRuns,
  };
}

export function createBatchId() {
  return randomUUID();
}
