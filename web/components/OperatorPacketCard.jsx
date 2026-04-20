import { useEffect, useState } from 'react';

function renderList(items, emptyText, tone = 'text-slate-200') {
  if (!items?.length) {
    return <p className="text-sm text-slate-400">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <p key={item} className={`text-sm ${tone}`}>
          - {item}
        </p>
      ))}
    </div>
  );
}

function renderChecklist(items, emptyText) {
  if (!items?.length) {
    return <p className="text-sm text-slate-400">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <p key={`${index + 1}-${item}`} className="text-sm text-slate-200">
          {index + 1}. {item}
        </p>
      ))}
    </div>
  );
}

function renderBlockers(items, emptyText) {
  if (!items?.length) {
    return <p className="text-sm text-slate-400">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.title || 'blocker'}-${index}`} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-amber-100">{item.title || 'Open blocker'}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-amber-300/80">{item.severity || 'review'}</p>
          <p className="mt-2 text-sm text-slate-200">{item.detail || 'No blocker detail provided.'}</p>
          <p className="mt-2 text-sm text-slate-300">{item.resolution || 'Resolution guidance unavailable.'}</p>
        </div>
      ))}
    </div>
  );
}

function renderTaskGroups(groups) {
  if (!groups || typeof groups !== 'object') {
    return <p className="text-sm text-slate-400">No staged staff tasks were prepared yet.</p>;
  }

  const labels = {
    pre_submission_review: 'Pre-submission review',
    evidence_collection: 'Evidence collection',
    portal_entry: 'Portal entry',
    escalation_fallback: 'Escalation fallback',
  };
  const entries = Object.entries(groups).filter(([, items]) => Array.isArray(items) && items.length > 0);

  if (!entries.length) {
    return <p className="text-sm text-slate-400">No staged staff tasks were prepared yet.</p>;
  }

  return (
    <div className="space-y-4">
      {entries.map(([key, items]) => (
        <div key={key}>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{labels[key] || key}</p>
          <div className="mt-2">{renderChecklist(items, 'No tasks')}</div>
        </div>
      ))}
    </div>
  );
}

function actionCopy(action) {
  if (action === 'submit_to_portal') {
    return 'Ready to submit';
  }

  if (action === 'collect_missing_evidence') {
    return 'Collect evidence first';
  }

  return action || 'Review required';
}

function lifecycleLabel(status) {
  return String(status || 'new')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildOperatorPacketBrief(packet) {
  if (!packet) {
    return '';
  }

  const lines = [
    `AuthPilot AI Operator Handoff`,
    ``,
    `Case ID: ${packet.case_id || 'N/A'}`,
    `Payer: ${packet.payer_name || 'N/A'}`,
    `Line of Business: ${packet.line_of_business || 'N/A'}`,
    `Member State: ${packet.member_state || 'N/A'}`,
    `Specialty: ${packet.specialty || 'N/A'}`,
    `Diagnosis: ${packet.diagnosis || 'N/A'}`,
    `Procedure: ${packet.procedure || 'N/A'}`,
    `Policy: ${packet.policy_name || 'N/A'}`,
    `Submission Ready: ${packet.submission_ready ? 'Yes' : 'No'}`,
    `Recommended Action: ${actionCopy(packet.recommended_action)}`,
    `Case Lifecycle: ${lifecycleLabel(packet.case_lifecycle?.status)}`,
    ``,
    `Supporting Evidence:`,
    ...(packet.supporting_evidence?.length ? packet.supporting_evidence.map((item) => `- ${item}`) : ['- None listed']),
    ``,
    `Missing Evidence:`,
    ...(packet.missing_evidence?.length ? packet.missing_evidence.map((item) => `- ${item}`) : ['- None']),
    ``,
    `Provider Precert Phone: ${packet.provider_precert_phone || 'N/A'}`,
    `Provider Precert Notes: ${packet.provider_precert_notes || 'N/A'}`,
    `Policy URL: ${packet.policy_url || 'N/A'}`,
    `Contact URL: ${packet.contact_url || 'N/A'}`,
    `Available Evidence Files: ${packet.available_evidence_files?.length ? packet.available_evidence_files.join(', ') : 'None listed'}`,
    ``,
    `Submission Prep Package:`,
    `Prep Status: ${packet.submission_prep?.status || 'N/A'}`,
    `Readiness Gate: ${packet.submission_prep?.readiness_gate || 'N/A'}`,
    `Owner: ${packet.submission_prep?.owner || 'N/A'}`,
    `Route Review Required: ${packet.submission_prep?.route_review_required ? 'Yes' : 'No'}`,
    `Next Review Trigger: ${packet.submission_prep?.review_summary?.next_review_trigger || 'N/A'}`,
    ``,
    `Submission Blockers:`,
    ...(packet.submission_prep?.blockers?.length
      ? packet.submission_prep.blockers.map(
          (item, index) =>
            `${index + 1}. ${item.title || 'Blocker'} [${item.severity || 'review'}] - ${item.detail || 'No detail'} | ${item.resolution || 'No resolution guidance'}`,
        )
      : ['- None']),
    ``,
    `Staged Staff Tasks:`,
    ...Object.entries(packet.submission_prep?.tasks || {}).flatMap(([key, items]) => {
      if (!Array.isArray(items) || !items.length) {
        return [];
      }
      return [`${key}:`, ...items.map((item, index) => `  ${index + 1}. ${item}`)];
    }),
    ``,
    `Submission Checklist:`,
    ...(packet.submission_checklist?.length ? packet.submission_checklist.map((item, index) => `${index + 1}. ${item}`) : ['- None']),
    ``,
    `Portal Handoff:`,
    `Next Step Title: ${packet.portal_handoff?.next_step_title || 'N/A'}`,
    `Preferred Channel: ${packet.portal_handoff?.preferred_channel || 'N/A'}`,
    `Portal Entry URL: ${packet.portal_handoff?.portal_entry_url || 'N/A'}`,
    `Phone Fallback: ${packet.portal_handoff?.phone_fallback || 'N/A'}`,
    `Delegated Vendor Hint: ${packet.portal_handoff?.delegated_vendor_hint || 'N/A'}`,
    `Route Rationale: ${packet.portal_handoff?.route_rationale || 'N/A'}`,
    `Operator Note: ${packet.portal_handoff?.operator_note || 'N/A'}`,
    ``,
    `Authenticated Portal Target:`,
    `Portal Name: ${packet.authenticated_portal_target?.portalName || 'N/A'}`,
    `Portal URL: ${packet.authenticated_portal_target?.portalUrl || 'N/A'}`,
    `Submission Step: ${packet.authenticated_portal_target?.likelySubmissionStepName || 'N/A'}`,
    `Credentials Needed: ${packet.authenticated_portal_target?.credentialsNeeded || 'N/A'}`,
    `Attachments Supported: ${packet.authenticated_portal_target?.attachmentsSupported ? 'Yes' : 'No'}`,
    ``,
    `Delegated Vendor Portal:`,
    `Vendor Name: ${packet.vendor_portal_target?.vendorName || 'N/A'}`,
    `Vendor URL: ${packet.vendor_portal_target?.portalUrl || 'N/A'}`,
    `Upload Step Present: ${packet.vendor_portal_target?.uploadStepPresent ? 'Yes' : 'No'}`,
    `Common Required Fields: ${
      packet.vendor_portal_target?.commonRequiredFields?.length
        ? packet.vendor_portal_target.commonRequiredFields.join(', ')
        : 'N/A'
    }`,
    ``,
    `Downstream Targets:`,
    ...(packet.downstream_targets?.length
      ? packet.downstream_targets.map(
          (target, index) =>
            `${index + 1}. ${target.systemName || 'Unknown'} | ${target.likelyPayloadFormat || 'N/A'} | ${target.importMethod || 'N/A'} | ${target.url || 'N/A'}`,
        )
      : ['- None']),
  ];

  return lines.join('\n');
}

export default function OperatorPacketCard({ packet, onSyncToEmr, onRunPortalSubmission }) {
  const [copyState, setCopyState] = useState('');
  const [syncConnector, setSyncConnector] = useState('athena');
  const [patientId, setPatientId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [operatorId, setOperatorId] = useState('staff-operator');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState({ tone: '', message: '' });
  const [isSubmittingPortal, setIsSubmittingPortal] = useState(false);
  const [portalFeedback, setPortalFeedback] = useState({ tone: '', message: '' });

  useEffect(() => {
    const targetKeys = Array.isArray(packet?.downstream_targets)
      ? packet.downstream_targets.map((target) => String(target?.key || '').toLowerCase())
      : [];
    if (targetKeys.includes('athena')) {
      setSyncConnector('athena');
      return;
    }
    if (targetKeys.includes('epic')) {
      setSyncConnector('epic');
      return;
    }
    setSyncConnector('athena');
  }, [packet?.downstream_targets]);

  useEffect(() => {
    setPatientId(packet?.patient_id || packet?.emr_sync?.patient_id || '');
    setDepartmentId(packet?.department_id || packet?.emr_sync?.department_id || '');
  }, [packet?.patient_id, packet?.department_id, packet?.emr_sync?.patient_id, packet?.emr_sync?.department_id]);

  if (!packet) {
    return (
      <div className="glass-panel rounded-2xl p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Staff Handoff View</p>
        <div className="premium-empty mt-4 rounded-xl px-4 py-6 text-sm text-slate-400">
          Execution layer initialized. Staff-ready handoff will appear here after the run completes.
        </div>
      </div>
    );
  }

  const ready = Boolean(packet.submission_ready);
  const existingExternalId = packet?.emr_sync?.external_emr_id || '';
  const hasExistingSync = Boolean(existingExternalId);

  const copyBrief = async () => {
    if (!navigator?.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(buildOperatorPacketBrief(packet));
    setCopyState('brief');
    setTimeout(() => setCopyState(''), 1200);
  };

  const downloadBrief = () => {
    const blob = new Blob([buildOperatorPacketBrief(packet)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${packet.case_id || 'authpilot-handoff'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${packet.case_id || 'authpilot-packet'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSyncToEMR = async () => {
    if (!onSyncToEmr) {
      return;
    }

    setIsSyncing(true);
    setSyncFeedback({ tone: '', message: '' });
    try {
      const result = await onSyncToEmr({
        connector: syncConnector,
        patientId,
        departmentId,
        operatorId,
      });

      if (!result?.ok) {
        throw new Error(result?.message || 'Unable to sync packet to EMR.');
      }

      const label = result.externalIdLabel || 'external_emr_id';
      setSyncFeedback({
        tone: 'success',
        message: `Successfully synced. ${label}: ${result.externalEmrId || 'N/A'}`,
      });
    } catch (error) {
      setSyncFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to sync packet to EMR.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePortalSubmission = async () => {
    if (!onRunPortalSubmission) {
      return;
    }

    setIsSubmittingPortal(true);
    setPortalFeedback({ tone: '', message: '' });
    try {
      const result = await onRunPortalSubmission({ payerKey: 'uhc' });
      if (!result?.ok) {
        throw new Error(result?.message || 'Portal submission failed.');
      }
      setPortalFeedback({
        tone: 'success',
        message: `Submitted to payer. Tracking ID: ${result.payerReferenceId || 'N/A'}`,
      });
    } catch (error) {
      setPortalFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Portal submission failed.',
      });
    } finally {
      setIsSubmittingPortal(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Staff Handoff View</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{ready ? 'Submission-ready case' : 'Evidence needed before submission'}</h3>
          <p className="mt-2 text-sm text-slate-300">
            {ready
              ? 'This case appears ready for the next payer step. Staff can use the routing details below immediately.'
              : 'This case is not ready yet. Staff should resolve the missing evidence below before portal work begins.'}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            ready
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
          }`}
        >
          {actionCopy(packet.recommended_action)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
          onClick={() => {
            void copyBrief();
          }}
          type="button"
        >
          {copyState === 'brief' ? 'Copied brief' : 'Copy brief'}
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
          onClick={downloadBrief}
          type="button"
        >
          Download brief
        </button>
        <button
          className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200"
          onClick={downloadJson}
          type="button"
        >
          Download JSON
        </button>
        <button
          className="premium-button premium-button-success rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ready || isSubmittingPortal || !onRunPortalSubmission}
          onClick={() => {
            void handlePortalSubmission();
          }}
          type="button"
        >
          {isSubmittingPortal ? 'Submitting to payer…' : 'Run Portal Submission'}
        </button>
      </div>

      {portalFeedback.message ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            portalFeedback.tone === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-100'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {portalFeedback.message}
        </div>
      ) : null}

      <div className="premium-subcard mt-4 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Sync to EMR</p>
          <span className="text-xs text-slate-400">Packet ID: {packet.case_id || 'N/A'}</span>
        </div>

        {hasExistingSync && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            This packet was already synced (external ID: {existingExternalId}). Re-sync creates a duplicate downstream action.
          </div>
        )}

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="text-xs text-slate-300">
            Connector
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={syncConnector}
              onChange={(event) => setSyncConnector(event.target.value)}
            >
              <option value="athena">athenahealth</option>
              <option value="epic">Epic</option>
            </select>
          </label>

          <label className="text-xs text-slate-300">
            Patient ID
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="Required for athena"
              type="text"
            />
          </label>

          <label className="text-xs text-slate-300">
            Department ID
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              placeholder="Optional for Epic"
              type="text"
            />
          </label>

          <label className="text-xs text-slate-300">
            Operator User ID
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
              value={operatorId}
              onChange={(event) => setOperatorId(event.target.value)}
              placeholder="staff-user-123"
              type="text"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            className="premium-button rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSyncing || !onSyncToEmr}
            onClick={() => {
              void handleSyncToEMR();
            }}
            type="button"
          >
            {isSyncing ? 'Syncing…' : hasExistingSync ? 'Re-sync to EMR' : 'Sync to EMR'}
          </button>

          {packet?.emr_sync?.external_emr_id && (
            <p className="text-xs text-emerald-200">
              Last synced: {packet.emr_sync.last_synced_at || 'unknown'} · ID: {packet.emr_sync.external_emr_id}
            </p>
          )}
        </div>

        {syncFeedback.message ? (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              syncFeedback.tone === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-100'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            {syncFeedback.message}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Case context</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Case: {packet.case_id || 'N/A'}</p>
            <p>Payer: {packet.payer_name || 'N/A'}</p>
            <p>Line of business: {packet.line_of_business || 'N/A'}</p>
            <p>Member state: {packet.member_state || 'N/A'}</p>
            <p>Specialty: {packet.specialty || 'N/A'}</p>
            <p>Diagnosis: {packet.diagnosis || 'N/A'}</p>
            <p>Procedure: {packet.procedure || 'N/A'}</p>
            <p>Lifecycle: {lifecycleLabel(packet.case_lifecycle?.status)}</p>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Payer routing</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Policy: {packet.policy_name || 'N/A'}</p>
            <p>Phone: {packet.provider_precert_phone || 'N/A'}</p>
            <p>Notes: {packet.provider_precert_notes || 'N/A'}</p>
            <p>Delegated vendor: {packet.portal_handoff?.delegated_vendor_hint || 'None detected'}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Supporting evidence</p>
          <div className="mt-3">{renderList(packet.supporting_evidence, 'No supporting evidence was surfaced.', 'text-emerald-100')}</div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing evidence</p>
          <div className="mt-3">{renderList(packet.missing_evidence, 'No missing evidence detected.', 'text-amber-100')}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Submission prep package</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Status: {packet.submission_prep?.status || 'N/A'}</p>
            <p>Readiness gate: {packet.submission_prep?.readiness_gate || 'N/A'}</p>
            <p>Owner: {packet.submission_prep?.owner || 'N/A'}</p>
            <p>Route review required: {packet.submission_prep?.route_review_required ? 'Yes' : 'No'}</p>
            <p>Next review trigger: {packet.submission_prep?.review_summary?.next_review_trigger || 'N/A'}</p>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Submission checklist</p>
          <div className="mt-3">{renderChecklist(packet.submission_checklist, 'Checklist will appear after the downstream action package is built.')}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Submission blockers</p>
          <div className="mt-3">
            {renderBlockers(packet.submission_prep?.blockers, 'No blockers are active. The case can move into submission prep.')}
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Staged staff tasks</p>
          <div className="mt-3">{renderTaskGroups(packet.submission_prep?.tasks)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Portal-ready handoff</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Next step: {packet.portal_handoff?.next_step_title || 'N/A'}</p>
            <p>Preferred channel: {packet.portal_handoff?.preferred_channel || 'N/A'}</p>
            <p>Portal entry: {packet.portal_handoff?.portal_entry_url || 'N/A'}</p>
            <p>Phone fallback: {packet.portal_handoff?.phone_fallback || 'N/A'}</p>
            <p>Route rationale: {packet.portal_handoff?.route_rationale || 'N/A'}</p>
            <p>Operator note: {packet.portal_handoff?.operator_note || 'N/A'}</p>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Required fields</p>
          <div className="mt-3">{renderList(packet.portal_handoff?.required_fields, 'No required fields were captured yet.')}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Authenticated portal target</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Portal: {packet.authenticated_portal_target?.portalName || 'N/A'}</p>
            <p>URL: {packet.authenticated_portal_target?.portalUrl || 'N/A'}</p>
            <p>Submission step: {packet.authenticated_portal_target?.likelySubmissionStepName || 'N/A'}</p>
            <p>Credentials: {packet.authenticated_portal_target?.credentialsNeeded || 'N/A'}</p>
            <p>Attachments: {packet.authenticated_portal_target?.attachmentsSupported ? 'Supported' : 'Unknown / not mapped'}</p>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Delegated vendor portal</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Vendor: {packet.vendor_portal_target?.vendorName || 'N/A'}</p>
            <p>URL: {packet.vendor_portal_target?.portalUrl || 'N/A'}</p>
            <p>Upload step: {packet.vendor_portal_target?.uploadStepPresent ? 'Present' : 'Unknown / not mapped'}</p>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Common required fields</p>
              <div className="mt-2">
                {renderList(packet.vendor_portal_target?.commonRequiredFields, 'No vendor field list mapped yet.')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Attachment staging</p>
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Ready now</p>
              <div className="mt-2">{renderList(packet.portal_handoff?.attachments_ready, 'No evidence files were staged yet.', 'text-emerald-100')}</div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Still missing</p>
              <div className="mt-2">{renderList(packet.portal_handoff?.attachments_missing, 'No missing attachments detected.', 'text-amber-100')}</div>
            </div>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Review metrics</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Matched evidence count: {packet.submission_prep?.review_summary?.matched_evidence_count ?? 'N/A'}</p>
            <p>Missing evidence count: {packet.submission_prep?.review_summary?.missing_evidence_count ?? 'N/A'}</p>
            <p>Available file count: {packet.submission_prep?.review_summary?.available_file_count ?? 'N/A'}</p>
            <p>Checklist steps: {packet.submission_prep?.submission_checklist_count ?? packet.submission_checklist?.length ?? 'N/A'}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Downstream targets</p>
          <div className="mt-3 space-y-3">
            {packet.downstream_targets?.length ? (
              packet.downstream_targets.map((target) => (
                <div key={target.key || target.systemName} className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-sm font-semibold text-white">{target.systemName || 'Unknown system'}</p>
                  <p className="mt-1 text-xs text-slate-400">{target.likelyPayloadFormat || 'Unknown payload format'}</p>
                  <p className="mt-1 text-xs text-slate-300">{target.importMethod || 'No import method mapped yet.'}</p>
                  <p className="mt-1 break-all text-xs text-cyan-200">{target.url || 'No public API URL mapped yet.'}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No downstream systems have been selected yet.</p>
            )}
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">PHI-safe defaults</p>
          <div className="mt-3 space-y-3">
            {packet.phi_safe_defaults?.length ? (
              packet.phi_safe_defaults.map((item) => (
                <div key={item.topic} className="premium-subcard-soft rounded-lg p-3">
                  <p className="text-sm font-semibold text-white">{item.topic}</p>
                  <p className="mt-1 text-xs text-slate-300">{item.recommendedDefault}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.implementationImplication}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No PHI-safe defaults were attached to this packet yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Route context</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Payer: {packet.portal_handoff?.route_context?.payer || packet.payer_name || 'N/A'}</p>
            <p>Line of business: {packet.portal_handoff?.route_context?.line_of_business || packet.line_of_business || 'N/A'}</p>
            <p>Member state: {packet.portal_handoff?.route_context?.member_state || packet.member_state || 'N/A'}</p>
            <p>Specialty: {packet.portal_handoff?.route_context?.specialty || packet.specialty || 'N/A'}</p>
          </div>
        </div>

        <div className="premium-subcard rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Route sources</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>Policy source: {packet.portal_handoff?.source_summary?.policy_source_url || packet.policy_url || 'N/A'}</p>
            <p>Contact source: {packet.portal_handoff?.source_summary?.contact_source_url || packet.contact_url || 'N/A'}</p>
          </div>
        </div>
      </div>

      <div className="premium-subcard mt-4 rounded-xl p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Source links</p>
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-slate-200">Policy URL: <span className="break-all text-cyan-200">{packet.policy_url || 'N/A'}</span></p>
          <p className="text-slate-200">Contact URL: <span className="break-all text-cyan-200">{packet.contact_url || 'N/A'}</span></p>
        </div>
      </div>
    </div>
  );
}
