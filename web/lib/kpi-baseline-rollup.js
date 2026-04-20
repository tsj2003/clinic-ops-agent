function asNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function calcDelta(baseline, current, suffix = '') {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) {
    return 'N/A';
  }

  const delta = current - baseline;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${round(delta, 2)}${suffix}`;
}

function formatValue(value, suffix = '') {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return `${round(value, 2)}${suffix}`;
}

export function buildKpiBaselineOutcomeRollup({ runs = [], commitments = [] }) {
  const completedRuns = runs.filter((run) => run?.status === 'completed');
  const signedPaidPilots = commitments.filter((commitment) => commitment?.status === 'signed_active').length;

  const baselineDenials = commitments
    .map((commitment) => asNumber(commitment?.baselineDenialRatePercent))
    .filter((value) => Number.isFinite(value));

  const baselineDays = commitments
    .map((commitment) => asNumber(commitment?.baselineDaysToAuth))
    .filter((value) => Number.isFinite(value));

  const avgBaselineDenial = avg(baselineDenials);
  const avgBaselineDays = avg(baselineDays);

  const avgDenialReduction = avg(
    completedRuns
      .map((run) => asNumber(run?.roi?.estimatedDenialRiskReductionPercent))
      .filter((value) => Number.isFinite(value)),
  );

  const avgDaysSaved = avg(
    completedRuns
      .map((run) => asNumber(run?.roi?.estimatedDaysToAuthSaved))
      .filter((value) => Number.isFinite(value)),
  );

  const avgHoursSavedPerCase = avg(
    completedRuns
      .map((run) => asNumber(run?.roi?.estimatedHoursSaved))
      .filter((value) => Number.isFinite(value)),
  );

  const totalRecoveredRevenue = completedRuns
    .map((run) => asNumber(run?.roi?.estimatedRecoveredRevenueUsd))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  const currentDenial =
    Number.isFinite(avgBaselineDenial) && Number.isFinite(avgDenialReduction)
      ? Math.max(0, avgBaselineDenial - avgDenialReduction)
      : null;

  const currentDays =
    Number.isFinite(avgBaselineDays) && Number.isFinite(avgDaysSaved)
      ? Math.max(0, avgBaselineDays - avgDaysSaved)
      : null;

  return {
    generatedAt: new Date().toISOString(),
    sample: {
      runsTotal: runs.length,
      completedRuns: completedRuns.length,
      commitmentsTotal: commitments.length,
      signedPaidPilots,
    },
    rows: [
      {
        metric: 'Denial rate (%)',
        baselineValue: formatValue(avgBaselineDenial, '%'),
        currentValue: formatValue(currentDenial, '%'),
        deltaValue: calcDelta(avgBaselineDenial, currentDenial, ' pp'),
        source: 'Admin metrics + partner report',
      },
      {
        metric: 'Days to auth',
        baselineValue: formatValue(avgBaselineDays),
        currentValue: formatValue(currentDays),
        deltaValue: calcDelta(avgBaselineDays, currentDays),
        source: 'Pilot workflow logs',
      },
      {
        metric: 'Hours saved / case',
        baselineValue: '0',
        currentValue: formatValue(avgHoursSavedPerCase),
        deltaValue: calcDelta(0, avgHoursSavedPerCase),
        source: 'Ops interviews + run data',
      },
      {
        metric: 'Recovered revenue ($)',
        baselineValue: '0',
        currentValue: formatValue(totalRecoveredRevenue),
        deltaValue: calcDelta(0, totalRecoveredRevenue),
        source: 'Billing outcome data',
      },
      {
        metric: 'Paid pilots (#)',
        baselineValue: '0',
        currentValue: String(signedPaidPilots),
        deltaValue: calcDelta(0, signedPaidPilots),
        source: 'Signed docs',
      },
    ],
  };
}
