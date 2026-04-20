import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBatchIntake } from '../lib/intake-import.js';
import { buildEpicDocumentReference, validateDocumentReferenceSchema } from '../lib/fhir-document-reference.js';
import { redactFreeText } from '../lib/privacy.js';

function buildMessyRows(count = 10) {
  return Array.from({ length: count }).map((_, index) => ({
    payerName: index % 2 === 0 ? 'Aetna' : 'UnitedHealthcare',
    procedureLabel: 'Lumbar MRI',
    diagnosis: 'M54.16',
    memberState: 'TX',
    chartSummary:
      `Patient note ${index + 1}: SSN 123-45-6789, DOB 01/22/1980, Member ID ABC12345, NPI 1234567890. ` +
      'Failed conservative therapy with persistent radicular pain.',
  }));
}

test('synthetic stress test: 10 messy records are ingested and redacted', () => {
  const payload = JSON.stringify(buildMessyRows(10));
  const parsed = parseBatchIntake(payload, 'json');

  assert.equal(parsed.total, 10);
  assert.equal(parsed.valid, 10);

  for (const row of parsed.rows) {
    const redacted = redactFreeText(row.normalized.chartSummary);
    assert.equal(/123-45-6789/.test(redacted), false);
    assert.equal(/01\/22\/1980/.test(redacted), false);
    assert.equal(/ABC12345/.test(redacted), false);
    assert.equal(/\b1234567890\b/.test(redacted), false);
  }
});

test('submission-prep packet maps to FHIR DocumentReference schema', () => {
  const packet = {
    case_id: 'CASE-STRESS-001',
    payer_name: 'Aetna',
    procedure: 'Lumbar MRI',
    diagnosis: 'M54.16',
    submission_ready: true,
    recommended_action: 'submit_to_portal',
    readiness_summary: 'Ready for portal submission after checklist review.',
  };

  const docRef = buildEpicDocumentReference(packet);
  const validation = validateDocumentReferenceSchema(docRef);

  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.equal(docRef.resourceType, 'DocumentReference');
  assert.ok(docRef.content[0].attachment.data.length > 0);
});
