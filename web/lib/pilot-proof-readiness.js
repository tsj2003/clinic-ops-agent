function clean(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function asNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasSignedEvidence(commitment = {}) {
  return Boolean(clean(commitment?.signedEvidenceUrl, 1200));
}

function hasBaseline(commitment = {}) {
  return Number.isFinite(asNumber(commitment?.baselineDenialRatePercent)) && Number.isFinite(asNumber(commitment?.baselineDaysToAuth));
}

function hasCurrent(commitment = {}) {
  return Number.isFinite(asNumber(commitment?.currentDenialRatePercent)) && Number.isFinite(asNumber(commitment?.currentDaysToAuth));
}

export function buildPilotProofReadiness({ commitments = [], runs = [] }) {
  const safeCommitments = Array.isArray(commitments) ? commitments : [];
  const safeRuns = Array.isArray(runs) ? runs : [];
  const signedActive = safeCommitments.filter((item) => item?.status === 'signed_active');

  const rows = signedActive.map((commitment) => {
    const missing = [];
    if (!hasSignedEvidence(commitment)) {
      missing.push('signed evidence URL');
    }
    if (!hasBaseline(commitment)) {
      missing.push('baseline KPI');
    }
    if (!hasCurrent(commitment)) {
      missing.push('current KPI');
    }

    return {
      id: clean(commitment?.id, 120),
      clinicName: clean(commitment?.clinicName, 120) || 'Unknown clinic',
      lane: clean(commitment?.lane, 120) || 'Unspecified lane',
      championName: clean(commitment?.championName, 120),
      status: clean(commitment?.status, 60) || 'signed_active',
      signedAt: clean(commitment?.signedAt, 40),
      targetStartDate: clean(commitment?.targetStartDate, 40),
      signedEvidenceUrl: clean(commitment?.signedEvidenceUrl, 1200),
      baselineDenialRatePercent: asNumber(commitment?.baselineDenialRatePercent),
      baselineDaysToAuth: asNumber(commitment?.baselineDaysToAuth),
      currentDenialRatePercent: asNumber(commitment?.currentDenialRatePercent),
      currentDaysToAuth: asNumber(commitment?.currentDaysToAuth),
      proofReady: missing.length === 0,
      missingProofItems: missing,
    };
  });

  const proofReadyRows = rows.filter((item) => item.proofReady);
  const baselineReady = rows.filter((item) => item.baselineDenialRatePercent !== null && item.baselineDaysToAuth !== null);
  const currentReady = rows.filter((item) => item.currentDenialRatePercent !== null && item.currentDaysToAuth !== null);
  const runsCompleted = safeRuns.filter((run) => run?.status === 'completed').length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      commitmentsTotal: safeCommitments.length,
      signedActive: rows.length,
      signedWithEvidence: rows.filter((item) => item.signedEvidenceUrl).length,
      baselineReady: baselineReady.length,
      currentReady: currentReady.length,
      proofReady: proofReadyRows.length,
      proofBlocked: rows.length - proofReadyRows.length,
      completedRuns: runsCompleted,
    },
    rows,
    publishableCaseStudyReady: proofReadyRows.length > 0,
  };
}

export function buildPilotProofReadinessMarkdown(report = {}) {
  const summary = report?.summary || {};
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const publishable = report?.publishableCaseStudyReady === true;

  const proofRows = rows.length
    ? rows.map((row) => {
        const missing = row.missingProofItems?.length ? row.missingProofItems.join(', ') : 'none';
        return `- ${row.clinicName} · ${row.lane} · proof ready: ${row.proofReady ? 'yes' : 'no'} · missing: ${missing}`;
      })
    : ['- none'];

  return [
    '# Pilot Proof Readiness — AuthPilot AI',
    '',
    `Generated: ${clean(report?.generatedAt, 80)}`,
    '',
    '## Summary',
    `- Total commitments: ${summary.commitmentsTotal || 0}`,
    `- Signed active: ${summary.signedActive || 0}`,
    `- Signed with evidence URL: ${summary.signedWithEvidence || 0}`,
    `- Baseline KPI ready: ${summary.baselineReady || 0}`,
    `- Current KPI ready: ${summary.currentReady || 0}`,
    `- Proof ready: ${summary.proofReady || 0}`,
    `- Proof blocked: ${summary.proofBlocked || 0}`,
    `- Completed runs available: ${summary.completedRuns || 0}`,
    '',
    '## Publishability',
    publishable
      ? '- At least one signed pilot has enough evidence for an external proof draft.'
      : '- No signed pilot is publishable yet. Missing signed evidence and/or KPI fields still block truthful external proof.',
    '',
    '## Signed Pilot Detail',
    ...proofRows,
    '',
  ].join('\n');
}
