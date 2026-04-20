import fs from 'fs/promises';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getRevenueSnapshot, triggerRevenueEvent } from '../lib/automation/billing-engine.js';

const ledgerPath = path.resolve(process.cwd(), 'lib/data/billing-ledger-hard-audit.json');

async function resetLedger() {
  process.env.BILLING_LEDGER_PATH = ledgerPath;
  await fs.rm(ledgerPath, { force: true });
}

test('Hard audit: double approve only charges once via payer_reference_id idempotency key', async () => {
  await resetLedger();

  const baseRun = {
    workspace: { id: 'practice-hard-audit' },
    intake: { procedureCode: '72148', lineOfBusiness: 'Commercial' },
    operatorPacket: {
      emr_sync: {
        payer_reference_id: 'PAYER-REF-HARD-001',
      },
    },
  };

  const first = await triggerRevenueEvent({
    run: {
      ...baseRun,
      appRunId: 'run-hard-audit-1',
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-hard-1', status: 'pending' }),
      },
    },
  });

  const second = await triggerRevenueEvent({
    run: {
      ...baseRun,
      appRunId: 'run-hard-audit-2',
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-hard-2-should-not-create', status: 'pending' }),
      },
    },
  });

  const snapshot = await getRevenueSnapshot({ limit: 10 });

  assert.equal(first.ok, true);
  assert.equal(first.charge.idempotencyKey, 'PAYER-REF-HARD-001');
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(snapshot.charges.length, 1);
  assert.equal(snapshot.charges[0].payerReferenceId, 'PAYER-REF-HARD-001');
});
