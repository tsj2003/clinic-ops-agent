import test from 'node:test';
import assert from 'node:assert/strict';

import { derivePeerToPeerPayload } from '../lib/automation/peer-to-peer-brief.js';

test('derivePeerToPeerPayload resolves denied cases from run state', () => {
  const payload = derivePeerToPeerPayload(
    {
      operatorPacket: {
        emr_sync: {
          status: 'DENIED',
          payer_reference_id: 'DENIAL-1234',
          message: 'Denied for lack of conservative treatment documentation.',
        },
      },
      caseLifecycle: {
        status: 'escalated',
      },
    },
    {},
  );

  assert.equal(payload.applicable, true);
  assert.equal(payload.denialStatus, 'DENIED');
  assert.equal(payload.payerReferenceId, 'DENIAL-1234');
  assert.match(payload.denialReason, /Denied/);
});

test('derivePeerToPeerPayload respects explicit operator overrides', () => {
  const payload = derivePeerToPeerPayload(
    {
      operatorPacket: {
        emr_sync: {
          status: 'INFO_REQUESTED',
          payer_reference_id: 'OLD-REF',
          message: 'Need more information.',
        },
      },
    },
    {
      denialStatus: 'DENIED',
      denialReason: 'Adverse determination received after appeal.',
      payerReferenceId: 'NEW-REF',
    },
  );

  assert.equal(payload.applicable, true);
  assert.equal(payload.denialStatus, 'DENIED');
  assert.equal(payload.denialReason, 'Adverse determination received after appeal.');
  assert.equal(payload.payerReferenceId, 'NEW-REF');
});
