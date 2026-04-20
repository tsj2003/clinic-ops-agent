import test from 'node:test';
import assert from 'node:assert/strict';

import { runWithTimeout } from '../lib/automation/timeout-guard.js';

test('runWithTimeout enforces preflight SLA timeout for hanging work', async () => {
  const startedAt = Date.now();

  await assert.rejects(
    () =>
      runWithTimeout(
        async () =>
          new Promise(() => {
            // simulate hanging retrieval/audit call path
          }),
        15,
        { message: 'Preflight rule audit timed out (>5s SLA).' },
      ),
    /timed out/i,
  );

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 120, `Timeout should fail fast, observed ${elapsedMs}ms`);
});

test('runWithTimeout returns result when work completes under SLA', async () => {
  const result = await runWithTimeout(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true };
    },
    100,
    { message: 'Preflight rule audit timed out (>5s SLA).' },
  );

  assert.equal(result.ok, true);
});
