import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceIvrStateMachine,
  buildVoiceStatusSystemPrompt,
  createIvrStateMachine,
  mapVoiceOutcomeToEmrStatus,
  redactVoiceTranscript,
  shouldTriggerVoiceCoordinatorCall,
} from '../lib/automation/voice-agent.js';

test('buildVoiceStatusSystemPrompt includes clinic context and auth metadata', () => {
  const prompt = buildVoiceStatusSystemPrompt({
    clinicName: 'Peak Spine Center',
    patientLastName: 'Johnson',
    npi: '1234567890',
    authId: 'AUTH-7788',
  });

  assert.match(prompt, /Peak Spine Center/);
  assert.match(prompt, /Johnson/);
  assert.match(prompt, /1234567890/);
  assert.match(prompt, /AUTH-7788/);
});

test('advanceIvrStateMachine emits DTMF actions from transcript keywords', () => {
  const start = createIvrStateMachine();
  const step1 = advanceIvrStateMachine(start, 'Press 1 for Authorizations and benefits.');
  assert.equal(step1.action?.tone, '1');
  assert.equal(step1.currentNode, 'auth_menu');

  const step2 = advanceIvrStateMachine(step1, 'For status check of existing authorization, press 2.');
  assert.equal(step2.action?.tone, '2');
  assert.equal(step2.currentNode, 'status_menu');
});

test('shouldTriggerVoiceCoordinatorCall requires submitted status older than 48 hours', () => {
  const now = Date.parse('2026-04-15T12:00:00.000Z');

  const eligible = shouldTriggerVoiceCoordinatorCall(
    {
      caseLifecycle: {
        status: 'submitted',
        updatedAt: '2026-04-13T10:00:00.000Z',
      },
    },
    now,
  );

  const notEligible = shouldTriggerVoiceCoordinatorCall(
    {
      caseLifecycle: {
        status: 'submitted',
        updatedAt: '2026-04-14T16:00:00.000Z',
      },
    },
    now,
  );

  assert.equal(eligible, true);
  assert.equal(notEligible, false);
});

test('redactVoiceTranscript redacts PHI and run-specific names and identifiers', () => {
  const redacted = redactVoiceTranscript(
    'Patient Johnson member id M-445566 with SSN 123-45-6789 called Peak Spine Center.',
    {
      run: {
        intake: {
          lastName: 'Johnson',
          memberId: 'M-445566',
        },
      },
      clinicName: 'Peak Spine Center',
    },
  );

  assert.equal(redacted.includes('Johnson'), false);
  assert.equal(redacted.includes('M-445566'), false);
  assert.equal(redacted.includes('123-45-6789'), false);
  assert.match(redacted, /REDACTED_SSN/);
});

test('mapVoiceOutcomeToEmrStatus maps final statuses to EMR outcomes', () => {
  assert.equal(mapVoiceOutcomeToEmrStatus('approved').emrStatus, 'EMR_TASK_APPROVED');
  assert.equal(mapVoiceOutcomeToEmrStatus('denied').emrStatus, 'EMR_TASK_DENIED');
  assert.equal(mapVoiceOutcomeToEmrStatus('pending review').emrStatus, 'INFO_SUBMITTED_WAITING');
});
