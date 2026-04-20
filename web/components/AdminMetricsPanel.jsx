'use client';

import { useEffect, useMemo, useState } from 'react';

const DAY_OPTIONS = [1, 3, 7, 14, 30];

function metricValue(value) {
  return Number.isFinite(Number(value)) ? value : 0;
}

function buildKpiSnapshotText({ days, rollup = {}, roi = {} }) {
  const totalRuns = metricValue(rollup?.totalRuns);
  const completedRuns = metricValue(rollup?.completedRuns);
  const failedRuns = metricValue(rollup?.failedRuns);
  const successRate = metricValue(rollup?.window?.successRatePercent);
  const readyRate = metricValue(rollup?.readiness?.readyRatePercent);
  const avgConfidence = metricValue(rollup?.readiness?.avgConfidence);
  const p95Latency = metricValue(rollup?.latency?.p95Seconds);
  const totalHoursSaved = metricValue(roi?.totalHoursSaved);
  const avgDaysSaved = metricValue(roi?.avgDaysToAuthSaved);
  const recoveredRevenue = metricValue(roi?.totalRecoveredRevenueUsd);
  const denialRiskReduction = metricValue(roi?.avgDenialRiskReductionPercent);
  const commitmentFunnel = rollup?.commitmentFunnel || {};

  return [
    `AuthPilot KPI Snapshot (${days}-day window)`,
    '',
    `Runs: ${totalRuns} total (${completedRuns} completed, ${failedRuns} failed)`,
    `Success rate: ${successRate}%`,
    `Readiness rate: ${readyRate}%`,
    `Avg confidence: ${avgConfidence}`,
    `P95 latency: ${p95Latency}s`,
    `Estimated hours saved: ${totalHoursSaved}`,
    `Estimated avg days-to-auth saved: ${avgDaysSaved}`,
    `Estimated recovered revenue: $${recoveredRevenue}`,
    `Estimated denial risk reduction: ${denialRiskReduction}%`,
    '',
    `Commitment pipeline: ${metricValue(commitmentFunnel.total)} total · ${metricValue(commitmentFunnel.signedActive)} signed active`,
    `Pipeline conversion to signed: ${metricValue(commitmentFunnel.conversionToSignedPercent)}%`,
  ].join('\n');
}

export default function AdminMetricsPanel() {
  const [days, setDays] = useState(7);
  const [adminKey, setAdminKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [isCopyingKpiTable, setIsCopyingKpiTable] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem('authpilot_internal_api_key') || '';
    if (stored) {
      setAdminKey(stored);
    }
  }, []);

  const loadMetrics = async (nextDays = days, nextKey = adminKey) => {
    try {
      setIsLoading(true);
      setError('');
      const headers = {};
      if (nextKey?.trim()) {
        headers['x-internal-api-key'] = nextKey.trim();
      }

      const response = await fetch(`/api/admin/metrics?days=${nextDays}&limit=250`, {
        cache: 'no-store',
        headers,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load startup metrics.');
      }

      setMetrics(payload);
    } catch (loadError) {
      setMetrics(null);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load startup metrics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMetrics(7, adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rollup = metrics?.rollup || {};
  const windowStats = rollup.window || {};
  const roi = rollup.roi || {};
  const commitmentFunnel = rollup.commitmentFunnel || {};
  const health = metrics?.health || {};
  const totalRuns = metricValue(rollup?.totalRuns);
  const completedRuns = metricValue(rollup?.completedRuns);
  const failedRuns = metricValue(rollup?.failedRuns);

  const copyKpiSnapshot = async () => {
    if (!navigator?.clipboard) {
      return;
    }

    const snapshot = buildKpiSnapshotText({ days, rollup, roi });
    await navigator.clipboard.writeText(snapshot);
  };

  const modeSummary = useMemo(() => {
    return Array.isArray(rollup.modes) ? rollup.modes : [];
  }, [rollup.modes]);

  const topFailures = useMemo(() => {
    return Array.isArray(rollup.topFailureCodes) ? rollup.topFailureCodes : [];
  }, [rollup.topFailureCodes]);

  const failureStages = useMemo(() => {
    return Array.isArray(rollup.failureStages) ? rollup.failureStages : [];
  }, [rollup.failureStages]);

  const dailySeries = useMemo(() => {
    return Array.isArray(rollup.dailySeries) ? rollup.dailySeries : [];
  }, [rollup.dailySeries]);

  const readinessTrend = useMemo(() => {
    return Array.isArray(rollup.readinessTrend) ? rollup.readinessTrend : [];
  }, [rollup.readinessTrend]);

  const maxDailyRuns = useMemo(() => {
    return dailySeries.reduce((max, point) => Math.max(max, Number(point.totalRuns) || 0), 0) || 1;
  }, [dailySeries]);

  const downloadCsv = () => {
    const params = new URLSearchParams({ limit: '500' });
    const url = `/api/admin/metrics/export?${params.toString()}`;
    fetch(url, {
      headers: adminKey?.trim() ? { 'x-internal-api-key': adminKey.trim() } : {},
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Unable to export CSV.');
        }
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `authpilot-admin-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch((exportError) => {
        setError(exportError instanceof Error ? exportError.message : 'Unable to export CSV.');
      });
  };

  const downloadCommitmentCsv = () => {
    const params = new URLSearchParams({ limit: '500', dataset: 'commitments' });
    const url = `/api/admin/metrics/export?${params.toString()}`;
    fetch(url, {
      headers: adminKey?.trim() ? { 'x-internal-api-key': adminKey.trim() } : {},
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Unable to export commitment CSV.');
        }
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `authpilot-commitment-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch((exportError) => {
        setError(exportError instanceof Error ? exportError.message : 'Unable to export commitment CSV.');
      });
  };

  const downloadMarkdown = async (kind) => {
    try {
      setError('');
      const endpoint =
        kind === 'snapshot'
          ? `/api/admin/metrics/snapshot?days=${days}&limit=300`
          : kind === 'case-study'
            ? `/api/admin/case-study?days=${days}&limit=300`
            : kind === 'commitment-snapshot'
              ? `/api/admin/commitments/snapshot?limit=300`
              : kind === 'pilot-proof-readiness'
                ? `/api/admin/pilot-proof-readiness?limit=300`
            : `/api/admin/operating-review?days=${days}&limit=300`;
      const response = await fetch(endpoint, {
        headers: adminKey?.trim() ? { 'x-internal-api-key': adminKey.trim() } : {},
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to export markdown artifact.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download =
        kind === 'snapshot'
          ? `authpilot-kpi-snapshot-${new Date().toISOString().slice(0, 10)}.md`
          : kind === 'case-study'
            ? `authpilot-case-study-draft-${new Date().toISOString().slice(0, 10)}.md`
            : kind === 'commitment-snapshot'
              ? `authpilot-commitment-snapshot-${new Date().toISOString().slice(0, 10)}.md`
              : kind === 'pilot-proof-readiness'
                ? `authpilot-pilot-proof-readiness-${new Date().toISOString().slice(0, 10)}.md`
            : `authpilot-operating-review-${new Date().toISOString().slice(0, 10)}.md`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Unable to export markdown artifact.');
    }
  };

  const copyBaselineOutcomeTable = async () => {
    if (!navigator?.clipboard) {
      return;
    }

    try {
      setIsCopyingKpiTable(true);
      setError('');
      const response = await fetch('/api/admin/kpi-table', {
        headers: adminKey?.trim() ? { 'x-internal-api-key': adminKey.trim() } : {},
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load KPI baseline/current table.');
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const header = '| Metric | Baseline | Current | Delta | Source |';
      const divider = '|---|---:|---:|---:|---|';
      const body = rows
        .map((row) => `| ${row.metric} | ${row.baselineValue} | ${row.currentValue} | ${row.deltaValue} | ${row.source} |`)
        .join('\n');

      await navigator.clipboard.writeText([header, divider, body].filter(Boolean).join('\n'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to copy KPI baseline/current table.');
    } finally {
      setIsCopyingKpiTable(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Startup Metrics</p>
          <p className="mt-1 text-sm text-slate-300">Operational rollups for reliability, readiness, and failure patterns.</p>
        </div>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={isLoading}
          onClick={() => {
            void loadMetrics(days, adminKey);
          }}
          type="button"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={isLoading}
          onClick={downloadCsv}
          type="button"
        >
          Export CSV
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={isLoading}
          onClick={downloadCommitmentCsv}
          type="button"
        >
          Export commitment CSV
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void copyKpiSnapshot();
          }}
          type="button"
        >
          Copy KPI snapshot
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={isCopyingKpiTable}
          onClick={() => {
            void copyBaselineOutcomeTable();
          }}
          type="button"
        >
          {isCopyingKpiTable ? 'Copying KPI table…' : 'Copy baseline/current table'}
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void downloadMarkdown('snapshot');
          }}
          type="button"
        >
          Export snapshot MD
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void downloadMarkdown('case-study');
          }}
          type="button"
        >
          Export case-study MD
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void downloadMarkdown('commitment-snapshot');
          }}
          type="button"
        >
          Export commitment snapshot MD
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void downloadMarkdown('pilot-proof-readiness');
          }}
          type="button"
        >
          Export pilot proof MD
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-50"
          disabled={!metrics}
          onClick={() => {
            void downloadMarkdown('operating-review');
          }}
          type="button"
        >
          Export operating review MD
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="premium-label rounded-xl p-3 text-xs text-slate-300">
          <span className="uppercase tracking-wide text-slate-400">Window (days)</span>
          <select
            className="premium-select mt-2 rounded-lg px-2 py-1.5 text-sm"
            value={days}
            onChange={(event) => {
              const nextDays = Number(event.target.value);
              setDays(nextDays);
              void loadMetrics(nextDays, adminKey);
            }}
          >
            {DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} day{option > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="premium-label rounded-xl p-3 text-xs text-slate-300 md:col-span-2">
          <span className="uppercase tracking-wide text-slate-400">Internal API key (optional)</span>
          <input
            className="premium-input mt-2 rounded-lg px-2 py-1.5 text-sm"
            placeholder="Set only if INTERNAL_API_KEY is enabled"
            type="password"
            value={adminKey}
            onChange={(event) => {
              const next = event.target.value;
              setAdminKey(next);
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('authpilot_internal_api_key', next);
              }
            }}
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

      <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-cyan-200">Pilot KPI Snapshot</p>
            <p className="mt-1 text-xs text-slate-300">Demo/investor quick read for the current measurement window.</p>
          </div>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
            {days}-day window
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-200 md:grid-cols-2">
          <p>• Runs: {totalRuns} total ({completedRuns} completed, {failedRuns} failed)</p>
          <p>• Est. recovered revenue: ${metricValue(roi?.totalRecoveredRevenueUsd)}</p>
          <p>• Est. hours saved: {metricValue(roi?.totalHoursSaved)}</p>
          <p>• Avg denial risk reduction: {metricValue(roi?.avgDenialRiskReductionPercent)}%</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Success Rate</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{metricValue(windowStats.successRatePercent)}%</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Ready Rate</p>
          <p className="mt-1 text-2xl font-bold text-cyan-300">{metricValue(rollup?.readiness?.readyRatePercent)}%</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">P95 Latency</p>
          <p className="mt-1 text-2xl font-bold text-white">{metricValue(rollup?.latency?.p95Seconds)}s</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Avg Confidence</p>
          <p className="mt-1 text-2xl font-bold text-white">{metricValue(rollup?.readiness?.avgConfidence)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Avg Runs/Day</p>
          <p className="mt-1 text-2xl font-bold text-white">{metricValue(rollup?.throughput?.avgRunsPerDay)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Hours Saved (Total)</p>
          <p className="mt-1 text-2xl font-bold text-violet-200">{metricValue(roi?.totalHoursSaved)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Avg Days-to-Auth Saved</p>
          <p className="mt-1 text-2xl font-bold text-violet-200">{metricValue(roi?.avgDaysToAuthSaved)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Recovered Revenue (Est)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-200">${metricValue(roi?.totalRecoveredRevenueUsd)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Pipeline Deals</p>
          <p className="mt-1 text-2xl font-bold text-cyan-200">{metricValue(commitmentFunnel?.total)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Signed Active</p>
          <p className="mt-1 text-2xl font-bold text-emerald-200">{metricValue(commitmentFunnel?.signedActive)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Pipeline Conversion</p>
          <p className="mt-1 text-2xl font-bold text-violet-200">{metricValue(commitmentFunnel?.conversionToSignedPercent)}%</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Proposal → Signed</p>
          <p className="mt-1 text-2xl font-bold text-violet-200">{metricValue(commitmentFunnel?.proposalToSignedPercent)}%</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Deals Due in 7d</p>
          <p className="mt-1 text-2xl font-bold text-amber-200">{metricValue(commitmentFunnel?.dueIn7Days)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Overdue Starts</p>
          <p className="mt-1 text-2xl font-bold text-red-200">{metricValue(commitmentFunnel?.overdueStartCount)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Missing Next Step</p>
          <p className="mt-1 text-2xl font-bold text-amber-200">{metricValue(commitmentFunnel?.missingNextStepCount)}</p>
        </div>
      </div>

      <div className="premium-subcard mt-3 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Run Volume Trend</p>
          <p className="text-[11px] text-slate-500">Last {days} day{days > 1 ? 's' : ''}</p>
        </div>
        <div className="mt-3 flex h-24 items-end gap-1.5">
          {dailySeries.length ? (
            dailySeries.map((point) => {
              const totalRuns = Number(point.totalRuns) || 0;
              const completedRuns = Number(point.completedRuns) || 0;
              const failedRuns = Number(point.failedRuns) || 0;
              const barHeight = Math.max(6, Math.round((totalRuns / maxDailyRuns) * 88));
              const successHeight = totalRuns > 0 ? Math.max(2, Math.round((completedRuns / totalRuns) * barHeight)) : 0;
              const failHeight = totalRuns > 0 ? Math.max(2, Math.round((failedRuns / totalRuns) * barHeight)) : 0;
              return (
                <div key={point.date} className="group relative flex flex-1 flex-col items-center">
                  <div className="relative w-full max-w-6 rounded bg-slate-800/90" style={{ height: `${barHeight}px` }}>
                    <div className="absolute inset-x-0 bottom-0 rounded-b bg-red-500/70" style={{ height: `${failHeight}px` }} />
                    <div
                      className="absolute inset-x-0 rounded-t bg-emerald-500/70"
                      style={{ bottom: `${failHeight}px`, height: `${successHeight}px` }}
                    />
                  </div>
                  <span className="mt-1 text-[10px] text-slate-500">{point.date.slice(5)}</span>
                  <div className="pointer-events-none absolute -top-12 hidden rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 group-hover:block">
                    <p>{point.date}</p>
                    <p>Total: {totalRuns}</p>
                    <p>Completed: {completedRuns}</p>
                    <p>Failed: {failedRuns}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-500">No daily data yet.</p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Readiness Trend</p>
          <p className="text-[11px] text-slate-500">Ready rate by day</p>
        </div>
        <div className="mt-3 flex h-16 items-end gap-1.5">
          {readinessTrend.length ? (
            readinessTrend.map((point) => {
              const value = Number(point.readyRatePercent) || 0;
              const height = Math.max(4, Math.round((value / 100) * 60));
              return (
                <div key={point.date} className="group relative flex flex-1 flex-col items-center">
                  <div className="w-full max-w-6 rounded bg-cyan-500/75" style={{ height: `${height}px` }} />
                  <span className="mt-1 text-[10px] text-slate-500">{point.date.slice(5)}</span>
                  <div className="pointer-events-none absolute -top-10 hidden rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 group-hover:block">
                    <p>{point.date}</p>
                    <p>Ready: {value}%</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-500">No readiness trend data yet.</p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Top Failure Codes</p>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            {topFailures.length ? (
              topFailures.map((item) => (
                <p key={`${item.code}-${item.count}`}>
                  • {item.code}: {item.count}
                </p>
              ))
            ) : (
              <p className="text-slate-400">No failure taxonomy data yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Mode Distribution</p>
          <div className="mt-2 space-y-1 text-sm text-slate-200">
            {modeSummary.length ? (
              modeSummary.map((item) => (
                <p key={`${item.mode}-${item.count}`}>
                  • {item.mode}: {item.count}
                </p>
              ))
            ) : (
              <p className="text-slate-400">No mode distribution data yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Failure Stage Distribution</p>
        <div className="mt-2 space-y-1 text-sm text-slate-200">
          {failureStages.length ? (
            failureStages.map((item) => (
              <p key={`${item.stage}-${item.count}`}>
                • {item.stage}: {item.count}
              </p>
            ))
          ) : (
            <p className="text-slate-400">No failure stage data yet.</p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
        <p>
          Health — TinyFish mode: <span className="text-white">{health?.tinyfish?.mode || 'unknown'}</span>, API key:
          {' '}
          <span className="text-white">{health?.tinyfish?.hasApiKey ? 'configured' : 'missing'}</span>, Axiom:
          {' '}
          <span className="text-white">{health?.observability?.configured ? 'configured' : 'missing'}</span>
        </p>
        <p className="mt-1 text-slate-400">
          Request trace: <span className="text-slate-300">{metrics?.requestId || 'n/a'}</span> · Generated:{' '}
          <span className="text-slate-300">{metrics?.generatedAt || 'n/a'}</span>
        </p>
      </div>
    </div>
  );
}
