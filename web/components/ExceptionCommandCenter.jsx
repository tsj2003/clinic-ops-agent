'use client';

import { useMemo, useState } from 'react';

function clean(value) {
  return String(value || '').trim();
}

function normalizeLifecycle(value) {
  return clean(value).toLowerCase();
}

function normalizeEmrStatus(run = {}) {
  return clean(run?.operatorPacket?.emr_sync?.status || run?.emrSync?.status || '').toUpperCase();
}

function likelyDenied(run = {}) {
  const emrStatus = normalizeEmrStatus(run);
  const message = clean(run?.operatorPacket?.emr_sync?.message || run?.emrSync?.message || run?.failureReason).toLowerCase();
  return emrStatus.includes('DENIED') || /(denied|denial|adverse determination|authorization declined)/i.test(message);
}

function runLabel(run = {}) {
  return run?.workflow?.caseId || run?.operatorPacket?.case_id || run?.appRunId || 'run';
}

function categorizeRun(run = {}) {
  const lifecycle = normalizeLifecycle(run?.caseLifecycle?.status);
  const emrStatus = normalizeEmrStatus(run);
  const jellyBean = clean(run?.operatorPacket?.emr_sync?.jelly_bean_alert || run?.emrSync?.jelly_bean_alert).toUpperCase();
  const hasProof = Boolean(clean(run?.operatorPacket?.emr_sync?.proof_screenshot_path || run?.emrSync?.proof_screenshot_path));

  if (jellyBean === 'MANUAL_ACTION_REQUIRED' || emrStatus === 'MANUAL_ACTION_REQUIRED' || lifecycle === 'escalated' || lifecycle === 'portal_layout_changed') {
    return 'MANUAL_ACTION_REQUIRED';
  }

  if (emrStatus === 'PORTAL_ACTION_REQUIRED' || lifecycle === 'collecting_evidence') {
    return 'CLINICAL_GAP_DETECTED';
  }

  if (lifecycle === 'submitted' && !hasProof) {
    return 'SUBMITTED_PENDING_PROOF';
  }

  return '';
}

function titleForCategory(category = '') {
  if (category === 'MANUAL_ACTION_REQUIRED') {
    return 'Manual Action Required';
  }
  if (category === 'CLINICAL_GAP_DETECTED') {
    return 'Clinical Gap Detected';
  }
  return 'Submitted Pending Proof';
}

function defaultAction(category = '') {
  if (category === 'MANUAL_ACTION_REQUIRED') {
    return {
      action: 'retry_with_healed_selector',
      label: 'Retry with Healed Selector',
    };
  }
  if (category === 'CLINICAL_GAP_DETECTED') {
    return {
      action: 'nudge_doctor_slack',
      label: 'Nudge Doctor via Slack',
    };
  }
  return {
    action: 'request_submission_proof',
    label: 'Request Submission Proof',
  };
}

export default function ExceptionCommandCenter({ runs = [], onOneClickFix, onGeneratePeerBrief }) {
  const [activeActionKey, setActiveActionKey] = useState('');

  const groups = useMemo(() => {
    const buckets = {
      MANUAL_ACTION_REQUIRED: [],
      CLINICAL_GAP_DETECTED: [],
      SUBMITTED_PENDING_PROOF: [],
    };

    for (const run of Array.isArray(runs) ? runs : []) {
      const category = categorizeRun(run);
      if (category) {
        buckets[category].push(run);
      }
    }

    return buckets;
  }, [runs]);

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Exception Command Center</p>
          <p className="mt-1 text-sm text-slate-300">Operators focus only on the unresolved 5%.</p>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
          {Object.values(groups).reduce((sum, list) => sum + list.length, 0)} active exceptions
        </span>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {Object.entries(groups).map(([category, categoryRuns]) => {
          const button = defaultAction(category);

          return (
            <div key={category} className="premium-subcard rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{titleForCategory(category)}</p>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">{categoryRuns.length}</span>
              </div>

              <div className="mt-3 space-y-2">
                {categoryRuns.length === 0 ? (
                  <p className="text-xs text-slate-500">No exceptions in this queue.</p>
                ) : (
                  categoryRuns.slice(0, 6).map((run) => {
                    const key = `${run?.appRunId || 'run'}:${button.action}`;
                    return (
                      <div key={run?.appRunId || key} className="rounded-lg border border-slate-700 bg-slate-900/70 p-2">
                        <p className="text-xs font-semibold text-white">{runLabel(run)}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {clean(run?.operatorPacket?.payer_name || run?.intake?.payerName) || 'Unknown payer'} ·{' '}
                          {clean(run?.operatorPacket?.procedure || run?.workflow?.procedure) || 'Unknown procedure'}
                        </p>
                        <button
                          className="premium-button premium-button-soft mt-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-cyan-100 disabled:opacity-50"
                          disabled={activeActionKey === key}
                          onClick={async () => {
                            if (typeof onOneClickFix !== 'function') {
                              return;
                            }
                            setActiveActionKey(key);
                            try {
                              await onOneClickFix({ run, action: button.action });
                            } finally {
                              setActiveActionKey('');
                            }
                          }}
                          type="button"
                        >
                          {activeActionKey === key ? 'Working…' : button.label}
                        </button>
                        {likelyDenied(run) ? (
                          <button
                            className="premium-button mt-2 ml-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-amber-50 disabled:opacity-50"
                            disabled={activeActionKey === `${run?.appRunId || 'run'}:peer_to_peer`}
                            onClick={async () => {
                              if (typeof onGeneratePeerBrief !== 'function') {
                                return;
                              }
                              const peerKey = `${run?.appRunId || 'run'}:peer_to_peer`;
                              setActiveActionKey(peerKey);
                              try {
                                await onGeneratePeerBrief({ run });
                              } finally {
                                setActiveActionKey('');
                              }
                            }}
                            type="button"
                          >
                            {activeActionKey === `${run?.appRunId || 'run'}:peer_to_peer` ? 'Generating…' : 'Generate P2P Brief'}
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
