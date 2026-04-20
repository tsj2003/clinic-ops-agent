import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTruthFirstCaseStudyMarkdown, summarizeRunWindow } from '../lib/case-study-truth.js';
import { buildPilotProofReadiness } from '../lib/pilot-proof-readiness.js';

test('buildTruthFirstCaseStudyMarkdown blocks publication when proof is incomplete', () => {
  const runSummary = summarizeRunWindow(
    [
      {
        status: 'completed',
        startedAt: new Date().toISOString(),
        readiness: { ready: true },
        roi: {
          estimatedHoursSaved: 2,
          estimatedDaysToAuthSaved: 1.5,
          estimatedRecoveredRevenueUsd: 120,
        },
      },
    ],
    7,
  );
  const proofReport = buildPilotProofReadiness({
    commitments: [
      {
        clinicName: 'Blue Ridge Spine',
        lane: 'Spine',
        status: 'signed_active',
        signedEvidenceUrl: '',
        baselineDenialRatePercent: '20',
        baselineDaysToAuth: '5',
      },
    ],
    runs: [],
  });

  const markdown = buildTruthFirstCaseStudyMarkdown({
    runSummary,
    proofReport,
    generatedAt: '2026-04-17T00:00:00.000Z',
  });

  assert.match(markdown, /Publishable internally: no/i);
  assert.match(markdown, /Blue Ridge Spine: signed evidence URL, current KPI/i);
});

test('buildTruthFirstCaseStudyMarkdown includes verified KPI delta for proof-ready pilot', () => {
  const proofReport = buildPilotProofReadiness({
    commitments: [
      {
        clinicName: 'Summit Neuro',
        lane: 'Neuro',
        championName: 'Jamie Lee',
        status: 'signed_active',
        signedEvidenceUrl: 'https://example.com/signed',
        signedAt: '2026-04-01',
        targetStartDate: '2026-04-10',
        baselineDenialRatePercent: '22',
        baselineDaysToAuth: '7',
        currentDenialRatePercent: '10',
        currentDaysToAuth: '3',
      },
    ],
    runs: [],
  });

  const markdown = buildTruthFirstCaseStudyMarkdown({
    runSummary: { days: 7, totalRuns: 0, completedRuns: 0, successRate: 0, readinessRate: 0, totalHoursSaved: 0, avgDaysSaved: 0, totalRecovered: 0, topFailureCode: 'none' },
    proofReport,
    generatedAt: '2026-04-17T00:00:00.000Z',
  });

  assert.match(markdown, /Publishable internally: yes/i);
  assert.match(markdown, /Clinic: Summit Neuro/i);
  assert.match(markdown, /Denial-rate delta: 12.00%/i);
  assert.match(markdown, /Days-to-auth delta: 4.00/i);
});
