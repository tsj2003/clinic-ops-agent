'use client';

import { useEffect, useMemo, useState } from 'react';

function clean(value, max = 300) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function formatDate(value = '') {
  const parsed = Date.parse(clean(value, 80));
  if (!Number.isFinite(parsed)) {
    return 'N/A';
  }
  return new Date(parsed).toLocaleString();
}

function summarizeOutcome(item = {}) {
  if (item.duplicate) {
    return 'Duplicate skipped';
  }
  if (item.createdRun) {
    return clean(item.status || 'Run created', 80).replaceAll('_', ' ');
  }
  return clean(item.status || 'Skipped', 80).replaceAll('_', ' ');
}

export default function IntakePollerPanel() {
  const [statusPayload, setStatusPayload] = useState(null);
  const [runPayload, setRunPayload] = useState(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [tenantId, setTenantId] = useState('default');
  const [includeAthena, setIncludeAthena] = useState(true);
  const [includeEpic, setIncludeEpic] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadStatus = async (targetTenantId = tenantId) => {
    try {
      setError('');
      const response = await fetch(
        `/api/automation/intake-poller/status?tenantId=${encodeURIComponent(clean(targetTenantId, 120) || 'default')}`,
        {
          cache: 'no-store',
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load intake poller status.');
      }
      setStatusPayload(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load intake poller status.');
    }
  };

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(() => {
      void loadStatus();
    }, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTenant = useMemo(() => {
    return statusPayload?.selectedTenant || null;
  }, [statusPayload]);

  const latestResult = runPayload?.result || selectedTenant?.lastResult || null;
  const outcomes = Array.isArray(latestResult?.results) ? latestResult.results : [];

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Zero-Touch Intake Poller</p>
          <p className="mt-1 text-sm text-slate-300">Run proactive EMR polling and review dedupe/creation outcomes in one place.</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            statusPayload?.running
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-slate-700 bg-slate-900 text-slate-300'
          }`}
        >
          {statusPayload?.running ? 'Scheduler Running' : 'Scheduler Idle'}
        </span>
      </div>

      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Scanned appointments</p>
          <p className="mt-1 text-xl font-semibold text-white">{statusPayload?.aggregate?.scanned || 0}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">High-signal matches</p>
          <p className="mt-1 text-xl font-semibold text-cyan-200">{statusPayload?.aggregate?.highSignalMatches || 0}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Created / deduped</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">
            {(statusPayload?.aggregate?.createdRuns || 0).toString()} / {(statusPayload?.aggregate?.duplicates || 0).toString()}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200 xl:col-span-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Tenant</span>
          <input
            className="premium-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
            value={tenantId}
            onChange={(event) => setTenantId(clean(event.target.value, 120))}
            placeholder="default"
          />
        </label>

        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Start date</span>
          <input
            className="premium-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">End date</span>
          <input
            className="premium-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>

        <label className="premium-label flex items-center gap-2 rounded-xl p-3 text-xs text-slate-200">
          <input
            checked={includeAthena}
            onChange={(event) => setIncludeAthena(event.target.checked)}
            type="checkbox"
          />
          Include athena
        </label>

        <label className="premium-label flex items-center gap-2 rounded-xl p-3 text-xs text-slate-200">
          <input checked={includeEpic} onChange={(event) => setIncludeEpic(event.target.checked)} type="checkbox" />
          Include Epic
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="premium-button premium-button-primary rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-50 disabled:opacity-60"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);
            try {
              setError('');
              const response = await fetch('/api/automation/intake-poller/run', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  action: 'run',
                  tenantId: clean(tenantId, 120) || 'default',
                  includeAthena,
                  includeEpic,
                  startDate,
                  endDate,
                }),
              });

              const payload = await response.json();
              if (!response.ok) {
                throw new Error(payload.error || 'Unable to run intake poller cycle.');
              }

              setRunPayload(payload);
              setStatusPayload((prev) => ({
                ...(prev || {}),
                ...payload,
                selectedTenant:
                  Array.isArray(payload?.tenants) && payload.tenants.length
                    ? payload.tenants.find((item) => item.tenantId === clean(tenantId, 120)) || payload.tenants[0]
                    : null,
              }));
              await loadStatus(tenantId);
            } catch (runError) {
              setError(runError instanceof Error ? runError.message : 'Unable to run intake poller cycle.');
            } finally {
              setIsSubmitting(false);
            }
          }}
          type="button"
        >
          {isSubmitting ? 'Running…' : 'Run Polling Cycle'}
        </button>

        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
          onClick={() => {
            void loadStatus();
          }}
          type="button"
        >
          Refresh status
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <div className="premium-subcard rounded-xl p-3 text-xs text-slate-300">
          <p>
            <span className="text-slate-500">Selected tenant:</span> {clean(selectedTenant?.tenantId || tenantId, 120) || 'default'}
          </p>
          <p className="mt-1">
            <span className="text-slate-500">Last run:</span> {formatDate(selectedTenant?.lastRunAt || latestResult?.windowStartDate)}
          </p>
          {latestResult?.athena?.reason || latestResult?.epic?.reason ? (
            <p className="mt-1 text-amber-200">
              {clean(latestResult?.athena?.reason || latestResult?.epic?.reason, 200)}
            </p>
          ) : null}
        </div>

        {outcomes.length === 0 ? (
          <div className="premium-subcard rounded-xl p-3 text-xs text-slate-400">No autonomous polling outcomes yet.</div>
        ) : (
          outcomes.slice(0, 12).map((item) => (
            <div key={`${clean(item.sourceSystem, 40)}:${clean(item.appointmentId, 120)}`} className="premium-subcard rounded-xl p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-white">
                  {clean(item.sourceSystem, 40)} · {clean(item.appointmentId, 120)}
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                    item.duplicate
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                      : item.createdRun
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                        : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {summarizeOutcome(item)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                CPT {clean(item.cptCode, 30) || 'N/A'}
                {item.runId ? ` · Run ${clean(item.runId, 120)}` : ''}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
