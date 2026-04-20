function formatWorkspaceTimestamp(value) {
  if (!value) {
    return 'Draft';
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

function formatAnalyticsTimestamp(value) {
  if (!value) {
    return 'No runs yet';
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

function workspaceTone(storageMode) {
  if (storageMode === 'mongodb') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (storageMode === 'local') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function analyticsStatusTone(status) {
  if (status === 'completed') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (status === 'failed') {
    return 'border-red-500/40 bg-red-500/10 text-red-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

export default function WorkspacePanel({
  clinicName,
  storageMode,
  error,
  workspaces,
  activeWorkspaceId,
  isSaving,
  isDeleting,
  onClinicNameChange,
  onSave,
  onLoad,
  onDelete,
  onNewDraft,
  onExportActiveBundle,
  onImportBundle,
}) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Design Partner Workspace</p>
          <p className="mt-1 text-sm text-slate-300">
            Save clinic-specific TinyFish workflows so design partners can rerun the same setup without re-entering everything.
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${workspaceTone(storageMode)}`}>
          {storageMode === 'mongodb' ? 'MongoDB' : storageMode === 'local' ? 'Local Fallback' : 'Loading'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_repeat(4,auto)]">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Clinic workspace name</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="Peak Spine Center"
            value={clinicName}
            onChange={(event) => onClinicNameChange(event.target.value)}
          />
        </label>
        <button
          className="premium-button premium-button-accent rounded-xl px-4 py-3 text-sm font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onSave}
          disabled={isSaving}
          type="button"
        >
          {isSaving ? 'Saving...' : activeWorkspaceId ? 'Update profile' : 'Save profile'}
        </button>
        <button
          className="premium-button premium-button-soft rounded-xl px-4 py-3 text-sm font-semibold text-slate-200"
          onClick={onNewDraft}
          type="button"
        >
          New draft
        </button>
        <button
          className="premium-button premium-button-soft rounded-xl px-4 py-3 text-sm font-semibold text-slate-200"
          onClick={onExportActiveBundle}
          type="button"
        >
          Export bundle
        </button>
        <button
          className="premium-button premium-button-soft rounded-xl px-4 py-3 text-sm font-semibold text-slate-200"
          onClick={onImportBundle}
          type="button"
        >
          Import bundle
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}

      <div className="mt-4 space-y-3">
        {workspaces.length === 0 ? (
          <div className="premium-empty rounded-xl px-4 py-4 text-sm text-slate-400">
            No workspace profiles yet. Save your first clinic workflow to make custom mode reusable for design partners.
          </div>
        ) : (
          workspaces.map((workspace) => {
            const analytics = workspace.analytics || {};

            return (
              <div
                key={workspace.id}
                className={`rounded-2xl p-4 transition ${
                  activeWorkspaceId === workspace.id ? 'premium-subcard border border-cyan-400/60 bg-cyan-400/10' : 'premium-subcard'
                }`}
              >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="premium-chip rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                      Clinic profile
                    </span>
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${analyticsStatusTone(
                        analytics.lastRunStatus,
                      )}`}
                    >
                      {analytics.totalRuns > 0 ? `Last ${analytics.lastRunStatus}` : 'No runs yet'}
                    </span>
                    <span className="text-xs text-slate-400">{formatWorkspaceTimestamp(workspace.updatedAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{workspace.clinicName}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {workspace.config?.workflowName || 'Custom policy workflow'} · {workspace.config?.contactWorkflowName || 'Custom contact workflow'}
                  </p>
                  <p className="mt-1 text-xs text-cyan-200">
                    {(workspace.intake?.payerName || 'Payer not set') +
                      ' · ' +
                      (workspace.intake?.specialty || 'Specialty not set') +
                      ' · ' +
                      (workspace.intake?.procedureLabel || 'Procedure not set')}
                  </p>
                  {(workspace.intake?.memberState || workspace.intake?.lineOfBusiness) ? (
                    <p className="mt-1 text-xs text-slate-400">
                      {(workspace.intake?.memberState || 'State not set') +
                        ' · ' +
                        (workspace.intake?.lineOfBusiness || 'LOB not set')}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
                    onClick={() => onLoad(workspace)}
                    type="button"
                  >
                    Load profile
                  </button>
                  <button
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => onDelete(workspace)}
                    disabled={isDeleting}
                    type="button"
                  >
                    {isDeleting && activeWorkspaceId === workspace.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Runs</p>
                  <p className="mt-1 text-sm font-medium text-white">{analytics.totalRuns ?? 0}</p>
                </div>
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Failure rate</p>
                  <p className="mt-1 text-sm font-medium text-amber-200">{analytics.failureRateLabel || '0%'}</p>
                </div>
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Last success</p>
                  <p className="mt-1 text-sm font-medium text-emerald-200">
                    {analytics.lastSuccessfulRunAt ? formatAnalyticsTimestamp(analytics.lastSuccessfulRunAt) : 'No success yet'}
                  </p>
                </div>
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Avg elapsed</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">
                    {analytics.averageElapsedSeconds ? `${analytics.averageElapsedSeconds}s` : 'No runs yet'}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Policy URL</p>
                  <p className="mt-1 text-xs text-slate-200">{workspace.config?.workflowUrl || 'Not set'}</p>
                </div>
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Contact URL</p>
                  <p className="mt-1 text-xs text-slate-200">{workspace.config?.contactWorkflowUrl || 'Not set'}</p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Last run</p>
                  <p className="mt-1 text-xs text-slate-200">{formatAnalyticsTimestamp(analytics.lastRunAt)}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {analytics.lastRunSummary || 'Run this workspace once to unlock clinic-level reliability analytics.'}
                  </p>
                </div>
                <div className="premium-subcard-soft rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Risk signal</p>
                  <p className="mt-1 text-xs text-slate-200">
                    {analytics.lastFailureCode
                      ? `${analytics.lastFailureCode}${analytics.lastFailureStage ? ` · ${analytics.lastFailureStage}` : ''}`
                      : analytics.totalRuns > 0
                        ? 'No recent workspace-specific failure'
                        : 'No failure signal yet'}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {analytics.lastSuccessfulProcedure
                      ? `Last successful procedure: ${analytics.lastSuccessfulProcedure}`
                      : 'As runs accumulate, this workspace becomes a reusable clinic operating profile.'}
                  </p>
                </div>
              </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
