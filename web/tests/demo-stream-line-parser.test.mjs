import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRunnerLine } from '../lib/demo-stream-line-parser.js';

test('parseRunnerLine attaches run context to config events', () => {
  const payload = parseRunnerLine('{"type":"config","mode":"live"}', {
    appRunId: 'run-1',
    workspaceId: 'ws-1',
    workspaceName: 'Clinic A',
  });

  assert.equal(payload.type, 'config');
  assert.equal(payload.appRunId, 'run-1');
  assert.equal(payload.workspaceId, 'ws-1');
  assert.equal(payload.workspaceName, 'Clinic A');
});

test('parseRunnerLine redacts PHI-like values in JSON log events', () => {
  const payload = parseRunnerLine(
    JSON.stringify({
      type: 'log',
      channel: 'execution',
      level: 'info',
      text: 'Call Jane at 415-555-1212 and email jane@example.com',
    }),
  );

  assert.equal(payload.type, 'log');
  assert.match(payload.text, /REDACTED_PHONE/);
  assert.match(payload.text, /REDACTED_EMAIL/);
});

test('parseRunnerLine converts raw text to fallback log with redaction', () => {
  const payload = parseRunnerLine('MRN: A1234567 contact me@clinic.org', {
    now: () => '12:00:00',
  });

  assert.equal(payload.type, 'log');
  assert.equal(payload.channel, 'execution');
  assert.equal(payload.level, 'info');
  assert.equal(payload.time, '12:00:00');
  assert.match(payload.text, /REDACTED_IDENTIFIER/);
  assert.match(payload.text, /REDACTED_EMAIL/);
});
