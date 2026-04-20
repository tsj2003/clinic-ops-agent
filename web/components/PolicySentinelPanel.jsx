'use client';

import { useEffect, useState } from 'react';

function clean(value) {
  return String(value || '').trim();
}

function formatDateTime(value) {
  if (!value) {
    return 'No runs yet';
  }

  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusTone(status) {
  const normalized = clean(status).toUpperCase();
  if (normalized === 'STALE_RELOAD_REQUIRED') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
  }
  if (normalized === 'METADATA_CHANGED') {
    return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

export default function PolicySentinelPanel() {
  const [payload, setPayload] = useState({ summary: null, changes: [] });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState('');

  const loadChanges = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch('/api/automation/policy-sentinel/changes?limit=8', { cache: 'no-store' });
      const nextPayload = await response.json();
      if (!response.ok) {
        throw new Error(nextPayload.error || 'Unable to load Policy Sentinel changes.');
      }
      setPayload({
        summary: nextPayload.summary || null,
        changes: Array.isArray(nextPayload.changes) ? nextPayload.changes : [],
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load Policy Sentinel changes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadChanges();
  }, []);

  const runSentinel = async () => {
    try {
      setIsRunning(true);
      setError('');
      setRunMessage('');
      const response = await fetch('/api/automation/policy-sentinel/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operatorId: 'staff-operator',
        }),
      });
      const nextPayload = await response.json();
      if (!response.ok) {
        throw new Error(nextPayload.error || 'Unable to run Policy Sentinel.');
      }
      const summary = nextPayload.summary || {};
      setRunMessage(
        summary.ok
          ? `Sentinel finished: ${Number(summary.changed) || 0} changed, ${Number(summary.staleReloadRequired) || 0} stale reload required.`
          : `Sentinel finished with ${Array.isArray(summary.errors) ? summary.errors.length : 0} error(s).`,
      );
      await loadChanges();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to run Policy Sentinel.');
    } finally {
      setIsRunning(false);
    }
  };

  const summary = payload.summary || {};

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Policy Sentinel</p>
          <p className="mt-1 text-sm text-slate-300">Monitor payer policy sources, trigger reloads, and review meaningful deltas from the dashboard.</p>
        </div>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-50"
          disabled={isRunning}
          onClick={() => {
            void runSentinel();
          }}
          type="button"
        >
          {isRunning ? 'Running…' : 'Run now'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Policies tracked</p>
          <p className="mt-2 text-2xl font-semibold text-white">{Number(summary.totalPoliciesTracked) || 0}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Change events</p>
          <p className="mt-2 text-2xl font-semibold text-white">{Number(summary.totalChangeEvents) || 0}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Stale reload required</p>
          <p className="mt-2 text-2xl font-semibold text-amber-100">{Number(summary.staleReloadRequired) || 0}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Alerts sent</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-100">{Number(summary.alertsSent) || 0}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Last manifest update: {formatDateTime(summary.updatedAt)}</span>
        {runMessage ? <span className="text-cyan-200">{runMessage}</span> : null}
        {error ? <span className="text-red-200">{error}</span> : null}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="premium-empty rounded-xl p-4 text-sm text-slate-400">Loading Policy Sentinel changes…</div>
        ) : payload.changes.length === 0 ? (
          <div className="premium-empty rounded-xl p-4 text-sm text-slate-400">No policy deltas recorded yet. Run Policy Sentinel to establish the first monitored baseline.</div>
        ) : (
          payload.changes.map((change) => (
            <div key={`${change.policyKey || change.pdfUrl || change.timestamp}`} className="premium-subcard rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{clean(change.title) || 'Untitled policy change'}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {clean(change.payerId).toUpperCase() || 'UNKNOWN'} · {formatDateTime(change.timestamp)}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(change.status)}`}>
                  {clean(change.status) || 'Unknown'}
                </span>
              </div>

              <p className="mt-3 text-sm text-slate-300">{clean(change.semantic?.summary) || 'No semantic summary captured for this change.'}</p>

              {Array.isArray(change.semantic?.newRequirements) && change.semantic.newRequirements.length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">New requirements</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    {change.semantic.newRequirements.slice(0, 3).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
