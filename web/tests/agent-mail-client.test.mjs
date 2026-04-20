import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzePayerReplyWithFireworks,
  buildRunInboxAddress,
  extractRunIdFromEmailAddress,
  normalizeInboundWebhookPayload,
} from '../lib/automation/agent-mail.js';

function mockJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('buildRunInboxAddress and extractRunIdFromEmailAddress are deterministic', () => {
  const email = buildRunInboxAddress('RUN-ABC-123');

  assert.equal(email, 'auth-run-abc-123@agentmail.to');
  assert.equal(extractRunIdFromEmailAddress(email), 'run-abc-123');
});

test('normalizeInboundWebhookPayload resolves run context from recipient email', () => {
  const payload = normalizeInboundWebhookPayload({
    data: {
      type: 'message.received',
      message: {
        inboxId: 'inbox_001',
        messageId: 'msg_001',
        subject: 'Additional Information Needed',
        extractedText: 'Please provide PT notes and creatinine results. Ref: EMR-4455.',
        from: [{ email: 'payer@uhc.com' }],
        to: [{ email: 'auth-9f6208d0-6fd8-4ab5-9a62-90d31d1c2c6a@agentmail.to' }],
      },
    },
  });

  assert.equal(payload.inboxId, 'inbox_001');
  assert.equal(payload.messageId, 'msg_001');
  assert.equal(payload.runId, '9f6208d0-6fd8-4ab5-9a62-90d31d1c2c6a');
  assert.equal(payload.from, 'payer@uhc.com');
});

test('analyzePayerReplyWithFireworks extracts requested document and EMR reference', async () => {
  const previousFetch = global.fetch;
  const previousApiKey = process.env.FIREWORKS_API_KEY;

  process.env.FIREWORKS_API_KEY = 'fw_test_reply_key';

  global.fetch = async () =>
    mockJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              requestedDocument: 'Physical therapy progress notes',
              emrReferenceNumber: 'EMR-4455',
              urgency: 'high',
              autoReplyDraft:
                'Attached are the requested PT notes. Patient SSN 123-45-6789 appears in internal records and is redacted in this response.',
            }),
          },
        },
      ],
    });

  try {
    const analyzed = await analyzePayerReplyWithFireworks({
      subject: 'Need Additional Info',
      text: 'Please send PT notes. Reference EMR-4455.',
      from: 'payer@uhc.com',
      runId: 'run-100',
    });

    assert.equal(analyzed.requestedDocument, 'Physical therapy progress notes');
    assert.equal(analyzed.emrReferenceNumber, 'EMR-4455');
    assert.match(analyzed.autoReplyDraft, /\[REDACTED_SSN\]/);
  } finally {
    global.fetch = previousFetch;
    if (typeof previousApiKey === 'string') {
      process.env.FIREWORKS_API_KEY = previousApiKey;
    } else {
      delete process.env.FIREWORKS_API_KEY;
    }
  }
});
