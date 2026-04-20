import test from 'node:test';
import assert from 'node:assert/strict';

import { inferHeaderMapping, listInternalBatchFields } from '../lib/batch-intake-engine.js';

test('batch intake target schema includes identity and DOB fields', () => {
  const fields = listInternalBatchFields();
  assert.ok(fields.includes('patientId'));
  assert.ok(fields.includes('firstName'));
  assert.ok(fields.includes('lastName'));
  assert.ok(fields.includes('dob'));
  assert.ok(fields.includes('memberId'));
  assert.ok(fields.includes('procedureCode'));
  assert.ok(fields.includes('serviceDate'));
  assert.ok(fields.includes('departmentId'));
});

test('fuzzy mapping recognizes common DOB-style clinic headers', () => {
  const mapping = inferHeaderMapping(['PatID', 'FName', 'LName', 'DateOfBirth', 'Member#', 'ProcCode', 'DOS']);
  assert.equal(mapping.patientId, 'PatID');
  assert.equal(mapping.firstName, 'FName');
  assert.equal(mapping.lastName, 'LName');
  assert.equal(mapping.dob, 'DateOfBirth');
  assert.equal(mapping.memberId, 'Member#');
  assert.equal(mapping.procedureCode, 'ProcCode');
  assert.equal(mapping.serviceDate, 'DOS');
});
