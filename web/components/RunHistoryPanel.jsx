function formatRunTimestamp(value) {
  if (!value) {
    return '';
  }

  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function historyTone(status) {
  if (status === 'failed') {
    return 'border-red-500/40 bg-red-500/10 text-red-200';
  }
  if (status === 'completed') {
    return 'border-green-500/40 bg-green-500/10 text-green-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function lifecycleTone(status) {
  if (status === 'ready_for_submission') {
    return 'border-green-500/40 bg-green-500/10 text-green-200';
  }
  if (status === 'collecting_evidence') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  if (status === 'submitted') {
    return 'border-blue-500/40 bg-blue-500/10 text-blue-200';
  }
  if (status === 'escalated') {
    return 'border-red-500/40 bg-red-500/10 text-red-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function lifecycleLabel(status) {
  return String(status || 'new')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export default function RunHistoryPanel({
  runs,
  storageMode,
  onLoadRun,
  activeRunId,
  highlightRunId,
  error,
  lifecycleDrafts,
  lifecycleSavingId,
  onLifecycleChange,
  onLifecycleSave,
}) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <p className="text-sm uppercase tracking-wide text-slate-400 font-semibold">Recent Runs</p>

      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

      <div className="mt-4 space-y-3">
        {runs.length === 0 ? (
          <div className="premium-empty rounded-xl px-4 py-4 text-sm text-slate-400">
            No saved runs yet. Complete a live run to see history.
          </div>
        ) : (
          runs.map((run) => (
            <div
              key={run.appRunId}
              className={`rounded-xl p-4 transition ${
                activeRunId === run.appRunId
                  ? 'premium-subcard border border-red-400/50 bg-red-400/5'
                  : highlightRunId === run.appRunId
                    ? 'premium-subcard motion-log-entry border border-emerald-400/60 bg-emerald-500/10'
                    : 'premium-subcard'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${historyTone(run.status)}`}>
                    {run.status}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${lifecycleTone(run.caseLifecycle?.status)}`}>
                    {lifecycleLabel(run.caseLifecycle?.status)}
                  </span>
                  <span className="text-sm text-slate-400">{formatRunTimestamp(run.startedAt)}</span>
                  {highlightRunId === run.appRunId ? (
                    <span className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                      New
                    </span>
                  ) : null}
                </div>
                <button
                  className="premium-button premium-button-soft rounded-lg px-4 py-2 text-sm font-medium text-slate-200"
                  onClick={() => onLoadRun(run)}
                  type="button"
                >
                  Load
                </button>
              </div>

              <p className="mt-2 text-base font-semibold text-white">{run.workflow?.name || 'Saved run'}</p>

              <div className="mt-3 grid grid-cols-4 gap-3">
                <div className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Mode</p>
                  <p className="mt-1 text-base font-bold capitalize text-white">{run.mode}</p>
                </div>
                <div className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Matched</p>
                  <p className="mt-1 text-base font-bold text-green-300">{run.metrics?.matchedEvidence ?? 0}</p>
                </div>
                <div className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Missing</p>
                  <p className="mt-1 text-base font-bold text-amber-300">{run.metrics?.missingEvidence ?? 0}</p>
                </div>
                <div className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Elapsed</p>
                  <p className="mt-1 text-base font-bold text-white">{run.metrics?.elapsedSeconds ?? 0}s</p>
                </div>
              </div>

              {run.failure?.code && (
                <p className="mt-2 text-sm text-red-400">
                  Failure: {run.failure.code.replaceAll('_', ' ')}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
