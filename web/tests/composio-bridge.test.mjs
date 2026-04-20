import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetComposioDispatchCache,
  dispatchExceptionAction,
  dispatchAuthOutcome,
} from '../lib/automation/composio-bridge.js';

const DYNAMIC_REGISTRY_FIXTURE = [
  {
    app: 'SLACK',
    action: 'SLACK_SEND_MESSAGE',
    description: 'Send a message to a Slack channel',
  },
  {
    app: 'GOOGLE_SHEETS',
    action: 'GOOGLE_SHEETS_UPDATE_ROW',
    description: 'Update a row in Google Sheets',
  },
  {
    app: 'GMAIL',
    action: 'GMAIL_SEND_EMAIL',
    description: 'Send an email',
  },
];

test('dispatchAuthOutcome sends redacted urgent Slack alert for INFO_REQUESTED', async () => {
  _resetComposioDispatchCache();

  const result = await dispatchAuthOutcome({
    run: {
      appRunId: 'run-composio-1',
    },
    authStatus: 'INFO_REQUESTED',
    referenceId: 'REF-9001',
    clinicalGap: 'Need SSN 123-45-6789 and DOB 01/02/1980 before review',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true, id: 'exec-1' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].channel, 'slack');
  assert.equal(result.results[0].params.client_id, 'run-composio-1');
  assert.match(result.results[0].params.text, /INFO_REQUESTED/);
  assert.match(result.results[0].params.text, /REF-9001/);
  assert.match(result.results[0].params.text, /REDACTED_SSN/);
  assert.match(result.results[0].params.text, /REDACTED_DOB/);
});

test('dispatchAuthOutcome sends billing + scheduling actions for APPROVED', async () => {
  _resetComposioDispatchCache();

  const result = await dispatchAuthOutcome({
    run: {
      appRunId: 'run-composio-2',
      intake: {
        patientEmail: 'patient@example.com',
      },
    },
    authStatus: 'APPROVED',
    referenceId: 'REF-APPROVED-1',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);

  const channels = result.results.map((item) => item.channel).sort();
  assert.deepEqual(channels, ['billing', 'scheduling']);

  const billing = result.results.find((item) => item.channel === 'billing');
  const scheduling = result.results.find((item) => item.channel === 'scheduling');

  assert.equal(billing.params.reference_id, 'REF-APPROVED-1');
  assert.equal(billing.params.status, 'APPROVED');
  assert.equal(scheduling.params.to, 'patient@example.com');
  assert.equal(result.results.every((item) => item.params.client_id === 'run-composio-2'), true);
});

test('dispatchAuthOutcome is idempotent for same runId + status', async () => {
  _resetComposioDispatchCache();

  const first = await dispatchAuthOutcome({
    run: { appRunId: 'run-composio-3' },
    authStatus: 'DENIED',
    referenceId: 'REF-DENIED-1',
    clinicalGap: 'conservative care notes missing',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true }),
  });

  const duplicate = await dispatchAuthOutcome({
    run: { appRunId: 'run-composio-3' },
    authStatus: 'DENIED',
    referenceId: 'REF-DENIED-1',
    clinicalGap: 'conservative care notes missing',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true }),
  });

  assert.equal(first.skipped, false);
  assert.equal(first.results.length >= 1, true);
  assert.equal(duplicate.skipped, true);
  assert.match(duplicate.reason, /Duplicate outcome dispatch prevented/i);
});

test('dispatchExceptionAction sends one-click Slack action with client_id and redaction', async () => {
  _resetComposioDispatchCache();

  const result = await dispatchExceptionAction({
    run: {
      appRunId: 'run-exception-1',
      operatorPacket: {
        emr_sync: {
          status: 'PORTAL_ACTION_REQUIRED',
        },
      },
    },
    actionType: 'nudge_doctor_slack',
    note: 'Please review missing DOB 04/05/1989 before submission.',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true, id: 'exc-1' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.result.channel, 'slack');
  assert.equal(result.result.params.client_id, 'run-exception-1');
  assert.match(result.result.params.text, /REDACTED_DOB/);
});

test('dispatchExceptionAction is idempotent for same run/action', async () => {
  _resetComposioDispatchCache();

  const first = await dispatchExceptionAction({
    run: { appRunId: 'run-exception-2' },
    actionType: 'retry_with_healed_selector',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true }),
  });

  const duplicate = await dispatchExceptionAction({
    run: { appRunId: 'run-exception-2' },
    actionType: 'retry_with_healed_selector',
    registry: DYNAMIC_REGISTRY_FIXTURE,
    execute: async () => ({ ok: true }),
  });

  assert.equal(first.skipped, false);
  assert.equal(duplicate.skipped, true);
  assert.match(duplicate.reason, /Duplicate exception action prevented/i);
});
