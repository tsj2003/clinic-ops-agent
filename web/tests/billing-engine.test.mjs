import fs from 'fs/promises';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRevenueSnapshot,
  triggerRefundWindowCredit,
  triggerRevenueEvent,
} from '../lib/automation/billing-engine.js';

const ledgerPath = path.resolve(process.cwd(), 'lib/data/billing-ledger-unit-test.json');

async function resetLedger() {
  process.env.BILLING_LEDGER_PATH = ledgerPath;
  await fs.rm(ledgerPath, { force: true });
}

test('Simulated Approval triggers a $50 Parasail success charge', async () => {
  await resetLedger();
  process.env.PARASAIL_SUCCESS_CHARGE_USD = '50';

  const result = await triggerRevenueEvent({
    run: {
      appRunId: 'run-billing-1',
      workspace: { id: 'practice-101' },
      intake: { procedureCode: '72148', lineOfBusiness: 'Commercial' },
      operatorPacket: {
        emr_sync: {
          payer_reference_id: 'PAYER-REF-1001',
        },
      },
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-1001', status: 'pending' }),
      },
    },
    yottaClient: {
      track: async () => ({ ok: true }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.charge.chargeAmountUsd, 50);
  assert.equal(result.charge.idempotencyKey, 'PAYER-REF-1001');
});

test('Idempotency guard prevents duplicate billing for same payer_reference_id', async () => {
  await resetLedger();
  process.env.PARASAIL_SUCCESS_CHARGE_USD = '50';

  const first = await triggerRevenueEvent({
    run: {
      appRunId: 'run-billing-2',
      workspace: { id: 'practice-202' },
      intake: { procedureCode: '72148', lineOfBusiness: 'Commercial' },
      operatorPacket: { emr_sync: { payer_reference_id: 'PAYER-REF-2002' } },
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-2002', status: 'pending' }),
      },
    },
  });

  const duplicate = await triggerRevenueEvent({
    run: {
      appRunId: 'run-billing-2b',
      workspace: { id: 'practice-202' },
      intake: { procedureCode: '72148', lineOfBusiness: 'Commercial' },
      operatorPacket: { emr_sync: { payer_reference_id: 'PAYER-REF-2002' } },
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-duplicate', status: 'pending' }),
      },
    },
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.duplicate, true);

  const snapshot = await getRevenueSnapshot({ limit: 10 });
  assert.equal(snapshot.charges.length, 1);
});

test('Refund credit succeeds inside 24-hour window when approval is inaccurate', async () => {
  await resetLedger();
  process.env.PARASAIL_SUCCESS_CHARGE_USD = '50';

  const first = await triggerRevenueEvent({
    run: {
      appRunId: 'run-billing-3',
      workspace: { id: 'practice-303' },
      intake: { procedureCode: '62323', lineOfBusiness: 'Medicare Advantage' },
      operatorPacket: { emr_sync: { payer_reference_id: 'PAYER-REF-3003' } },
    },
    coordinatorStatus: 'APPROVED',
    parasailClient: {
      charges: {
        create: async () => ({ id: 'charge-3003', status: 'pending' }),
      },
    },
  });

  const createdMs = Date.parse(first.charge.createdAt);
  const refund = await triggerRefundWindowCredit({
    runId: 'run-billing-3',
    reason: 'approval_inaccurate',
    nowMs: createdMs + 60 * 60 * 1000,
    parasailClient: {
      credits: {
        create: async () => ({ id: 'refund-3003', status: 'succeeded' }),
      },
    },
  });

  assert.equal(refund.ok, true);
  assert.equal(refund.refund.amountUsd, 50);
});
