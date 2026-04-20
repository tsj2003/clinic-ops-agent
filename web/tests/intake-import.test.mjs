import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBatchIntake } from '../lib/intake-import.js';

test('parseBatchIntake parses CSV intake rows', () => {
  const csv = [
    'payerName,procedureLabel,diagnosis,chartSummary,memberState',
    'Aetna,Lumbar MRI,M54.16,Radicular pain with failed conservative therapy,TX',
  ].join('\n');

  const result = parseBatchIntake(csv, 'csv');
  assert.equal(result.total, 1);
  assert.equal(result.valid, 1);
  assert.equal(result.rows[0].normalized.payerName, 'Aetna');
  assert.equal(result.rows[0].normalized.memberState, 'TX');
});

test('parseBatchIntake parses FHIR bundle style JSON', () => {
  const bundle = {
    resourceType: 'Bundle',
    entry: [
      {
        resource: {
          resourceType: 'ServiceRequest',
          id: 'sr-1',
          code: { text: 'Lumbar MRI' },
          reasonCode: [{ text: 'M54.16 lumbar radiculopathy' }],
          note: [{ text: 'Failed conservative therapy for six weeks.' }],
        },
      },
    ],
  };

  const result = parseBatchIntake(JSON.stringify(bundle), 'json');
  assert.equal(result.total, 1);
  assert.equal(result.valid, 0);
  assert.equal(result.rows[0].normalized.procedureLabel, 'Lumbar MRI');
  assert.equal(result.rows[0].normalized.caseLabel, 'sr-1');
});

test('parseBatchIntake reports invalid rows with missing required fields', () => {
  const payload = JSON.stringify([
    { payerName: 'Aetna', procedureLabel: 'MRI', diagnosis: 'M54.5', chartSummary: 'ok' },
    { payerName: 'UHC', procedureLabel: 'MRI' },
  ]);

  const result = parseBatchIntake(payload, 'json');
  assert.equal(result.total, 2);
  assert.equal(result.valid, 1);
  assert.equal(result.invalid, 1);
  assert.equal(result.rows[1].valid, false);
  assert.match(result.rows[1].missing.join(','), /diagnosis/);
});
