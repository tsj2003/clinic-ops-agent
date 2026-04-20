import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePilotCommitmentCreatePayload,
  validatePilotCommitmentPatchPayload,
} from '../lib/pilot-commitment-schemas.js';

test('validatePilotCommitmentCreatePayload accepts valid payload', () => {
  const result = validatePilotCommitmentCreatePayload({
    clinicName: 'Peak Spine Center',
    championName: 'Nora Ops',
    championEmail: 'nora@peakspine.com',
    lane: 'Lumbar MRI',
    status: 'proposal_sent',
    targetStartDate: '2026-04-20',
    baselineDenialRatePercent: '24',
    baselineDaysToAuth: '5',
    weeklyReviewDay: 'Wednesday',
    nextStep: 'Send terms sheet',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'proposal_sent');
  assert.equal(result.data.championEmail, 'nora@peakspine.com');
  assert.equal(result.data.weeklyReviewDay, 'wednesday');
});

test('validatePilotCommitmentCreatePayload rejects malformed body', () => {
  const result = validatePilotCommitmentCreatePayload('not-json-object');
  assert.equal(result.ok, false);
  assert.match(result.message, /JSON object/);
});

test('validatePilotCommitmentCreatePayload rejects invalid email and status', () => {
  const invalidEmail = validatePilotCommitmentCreatePayload({
    clinicName: 'Peak Spine Center',
    championEmail: 'invalid-email',
  });
  assert.equal(invalidEmail.ok, false);
  assert.match(invalidEmail.message, /valid email/);

  const invalidStatus = validatePilotCommitmentCreatePayload({
    clinicName: 'Peak Spine Center',
    championEmail: 'ops@clinic.com',
    status: 'ready_to_close',
  });
  assert.equal(invalidStatus.ok, true);
  assert.equal(invalidStatus.data.status, 'prospect');
});

test('validatePilotCommitmentCreatePayload rejects invalid numeric bounds', () => {
  const invalidDenial = validatePilotCommitmentCreatePayload({
    clinicName: 'Peak Spine Center',
    baselineDenialRatePercent: '140',
  });
  assert.equal(invalidDenial.ok, false);
  assert.match(invalidDenial.message, /between 0 and 100/);

  const invalidDays = validatePilotCommitmentCreatePayload({
    clinicName: 'Peak Spine Center',
    baselineDaysToAuth: '400',
  });
  assert.equal(invalidDays.ok, false);
  assert.match(invalidDays.message, /between 0 and 365/);
});

test('validatePilotCommitmentPatchPayload requires id and writable fields', () => {
  const missingId = validatePilotCommitmentPatchPayload({ status: 'signed_active' });
  assert.equal(missingId.ok, false);
  assert.match(missingId.message, /id is required/);

  const idOnly = validatePilotCommitmentPatchPayload({ id: 'pc-1' });
  assert.equal(idOnly.ok, false);
  assert.match(idOnly.message, /At least one writable field/);
});

test('validatePilotCommitmentPatchPayload rejects malformed patch values', () => {
  const invalidPatch = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    status: 'not-a-stage',
  });
  assert.equal(invalidPatch.ok, false);
  assert.match(invalidPatch.message, /status is invalid/);

  const invalidDate = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    targetStartDate: '2026/04/21',
  });
  assert.equal(invalidDate.ok, false);
  assert.match(invalidDate.message, /YYYY-MM-DD/);
});

test('validatePilotCommitmentPatchPayload accepts valid update', () => {
  const result = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    status: 'signed_active',
    nextStep: 'Kickoff held',
    signedAt: '2026-04-15',
    signedEvidenceUrl: 'https://example.com/signed-loi',
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, 'pc-1');
  assert.equal(result.patch.status, 'signed_active');
});

test('validatePilotCommitmentPatchPayload rejects invalid signed evidence URL', () => {
  const result = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    signedEvidenceUrl: 'not-a-url',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /signedEvidenceUrl/);
});

test('validatePilotCommitmentPatchPayload rejects invalid current KPI bounds', () => {
  const denial = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    currentDenialRatePercent: '120',
  });
  assert.equal(denial.ok, false);
  assert.match(denial.message, /currentDenialRatePercent/);

  const days = validatePilotCommitmentPatchPayload({
    id: 'pc-1',
    currentDaysToAuth: '999',
  });
  assert.equal(days.ok, false);
  assert.match(days.message, /currentDaysToAuth/);
});
