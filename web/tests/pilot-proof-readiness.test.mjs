import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPilotProofReadiness,
  buildPilotProofReadinessMarkdown,
} from '../lib/pilot-proof-readiness.js';

test('buildPilotProofReadiness marks signed pilots with missing fields as blocked', () => {
  const report = buildPilotProofReadiness({
    commitments: [
      {
        id: 'pilot-1',
        clinicName: 'North Spine',
        lane: 'Spine',
        status: 'signed_active',
        signedEvidenceUrl: '',
        baselineDenialRatePercent: '21',
        baselineDaysToAuth: '5.5',
        currentDenialRatePercent: '',
        currentDaysToAuth: '',
      },
    ],
    runs: [{ status: 'completed' }, { status: 'failed' }],
  });

  assert.equal(report.summary.signedActive, 1);
  assert.equal(report.summary.proofReady, 0);
  assert.equal(report.summary.proofBlocked, 1);
  assert.deepEqual(report.rows[0].missingProofItems, ['signed evidence URL', 'current KPI']);
  assert.equal(report.publishableCaseStudyReady, false);
});

test('buildPilotProofReadiness marks fully populated signed pilot as publishable', () => {
  const report = buildPilotProofReadiness({
    commitments: [
      {
        id: 'pilot-2',
        clinicName: 'Peak Pain',
        lane: 'Pain',
        championName: 'Dr Smith',
        status: 'signed_active',
        signedEvidenceUrl: 'https://example.com/signed.pdf',
        baselineDenialRatePercent: '18',
        baselineDaysToAuth: '6',
        currentDenialRatePercent: '9',
        currentDaysToAuth: '2',
      },
    ],
    runs: [{ status: 'completed' }, { status: 'completed' }],
  });

  assert.equal(report.summary.signedWithEvidence, 1);
  assert.equal(report.summary.baselineReady, 1);
  assert.equal(report.summary.currentReady, 1);
  assert.equal(report.summary.proofReady, 1);
  assert.equal(report.publishableCaseStudyReady, true);
  assert.deepEqual(report.rows[0].missingProofItems, []);
});

test('buildPilotProofReadinessMarkdown states when no pilot is publishable yet', () => {
  const markdown = buildPilotProofReadinessMarkdown(
    buildPilotProofReadiness({
      commitments: [
        {
          clinicName: 'Atlas Ortho',
          lane: 'Ortho',
          status: 'signed_active',
        },
      ],
      runs: [],
    }),
  );

  assert.match(markdown, /No signed pilot is publishable yet/i);
  assert.match(markdown, /Atlas Ortho · Ortho · proof ready: no/i);
});
