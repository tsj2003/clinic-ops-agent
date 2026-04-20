import { useState } from 'react';

const STATUS_OPTIONS = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'proposal_sent', label: 'Proposal sent' },
  { value: 'verbal_committed', label: 'Verbal committed' },
  { value: 'signed_active', label: 'Signed active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'closed_lost', label: 'Closed lost' },
];

function statusTone(status) {
  if (status === 'signed_active') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (status === 'verbal_committed') {
    return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
  }
  if (status === 'proposal_sent') {
    return 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200';
  }
  if (status === 'closed_lost') {
    return 'border-red-500/40 bg-red-500/10 text-red-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function storageTone(storageMode) {
  if (storageMode === 'mongodb') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  if (storageMode === 'local') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function prettyStatus(value) {
  return String(value || 'prospect')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function daysUntilTarget(value) {
  if (!value) {
    return null;
  }

  const target = new Date(`${value}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(target)) {
    return null;
  }

  const now = Date.now();
  const diff = target - now;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function buildReminder(commitment) {
  const status = String(commitment?.status || 'prospect');
  const nextStep = String(commitment?.nextStep || '').trim();
  const daysToStart = daysUntilTarget(commitment?.targetStartDate);

  if (status === 'closed_lost') {
    return {
      tone: 'text-slate-400',
      text: 'Closed lost. Log reason and recycle only with a clear new trigger.',
    };
  }

  if (status === 'signed_active') {
    return {
      tone: 'text-emerald-200',
      text: 'Signed active. Run kickoff checklist and lock weekly review cadence.',
    };
  }

  if (!nextStep) {
    return {
      tone: 'text-amber-200',
      text: 'Missing next step. Add one concrete close action now.',
    };
  }

  if (Number.isFinite(daysToStart)) {
    if (daysToStart < 0 && status !== 'signed_active') {
      return {
        tone: 'text-red-200',
        text: 'Target start date has passed. Escalate close call today.',
      };
    }

    if (daysToStart <= 3 && status !== 'signed_active') {
      return {
        tone: 'text-amber-200',
        text: 'Target start is within 3 days. Send terms and confirm signer + date.',
      };
    }
  }

  return {
    tone: 'text-cyan-200',
    text: 'Pipeline healthy. Keep next step date-bound and owner-assigned.',
  };
}

function buildTermsTemplate(commitment) {
  const clinicName = commitment?.clinicName || 'Design Partner Clinic';
  const lane = commitment?.lane || 'prior-auth workflow lane';
  const targetStartDate = commitment?.targetStartDate || '[target start date]';

  return [
    `Subject: AuthPilot paid pilot terms — ${clinicName}`,
    '',
    `Hi ${commitment?.championName || 'team'},`,
    '',
    'Recap of agreed pilot scope:',
    `- Scope: ${lane}`,
    '- Duration: 14 days',
    '- Motion: one-lane execution + weekly KPI review',
    '- KPI targets: denial-rate delta, days-to-auth delta, hours saved/case, recovered revenue',
    `- Target start: ${targetStartDate}`,
    '',
    'If this matches your understanding, reply “approved” and we will send kickoff checklist + week-1 schedule.',
    '',
    '— AuthPilot',
  ].join('\n');
}

function buildKickoffChecklistTemplate(commitment) {
  const clinicName = commitment?.clinicName || 'Design Partner Clinic';
  const lane = commitment?.lane || 'prior-auth workflow lane';

  return [
    `AuthPilot Pilot Kickoff Checklist — ${clinicName}`,
    '',
    `Lane: ${lane}`,
    '',
    '- [ ] Confirm pilot owner (clinic) + owner (AuthPilot)',
    '- [ ] Lock weekly review day/time',
    '- [ ] Capture baseline denial rate for lane',
    '- [ ] Capture baseline days-to-auth for lane',
    '- [ ] Run first live readiness + routing workflow',
    '- [ ] Export KPI snapshot markdown',
    '- [ ] Confirm success criteria and signoff path',
  ].join('\n');
}

function buildFollowupTemplate(commitment) {
  const clinicName = commitment?.clinicName || 'team';
  const lane = commitment?.lane || 'pilot lane';
  const nextStep = commitment?.nextStep || 'confirm pilot terms + signer';

  return [
    `Subject: Follow-up — ${clinicName} pilot next step`,
    '',
    `Hi ${commitment?.championName || 'team'},`,
    '',
    `Quick follow-up on the ${lane} pilot lane.`,
    `Next step: ${nextStep}`,
    '',
    'Can we lock owner + date today so kickoff stays on schedule?',
    '',
    '— AuthPilot',
  ].join('\n');
}

function formatDate(value) {
  if (!value) {
    return 'No target date';
  }

  try {
    return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}

function buildProofReadinessSummary(commitments = []) {
  const signed = (Array.isArray(commitments) ? commitments : []).filter((item) => item?.status === 'signed_active');
  const hasSignedEvidence = signed.filter((item) => item?.signedEvidenceUrl).length;
  const hasBaseline = signed.filter((item) => item?.baselineDenialRatePercent !== '' && item?.baselineDaysToAuth !== '').length;
  const hasCurrent = signed.filter((item) => item?.currentDenialRatePercent !== '' && item?.currentDaysToAuth !== '').length;
  const proofReady = signed.filter(
    (item) =>
      item?.signedEvidenceUrl &&
      item?.baselineDenialRatePercent !== '' &&
      item?.baselineDaysToAuth !== '' &&
      item?.currentDenialRatePercent !== '' &&
      item?.currentDaysToAuth !== '',
  ).length;

  return {
    signedActive: signed.length,
    signedEvidenceMissing: signed.length - hasSignedEvidence,
    baselineMissing: signed.length - hasBaseline,
    currentMissing: signed.length - hasCurrent,
    proofReady,
  };
}

export default function PilotCommitmentPanel({
  commitments,
  error,
  storageMode,
  isSaving,
  savingId,
  onCreate,
  onStatusChange,
  onQuickUpdate,
  onDelete,
}) {
  const [draft, setDraft] = useState({
    clinicName: '',
    championName: '',
    championEmail: '',
    lane: '',
    status: 'prospect',
    targetStartDate: '',
    nextStep: '',
    baselineDenialRatePercent: '',
    baselineDaysToAuth: '',
    currentDenialRatePercent: '',
    currentDaysToAuth: '',
    signedAt: '',
    signedEvidenceUrl: '',
  });
  const [editDrafts, setEditDrafts] = useState({});
  const proofSummary = buildProofReadinessSummary(commitments);

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Pilot Commitment Tracker</p>
          <p className="mt-1 text-sm text-slate-300">Capture active pilot deals and move them from discovery to signed with a weekly close rhythm.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${storageTone(storageMode)}`}>
          {storageMode === 'mongodb' ? 'MongoDB' : storageMode === 'local' ? 'Local Fallback' : 'Loading'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Signed active</p>
          <p className="mt-2 text-2xl font-semibold text-white">{proofSummary.signedActive}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Missing signed proof</p>
          <p className="mt-2 text-2xl font-semibold text-amber-100">{proofSummary.signedEvidenceMissing}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Missing KPI baseline/current</p>
          <p className="mt-2 text-2xl font-semibold text-amber-100">{Math.max(proofSummary.baselineMissing, proofSummary.currentMissing)}</p>
        </div>
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Proof ready</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-100">{proofSummary.proofReady}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Truth-first rule: signed pilots are not counted as external proof until signer evidence plus baseline and current KPI fields are filled in.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Clinic</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.clinicName}
            onChange={(event) => setDraft((prev) => ({ ...prev, clinicName: event.target.value }))}
            placeholder="Peak Spine Center"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Champion</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.championName}
            onChange={(event) => setDraft((prev) => ({ ...prev, championName: event.target.value }))}
            placeholder="Ops Director"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Champion email</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.championEmail}
            onChange={(event) => setDraft((prev) => ({ ...prev, championEmail: event.target.value }))}
            placeholder="ops@clinic.com"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Workflow lane</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.lane}
            onChange={(event) => setDraft((prev) => ({ ...prev, lane: event.target.value }))}
            placeholder="Lumbar MRI auth"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Next step</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.nextStep}
            onChange={(event) => setDraft((prev) => ({ ...prev, nextStep: event.target.value }))}
            placeholder="Send pilot terms by Friday"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Status</span>
            <select
              className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-slate-400">Target start date</span>
            <input
              className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
              type="date"
              value={draft.targetStartDate}
              onChange={(event) => setDraft((prev) => ({ ...prev, targetStartDate: event.target.value }))}
            />
          </label>
        </div>
        <button
          className="premium-button premium-button-primary rounded-xl px-4 py-3 text-sm font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={async () => {
            const created = await onCreate(draft);
            if (created) {
              setDraft({
                clinicName: '',
                championName: '',
                championEmail: '',
                lane: '',
                status: 'prospect',
                targetStartDate: '',
                nextStep: '',
                baselineDenialRatePercent: '',
                baselineDaysToAuth: '',
                currentDenialRatePercent: '',
                currentDaysToAuth: '',
                signedAt: '',
                signedEvidenceUrl: '',
              });
            }
          }}
          disabled={isSaving}
          type="button"
        >
          {isSaving ? 'Saving...' : 'Add commitment'}
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Baseline denial %</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.baselineDenialRatePercent}
            onChange={(event) => setDraft((prev) => ({ ...prev, baselineDenialRatePercent: event.target.value }))}
            placeholder="22"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Baseline days-to-auth</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.baselineDaysToAuth}
            onChange={(event) => setDraft((prev) => ({ ...prev, baselineDaysToAuth: event.target.value }))}
            placeholder="6"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Current denial %</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.currentDenialRatePercent}
            onChange={(event) => setDraft((prev) => ({ ...prev, currentDenialRatePercent: event.target.value }))}
            placeholder="18"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Current days-to-auth</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.currentDaysToAuth}
            onChange={(event) => setDraft((prev) => ({ ...prev, currentDaysToAuth: event.target.value }))}
            placeholder="4"
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Signed date</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            type="date"
            value={draft.signedAt}
            onChange={(event) => setDraft((prev) => ({ ...prev, signedAt: event.target.value }))}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Signed evidence URL</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={draft.signedEvidenceUrl}
            onChange={(event) => setDraft((prev) => ({ ...prev, signedEvidenceUrl: event.target.value }))}
            placeholder="https://..."
          />
        </label>
      </div>

      {error ? <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p> : null}

      <div className="mt-4 space-y-3">
        {commitments.length === 0 ? (
          <div className="premium-empty rounded-xl px-4 py-4 text-sm text-slate-400">
            No pilot commitments yet. Add the first clinic to start the Day 21 close loop.
          </div>
        ) : (
          commitments.map((commitment) => (
            <div key={commitment.id} className="premium-subcard rounded-2xl p-4">
              {(() => {
                const editDraft = editDrafts[commitment.id] || {
                  nextStep: commitment.nextStep || '',
                  targetStartDate: commitment.targetStartDate || '',
                  currentDenialRatePercent: commitment.currentDenialRatePercent || '',
                  currentDaysToAuth: commitment.currentDaysToAuth || '',
                  signedAt: commitment.signedAt || '',
                  signedEvidenceUrl: commitment.signedEvidenceUrl || '',
                };

                return (
                  <div className="mb-3 grid gap-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3 md:grid-cols-3">
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs"
                      placeholder="Next step"
                      value={editDraft.nextStep}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            nextStep: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs"
                      type="date"
                      value={editDraft.targetStartDate}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            targetStartDate: event.target.value,
                          },
                        }))
                      }
                    />
                    <button
                      className="premium-button premium-button-soft rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200"
                      onClick={() =>
                        onQuickUpdate(commitment.id, {
                          nextStep: editDraft.nextStep,
                          targetStartDate: editDraft.targetStartDate,
                          currentDenialRatePercent: editDraft.currentDenialRatePercent,
                          currentDaysToAuth: editDraft.currentDaysToAuth,
                          signedAt: editDraft.signedAt,
                          signedEvidenceUrl: editDraft.signedEvidenceUrl,
                        })
                      }
                      disabled={savingId === commitment.id}
                      type="button"
                    >
                      Save fields
                    </button>
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs"
                      placeholder="Current denial %"
                      value={editDraft.currentDenialRatePercent}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            currentDenialRatePercent: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs"
                      placeholder="Current days-to-auth"
                      value={editDraft.currentDaysToAuth}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            currentDaysToAuth: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs"
                      type="date"
                      value={editDraft.signedAt}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            signedAt: event.target.value,
                          },
                        }))
                      }
                    />
                    <input
                      className="premium-input rounded-lg px-2.5 py-1.5 text-xs md:col-span-2"
                      placeholder="Signed evidence URL"
                      value={editDraft.signedEvidenceUrl}
                      onChange={(event) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [commitment.id]: {
                            ...editDraft,
                            signedEvidenceUrl: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                );
              })()}

              {(() => {
                const reminder = buildReminder(commitment);
                return (
                  <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2">
                    <p className={`text-xs ${reminder.tone}`}>{reminder.text}</p>
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone(commitment.status)}`}>
                      {prettyStatus(commitment.status)}
                    </span>
                    <span className="text-xs text-slate-400">Target start: {formatDate(commitment.targetStartDate)}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{commitment.clinicName}</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {(commitment.championName || 'No champion') +
                      (commitment.championEmail ? ` · ${commitment.championEmail}` : '') +
                      (commitment.lane ? ` · ${commitment.lane}` : '')}
                  </p>
                  <p className="mt-1 text-xs text-cyan-200">{commitment.nextStep || 'No next step set.'}</p>
                </div>
                <button
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:border-red-400/60 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onDelete(commitment.id)}
                  disabled={savingId === commitment.id}
                  type="button"
                >
                  {savingId === commitment.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
                  onClick={async () => {
                    if (!navigator?.clipboard) {
                      return;
                    }
                    await navigator.clipboard.writeText(buildTermsTemplate(commitment));
                  }}
                  type="button"
                >
                  Copy terms message
                </button>
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
                  onClick={async () => {
                    if (!navigator?.clipboard) {
                      return;
                    }
                    await navigator.clipboard.writeText(buildKickoffChecklistTemplate(commitment));
                  }}
                  type="button"
                >
                  Copy kickoff checklist
                </button>
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
                  onClick={async () => {
                    if (!navigator?.clipboard) {
                      return;
                    }
                    await navigator.clipboard.writeText(buildFollowupTemplate(commitment));
                  }}
                  type="button"
                >
                  Copy follow-up message
                </button>
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
                  onClick={() => onQuickUpdate(commitment.id, { lastContactAt: new Date().toISOString() })}
                  disabled={savingId === commitment.id}
                  type="button"
                >
                  Mark contacted now
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
                      commitment.status === option.value
                        ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-100'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200'
                    }`}
                    onClick={() => onStatusChange(commitment.id, option.value)}
                    disabled={savingId === commitment.id || commitment.status === option.value}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
