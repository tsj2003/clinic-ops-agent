import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBatchIdempotencyKey,
  inferHeaderMapping,
  mapRecordToAuthPilotSchema,
  parseBatchInput,
} from '../lib/batch-intake-engine.js';

test('inferHeaderMapping maps common clinic headers into AuthPilot fields', () => {
  const mapping = inferHeaderMapping(['PatID', 'Member#', 'ProcCode', 'DOS', 'Dx', 'Summary', 'DepartmentID']);

  assert.equal(mapping.patientId, 'PatID');
  assert.equal(mapping.memberId, 'Member#');
  assert.equal(mapping.procedureCode, 'ProcCode');
  assert.equal(mapping.serviceDate, 'DOS');
  assert.equal(mapping.diagnosis, 'Dx');
  assert.equal(mapping.chartSummary, 'Summary');
  assert.equal(mapping.departmentId, 'DepartmentID');
});

test('mapRecordToAuthPilotSchema normalizes mapped row fields', () => {
  const row = {
    PatID: 'P-100',
    'Member#': 'M-100',
    ProcCode: '72148',
    DOS: '2026-04-15',
    Dx: 'M54.16',
    Summary: 'Persistent lumbar radiculopathy after conservative therapy.',
  };

  const normalized = mapRecordToAuthPilotSchema(row, {
    patientId: 'PatID',
    memberId: 'Member#',
    procedureCode: 'ProcCode',
    serviceDate: 'DOS',
    diagnosis: 'Dx',
    chartSummary: 'Summary',
  });

  assert.equal(normalized.patientId, 'P-100');
  assert.equal(normalized.memberId, 'M-100');
  assert.equal(normalized.procedureCode, '72148');
  assert.equal(normalized.serviceDate, '2026-04-15');
  assert.equal(normalized.diagnosis, 'M54.16');
});

test('parseBatchInput parses CSV and returns normalized rows with mapping', () => {
  const csv = [
    'PatID,Member#,ProcCode,DOS,Dx,Summary,DepartmentID',
    'P-100,M-100,72148,2026-04-15,M54.16,Failed conservative therapy,DEPT-9',
  ].join('\n');

  const parsed = parseBatchInput({ rawText: csv, formatHint: 'csv' });

  assert.equal(parsed.format, 'csv');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].normalized.memberId, 'M-100');
  assert.equal(parsed.rows[0].normalized.departmentId, 'DEPT-9');
});

test('buildBatchIdempotencyKey is stable for same practice/member/procedure/date', () => {
  const a = buildBatchIdempotencyKey({
    practiceId: 'practice-a',
    memberId: 'M-100',
    procedureCode: '72148',
    serviceDate: '2026-04-15',
  });
  const b = buildBatchIdempotencyKey({
    practiceId: 'practice-a',
    memberId: 'M-100',
    procedureCode: '72148',
    serviceDate: '2026-04-15',
  });
  const c = buildBatchIdempotencyKey({
    practiceId: 'practice-b',
    memberId: 'M-100',
    procedureCode: '72148',
    serviceDate: '2026-04-15',
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
});
