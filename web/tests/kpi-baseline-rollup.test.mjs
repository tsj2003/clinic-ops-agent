import test from 'node:test';
import assert from 'node:assert/strict';

import { buildKpiBaselineOutcomeRollup } from '../lib/kpi-baseline-rollup.js';

test('buildKpiBaselineOutcomeRollup computes baseline/current/delta rows', () => {
  const rollup = buildKpiBaselineOutcomeRollup({
    commitments: [
      {
        status: 'signed_active',
        baselineDenialRatePercent: '20',
        baselineDaysToAuth: '6',
      },
      {
        status: 'proposal_sent',
        baselineDenialRatePercent: '30',
        baselineDaysToAuth: '4',
      },
    ],
    runs: [
      {
        status: 'completed',
        roi: {
          estimatedDenialRiskReductionPercent: 10,
          estimatedDaysToAuthSaved: 2,
          estimatedHoursSaved: 1.5,
          estimatedRecoveredRevenueUsd: 120,
        },
      },
      {
        status: 'completed',
        roi: {
          estimatedDenialRiskReductionPercent: 20,
          estimatedDaysToAuthSaved: 1,
          estimatedHoursSaved: 0.5,
          estimatedRecoveredRevenueUsd: 80,
        },
      },
    ],
  });

  assert.equal(Array.isArray(rollup.rows), true);
  assert.equal(rollup.rows.length, 5);
  assert.equal(rollup.sample.signedPaidPilots, 1);

  const denialRow = rollup.rows.find((row) => row.metric === 'Denial rate (%)');
  assert.equal(denialRow.baselineValue, '25%');
  assert.equal(denialRow.currentValue, '10%');
  assert.equal(denialRow.deltaValue, '-15 pp');

  const pilotsRow = rollup.rows.find((row) => row.metric === 'Paid pilots (#)');
  assert.equal(pilotsRow.currentValue, '1');
  assert.equal(pilotsRow.deltaValue, '+1');
});

test('buildKpiBaselineOutcomeRollup handles empty data safely', () => {
  const rollup = buildKpiBaselineOutcomeRollup({ commitments: [], runs: [] });
  const denialRow = rollup.rows.find((row) => row.metric === 'Denial rate (%)');
  const hoursRow = rollup.rows.find((row) => row.metric === 'Hours saved / case');

  assert.equal(rollup.sample.signedPaidPilots, 0);
  assert.equal(denialRow.baselineValue, 'N/A');
  assert.equal(denialRow.currentValue, 'N/A');
  assert.equal(hoursRow.currentValue, 'N/A');
});
