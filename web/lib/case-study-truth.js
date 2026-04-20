function metricValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clean(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function summarizeRunWindow(runs = [], days = 7) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const scoped = (Array.isArray(runs) ? runs : []).filter((run) => {
    const ts = Date.parse(run?.startedAt || '');
    return Number.isFinite(ts) && ts >= cutoffMs;
  });
  const completed = scoped.filter((run) => run?.status === 'completed');

  const successRate = scoped.length ? Math.round((completed.length / scoped.length) * 100) : 0;
  const readinessRate = completed.length
    ? Math.round((completed.filter((run) => run?.readiness?.ready).length / completed.length) * 100)
    : 0;

  const totalHoursSaved = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedHoursSaved) || 0), 0);
  const totalRecovered = completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedRecoveredRevenueUsd) || 0), 0);
  const avgDaysSaved = completed.length
    ? completed.reduce((sum, run) => sum + (Number(run?.roi?.estimatedDaysToAuthSaved) || 0), 0) / completed.length
    : 0;

  const topFailure = scoped
    .map((run) => run?.failure?.code)
    .filter(Boolean)
    .reduce((acc, code) => {
      acc.set(code, (acc.get(code) || 0) + 1);
      return acc;
    }, new Map());

  const topFailureCode = [...topFailure.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

  return {
    days,
    totalRuns: scoped.length,
    completedRuns: completed.length,
    successRate,
    readinessRate,
    totalHoursSaved: Number(totalHoursSaved.toFixed(2)),
    avgDaysSaved: Number(avgDaysSaved.toFixed(2)),
    totalRecovered: Number(totalRecovered.toFixed(2)),
    topFailureCode,
  };
}

function selectFeaturedPilot(proofReport = {}) {
  const rows = Array.isArray(proofReport?.rows) ? proofReport.rows : [];
  return rows.find((row) => row?.proofReady) || null;
}

function formatDelta(baseline, current, suffix = '') {
  if (baseline === null || current === null) {
    return 'N/A';
  }
  return `${(baseline - current).toFixed(2)}${suffix}`;
}

export function buildTruthFirstCaseStudyMarkdown({ runSummary = {}, proofReport = {}, generatedAt = '' } = {}) {
  const featuredPilot = selectFeaturedPilot(proofReport);
  const publishable = proofReport?.publishableCaseStudyReady === true && Boolean(featuredPilot);
  const blockedRows = (Array.isArray(proofReport?.rows) ? proofReport.rows : []).filter((row) => !row?.proofReady);
  const blockedLines = blockedRows.length
    ? blockedRows.map((row) => {
        const missing = row?.missingProofItems?.length ? row.missingProofItems.join(', ') : 'unspecified proof fields';
        return `- ${clean(row?.clinicName, 120)}: ${missing}`;
      })
    : ['- No signed-active pilot has complete proof fields yet.'];

  const featuredLines = featuredPilot
    ? [
        '## Featured Signed Pilot',
        `- Clinic: ${clean(featuredPilot.clinicName, 120)}`,
        `- Lane: ${clean(featuredPilot.lane, 120) || 'Unspecified lane'}`,
        `- Champion: ${clean(featuredPilot.championName, 120) || 'Not recorded'}`,
        `- Signed evidence URL: ${clean(featuredPilot.signedEvidenceUrl, 1200) || 'Missing'}`,
        `- Signed at: ${clean(featuredPilot.signedAt, 40) || 'Not recorded'}`,
        `- Target start date: ${clean(featuredPilot.targetStartDate, 40) || 'Not recorded'}`,
        '',
        '## Verified Pilot KPI Delta',
        `- Baseline denial rate: ${featuredPilot.baselineDenialRatePercent ?? 'N/A'}%`,
        `- Current denial rate: ${featuredPilot.currentDenialRatePercent ?? 'N/A'}%`,
        `- Denial-rate delta: ${formatDelta(featuredPilot.baselineDenialRatePercent, featuredPilot.currentDenialRatePercent, '%')}`,
        `- Baseline days to auth: ${featuredPilot.baselineDaysToAuth ?? 'N/A'}`,
        `- Current days to auth: ${featuredPilot.currentDaysToAuth ?? 'N/A'}`,
        `- Days-to-auth delta: ${formatDelta(featuredPilot.baselineDaysToAuth, featuredPilot.currentDaysToAuth)}`,
        '',
      ]
    : [];

  return [
    '# Case Study Draft — AuthPilot AI',
    '',
    `Generated: ${clean(generatedAt, 80)}`,
    '',
    '## Publication Status',
    publishable
      ? '- Publishable internally: yes. At least one signed-active pilot has signed evidence plus baseline/current KPI fields.'
      : '- Publishable internally: no. This draft is blocked until a signed-active pilot has a signed evidence URL and both baseline/current KPI fields.',
    '',
    ...featuredLines,
    '## Operational Context',
    `- Reporting window: last ${metricValue(runSummary?.days) ?? 0} day(s)`,
    `- Total runs: ${metricValue(runSummary?.totalRuns) ?? 0}`,
    `- Completed runs: ${metricValue(runSummary?.completedRuns) ?? 0}`,
    `- Success rate: ${metricValue(runSummary?.successRate) ?? 0}%`,
    `- Readiness rate: ${metricValue(runSummary?.readinessRate) ?? 0}%`,
    `- Estimated hours saved: ${metricValue(runSummary?.totalHoursSaved) ?? 0}`,
    `- Estimated average days-to-auth saved from completed runs: ${metricValue(runSummary?.avgDaysSaved) ?? 0}`,
    `- Estimated recovered revenue from completed runs: $${metricValue(runSummary?.totalRecovered) ?? 0}`,
    `- Most frequent failure code: ${clean(runSummary?.topFailureCode, 120) || 'none'}`,
    '',
    '## Blocking Gaps',
    ...(publishable ? ['- None for the featured signed pilot. Continue validating external quote and source artifact before publication.'] : blockedLines),
    '',
    '## Truth Guardrails',
    '- Do not add customer quotes unless they are stored separately and attributed to a real operator.',
    '- Do not claim external KPI proof beyond the signed pilot rows captured in the proof-readiness report.',
    '- Treat run-level ROI metrics as operating context, not customer-validated proof, unless matched back to the signed pilot record.',
    '',
  ].join('\n');
}
