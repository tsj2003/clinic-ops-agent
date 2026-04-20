'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AntigravityCanvas from '@/components/AntigravityCanvas';
import TypewriterHeading from '@/components/TypewriterHeading';
import AdminMetricsPanel from '@/components/AdminMetricsPanel';
import BatchUploadDashboard from '@/components/BatchUploadDashboard';
import ConfidenceMeter from '@/components/ConfidenceMeter';
import ExceptionCommandCenter from '@/components/ExceptionCommandCenter';
import ExecutionPanel from '@/components/ExecutionPanel';
import GuidedIntakePanel from '@/components/GuidedIntakePanel';
import IntakePollerPanel from '@/components/IntakePollerPanel';
import LogPanel from '@/components/LogPanel';
import OperatorPacketCard, { buildOperatorPacketBrief } from '@/components/OperatorPacketCard';
import PilotCommitmentPanel from '@/components/PilotCommitmentPanel';
import PolicySentinelPanel from '@/components/PolicySentinelPanel';
import RevenuePanel from '@/components/RevenuePanel';
import RunHistoryPanel from '@/components/RunHistoryPanel';
import StatusCard from '@/components/StatusCard';
import VitalsHeader from '@/components/VitalsHeader';
import WorkspacePanel from '@/components/WorkspacePanel';
import useBatchIntake from '@/hooks/useBatchIntake';
import { buildCaseBundle, buildOperatorPacketCsv, parseCaseBundle } from '@/lib/case-bundle';
import { getPayerProcedureSuggestion } from '@/lib/payer-intelligence';
import { buildWebhookReadyExport, enrichOperatorPacketWithExecutionPlan, getPortalExecutionPlan } from '@/lib/portal-targets';

const STATUS_BADGE = {
  idle: { text: '● Ready', tone: 'text-slate-100 border-slate-600 bg-slate-800/80' },
  running: { text: '🟢 Running', tone: 'text-green-100 border-green-500/40 bg-green-500/10' },
  error: { text: '🔴 Error', tone: 'text-red-100 border-red-500/50 bg-red-500/10' },
  recovering: { text: '🟡 Recovering', tone: 'text-amber-100 border-amber-500/50 bg-amber-500/10' },
  completed: { text: '✅ Completed', tone: 'text-blue-100 border-blue-500/50 bg-blue-500/10' },
};

const DEFAULT_WORKFLOW = {
  name: 'Awaiting default TinyFish workflow',
  url: 'Awaiting live workflow URL',
  goal: '',
  contactName: 'Awaiting default contact workflow',
  contactUrl: 'Awaiting live contact URL',
  mode: 'autoplay',
  workspaceName: '',
  caseId: 'Awaiting run',
  procedure: 'Awaiting run',
};

const PILOT_WORKSPACE_TEMPLATES = {
  spine_mri_commercial: {
    workspaceName: 'Pilot · Spine MRI Commercial',
    intake: {
      payerName: 'Aetna',
      lineOfBusiness: 'Commercial',
      memberState: 'TX',
      specialty: 'Spine/Pain',
      procedureLabel: 'Lumbar spine MRI',
      diagnosis: 'M54.16 - Radiculopathy, lumbar region',
      caseLabel: 'PILOT-SPINE-MRI',
      policyPageUrl: 'https://www.aetna.com/cpb/medical/data/200_299/0236.html',
      contactPageUrl: 'https://www.aetna.com/about-us/contact-aetna.html',
      chartSummary:
        'Persistent lumbar radicular pain despite conservative therapy with PT, NSAID trial, and home exercise. Functional limitation remains after six weeks.',
      evidenceFiles: 'PT_progress_note.pdf, PCP_followup_note.pdf, lumbar_xray_report.pdf',
    },
  },
  pain_management_repeat_denial: {
    workspaceName: 'Pilot · Pain Management Repeat Denial',
    intake: {
      payerName: 'UnitedHealthcare',
      lineOfBusiness: 'Medicare Advantage',
      memberState: 'FL',
      specialty: 'Pain Management',
      procedureLabel: 'Lumbar epidural steroid injection',
      diagnosis: 'M54.5 - Low back pain',
      caseLabel: 'PILOT-PAIN-ESI',
      policyPageUrl: '',
      contactPageUrl: '',
      chartSummary:
        'Chronic low back pain with failed conservative management, persistent functional impairment, and prior medication trial documented.',
      evidenceFiles: 'prior_auth_denial.pdf, procedure_note.pdf, medication_history.pdf',
    },
  },
};

function createInitialProofState() {
  return {
    runtimeMode: 'pending',
    policy: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
    contact: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
  };
}

function createInitialFailureState() {
  return null;
}

function createInitialSourceDiscoveryState() {
  return {
    status: 'idle',
    error: '',
    result: null,
  };
}

function createInitialCustomConfig() {
  return {
    workflowName: 'Custom policy readiness check',
    workflowUrl: '',
    workflowGoal: 'Read this payer policy page and return compact JSON with keys: policy_name, evidence_requirements, page_url.',
    contactWorkflowName: 'Custom prior authorization contact lookup',
    contactWorkflowUrl: '',
    contactWorkflowGoal:
      'For providers seeking prior authorization help, return compact JSON with keys: provider_precert_phone, provider_precert_notes, source_page_url.',
  };
}

function createInitialGuidedIntake() {
  return {
    payerName: '',
    lineOfBusiness: '',
    memberState: '',
    specialty: '',
    procedureLabel: '',
    diagnosis: '',
    caseLabel: '',
    policyPageUrl: '',
    contactPageUrl: '',
    chartSummary: '',
    evidenceFiles: '',
  };
}

function buildGeneratedConfigFromIntake(intake, suggestion = null) {
  const payerName = intake.payerName?.trim() || 'Payer';
  const specialty = intake.specialty?.trim() || 'specialty care';
  const procedureLabel = intake.procedureLabel?.trim() || 'requested procedure';
  const lineOfBusiness = intake.lineOfBusiness?.trim();
  const memberState = intake.memberState?.trim().toUpperCase();
  const generated = suggestion?.generatedConfig || {};
  const contextParts = [memberState, lineOfBusiness].filter(Boolean);
  const contextDescriptor = contextParts.length ? ` for ${contextParts.join(' ')}` : '';

  return {
    workflowName: generated.workflowName || `${payerName} ${procedureLabel} readiness check`,
    workflowUrl: intake.policyPageUrl?.trim() || suggestion?.suggestedPolicyUrl || '',
    workflowGoal:
      generated.workflowGoal ||
      (`Read this ${payerName} policy page for ${procedureLabel} in ${specialty}${contextDescriptor} and return compact JSON with keys: ` +
        'policy_name, evidence_requirements, page_url.'),
    contactWorkflowName: generated.contactWorkflowName || `${payerName} prior authorization contact lookup`,
    contactWorkflowUrl: intake.contactPageUrl?.trim() || suggestion?.suggestedContactUrl || '',
    contactWorkflowGoal:
      generated.contactWorkflowGoal ||
      (`For providers seeking prior authorization help for ${procedureLabel} in ${specialty}${contextDescriptor}, ` +
        'return compact JSON with keys: provider_precert_phone, provider_precert_notes, source_page_url.'),
  };
}

function buildEffectiveIntake(intake, suggestion = null) {
  return {
    ...intake,
    policyPageUrl: intake.policyPageUrl?.trim() || suggestion?.suggestedPolicyUrl || '',
    contactPageUrl: intake.contactPageUrl?.trim() || suggestion?.suggestedContactUrl || '',
  };
}

function validateGuidedIntake(intake) {
  const missing = [];

  if (!intake.payerName?.trim()) missing.push('payer name');
  if (!intake.procedureLabel?.trim()) missing.push('procedure');
  if (!intake.diagnosis?.trim()) missing.push('diagnosis');
  if (!intake.policyPageUrl?.trim()) missing.push('policy page URL');
  if (!intake.contactPageUrl?.trim()) missing.push('contact page URL');
  if (!intake.chartSummary?.trim()) missing.push('chart summary');

  return missing;
}

function inferCaseLifecycleFromPacket(packet) {
  if (!packet) {
    return null;
  }

  if (packet.case_lifecycle) {
    return packet.case_lifecycle;
  }

  const status = packet.submission_ready ? 'ready_for_submission' : packet.missing_evidence?.length ? 'collecting_evidence' : 'new';
  return {
    status,
    notes: '',
    updatedAt: '',
    history: [],
  };
}

function withCaseLifecycle(packet, lifecycle) {
  if (!packet) {
    return packet;
  }
  return {
    ...packet,
    case_lifecycle: lifecycle || inferCaseLifecycleFromPacket(packet),
  };
}

function buildDisplayPacket(packet, lifecycle = null) {
  return enrichOperatorPacketWithExecutionPlan(withCaseLifecycle(packet, lifecycle));
}

function extractEmrFailureMessage(payload = {}) {
  const executed = Array.isArray(payload.executed) ? payload.executed : [];
  const failed = executed.find((item) => item?.ok === false && !item?.skipped);
  if (!failed) {
    return '';
  }

  const message =
    failed?.response?.message ||
    failed?.response?.detail ||
    failed?.response?.error ||
    failed?.reason ||
    'EMR sync failed.';
  const connector = String(failed.connector || 'emr').toUpperCase();
  return `${connector}: ${message}`;
}

function normalizeRunLifecycleStatus(run = {}) {
  return String(run?.caseLifecycle?.status || '').trim().toLowerCase();
}

function normalizeRunEmrStatus(run = {}) {
  return String(run?.operatorPacket?.emr_sync?.status || run?.emrSync?.status || '')
    .trim()
    .toUpperCase();
}

function hasSubmissionProof(run = {}) {
  return Boolean(
    String(run?.operatorPacket?.emr_sync?.proof_screenshot_path || run?.emrSync?.proof_screenshot_path || '').trim(),
  );
}

function isManualActionException(run = {}) {
  const lifecycle = normalizeRunLifecycleStatus(run);
  const emrStatus = normalizeRunEmrStatus(run);
  const jellyBean = String(run?.operatorPacket?.emr_sync?.jelly_bean_alert || run?.emrSync?.jelly_bean_alert || '')
    .trim()
    .toUpperCase();

  return (
    lifecycle === 'escalated' ||
    lifecycle === 'portal_layout_changed' ||
    emrStatus === 'MANUAL_ACTION_REQUIRED' ||
    jellyBean === 'MANUAL_ACTION_REQUIRED'
  );
}

function isClinicalGapException(run = {}) {
  const lifecycle = normalizeRunLifecycleStatus(run);
  const emrStatus = normalizeRunEmrStatus(run);
  return lifecycle === 'collecting_evidence' || emrStatus === 'PORTAL_ACTION_REQUIRED';
}

function isSubmittedPendingProof(run = {}) {
  const lifecycle = normalizeRunLifecycleStatus(run);
  return lifecycle === 'submitted' && !hasSubmissionProof(run);
}

export default function HomePage() {
  const [runMode, setRunMode] = useState('default');
  const [uiTab, setUiTab] = useState('verdict');
  const [viewMode, setViewMode] = useState('operator');
  const [checklistState, setChecklistState] = useState({});
  const [openOperatorSections, setOpenOperatorSections] = useState({
    caseDetails: false,
    payerRouting: false,
    files: false,
    sourceLinks: false,
  });
  const [thinkingLogs, setThinkingLogs] = useState([]);
  const [executionLogs, setExecutionLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [confidenceTrend, setConfidenceTrend] = useState('neutral');
  const [confidenceText, setConfidenceText] = useState('🧠 Ready to analyze clinical input...');
  const [liveStatus, setLiveStatus] = useState('idle');
  const [errorMoment, setErrorMoment] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [endedAt, setEndedAt] = useState(null);
  const [status, setStatus] = useState({ queued: 1, processing: 0, needsEvidence: 0, ready: 0 });
  const [workflow, setWorkflow] = useState(DEFAULT_WORKFLOW);
  const [artifact, setArtifact] = useState(null);
  const [operatorPacket, setOperatorPacket] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [proofState, setProofState] = useState(createInitialProofState);
  const [failureState, setFailureState] = useState(createInitialFailureState);
  const [snapshotDiff, setSnapshotDiff] = useState(null);
  const [currentRunId, setCurrentRunId] = useState('');
  const [historyMode, setHistoryMode] = useState('waiting');
  const [historyError, setHistoryError] = useState('');
  const [runHistory, setRunHistory] = useState([]);
  const [lifecycleDrafts, setLifecycleDrafts] = useState({});
  const [lifecycleSavingId, setLifecycleSavingId] = useState('');
  const [customConfig, setCustomConfig] = useState(createInitialCustomConfig);
  const [guidedIntake, setGuidedIntake] = useState(createInitialGuidedIntake);
  const [guidedIntakeError, setGuidedIntakeError] = useState('');
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState('waiting');
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [sourceDiscovery, setSourceDiscovery] = useState(createInitialSourceDiscoveryState);
  const [pilotCommitments, setPilotCommitments] = useState([]);
  const [pilotCommitmentMode, setPilotCommitmentMode] = useState('waiting');
  const [pilotCommitmentError, setPilotCommitmentError] = useState('');
  const [isSavingPilotCommitment, setIsSavingPilotCommitment] = useState(false);
  const [savingPilotCommitmentId, setSavingPilotCommitmentId] = useState('');
  const [intakeBatchRows, setIntakeBatchRows] = useState([]);
  const [intakeBatchCursor, setIntakeBatchCursor] = useState(0);
  const [intakeBatchMeta, setIntakeBatchMeta] = useState({ total: 0, valid: 0, invalid: 0 });
  const [operatorUserId, setOperatorUserId] = useState('staff-operator');
  const [activeOpsTab, setActiveOpsTab] = useState('exceptions');
  const [runtimeNow, setRuntimeNow] = useState(Date.now());
  const [statusPulse, setStatusPulse] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeChecklistIndex, setActiveChecklistIndex] = useState(0);
  const [completionToast, setCompletionToast] = useState(null);
  const [streamConnection, setStreamConnection] = useState('idle');
  const [newHistoryRunId, setNewHistoryRunId] = useState('');
  const [manualBaselineMinutes, setManualBaselineMinutes] = useState('');

  const sourceRef = useRef(null);
  const importBundleInputRef = useRef(null);
  const importBatchIntakeInputRef = useRef(null);
  const queueRef = useRef([]);
  const processingRef = useRef(false);
  const autoStartRef = useRef(false);
  const hasResultRef = useRef(false);
  const hasErrorRef = useRef(false);
  const lastOutcomeRef = useRef('');
  const previousLiveStatusRef = useRef('idle');

  const batchIntake = useBatchIntake({
    onCommitted: async () => {
      await loadRunHistory();
    },
  });

  useEffect(() => {
    if (!isRunning || !startedAt) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setRuntimeNow(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isRunning, startedAt]);

  const summary = useMemo(() => {
    const elapsedEnd = endedAt || (isRunning ? runtimeNow : null);
    const elapsedSeconds = startedAt && elapsedEnd ? Math.max(1, Math.round((elapsedEnd - startedAt) / 1000)) : 0;
    return {
      elapsedSeconds,
      matchingEvidence: readiness?.supporting_evidence?.length || 0,
      missingEvidence: readiness?.missing_evidence?.length || 0,
      outcome:
        liveStatus === 'error'
          ? '❌ LIVE RUN FAILED'
          : liveStatus === 'completed'
          ? readiness
            ? readiness.ready
              ? '✅ SUBMISSION READY'
              : '⚠️ ADDITIONAL EVIDENCE REQUIRED'
            : '🧾 READINESS ANALYSIS COMPLETE'
          : 'Awaiting run',
    };
  }, [endedAt, isRunning, liveStatus, readiness, runtimeNow, startedAt]);

  const operatorChecklistEntries = useMemo(() => {
    const checklist = Array.isArray(operatorPacket?.submission_checklist) ? operatorPacket.submission_checklist.slice(0, 6) : [];
    if (checklist.length) {
      return checklist.map((item) => ({
        id: item,
        label: item,
        done: Boolean(checklistState[item]),
        autoDerived: false,
      }));
    }

    const missingEvidenceCount = readiness?.missing_evidence?.length || 0;
    const hasEvidenceFiles = Array.isArray(operatorPacket?.available_evidence_files) && operatorPacket.available_evidence_files.length > 0;

    return [
      {
        id: 'live-policy',
        label: `Policy extraction ${proofState.policy.status === 'completed' ? 'completed' : 'in progress'}`,
        done: proofState.policy.status === 'completed',
        autoDerived: true,
      },
      {
        id: 'live-routing',
        label: `Routing lookup ${proofState.contact.status === 'completed' ? 'completed' : 'in progress'}`,
        done: proofState.contact.status === 'completed',
        autoDerived: true,
      },
      {
        id: 'live-evidence',
        label: `Evidence gaps ${missingEvidenceCount === 0 ? 'resolved' : `open (${missingEvidenceCount})`}`,
        done: missingEvidenceCount === 0 && Boolean(readiness),
        autoDerived: true,
      },
      {
        id: 'live-packet',
        label: `Operator packet ${operatorPacket ? 'generated' : 'pending'}`,
        done: Boolean(operatorPacket),
        autoDerived: true,
      },
      {
        id: 'live-ready',
        label: `Submission readiness ${readiness?.ready ? 'confirmed' : 'not ready yet'}`,
        done: Boolean(readiness?.ready) || (hasEvidenceFiles && missingEvidenceCount === 0),
        autoDerived: true,
      },
    ];
  }, [checklistState, operatorPacket, proofState.contact.status, proofState.policy.status, readiness]);
  const checklistCompleteCount = useMemo(
    () => operatorChecklistEntries.filter((item) => item.done).length,
    [operatorChecklistEntries],
  );
  const checklistCompletionPercent = useMemo(() => {
    if (!operatorChecklistEntries.length) {
      return 0;
    }
    return Math.round((checklistCompleteCount / operatorChecklistEntries.length) * 100);
  }, [checklistCompleteCount, operatorChecklistEntries.length]);
  const hasPacketChecklist = useMemo(
    () => Array.isArray(operatorPacket?.submission_checklist) && operatorPacket.submission_checklist.length > 0,
    [operatorPacket],
  );

  const intelligenceSuggestion = useMemo(() => getPayerProcedureSuggestion(guidedIntake), [guidedIntake]);
  const portalExecutionPlan = useMemo(
    () =>
      getPortalExecutionPlan({
        payerName: guidedIntake.payerName,
        lineOfBusiness: guidedIntake.lineOfBusiness,
        memberState: guidedIntake.memberState,
        procedureLabel: guidedIntake.procedureLabel,
        specialty: guidedIntake.specialty,
        vendorName: intelligenceSuggestion?.routingStrategy?.vendorName || '',
      }),
    [guidedIntake, intelligenceSuggestion],
  );

  const activeBadge = STATUS_BADGE[liveStatus] || STATUS_BADGE.idle;
  const policyActive = ['started', 'session_connected', 'completed', 'failed'].includes(proofState.policy.status);
  const contactActive = ['started', 'session_connected', 'completed', 'failed'].includes(proofState.contact.status);
  const verdictActive = liveStatus === 'completed' || liveStatus === 'error';
  const displayWorkflow =
    runMode === 'custom' && !isRunning
      ? {
          ...workflow,
          name: customConfig.workflowName || 'Custom policy readiness check',
          url: customConfig.workflowUrl || guidedIntake.policyPageUrl || 'Awaiting custom policy URL',
          goal: customConfig.workflowGoal,
          contactName: customConfig.contactWorkflowName || 'Custom prior authorization contact lookup',
          contactUrl: customConfig.contactWorkflowUrl || guidedIntake.contactPageUrl || 'Awaiting custom contact URL',
          mode: activeWorkspaceId ? 'workspace draft' : 'custom draft',
          workspaceName: workspaceName || '',
          caseId: guidedIntake.caseLabel || 'Awaiting run',
          procedure: guidedIntake.procedureLabel || 'Awaiting run',
        }
      : workflow;

  const liveRunKpis = useMemo(() => {
    const runs = Array.isArray(runHistory) ? runHistory : [];
    const total = runs.length;
    if (!total) {
      return {
        total: 0,
        successRate: 0,
        avgElapsed: 0,
        gapRate: 0,
      };
    }
    const completed = runs.filter((run) => run.status === 'completed').length;
    const withGaps = runs.filter((run) => (run?.readiness?.missing_evidence?.length || 0) > 0).length;
    const elapsedValues = runs.map((run) => Number(run?.metrics?.elapsedSeconds || 0)).filter((value) => value > 0);
    const avgElapsed = elapsedValues.length ? Math.round(elapsedValues.reduce((sum, value) => sum + value, 0) / elapsedValues.length) : 0;
    return {
      total,
      successRate: Math.round((completed / total) * 100),
      avgElapsed,
      gapRate: Math.round((withGaps / total) * 100),
    };
  }, [runHistory]);
  const runDerivedStatus = useMemo(() => {
    const runs = Array.isArray(runHistory) ? runHistory : [];
    return {
      ready: runs.filter((run) => Boolean(run?.readiness?.ready)).length,
      clinicalGapDetected: runs.filter((run) => (run?.readiness?.missing_evidence?.length || 0) > 0).length,
      manualActionRequired: runs.filter((run) => {
        const lifecycle = normalizeRunLifecycleStatus(run);
        const emrStatus = normalizeRunEmrStatus(run);
        return lifecycle === 'escalated' || emrStatus === 'MANUAL_ACTION_REQUIRED';
      }).length,
      submittedPendingProof: runs.filter((run) => normalizeRunLifecycleStatus(run) === 'submitted' && !hasSubmissionProof(run)).length,
    };
  }, [runHistory]);
  const kpiComparison = useMemo(() => {
    const baselineMinutes = Number(manualBaselineMinutes);
    const validBaselineMinutes = Number.isFinite(baselineMinutes) && baselineMinutes > 0 ? baselineMinutes : null;
    const currentElapsedSeconds = summary.elapsedSeconds > 0 ? summary.elapsedSeconds : null;
    const fallbackElapsedSeconds = liveRunKpis.avgElapsed > 0 ? liveRunKpis.avgElapsed : null;
    const measuredElapsedSeconds = currentElapsedSeconds ?? fallbackElapsedSeconds;
    if (!validBaselineMinutes || !measuredElapsedSeconds) {
      return {
        hasData: false,
        baselineMinutes: validBaselineMinutes,
        measuredSeconds: measuredElapsedSeconds,
        source: currentElapsedSeconds ? 'current_run' : fallbackElapsedSeconds ? 'run_history_avg' : 'none',
      };
    }
    const baselineSeconds = validBaselineMinutes * 60;
    const secondsSaved = Math.max(0, baselineSeconds - measuredElapsedSeconds);
    const percentFaster = baselineSeconds > 0 ? Math.max(0, (secondsSaved / baselineSeconds) * 100) : 0;
    return {
      hasData: true,
      baselineMinutes: validBaselineMinutes,
      measuredSeconds: measuredElapsedSeconds,
      minutesSaved: secondsSaved / 60,
      percentFaster,
      source: currentElapsedSeconds ? 'current_run' : 'run_history_avg',
    };
  }, [liveRunKpis.avgElapsed, manualBaselineMinutes, summary.elapsedSeconds]);

  const tabButtonClass = (tabId) =>
    `premium-button rounded-xl border-b-2 px-3 py-2 text-left text-sm font-semibold transition-all duration-150 ${
      uiTab === tabId
        ? 'border-b-red-400 border-red-500/40 bg-red-500/10 text-red-100'
        : 'border-b-transparent premium-button-soft text-slate-300 hover:bg-slate-800/60'
    }`;
  const showSetupPanel = uiTab === 'configure';
  const topBarContext = useMemo(() => {
    if (viewMode === 'operator') {
      if (uiTab === 'packet') {
        return {
          icon: readiness?.ready ? '✅' : '⚠️',
          text: `${displayWorkflow.caseId || 'Awaiting run'} · ${checklistCompleteCount}/${operatorChecklistEntries.length} items complete`,
          ctaLabel: readiness?.ready ? 'Submit When Ready' : 'Run Live Workflow',
          ctaAction: readiness?.ready
            ? () => {
                void triggerPrimarySubmission();
              }
            : () => {
                void runDemo(runMode);
              },
          ctaDisabled: readiness?.ready ? !operatorPacket : isRunning,
        };
      }
      return {
        icon: readiness?.ready ? '✅' : liveStatus === 'error' ? '❌' : '⚠️',
        text: `${displayWorkflow.caseId || 'Awaiting run'} · ${summary.outcome} · ${summary.matchingEvidence}/${Math.max(1, summary.matchingEvidence + summary.missingEvidence)} matched`,
        ctaLabel: readiness?.ready ? 'Run Portal Submission' : 'Run Live Workflow',
        ctaAction: readiness?.ready
          ? () => {
              void triggerPrimarySubmission();
            }
          : () => {
              void runDemo(runMode);
            },
        ctaDisabled: readiness?.ready ? !operatorPacket : isRunning,
      };
    }

    if (uiTab === 'logs') {
      return {
        icon: isRunning ? '🟢' : '⚪',
        text: `${displayWorkflow.caseId || 'Awaiting run'} · ${isRunning ? 'Running' : 'Idle'} · ${summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : '-'} · ${readiness?.confidence ?? confidence ?? 0}% confidence`,
        ctaLabel: isRunning ? 'Running...' : 'Run Live Workflow',
        ctaAction: () => {
          void runDemo(runMode);
        },
        ctaDisabled: isRunning,
      };
    }

    if (uiTab === 'history') {
      return {
        icon: '🕘',
        text: `Run history · ${liveRunKpis.total} runs · ${liveRunKpis.successRate}% success · avg ${liveRunKpis.avgElapsed || '-'}s · gaps ${liveRunKpis.gapRate}%`,
        ctaLabel: isRunning ? 'Running...' : 'Run Live Workflow',
        ctaAction: () => {
          void runDemo(runMode);
        },
        ctaDisabled: isRunning,
      };
    }

    if (uiTab === 'configure') {
      return {
        icon: '⚙️',
        text: `Configure workflow · ${runMode === 'custom' ? 'Custom mode' : 'Autoplay mode'} · ${displayWorkflow.caseId || 'Awaiting run'}`,
        ctaLabel: isRunning ? 'Running...' : runMode === 'custom' ? 'Run Custom Workflow' : 'Run Live Workflow',
        ctaAction: () => {
          void runDemo(runMode);
        },
        ctaDisabled: isRunning,
      };
    }

    return {
      icon: '📦',
      text: `${displayWorkflow.caseId || 'Awaiting run'} · Technical packet view`,
      ctaLabel: isRunning ? 'Running...' : 'Run Live Workflow',
      ctaAction: () => {
        void runDemo(runMode);
      },
      ctaDisabled: isRunning,
    };
  }, [
    checklistCompleteCount,
    confidence,
    displayWorkflow.caseId,
    historyMode,
    isRunning,
    liveStatus,
    operatorChecklistEntries.length,
    operatorPacket,
    readiness?.confidence,
    readiness?.ready,
    runHistory.length,
    liveRunKpis.avgElapsed,
    liveRunKpis.gapRate,
    liveRunKpis.successRate,
    liveRunKpis.total,
    runMode,
    summary.elapsedSeconds,
    summary.matchingEvidence,
    summary.missingEvidence,
    summary.outcome,
    uiTab,
    viewMode,
  ]);

  const toggleOperatorSection = (sectionKey) => {
    setOpenOperatorSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const toggleChecklistItem = (itemKey) => {
    if (!hasPacketChecklist) {
      return;
    }
    setChecklistState((prev) => ({
      ...prev,
      [itemKey]: !prev[itemKey],
    }));
  };

  const triggerPrimarySubmission = async () => {
    try {
      await handleRunPortalSubmission({ payerKey: 'uhc' });
      setErrorMoment({
        title: 'Submission Triggered',
        message: 'Portal submission automation started.',
      });
      setTimeout(() => setErrorMoment(null), 1800);
    } catch (error) {
      setErrorMoment({
        title: 'Submission Failed',
        message: error instanceof Error ? error.message : 'Unable to trigger portal submission.',
      });
      setTimeout(() => setErrorMoment(null), 2200);
    }
  };

  useEffect(() => {
    const packetChecklist = Array.isArray(operatorPacket?.submission_checklist) ? operatorPacket.submission_checklist.slice(0, 6) : [];
    if (!packetChecklist.length) {
      return;
    }
    setChecklistState((prev) => {
      const next = {};
      packetChecklist.forEach((item) => {
        next[item] = prev[item] || false;
      });
      return next;
    });
  }, [operatorPacket]);

  useEffect(() => {
    setActiveChecklistIndex((prev) => {
      if (!operatorChecklistEntries.length) {
        return 0;
      }
      return Math.min(prev, operatorChecklistEntries.length - 1);
    });
  }, [operatorChecklistEntries.length]);

  useEffect(() => {
    if (!summary.outcome) {
      return undefined;
    }
    if (!lastOutcomeRef.current) {
      lastOutcomeRef.current = summary.outcome;
      return undefined;
    }
    if (lastOutcomeRef.current !== summary.outcome) {
      setStatusPulse(true);
      const timerId = window.setTimeout(() => setStatusPulse(false), 420);
      lastOutcomeRef.current = summary.outcome;
      return () => window.clearTimeout(timerId);
    }
    return undefined;
  }, [summary.outcome]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('authpilot_manual_baseline_minutes');
      if (saved && !Number.isNaN(Number(saved))) {
        setManualBaselineMinutes(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('authpilot_manual_baseline_minutes', manualBaselineMinutes || '');
    } catch {}
  }, [manualBaselineMinutes]);

  useEffect(() => {
    if (previousLiveStatusRef.current !== 'completed' && liveStatus === 'completed') {
      const caseLabel = displayWorkflow.caseId || operatorPacket?.case_id || 'Case';
      const message = readiness?.ready
        ? `${caseLabel} — Submission Ready`
        : `${caseLabel} — Additional Evidence Required`;
      setCompletionToast({
        title: readiness?.ready ? 'Run completed' : 'Run completed with gaps',
        message,
      });
      const timerId = window.setTimeout(() => {
        setCompletionToast(null);
      }, 7000);
      previousLiveStatusRef.current = liveStatus;
      return () => window.clearTimeout(timerId);
    }
    previousLiveStatusRef.current = liveStatus;
    return undefined;
  }, [displayWorkflow.caseId, liveStatus, operatorPacket?.case_id, readiness?.ready]);

  useEffect(() => {
    if (viewMode === 'operator' && ['logs', 'history', 'configure'].includes(uiTab)) {
      setUiTab('verdict');
    }
    if (viewMode === 'technical' && ['verdict'].includes(uiTab)) {
      setUiTab('logs');
    }
  }, [viewMode, uiTab]);

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!target || !(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const onKeyDown = (event) => {
      if (isEditableElement(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const operatorTabs = ['verdict', 'packet'];
      const technicalTabs = ['logs', 'history', 'configure', 'packet'];
      const activeTabs = viewMode === 'operator' ? operatorTabs : technicalTabs;

      if (key === '?') {
        event.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      if (key === 'escape') {
        if (showShortcuts) {
          event.preventDefault();
          setShowShortcuts(false);
          return;
        }
        if (openOperatorSections.caseDetails || openOperatorSections.payerRouting || openOperatorSections.files || openOperatorSections.sourceLinks) {
          event.preventDefault();
          setOpenOperatorSections({
            caseDetails: false,
            payerRouting: false,
            files: false,
            sourceLinks: false,
          });
        }
        return;
      }

      if (key === 'o') {
        event.preventDefault();
        setViewMode('operator');
        return;
      }

      if (key === 't') {
        event.preventDefault();
        setViewMode('technical');
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        void runDemo(runMode);
        return;
      }

      if (key === 'enter') {
        if (viewMode === 'operator' && (uiTab === 'verdict' || uiTab === 'packet')) {
          event.preventDefault();
          if (operatorPacket && readiness?.ready) {
            void triggerPrimarySubmission();
          }
        }
        return;
      }

      if ((key === 'j' || key === 'k') && viewMode === 'operator' && (uiTab === 'verdict' || uiTab === 'packet')) {
        event.preventDefault();
        if (!operatorChecklistEntries.length) {
          return;
        }
        setActiveChecklistIndex((prev) => {
          if (key === 'j') {
            return Math.min(operatorChecklistEntries.length - 1, prev + 1);
          }
          return Math.max(0, prev - 1);
        });
        return;
      }

      if (key === ' ' && viewMode === 'operator' && (uiTab === 'verdict' || uiTab === 'packet')) {
        if (!operatorChecklistEntries.length || !hasPacketChecklist) {
          return;
        }
        event.preventDefault();
        const targetItem = operatorChecklistEntries[activeChecklistIndex];
        if (targetItem) {
          toggleChecklistItem(targetItem.id);
        }
        return;
      }

      if (/^[1-5]$/.test(key)) {
        const index = Number(key) - 1;
        if (activeTabs[index]) {
          event.preventDefault();
          setUiTab(activeTabs[index]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeChecklistIndex,
    openOperatorSections.caseDetails,
    openOperatorSections.files,
    openOperatorSections.payerRouting,
    openOperatorSections.sourceLinks,
    hasPacketChecklist,
    operatorChecklistEntries,
    operatorPacket,
    readiness?.ready,
    runMode,
    showShortcuts,
    uiTab,
    viewMode,
  ]);

  const loadRunHistory = async () => {
    try {
      setHistoryError('');
      const response = await fetch('/api/runs?limit=3', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load run history.');
      }
      setHistoryMode(payload.storage || 'local');
      const nextRuns = Array.isArray(payload.runs) ? payload.runs : [];
      setRunHistory((prev) => {
        const prevTop = prev[0]?.appRunId || '';
        const nextTop = nextRuns[0]?.appRunId || '';
        if (nextTop && prevTop && nextTop !== prevTop) {
          setNewHistoryRunId(nextTop);
          window.setTimeout(() => setNewHistoryRunId(''), 1600);
        }
        return nextRuns;
      });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to load run history.');
    }
  };

  const loadWorkspaces = async () => {
    try {
      setWorkspaceError('');
      const response = await fetch('/api/workspaces?limit=12', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load workspace profiles.');
      }
      setWorkspaceMode(payload.storage || 'local');
      setWorkspaces(Array.isArray(payload.workspaces) ? payload.workspaces : []);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Unable to load workspace profiles.');
    }
  };

  const loadPilotCommitments = async () => {
    try {
      setPilotCommitmentError('');
      const response = await fetch('/api/pilot-commitments?limit=25', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load pilot commitments.');
      }
      setPilotCommitmentMode(payload.storage || 'local');
      setPilotCommitments(Array.isArray(payload.commitments) ? payload.commitments : []);
    } catch (error) {
      setPilotCommitmentError(error instanceof Error ? error.message : 'Unable to load pilot commitments.');
    }
  };

  const processQueue = () => {
    if (processingRef.current || queueRef.current.length === 0) {
      return;
    }

    processingRef.current = true;
    const payload = queueRef.current.shift();

    if (!payload) {
      processingRef.current = false;
      return;
    }

    if (payload.type === 'complete') {
      setIsRunning(false);
      setEndedAt(Date.now());
      setStreamConnection('idle');
      if (hasErrorRef.current && !hasResultRef.current) {
        setLiveStatus('error');
        setStatus((prev) => ({ ...prev, processing: 0, ready: 0 }));
      } else {
        setLiveStatus('completed');
        setStatus({ queued: 0, processing: 0, needsEvidence: 0, ready: 1 });
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      void loadRunHistory();
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'moment') {
      setLiveStatus('error');
      setErrorMoment({ title: payload.title, message: payload.message });
      setTimeout(() => setErrorMoment(null), 1450);
      processingRef.current = false;
      setTimeout(processQueue, 1450);
      return;
    }

    if (payload.type === 'config') {
      setWorkflow({
        name: payload.workflowName,
        url: payload.workflowUrl,
        goal: payload.workflowGoal,
        contactName: payload.contactWorkflowName,
        contactUrl: payload.contactWorkflowUrl,
        mode: payload.mode,
        workspaceName: payload.workspaceName || '',
        caseId: payload.caseId,
        procedure: payload.procedure,
      });
      setCurrentRunId(payload.appRunId || '');
      setLiveStatus('running');
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'artifact') {
      setArtifact({
        policyResult: payload.policyResult,
        contactResult: payload.contactResult,
      });
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'snapshot_diff') {
      setSnapshotDiff(payload.snapshotDiff || null);
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'failure') {
      setFailureState({
        stage: payload.stage,
        code: payload.code,
        message: payload.message,
        retrySuggestion: payload.retrySuggestion,
        retryable: payload.retryable,
      });
      setLiveStatus('error');
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'packet') {
      setOperatorPacket(buildDisplayPacket(payload.operatorPacket, inferCaseLifecycleFromPacket(payload.operatorPacket)));
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'proof') {
      if (payload.status === 'failed') {
        hasErrorRef.current = true;
        setLiveStatus('error');
      }
      setProofState((prev) => ({
        ...prev,
        [payload.workflowKind]: {
          ...(prev[payload.workflowKind] || {}),
          status: payload.status,
          runId: payload.runId ?? prev[payload.workflowKind]?.runId ?? '',
          sourceUrl: payload.sourceUrl ?? prev[payload.workflowKind]?.sourceUrl ?? '',
          streamUrl: payload.streamUrl ?? prev[payload.workflowKind]?.streamUrl ?? '',
          error: payload.error ?? prev[payload.workflowKind]?.error ?? '',
        },
      }));
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'result') {
      hasResultRef.current = true;
      const nextReadiness = payload.readiness;
      setReadiness(nextReadiness);
      setConfidence(nextReadiness.confidence || 0);
      setConfidenceTrend('up');
      setConfidenceText(nextReadiness.summary);
      setStatus({
        queued: 0,
        processing: 0,
        needsEvidence: nextReadiness.ready ? 0 : nextReadiness.missing_evidence?.length || 1,
        ready: nextReadiness.ready ? 1 : 0,
      });
      processingRef.current = false;
      setTimeout(processQueue, 50);
      return;
    }

    if (payload.type === 'log') {
      setTotalSteps(payload.totalSteps ?? 0);
      setStep(payload.index ?? 0);

      const enriched = {
        id: payload.id,
        time: payload.time,
        text: payload.text,
        level: payload.level,
      };

      if (payload.channel === 'thinking') {
        setThinkingLogs((prev) => [...prev, enriched]);
      } else {
        setExecutionLogs((prev) => [...prev, enriched]);
      }

      if (typeof payload.confidence === 'number') {
        setConfidence((prev) => {
          if (payload.confidence > prev) {
            setConfidenceTrend('up');
          } else if (payload.confidence < prev) {
            setConfidenceTrend('down');
          } else {
            setConfidenceTrend('neutral');
          }
          return payload.confidence;
        });
      }

      if (/confidence dropped/i.test(payload.text)) {
        setConfidenceText(payload.text);
      } else if (/re-evaluating strategy/i.test(payload.text)) {
        setConfidenceText('Re-evaluating strategy...');
      } else if (/found supporting evidence/i.test(payload.text)) {
        setConfidenceText('Found supporting evidence');
      } else if (/confidence restored/i.test(payload.text)) {
        setConfidenceText(payload.text);
      }

      if (payload.level === 'error') {
        hasErrorRef.current = true;
        setLiveStatus('error');
        setStatus((prev) => ({ ...prev, needsEvidence: 1 }));
      } else if (payload.level === 'retry') {
        setLiveStatus('recovering');
      } else if (payload.level === 'success') {
        setLiveStatus('running');
      } else {
        setLiveStatus('running');
      }

      processingRef.current = false;
      setTimeout(processQueue, payload.pauseMs ?? 180);
      return;
    }

    processingRef.current = false;
    setTimeout(processQueue, 50);
  };

  const startEventStream = (params) => {
    const url = params?.toString() ? `/api/demo-stream?${params.toString()}` : '/api/demo-stream';
    setStreamConnection('connecting');
    const source = new EventSource(url);
    sourceRef.current = source;
    source.onopen = () => {
      setStreamConnection('connected');
    };

    source.onmessage = (message) => {
      let payload = null;
      try {
        payload = JSON.parse(message.data);
      } catch {
        payload = {
          type: 'failure',
          stage: 'stream',
          code: 'malformed_event_payload',
          message: 'Stream payload could not be parsed as JSON.',
          retrySuggestion: 'Retry once. If repeated, inspect the backend stream output for malformed events.',
          retryable: true,
        };
      }
      if (payload.type === 'config' && payload.mode) {
        setProofState((prev) => ({ ...prev, runtimeMode: payload.mode }));
      }
      queueRef.current.push(payload);
      processQueue();
    };

    source.onerror = () => {
      hasErrorRef.current = true;
      setIsRunning(false);
      setLiveStatus('error');
      setStreamConnection('disconnected');
      setFailureState((prev) =>
        prev || {
          stage: 'stream',
          code: 'stream_interrupted',
          message: 'Live stream disconnected before terminal completion.',
          retrySuggestion: 'Retry once. If repeated, inspect network stability and server logs.',
          retryable: true,
        },
      );
      setErrorMoment({
        title: '❌ STREAM INTERRUPTED',
        message: 'Connection dropped before final result. You can retry safely.',
      });
      source.close();
      sourceRef.current = null;
    };
  };

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    void loadRunHistory();
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  useEffect(() => {
    void loadPilotCommitments();
  }, []);

  useEffect(() => {
    if (runMode !== 'default' || autoStartRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      autoStartRef.current = true;
      runDemo('default');
    }, 1400);

    return () => clearTimeout(timer);
  }, [runMode]);

  const resetRun = () => {
    setThinkingLogs([]);
    setExecutionLogs([]);
    setArtifact(null);
    setOperatorPacket(null);
    setReadiness(null);
    setProofState(createInitialProofState());
    setFailureState(createInitialFailureState());
    setSourceDiscovery(createInitialSourceDiscoveryState());
    setSnapshotDiff(null);
    setCurrentRunId('');
    setStep(0);
    setTotalSteps(0);
    setConfidence(0);
    setConfidenceTrend('neutral');
    setConfidenceText('🧠 Ready to analyze clinical input...');
    setLiveStatus('idle');
    setErrorMoment(null);
    setCompletionToast(null);
    setStreamConnection('idle');
    setStartedAt(null);
    setEndedAt(null);
    setStatus({ queued: 1, processing: 0, needsEvidence: 0, ready: 0 });
    setWorkflow(runMode === 'default' ? DEFAULT_WORKFLOW : workflow);
    queueRef.current = [];
    processingRef.current = false;
    hasResultRef.current = false;
    hasErrorRef.current = false;
  };

  const loadSnapshot = (run) => {
    if (!run) {
      return;
    }

    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    const readinessSnapshot = run.readiness || null;
    const thinkingSnapshot = run.logs?.thinking || [];
    const executionSnapshot = run.logs?.execution || [];
    const snapshotStatus = run.status === 'failed' ? 'error' : 'completed';
    const hasCustomContext =
      Boolean(run.workspace?.id) ||
      Boolean(run.workspace?.name) ||
      Boolean(run.intake?.payerName) ||
      Boolean(run.intake?.policyPageUrl) ||
      Boolean(run.intake?.contactPageUrl);

    setRunMode(hasCustomContext ? 'custom' : 'default');

    if (hasCustomContext) {
      setActiveWorkspaceId(run.workspace?.id || '');
      setWorkspaceName(run.workspace?.name || '');
      setGuidedIntake({
        ...createInitialGuidedIntake(),
        ...(run.intake || {}),
      });
      setCustomConfig({
        ...createInitialCustomConfig(),
        workflowName: run.workflow?.name || createInitialCustomConfig().workflowName,
        workflowUrl: run.workflow?.url || run.intake?.policyPageUrl || '',
        workflowGoal: run.workflow?.goal || createInitialCustomConfig().workflowGoal,
        contactWorkflowName: run.workflow?.contactName || createInitialCustomConfig().contactWorkflowName,
        contactWorkflowUrl: run.workflow?.contactUrl || run.intake?.contactPageUrl || '',
        contactWorkflowGoal: run.workflow?.contactGoal || createInitialCustomConfig().contactWorkflowGoal,
      });
      setGuidedIntakeError('');
    }

    setIsRunning(false);
    setCurrentRunId(run.appRunId || '');
    setWorkflow({
      name: run.workflow?.name || DEFAULT_WORKFLOW.name,
      url: run.workflow?.url || DEFAULT_WORKFLOW.url,
      goal: run.workflow?.goal || '',
      contactName: run.workflow?.contactName || DEFAULT_WORKFLOW.contactName,
      contactUrl: run.workflow?.contactUrl || DEFAULT_WORKFLOW.contactUrl,
      mode: run.mode || 'history',
      workspaceName: run.workspace?.name || '',
      caseId: run.workflow?.caseId || DEFAULT_WORKFLOW.caseId,
      procedure: run.workflow?.procedure || DEFAULT_WORKFLOW.procedure,
    });
    setArtifact(run.artifact || null);
    setOperatorPacket(buildDisplayPacket(run.operatorPacket || null, run.caseLifecycle || null));
    setReadiness(readinessSnapshot);
    setProofState(
      run.proof || {
        ...createInitialProofState(),
        runtimeMode: run.mode || 'history',
      },
    );
    setFailureState(run.failure || null);
    setSourceDiscovery(createInitialSourceDiscoveryState());
    setSnapshotDiff(run.snapshotDiff || null);
    setThinkingLogs(thinkingSnapshot);
    setExecutionLogs(executionSnapshot);
    setStep(run.metrics?.eventCount || thinkingSnapshot.length + executionSnapshot.length);
    setTotalSteps(run.metrics?.totalSteps || 0);
    setStartedAt(run.startedAt ? new Date(run.startedAt).getTime() : null);
    setEndedAt(run.completedAt ? new Date(run.completedAt).getTime() : null);
    setLiveStatus(snapshotStatus);
    setConfidence(readinessSnapshot?.confidence || 0);
    setConfidenceTrend('neutral');
    setConfidenceText(
      readinessSnapshot?.summary ||
        (snapshotStatus === 'error' ? run.failureReason || 'Loaded failed run snapshot.' : 'Loaded saved run snapshot.'),
    );
    setStatus({
      queued: 0,
      processing: 0,
      needsEvidence: readinessSnapshot?.ready ? 0 : readinessSnapshot?.missing_evidence?.length || 0,
      ready: readinessSnapshot?.ready ? 1 : 0,
    });
    setErrorMoment(null);
  };

  const copyOperatorPacket = async () => {
    if (!operatorPacket || !navigator?.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(operatorPacket, null, 2));
  };

  const updateLifecycleDraft = (run, key, value) => {
    if (!run?.appRunId) {
      return;
    }
    setLifecycleDrafts((prev) => ({
      ...prev,
      [run.appRunId]: {
        status: prev[run.appRunId]?.status || run.caseLifecycle?.status || 'new',
        notes: prev[run.appRunId]?.notes ?? run.caseLifecycle?.notes ?? '',
        [key]: value,
      },
    }));
  };

  const saveLifecycle = async (run) => {
    if (!run?.appRunId) {
      return;
    }

    const draft = lifecycleDrafts[run.appRunId] || {
      status: run.caseLifecycle?.status || 'new',
      notes: run.caseLifecycle?.notes || '',
    };

    try {
      setLifecycleSavingId(run.appRunId);
      setHistoryError('');
      const response = await fetch('/api/runs', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appRunId: run.appRunId,
          status: draft.status,
          notes: draft.notes,
          eventNote: draft.notes || `Case moved to ${String(draft.status || 'new').replaceAll('_', ' ')}.`,
          actor: 'staff',
          source: 'ui',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save lifecycle.');
      }

      const updatedRun = payload.run;
      setRunHistory((prev) => prev.map((item) => (item.appRunId === updatedRun.appRunId ? updatedRun : item)));
      setLifecycleDrafts((prev) => {
        const next = { ...prev };
        delete next[run.appRunId];
        return next;
      });

      if (currentRunId === updatedRun.appRunId) {
        setOperatorPacket((prev) => buildDisplayPacket(prev, updatedRun.caseLifecycle || null));
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to save lifecycle.');
    } finally {
      setLifecycleSavingId('');
    }
  };

  const downloadOperatorPacket = () => {
    if (!operatorPacket) {
      return;
    }
    const blob = new Blob([JSON.stringify(operatorPacket, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${operatorPacket.case_id || 'authpilot-packet'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyOperatorBrief = async () => {
    if (!operatorPacket || !navigator?.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(buildOperatorPacketBrief(operatorPacket));
  };

  const downloadOperatorBrief = () => {
    if (!operatorPacket) {
      return;
    }
    const blob = new Blob([buildOperatorPacketBrief(operatorPacket)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${operatorPacket.case_id || 'authpilot-handoff'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadOperatorCsv = () => {
    if (!operatorPacket) {
      return;
    }
    const blob = new Blob([buildOperatorPacketCsv(operatorPacket)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${operatorPacket.case_id || 'authpilot-handoff'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadWebhookExport = () => {
    if (!operatorPacket) {
      return;
    }
    const payload = buildWebhookReadyExport(operatorPacket);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${operatorPacket.case_id || 'authpilot-webhook-export'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleSyncToEmr = async ({ connector, patientId, departmentId, operatorId }) => {
    if (!operatorPacket) {
      return { ok: false, message: 'No operator packet is loaded yet.' };
    }

    const connectorKey = String(connector || 'athena').trim().toLowerCase();
    const packetPayload = {
      ...operatorPacket,
      patient_id: patientId || operatorPacket.patient_id || '',
      department_id: departmentId || operatorPacket.department_id || '',
    };

    const syncResponse = await fetch('/api/integrations/connector-prototype', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'live',
        connector: connectorKey,
        packetId: operatorPacket.case_id || currentRunId || '',
        operatorId: operatorId || 'staff-operator',
        packet: packetPayload,
        athena: {
          patientId: patientId || operatorPacket.patient_id || '',
          departmentId: departmentId || operatorPacket.department_id || '',
        },
      }),
    });

    const syncPayload = await syncResponse.json();
    if (!syncResponse.ok) {
      throw new Error(syncPayload.error || 'Unable to reach connector prototype API.');
    }

    const emrFailure = extractEmrFailureMessage(syncPayload);
    if (emrFailure) {
      throw new Error(emrFailure);
    }

    const external = syncPayload.primaryExternalId || syncPayload.externalIds?.[0] || null;
    if (!external?.externalEmrId) {
      throw new Error('EMR sync did not return an external ID. Verify connector credentials and patient mapping.');
    }

    const nowIso = new Date().toISOString();
    const emrSyncPatch = {
      connector: external.connector || connectorKey,
      emrSystem: external.connector || connectorKey,
      externalEmrId: external.externalEmrId,
      operation: external.operation || 'sync',
      status: 'synced',
      packetId: operatorPacket.case_id || currentRunId || '',
      operatorId: operatorId || 'staff-operator',
      patientId: patientId || operatorPacket.patient_id || '',
      departmentId: departmentId || operatorPacket.department_id || '',
      message: 'Live connector sync completed.',
      lastSyncedAt: nowIso,
    };

    if (currentRunId) {
      const patchResponse = await fetch('/api/runs', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appRunId: currentRunId,
          actor: operatorId || 'staff-operator',
          source: 'ui',
          emrSync: emrSyncPatch,
        }),
      });
      const patchPayload = await patchResponse.json();
      if (!patchResponse.ok) {
        throw new Error(patchPayload.error || 'EMR sync succeeded but metadata persistence failed.');
      }

      const updatedRun = patchPayload.run;
      if (updatedRun) {
        setRunHistory((prev) => prev.map((item) => (item.appRunId === updatedRun.appRunId ? updatedRun : item)));
        if (currentRunId === updatedRun.appRunId) {
          setOperatorPacket(buildDisplayPacket(updatedRun.operatorPacket || operatorPacket, updatedRun.caseLifecycle || null));
        }
      }
    } else {
      setOperatorPacket((prev) => {
        if (!prev) {
          return prev;
        }
        return buildDisplayPacket(
          {
            ...prev,
            emr_sync: {
              connector: emrSyncPatch.connector,
              emr_system: emrSyncPatch.emrSystem,
              external_emr_id: emrSyncPatch.externalEmrId,
              operation: emrSyncPatch.operation,
              status: emrSyncPatch.status,
              packet_id: emrSyncPatch.packetId,
              operator_id: emrSyncPatch.operatorId,
              message: emrSyncPatch.message,
              last_synced_at: emrSyncPatch.lastSyncedAt,
              patient_id: patientId || prev.patient_id || '',
              department_id: departmentId || prev.department_id || '',
            },
          },
          prev.case_lifecycle || null,
        );
      });
    }

    return {
      ok: true,
      externalEmrId: external.externalEmrId,
      externalIdLabel: external.externalIdLabel || 'external_emr_id',
      connector: external.connector || connectorKey,
    };
  };

  const handleRunPortalSubmission = async ({ payerKey = 'uhc' } = {}) => {
    if (!currentRunId) {
      throw new Error('No active run selected for portal submission.');
    }

    const response = await fetch('/api/automation/submit-to-payer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId: currentRunId,
        operatorId: operatorUserId || 'staff-operator',
        payerKey,
        connector: operatorPacket?.emr_sync?.connector || operatorPacket?.emr_connector_hint || 'athena',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Portal submission request failed.');
    }

    if (payload.run) {
      setRunHistory((prev) => prev.map((item) => (item.appRunId === payload.run.appRunId ? payload.run : item)));
      if (payload.run.appRunId === currentRunId) {
        setOperatorPacket(buildDisplayPacket(payload.run.operatorPacket || operatorPacket, payload.run.caseLifecycle || null));
      }
    } else {
      await loadRunHistory();
    }

    if (!payload.ok) {
      throw new Error(payload.message || payload.status || 'Manual follow-up required.');
    }

    return {
      ok: true,
      payerReferenceId: payload.payerReferenceId,
      proof: payload.proof,
    };
  };

  const handleExceptionOneClickFix = async ({ run, action }) => {
    if (!run?.appRunId || !action) {
      return;
    }

    const response = await fetch('/api/automation/exception-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId: run.appRunId,
        action,
        operatorId: operatorUserId || 'staff-operator',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to dispatch exception action.');
    }

    if (payload.run?.appRunId) {
      setRunHistory((prev) => prev.map((item) => (item.appRunId === payload.run.appRunId ? payload.run : item)));
      if (payload.run.appRunId === currentRunId) {
        setOperatorPacket(buildDisplayPacket(payload.run.operatorPacket || operatorPacket, payload.run.caseLifecycle || null));
      }
    }

    await loadRunHistory();
  };

  const handleGeneratePeerBrief = async ({ run }) => {
    if (!run?.appRunId) {
      return;
    }

    const response = await fetch('/api/automation/peer-to-peer-brief', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId: run.appRunId,
        operatorId: operatorUserId || 'staff-operator',
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to generate peer-to-peer brief.');
    }

    if (payload.run?.appRunId) {
      setRunHistory((prev) => prev.map((item) => (item.appRunId === payload.run.appRunId ? payload.run : item)));
      if (payload.run.appRunId === currentRunId) {
        setOperatorPacket(buildDisplayPacket(payload.run.operatorPacket || operatorPacket, payload.run.caseLifecycle || null));
      }
    }

    setErrorMoment({
      title: 'P2P Brief Ready',
      message: payload?.brief?.storage?.pdfPath
        ? `Saved ${payload.brief.storage.pdfPath.split('/').pop()} for manual denial defense.`
        : 'Manual denial-defense brief generated.',
    });
    setTimeout(() => setErrorMoment(null), 1800);
    await loadRunHistory();
  };

  const exportCaseBundle = () => {
    const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
    const generatedConfig = {
      ...customConfig,
      ...buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion),
    };
    const bundle = buildCaseBundle({
      workspaceId: activeWorkspaceId,
      workspaceName,
      intake: effectiveIntake,
      config: generatedConfig,
      suggestion: intelligenceSuggestion,
      executionPlan: portalExecutionPlan,
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workspaceName || effectiveIntake.caseLabel || 'authpilot-case-bundle'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const triggerBundleImport = () => {
    importBundleInputRef.current?.click();
  };

  const triggerBatchIntakeImport = () => {
    batchIntake.open();
  };

  const applyBatchRow = (row) => {
    if (!row?.normalized) {
      return;
    }

    const nextIntake = {
      ...createInitialGuidedIntake(),
      ...row.normalized,
    };
    const suggestion = getPayerProcedureSuggestion(nextIntake);
    const effectiveIntake = buildEffectiveIntake(nextIntake, suggestion);
    setGuidedIntake(effectiveIntake);
    setCustomConfig((prev) => ({
      ...prev,
      ...buildGeneratedConfigFromIntake(effectiveIntake, suggestion),
    }));
    setGuidedIntakeError('');
    setSourceDiscovery(createInitialSourceDiscoveryState());
  };

  const handleBatchIntakeImport = async (event) => {
    const [file] = Array.from(event.target.files || []);
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const formatHint = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
      const response = await fetch('/api/intake/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rawText, formatHint }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to import intake file.');
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const validRows = rows.filter((row) => row.valid);
      if (!validRows.length) {
        throw new Error('No valid intake rows found. Each row needs payer, procedure, diagnosis, and chart summary.');
      }

      setIntakeBatchRows(validRows);
      setIntakeBatchCursor(0);
      setIntakeBatchMeta({
        total: Number(payload.total) || validRows.length,
        valid: Number(payload.valid) || validRows.length,
        invalid: Number(payload.invalid) || 0,
      });
      applyBatchRow(validRows[0]);
    } catch (error) {
      setGuidedIntakeError(error instanceof Error ? error.message : 'Unable to import intake file.');
    }
  };

  const handleCaseBundleImport = async (event) => {
    const [file] = Array.from(event.target.files || []);
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const bundle = parseCaseBundle(rawText);
      setRunMode('custom');
      setActiveWorkspaceId(bundle.workspaceId || '');
      setWorkspaceName(bundle.workspaceName || '');
      setGuidedIntake({
        ...createInitialGuidedIntake(),
        ...(bundle.intake || {}),
      });
      setCustomConfig({
        ...createInitialCustomConfig(),
        ...(bundle.config || {}),
      });
      setGuidedIntakeError('');
      setWorkspaceError('');
      setSourceDiscovery(createInitialSourceDiscoveryState());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import the selected case bundle.';
      setGuidedIntakeError(message);
      setWorkspaceError(message);
    }
  };

  const resetWorkspaceDraft = () => {
    setActiveWorkspaceId('');
    setWorkspaceName('');
    setCustomConfig(createInitialCustomConfig());
    setGuidedIntake(createInitialGuidedIntake());
    setGuidedIntakeError('');
    setSourceDiscovery(createInitialSourceDiscoveryState());
  };

  const loadWorkspaceProfile = (workspace) => {
    if (!workspace) {
      return;
    }

    setRunMode('custom');
    setActiveWorkspaceId(workspace.id || '');
    setWorkspaceName(workspace.clinicName || '');
    setCustomConfig({
      ...createInitialCustomConfig(),
      ...(workspace.config || {}),
    });
    setGuidedIntake({
      ...createInitialGuidedIntake(),
      ...(workspace.intake || {}),
    });
    setGuidedIntakeError('');
    setSourceDiscovery(createInitialSourceDiscoveryState());
  };

  const saveWorkspaceProfile = async () => {
    try {
      setIsSavingWorkspace(true);
      setWorkspaceError('');
      const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
      const generatedConfig = {
        ...customConfig,
        ...buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion),
      };
      setCustomConfig(generatedConfig);
      setGuidedIntake(effectiveIntake);
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: activeWorkspaceId || undefined,
          clinicName: workspaceName,
          config: generatedConfig,
          intake: effectiveIntake,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save workspace profile.');
      }

      if (payload.workspace) {
        setActiveWorkspaceId(payload.workspace.id || '');
        setWorkspaceName(payload.workspace.clinicName || workspaceName);
      }

      await loadWorkspaces();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Unable to save workspace profile.');
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const deleteWorkspaceProfile = async (workspace) => {
    if (!workspace?.id) {
      return;
    }

    try {
      setIsDeletingWorkspace(true);
      setWorkspaceError('');
      const response = await fetch(`/api/workspaces?id=${encodeURIComponent(workspace.id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to delete workspace profile.');
      }

      if (activeWorkspaceId === workspace.id) {
        resetWorkspaceDraft();
      }

      await loadWorkspaces();
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Unable to delete workspace profile.');
    } finally {
      setIsDeletingWorkspace(false);
    }
  };

  const updateGuidedIntake = (key, value) => {
    const next = { ...guidedIntake, [key]: value };
    const nextSuggestion = getPayerProcedureSuggestion(next);
    setGuidedIntake(next);
    setCustomConfig((current) => ({
      ...current,
      ...buildGeneratedConfigFromIntake(next, nextSuggestion),
    }));
    setGuidedIntakeError('');
    setSourceDiscovery(createInitialSourceDiscoveryState());
  };

  const applyGeneratedDraft = () => {
    const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
    const nextConfig = buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion);
    setGuidedIntake(effectiveIntake);
    setCustomConfig((prev) => ({
      ...prev,
      ...nextConfig,
    }));
  };

  const applySuggestedUrls = () => {
    const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
    setGuidedIntake(effectiveIntake);
    setCustomConfig((prev) => ({
      ...prev,
      ...buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion),
    }));
    setGuidedIntakeError('');
  };

  const applyStarterTemplate = () => {
    const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
    setGuidedIntake(effectiveIntake);
    setCustomConfig({
      ...createInitialCustomConfig(),
      ...buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion),
    });
    setShowAdvancedConfig(true);
    setGuidedIntakeError('');
  };

  const discoverLiveSources = async () => {
    if (!guidedIntake.payerName?.trim() || !guidedIntake.procedureLabel?.trim()) {
      setGuidedIntakeError('Add payer name and procedure before live source discovery.');
      return;
    }

    try {
      setSourceDiscovery({
        status: 'loading',
        error: '',
        result: null,
      });

      const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
      const response = await fetch('/api/discover-sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payerName: effectiveIntake.payerName,
          lineOfBusiness: effectiveIntake.lineOfBusiness,
          memberState: effectiveIntake.memberState,
          specialty: effectiveIntake.specialty,
          procedureLabel: effectiveIntake.procedureLabel,
          starterPolicyUrl: effectiveIntake.policyPageUrl || intelligenceSuggestion?.suggestedPolicyUrl || '',
          starterContactUrl: effectiveIntake.contactPageUrl || intelligenceSuggestion?.suggestedContactUrl || '',
          preferLive: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to discover payer sources.');
      }

      const discoveredPolicyUrl = payload.discovery?.effectivePolicyUrl || effectiveIntake.policyPageUrl || '';
      const discoveredContactUrl = payload.discovery?.effectiveContactUrl || effectiveIntake.contactPageUrl || '';
      const nextIntake = {
        ...effectiveIntake,
        policyPageUrl: discoveredPolicyUrl,
        contactPageUrl: discoveredContactUrl,
      };
      setGuidedIntake(nextIntake);
      setCustomConfig((current) => ({
        ...current,
        ...buildGeneratedConfigFromIntake(nextIntake, payload.suggestion || intelligenceSuggestion),
      }));
      setGuidedIntakeError('');
      setSourceDiscovery({
        status: payload.mode || payload.discovery?.mode || 'ready',
        error: payload.error || '',
        result: payload,
      });
    } catch (error) {
      setSourceDiscovery({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to discover payer sources.',
        result: null,
      });
    }
  };

  const runDemo = (modeOverride = runMode) => {
    if (isRunning) {
      return;
    }

    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    resetRun();
    setIsRunning(true);
    setStartedAt(Date.now());
    setLiveStatus('running');
    setStatus({ queued: 0, processing: 1, needsEvidence: 0, ready: 0 });

    if (modeOverride === 'default') {
      startEventStream(new URLSearchParams());
      return;
    }

    const effectiveIntake = buildEffectiveIntake(guidedIntake, intelligenceSuggestion);
    if (
      effectiveIntake.policyPageUrl !== guidedIntake.policyPageUrl ||
      effectiveIntake.contactPageUrl !== guidedIntake.contactPageUrl
    ) {
      setGuidedIntake(effectiveIntake);
    }

    const missingFields = validateGuidedIntake(effectiveIntake);
    if (missingFields.length > 0) {
      setGuidedIntakeError(`Add ${missingFields.join(', ')} before running a custom workflow.`);
      setIsRunning(false);
      setLiveStatus('idle');
      setStatus({ queued: 1, processing: 0, needsEvidence: 0, ready: 0 });
      return;
    }

    const effectiveConfig = {
      ...customConfig,
      ...buildGeneratedConfigFromIntake(effectiveIntake, intelligenceSuggestion),
    };
    setCustomConfig(effectiveConfig);

    const params = new URLSearchParams();
    Object.entries(effectiveConfig).forEach(([key, value]) => {
      if (value?.trim()) {
        params.set(key, value.trim());
      }
    });
    Object.entries(effectiveIntake).forEach(([key, value]) => {
      if (value?.trim()) {
        params.set(key, value.trim());
      }
    });
    if (activeWorkspaceId) {
      params.set('workspaceId', activeWorkspaceId);
    }
    if (workspaceName.trim()) {
      params.set('workspaceName', workspaceName.trim());
    }

    startEventStream(params);
  };

  const updateCustomConfig = (key, value) => {
    setCustomConfig((prev) => ({ ...prev, [key]: value }));
  };

  const copyPilotCloseScript = async () => {
    if (!navigator?.clipboard) {
      return;
    }

    const script = [
      'AuthPilot 14-day paid pilot (single workflow lane)',
      '',
      'Scope: prior-auth readiness + payer routing for one procedure lane.',
      'Weekly KPI review: denial-rate delta, days-to-auth delta, hours saved per case, recovered revenue.',
      'Success criteria are locked at kickoff and reviewed with ops leadership weekly.',
      'Expansion trigger: KPI targets met in lane 1, then expand to adjacent lanes.',
    ].join('\n');

    await navigator.clipboard.writeText(script);
  };

  const copyDemoObjectionScript = async () => {
    if (!navigator?.clipboard) {
      return;
    }

    const objectionPack = [
      'Demo-day objection handling (quick)',
      '',
      'Objection: "We already have prior-auth software."',
      'Response: "We do not replace your full stack. We remove manual readiness and routing work before portal submission."',
      '',
      'Objection: "This sounds like more workflow change."',
      'Response: "Pilot starts with one lane and one staff user. No full rollout required."',
      '',
      'Objection: "How do we know it is working?"',
      'Response: "Weekly KPI review: denial-rate delta, days-to-auth delta, hours saved, recovered revenue."',
    ].join('\n');

    await navigator.clipboard.writeText(objectionPack);
  };

  const applyPilotTemplate = (templateKey) => {
    const template = PILOT_WORKSPACE_TEMPLATES[templateKey];
    if (!template) {
      return;
    }

    const nextIntake = {
      ...createInitialGuidedIntake(),
      ...(template.intake || {}),
    };
    const nextSuggestion = getPayerProcedureSuggestion(nextIntake);
    const effectiveIntake = buildEffectiveIntake(nextIntake, nextSuggestion);

    setRunMode('custom');
    setWorkspaceName(template.workspaceName || 'Pilot Workspace');
    setActiveWorkspaceId('');
    setGuidedIntake(effectiveIntake);
    setCustomConfig({
      ...createInitialCustomConfig(),
      ...buildGeneratedConfigFromIntake(effectiveIntake, nextSuggestion),
    });
    setGuidedIntakeError('');
    setSourceDiscovery(createInitialSourceDiscoveryState());
  };

  const createPilotCommitment = async (draft) => {
    try {
      setIsSavingPilotCommitment(true);
      setPilotCommitmentError('');
      const response = await fetch('/api/pilot-commitments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clinicName: draft?.clinicName || workspaceName || guidedIntake.caseLabel,
          championName: draft?.championName || '',
          championEmail: draft?.championEmail || '',
          lane: draft?.lane || guidedIntake.procedureLabel || '',
          status: draft?.status || 'prospect',
          targetStartDate: draft?.targetStartDate || '',
          baselineDenialRatePercent: draft?.baselineDenialRatePercent || '',
          baselineDaysToAuth: draft?.baselineDaysToAuth || '',
          currentDenialRatePercent: draft?.currentDenialRatePercent || '',
          currentDaysToAuth: draft?.currentDaysToAuth || '',
          signedAt: draft?.signedAt || '',
          signedEvidenceUrl: draft?.signedEvidenceUrl || '',
          nextStep: draft?.nextStep || 'Run paid pilot close call and send terms sheet.',
          weeklyReviewDay: 'Wednesday',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create pilot commitment.');
      }

      if (payload.commitment?.id) {
        const created = payload.commitment;
        setPilotCommitments((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      } else {
        await loadPilotCommitments();
      }

      return true;
    } catch (error) {
      setPilotCommitmentError(error instanceof Error ? error.message : 'Unable to create pilot commitment.');
      return false;
    } finally {
      setIsSavingPilotCommitment(false);
    }
  };

  const updatePilotCommitment = async (id, patch = {}) => {
    if (!id) {
      return;
    }

    try {
      setSavingPilotCommitmentId(id);
      setPilotCommitmentError('');
      const response = await fetch('/api/pilot-commitments', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          ...patch,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update pilot commitment.');
      }

      if (payload.commitment?.id) {
        const updated = payload.commitment;
        setPilotCommitments((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)]);
      } else {
        await loadPilotCommitments();
      }
    } catch (error) {
      setPilotCommitmentError(error instanceof Error ? error.message : 'Unable to update pilot commitment.');
    } finally {
      setSavingPilotCommitmentId('');
    }
  };

  const updatePilotCommitmentStatus = async (id, status) => {
    await updatePilotCommitment(id, {
      status,
      lastContactAt: new Date().toISOString(),
    });
  };

  const quickUpdatePilotCommitment = async (id, patch = {}) => {
    await updatePilotCommitment(id, {
      ...patch,
      lastContactAt: new Date().toISOString(),
    });
  };

  const deletePilotCommitmentById = async (id) => {
    if (!id) {
      return;
    }

    try {
      setSavingPilotCommitmentId(id);
      setPilotCommitmentError('');
      const response = await fetch(`/api/pilot-commitments?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to delete pilot commitment.');
      }

      setPilotCommitments((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      setPilotCommitmentError(error instanceof Error ? error.message : 'Unable to delete pilot commitment.');
    } finally {
      setSavingPilotCommitmentId('');
    }
  };

  return (
    <main className="authpilot-shell min-h-screen overflow-x-hidden px-4 pb-4 pt-24 sm:px-5 sm:pb-6 sm:pt-24 md:px-8 md:pb-8 md:pt-28">
      <AntigravityCanvas />
      <div className="relative z-10 mx-auto w-full max-w-[96vw] space-y-6">

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)_minmax(340px,0.9fr)]">
          <div className="space-y-6 xl:col-span-2">
          <div className="glass-panel glass-panel-hero relative overflow-hidden rounded-[28px] p-6 md:p-8">
            <div aria-hidden="true" className="ambient-ring h-28 w-28 right-6 top-6" style={{ position: 'absolute' }} />
            <div aria-hidden="true" className="absolute -right-20 bottom-[-72px] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(239,68,68,0.2),rgba(239,68,68,0.01)_68%)] blur-2xl" />
            <div className="relative mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-red-400/90 sm:text-base">Clinic Ops Agent · TinyFish Live</p>
                <TypewriterHeading
                  text="Close the Prior-Auth Growth Gap"
                  className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-5xl"
                  speed={50}
                  startDelay={300}
                />
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  Inbound Open Innovation for clinic ops — live browser agents pull payer truth from real websites, then deliver an operator-owned handoff.
                </p>
                <p className="mt-2 max-w-xl text-xs text-slate-400">
                  KPI proof: configure your manual baseline and compare it to measured live elapsed runs.
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {displayWorkflow.caseId || operatorPacket?.case_id || 'Awaiting run'} · {summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : 'No active runtime'}
                </p>
              </div>
              <span className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${activeBadge.tone}`}>
                {activeBadge.text}
              </span>
            </div>

            {showSetupPanel ? (
            <div className="glass-subpanel grid gap-3 rounded-2xl p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  className={`premium-button rounded-xl px-4 py-3 text-left ${
                    runMode === 'default'
                      ? 'border-red-500/40 bg-red-500/10 text-red-100'
                      : 'premium-button-soft text-slate-300'
                  }`}
                  onClick={() => setRunMode('default')}
                  type="button"
                >
                  <p className="text-base font-bold">Autoplay Live</p>
                  <p className="mt-1 text-sm text-slate-400">Auto-run TinyFish judge on page load.</p>
                </button>
                <button
                  className={`premium-button rounded-xl px-4 py-3 text-left ${
                    runMode === 'custom'
                      ? 'border-red-500/40 bg-red-500/10 text-red-100'
                      : 'premium-button-soft text-slate-300'
                  }`}
                  onClick={() => setRunMode('custom')}
                  type="button"
                >
                  <p className="text-base font-bold">Custom Live</p>
                  <p className="mt-1 text-sm text-slate-400">Paste your own policy and contact page.</p>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="premium-subcard rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Mode</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-white">{displayWorkflow.mode}</p>
                </div>
                <div className="premium-subcard rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Case</p>
                  <p className="mt-1 text-sm font-semibold text-white">{displayWorkflow.caseId || 'Awaiting run'}</p>
                </div>
                <div className="premium-subcard rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Runtime</p>
                  <p className="mt-1 text-sm font-semibold text-white">{summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : '-'}</p>
                </div>
                <div className="premium-subcard rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Decision</p>
                  <p className="mt-1 text-sm font-semibold text-white">{summary.outcome}</p>
                </div>
              </div>

              <div className="premium-subcard rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Live Browser Proof</p>
                  <span
                    className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      proofState.runtimeMode === 'live'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : proofState.runtimeMode === 'mock'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          : 'border-slate-700 bg-slate-900 text-slate-300'
                    }`}
                  >
                    {proofState.runtimeMode === 'live'
                      ? 'Live TinyFish'
                      : proofState.runtimeMode === 'mock'
                        ? 'Mock Mode'
                        : 'Waiting'}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="premium-subcard-soft rounded-xl p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Policy run</p>
                    <p className="mt-2 text-sm font-medium text-white">{proofState.policy.status}</p>
                    <p className="mt-1 text-xs text-slate-400">{proofState.policy.runId ? 'Run ID captured' : 'Waiting for run id'}</p>
                    {proofState.policy.error && (
                      <p className="mt-2 text-xs text-red-300">{proofState.policy.error}</p>
                    )}
                  </div>
                  <div className="premium-subcard-soft rounded-xl p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Contact run</p>
                    <p className="mt-2 text-sm font-medium text-white">{proofState.contact.status}</p>
                    <p className="mt-1 text-xs text-slate-400">{proofState.contact.runId ? 'Run ID captured' : 'Waiting for run id'}</p>
                    {proofState.contact.error && (
                      <p className="mt-2 text-xs text-red-300">{proofState.contact.error}</p>
                    )}
                  </div>
                </div>
                {failureState && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-100">
                        {failureState.code.replaceAll('_', ' ')}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-red-200">{failureState.stage} stage</span>
                    </div>
                    <p className="mt-2 text-sm text-red-100">{failureState.message}</p>
                    <p className="mt-1 text-xs text-red-200">{failureState.retrySuggestion}</p>
                  </div>
                )}
              </div>

              {runMode === 'custom' && uiTab === 'configure' && (
                <div className="grid gap-3">
                  <WorkspacePanel
                    activeWorkspaceId={activeWorkspaceId}
                    clinicName={workspaceName}
                    error={workspaceError}
                    isDeleting={isDeletingWorkspace}
                    isSaving={isSavingWorkspace}
                    onClinicNameChange={setWorkspaceName}
                    onDelete={deleteWorkspaceProfile}
                    onExportActiveBundle={exportCaseBundle}
                    onImportBundle={triggerBundleImport}
                    onLoad={loadWorkspaceProfile}
                    onNewDraft={resetWorkspaceDraft}
                    onSave={() => {
                      void saveWorkspaceProfile();
                    }}
                    storageMode={workspaceMode}
                    workspaces={workspaces}
                  />

                  <GuidedIntakePanel
                    advancedOpen={showAdvancedConfig}
                    error={guidedIntakeError}
                    executionPlan={portalExecutionPlan}
                    intake={guidedIntake}
                    intelligenceSuggestion={intelligenceSuggestion}
                    sourceDiscovery={sourceDiscovery}
                    onExportCaseBundle={exportCaseBundle}
                    onDiscoverLiveSources={() => {
                      void discoverLiveSources();
                    }}
                    onApplyPilotTemplate={applyPilotTemplate}
                    onApplyStarterTemplate={applyStarterTemplate}
                    onApplySuggestedUrls={applySuggestedUrls}
                    onChange={updateGuidedIntake}
                    onGenerateDraft={applyGeneratedDraft}
                    onImportCaseBundle={triggerBundleImport}
                    onImportBatchIntake={triggerBatchIntakeImport}
                    onToggleAdvanced={() => setShowAdvancedConfig((prev) => !prev)}
                  />

                  <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Batch intake operator identity</p>
                      <p className="text-xs text-slate-400">Used for live audit trails</p>
                    </div>
                    <input
                      className="premium-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
                      placeholder="staff-user-id"
                      value={operatorUserId}
                      onChange={(event) => setOperatorUserId(event.target.value)}
                    />
                  </div>

                  {intakeBatchRows.length > 0 ? (
                    <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-slate-400">
                          Batch intake loaded · {intakeBatchMeta.valid}/{intakeBatchMeta.total} valid
                        </p>
                        <p className="text-xs text-slate-400">Invalid rows: {intakeBatchMeta.invalid}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          className="premium-button premium-button-soft rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200"
                          onClick={() => {
                            const next = Math.max(0, intakeBatchCursor - 1);
                            setIntakeBatchCursor(next);
                            applyBatchRow(intakeBatchRows[next]);
                          }}
                          disabled={intakeBatchCursor <= 0}
                          type="button"
                        >
                          Previous row
                        </button>
                        <button
                          className="premium-button premium-button-soft rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200"
                          onClick={() => {
                            const next = Math.min(intakeBatchRows.length - 1, intakeBatchCursor + 1);
                            setIntakeBatchCursor(next);
                            applyBatchRow(intakeBatchRows[next]);
                          }}
                          disabled={intakeBatchCursor >= intakeBatchRows.length - 1}
                          type="button"
                        >
                          Next row
                        </button>
                        <span className="text-xs text-cyan-200">
                          Active row {intakeBatchCursor + 1} of {intakeBatchRows.length}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {showAdvancedConfig ? (
                    <div className="grid gap-3">
                      <div className="premium-subcard rounded-xl px-4 py-3 text-sm text-slate-300">
                        Advanced TinyFish settings are generated from guided intake and can be tuned here before running.
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                          <span className="text-xs uppercase tracking-wide text-slate-400">Policy workflow name</span>
                          <input
                            className="premium-input mt-2 rounded-xl px-3 py-2 text-sm"
                            value={customConfig.workflowName}
                            onChange={(event) => updateCustomConfig('workflowName', event.target.value)}
                          />
                        </label>
                        <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                          <span className="text-xs uppercase tracking-wide text-slate-400">Contact workflow name</span>
                          <input
                            className="premium-input mt-2 rounded-xl px-3 py-2 text-sm"
                            value={customConfig.contactWorkflowName}
                            onChange={(event) => updateCustomConfig('contactWorkflowName', event.target.value)}
                          />
                        </label>
                      </div>

                      <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                        <span className="text-xs uppercase tracking-wide text-slate-400">Policy page URL</span>
                        <input
                          className="premium-input mt-2 rounded-xl px-3 py-2 text-sm"
                          placeholder="https://payer-site/policy-page"
                          value={customConfig.workflowUrl}
                          onChange={(event) => updateCustomConfig('workflowUrl', event.target.value)}
                        />
                      </label>

                      <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                        <span className="text-xs uppercase tracking-wide text-slate-400">Policy TinyFish goal</span>
                        <textarea
                          className="premium-textarea mt-2 min-h-24 rounded-xl px-3 py-2 text-sm"
                          value={customConfig.workflowGoal}
                          onChange={(event) => updateCustomConfig('workflowGoal', event.target.value)}
                        />
                      </label>

                      <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                        <span className="text-xs uppercase tracking-wide text-slate-400">Contact page URL</span>
                        <input
                          className="premium-input mt-2 rounded-xl px-3 py-2 text-sm"
                          placeholder="https://payer-site/contact-page"
                          value={customConfig.contactWorkflowUrl}
                          onChange={(event) => updateCustomConfig('contactWorkflowUrl', event.target.value)}
                        />
                      </label>

                      <label className="premium-label rounded-2xl p-4 text-sm text-slate-200">
                        <span className="text-xs uppercase tracking-wide text-slate-400">Contact TinyFish goal</span>
                        <textarea
                          className="premium-textarea mt-2 min-h-24 rounded-xl px-3 py-2 text-sm"
                          value={customConfig.contactWorkflowGoal}
                          onChange={(event) => updateCustomConfig('contactWorkflowGoal', event.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            ) : (
              <div className="glass-subpanel grid gap-3 rounded-2xl p-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="premium-subcard rounded-2xl p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Mode</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-white">{displayWorkflow.mode}</p>
                  </div>
                  <div className="premium-subcard rounded-2xl p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Case</p>
                    <p className="mt-1 text-sm font-semibold text-white">{displayWorkflow.caseId || 'Awaiting run'}</p>
                  </div>
                  <div className="premium-subcard rounded-2xl p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Runtime</p>
                    <p className="mt-1 text-sm font-semibold text-white">{summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : '-'}</p>
                  </div>
                  <div className="premium-subcard rounded-2xl p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Live Proof</p>
                    <p className="mt-1 text-sm font-semibold text-white">{proofState.runtimeMode === 'live' ? 'Live TinyFish' : proofState.runtimeMode === 'mock' ? 'Mock Mode' : 'Waiting'}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 space-y-3 rounded-2xl border border-slate-700/80 bg-slate-950/90 p-3 backdrop-blur">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.26em] text-slate-300">Navigation</p>
                <p className="hidden text-xs text-slate-400 sm:block">Operator and technical controls</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-xl border border-slate-700/80 bg-slate-900/70 p-1 text-xs">
                  <button
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      viewMode === 'operator' ? 'bg-red-500/20 text-red-100' : 'text-slate-300'
                    }`}
                    onClick={() => setViewMode('operator')}
                    type="button"
                  >
                    Operator View
                  </button>
                  <button
                    className={`rounded-lg px-3 py-1.5 font-semibold ${
                      viewMode === 'technical' ? 'bg-blue-500/20 text-blue-100' : 'text-slate-300'
                    }`}
                    onClick={() => setViewMode('technical')}
                    type="button"
                  >
                    Technical View
                  </button>
                </div>

                <div className={`grid gap-2 ${viewMode === 'operator' ? 'grid-cols-2 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
                  {viewMode === 'operator' ? (
                    <>
                      <button className={tabButtonClass('verdict')} onClick={() => setUiTab('verdict')} type="button">
                        Summary
                      </button>
                      <button className={tabButtonClass('packet')} onClick={() => setUiTab('packet')} type="button">
                        Checklist + Submit
                      </button>
                    </>
                  ) : (
                    <>
                      <button className={tabButtonClass('logs')} onClick={() => setUiTab('logs')} type="button">
                        Live Logs
                      </button>
                      <button className={tabButtonClass('history')} onClick={() => setUiTab('history')} type="button">
                        Run History
                      </button>
                      <button className={tabButtonClass('configure')} onClick={() => setUiTab('configure')} type="button">
                        Configure
                      </button>
                      <button className={tabButtonClass('packet')} onClick={() => setUiTab('packet')} type="button">
                        Raw Packet
                      </button>
                    </>
                  )}
                </div>

                <div className="ml-auto">
                  <button
                    className="premium-button premium-button-primary rounded-lg px-4 py-2 text-sm font-semibold text-slate-950"
                    onClick={topBarContext.ctaAction}
                    disabled={topBarContext.ctaDisabled}
                    type="button"
                  >
                    {topBarContext.ctaLabel}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-2">
                <p className="text-xs text-slate-300">
                  <span className="mr-1">{topBarContext.icon}</span>
                  {topBarContext.text}
                </p>
              </div>
              {runMode === 'custom' && !showSetupPanel ? (
                <p className="text-xs text-slate-400">
                  Custom mode is active. Open <span className="font-semibold text-slate-200">Configure</span> to edit payer inputs.
                </p>
              ) : null}
            </div>
          </div>
          </div>

          {uiTab === 'logs' ? (
            <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
              <ConfidenceMeter value={confidence} trend={confidenceTrend} trendText={confidenceText} />

              <div className="glass-panel rounded-2xl p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Step Indicator</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className={`rounded-full px-3 py-1 text-sm ${step >= 1 ? 'bg-red-500/20 text-red-100' : 'bg-slate-800'}`}>
                    Case
                  </span>
                  <span>→</span>
                  <span className={`rounded-full px-3 py-1 ${policyActive ? 'bg-sky-500/20 text-sky-100' : 'bg-slate-800'}`}>
                    Policy
                  </span>
                  <span>→</span>
                  <span className={`rounded-full px-3 py-1 ${contactActive ? 'bg-indigo-500/20 text-indigo-100' : 'bg-slate-800'}`}>
                    Routing
                  </span>
                  <span>→</span>
                  <span
                    className={`rounded-full px-3 py-1 ${
                      verdictActive
                        ? liveStatus === 'error'
                          ? 'bg-red-500/20 text-red-100'
                          : 'bg-green-500/20 text-green-100'
                        : 'bg-slate-800'
                    }`}
                  >
                    Verdict
                  </span>
                </div>
              </div>

              <div className="h-[16rem] sm:h-[20rem] md:h-[24rem]">
                <LogPanel title="Clinical reasoning" logs={thinkingLogs} isRunning={isRunning} />
              </div>
              <div className="h-[16rem] sm:h-[18rem] md:h-[22rem]">
                <ExecutionPanel logs={executionLogs} isRunning={isRunning} />
              </div>
            </aside>
          ) : null}
        </section>

        <section
          key={`${viewMode}-${uiTab}`}
          className={`${uiTab === 'verdict' ? "grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]" : "space-y-6"} motion-tab-enter`}
        >
          {errorMoment && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
              <div className="animate-[shake_420ms_ease-in-out] rounded-2xl border border-red-500/70 bg-red-500/10 p-8 shadow-[0_0_50px_rgba(239,68,68,0.4)]">
                <p className="text-center text-4xl font-bold text-red-100">{errorMoment.title}</p>
                <p className="mt-3 text-center text-xl text-red-50">{errorMoment.message}</p>
              </div>
            </div>
          )}

          {uiTab === 'history' ? (
            <RunHistoryPanel
              activeRunId={currentRunId}
              error={historyError}
              highlightRunId={newHistoryRunId}
              lifecycleDrafts={lifecycleDrafts}
              lifecycleSavingId={lifecycleSavingId}
              onLifecycleChange={updateLifecycleDraft}
              onLifecycleSave={saveLifecycle}
              onLoadRun={loadSnapshot}
              runs={runHistory}
              storageMode={historyMode}
            />
          ) : null}

          {uiTab === 'logs' ? (
            <div className="glass-panel rounded-2xl p-4 text-sm text-slate-300">
              Live logs are shown in the right rail for a compact judge view.
            </div>
          ) : null}

          {uiTab === 'configure' ? (
            <div className="glass-panel rounded-2xl p-4 text-sm text-slate-300">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="premium-subcard rounded-xl p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Current mode</p>
                  <p className="mt-1 text-sm font-semibold text-white capitalize">{runMode}</p>
                </div>
                <div className="premium-subcard rounded-xl p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Active case</p>
                  <p className="mt-1 text-sm font-semibold text-white">{displayWorkflow.caseId || 'Awaiting run'}</p>
                </div>
                <div className="premium-subcard rounded-xl p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Live runtime</p>
                  <p className="mt-1 text-sm font-semibold text-white">{summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : '-'}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <label className="premium-subcard rounded-xl p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Manual baseline (minutes)</p>
                  <input
                    className="premium-input mt-2 w-full rounded-lg px-3 py-2 text-sm"
                    inputMode="decimal"
                    min="1"
                    onChange={(event) => setManualBaselineMinutes(event.target.value)}
                    placeholder="e.g. 120"
                    type="number"
                    value={manualBaselineMinutes}
                  />
                </label>
                <div className="premium-subcard rounded-xl p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">KPI source</p>
                  <p className="mt-1 text-sm text-slate-200">
                    Baseline uses your configured manual minutes. After uses{' '}
                    <span className="font-semibold text-white">
                      {kpiComparison.source === 'current_run'
                        ? 'current live run elapsed'
                        : kpiComparison.source === 'run_history_avg'
                          ? 'average elapsed from persisted run history'
                          : 'no elapsed run data yet'}
                    </span>
                    .
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                Configure inputs are active in the setup panel above. Switch to <span className="font-semibold text-white">Summary</span> to review outcome cards and operational checklist.
              </p>
            </div>
          ) : null}

          {uiTab === 'verdict' ? (
            <>
              <div className="space-y-6">
                <div className="sticky top-4 z-20 rounded-2xl border border-slate-700/80 bg-slate-950/95 p-3 backdrop-blur">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Active Case</p>
                      <p className="text-xl font-bold text-white">{displayWorkflow.caseId || operatorPacket?.case_id || 'Awaiting run'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200 ${statusPulse ? 'motion-badge-pulse' : ''} ${
                          readiness?.ready
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                            : liveStatus === 'error'
                              ? 'border-red-500/50 bg-red-500/15 text-red-200'
                              : 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                        }`}
                      >
                        {summary.outcome}
                      </span>
                      <button
                        className="premium-button premium-button-primary rounded-lg px-4 py-2 text-sm font-semibold text-slate-950"
                        onClick={() => {
                          void triggerPrimarySubmission();
                        }}
                        disabled={!operatorPacket || !readiness?.ready}
                        type="button"
                      >
                        Run Portal Submission
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatusCard label="Ready Cases" value={runDerivedStatus.ready} tone="success" />
                  <StatusCard label="Clinical Gaps" value={runDerivedStatus.clinicalGapDetected} tone="processing" />
                  <StatusCard label="Manual Required" value={runDerivedStatus.manualActionRequired} tone="warning" />
                  <StatusCard label="Pending Proof" value={runDerivedStatus.submittedPendingProof} tone="neutral" />
                </div>
                <p className="text-xs text-slate-400">
                  Live KPI source: {runHistory.length} persisted run{runHistory.length === 1 ? '' : 's'}.
                </p>

                <div className="glass-panel rounded-2xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Decision</p>
                      <h3 className="mt-2 text-2xl font-bold text-white">{summary.outcome}</h3>
                      <p className="mt-2 text-sm text-slate-300">
                        {readiness?.summary || 'Run a live workflow to generate a submission decision.'}
                      </p>
                    </div>
                    <button
                      className="premium-button premium-button-primary rounded-lg px-4 py-2 text-sm font-semibold text-slate-950"
                      onClick={() => setUiTab('packet')}
                      type="button"
                    >
                      Open Full Packet
                    </button>
                  </div>

                  {liveStatus === 'error' ? (
                    <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                      <p>{failureState?.message || 'The live workflow did not return a usable result.'}</p>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="premium-subcard rounded-xl p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Elapsed</p>
                      <p className="mt-1 text-2xl font-bold text-white">{summary.elapsedSeconds > 0 ? `${summary.elapsedSeconds}s` : '-'}</p>
                    </div>
                    <div className="premium-subcard rounded-xl p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Confidence</p>
                      <p className="mt-1 text-2xl font-bold text-white">{readiness?.confidence ?? confidence ?? 0}%</p>
                    </div>
                    <div className="premium-subcard rounded-xl p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Matched Evidence</p>
                      <p className="mt-1 text-2xl font-bold text-emerald-300">{summary.matchingEvidence}</p>
                    </div>
                    <div className="premium-subcard rounded-xl p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Missing Evidence</p>
                      <p className="mt-1 text-2xl font-bold text-amber-300">{summary.missingEvidence}</p>
                    </div>
                  </div>
                </div>
                <div className="glass-panel rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Before vs After KPI</p>
                      {kpiComparison.hasData ? (
                        <>
                          <p className="mt-2 text-2xl font-bold text-emerald-200">
                            {kpiComparison.percentFaster.toFixed(1)}% faster
                          </p>
                          <p className="mt-1 text-sm text-slate-300">
                            Before: {kpiComparison.baselineMinutes} min manual · After: {(kpiComparison.measuredSeconds || 0).toFixed(0)}s live
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            Time saved per case: {(kpiComparison.minutesSaved || 0).toFixed(1)} minutes · Source:{' '}
                            {kpiComparison.source === 'current_run' ? 'current live run elapsed' : 'persisted run history average'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="mt-2 text-sm text-slate-300">
                            Add manual baseline minutes in Configure and run at least one live case to compute this KPI.
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            No placeholder math shown until both real inputs exist.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="glass-panel rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Checklist</p>
                    <p className="text-xs text-slate-300">{checklistCompleteCount}/{operatorChecklistEntries.length} complete</p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-200"
                      style={{ width: `${checklistCompletionPercent}%` }}
                    />
                  </div>
                  <div className="mt-3 space-y-2">
                    {operatorChecklistEntries.map((item, index) => (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 rounded-xl border bg-slate-900/60 px-3 py-2 text-sm text-slate-200 transition-colors duration-200 ${
                          activeChecklistIndex === index ? 'border-cyan-400/60 ring-1 ring-cyan-400/30' : 'border-slate-700/70'
                        }`}
                        onMouseEnter={() => setActiveChecklistIndex(index)}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(item.done)}
                          onChange={() => toggleChecklistItem(item.id)}
                          disabled={item.autoDerived}
                          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-400 transition-all duration-200"
                        />
                        <span className={`transition-all duration-200 ${item.done ? 'text-emerald-200 line-through decoration-emerald-400/70' : ''}`}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <button
                  className="glass-panel w-full rounded-2xl p-4 text-left"
                  onClick={() => toggleOperatorSection('caseDetails')}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-semibold text-white">Case Details</p>
                    <span className="text-xs text-slate-400">{openOperatorSections.caseDetails ? 'Hide' : 'Show'}</span>
                  </div>
                  {openOperatorSections.caseDetails ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
                      <div className="premium-subcard rounded-xl p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Case ID</p>
                        <p className="mt-1 break-all">{displayWorkflow.caseId || operatorPacket?.case_id || 'Awaiting run'}</p>
                      </div>
                      <div className="premium-subcard rounded-xl p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Procedure</p>
                        <p className="mt-1">{displayWorkflow.procedure || operatorPacket?.procedure || 'Awaiting run'}</p>
                      </div>
                    </div>
                  ) : null}
                </button>

                <button
                  className="glass-panel w-full rounded-2xl p-4 text-left"
                  onClick={() => toggleOperatorSection('payerRouting')}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-semibold text-white">Payer Routing</p>
                    <span className="text-xs text-slate-400">{openOperatorSections.payerRouting ? 'Hide' : 'Show'}</span>
                  </div>
                  {openOperatorSections.payerRouting ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-slate-200 sm:grid-cols-2">
                      <div className="premium-subcard rounded-xl p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Policy Run</p>
                        <p className="mt-1 capitalize">{proofState.policy.status}</p>
                      </div>
                      <div className="premium-subcard rounded-xl p-3">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Contact Run</p>
                        <p className="mt-1 capitalize">{proofState.contact.status}</p>
                      </div>
                    </div>
                  ) : null}
                </button>

                <button
                  className="glass-panel w-full rounded-2xl p-4 text-left"
                  onClick={() => toggleOperatorSection('files')}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-semibold text-white">Files & Attachments</p>
                    <span className="text-xs text-slate-400">{openOperatorSections.files ? 'Hide' : 'Show'}</span>
                  </div>
                  {openOperatorSections.files ? (
                    <p className="mt-3 text-sm text-slate-300">
                      {Array.isArray(operatorPacket?.available_evidence_files) && operatorPacket.available_evidence_files.length
                        ? operatorPacket.available_evidence_files.join(', ')
                        : 'No staged evidence files yet.'}
                    </p>
                  ) : null}
                </button>

                <button
                  className="glass-panel w-full rounded-2xl p-4 text-left"
                  onClick={() => toggleOperatorSection('sourceLinks')}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-semibold text-white">Source Links</p>
                    <span className="text-xs text-slate-400">{openOperatorSections.sourceLinks ? 'Hide' : 'Show'}</span>
                  </div>
                  {openOperatorSections.sourceLinks ? (
                    <div className="mt-3 space-y-2 text-sm text-slate-300">
                      <p className="break-all">Policy: {operatorPacket?.policy_url || displayWorkflow.url || 'N/A'}</p>
                      <p className="break-all">Contact: {operatorPacket?.contact_url || displayWorkflow.contactUrl || 'N/A'}</p>
                    </div>
                  ) : null}
                </button>
              </div>
            </>
          ) : null}

          {uiTab === 'packet' ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.56fr)_minmax(0,0.44fr)]">
              {viewMode === 'technical' ? (
                <div className="glass-panel rounded-2xl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm uppercase tracking-wide text-slate-400 font-semibold">Raw Operator Packet</p>
                    <div className="flex items-center gap-2">
                      <button
                        className="premium-button premium-button-soft rounded-lg px-4 py-2 text-sm font-medium text-slate-200"
                        disabled={!operatorPacket}
                        onClick={() => {
                          void copyOperatorPacket();
                        }}
                        type="button"
                      >
                        Copy JSON
                      </button>
                      <button
                        className="premium-button premium-button-primary rounded-lg px-4 py-2 text-sm font-medium text-white"
                        disabled={!operatorPacket}
                        onClick={downloadOperatorPacket}
                        type="button"
                      >
                        Download
                      </button>
                    </div>
                  </div>
                  <pre className="premium-code mt-4 max-h-[60vh] overflow-auto rounded-xl p-4 text-sm text-slate-200">
                    {operatorPacket ? JSON.stringify(operatorPacket, null, 2) : '⚙️ Awaiting run completion...'}
                  </pre>
                </div>
              ) : (
                <div className="glass-panel rounded-2xl p-5">
                  <p className="text-sm uppercase tracking-wide text-slate-400 font-semibold">Checklist + Submit</p>
                  <p className="mt-2 text-sm text-slate-300">
                    Use this operational view to confirm checklist items and trigger portal submission.
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-300">{checklistCompleteCount}/{operatorChecklistEntries.length} complete</p>
                    <p className="text-xs text-slate-400">{checklistCompletionPercent}%</p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-200"
                      style={{ width: `${checklistCompletionPercent}%` }}
                    />
                  </div>
                  <div className="mt-4 space-y-2">
                    {operatorChecklistEntries.map((item, index) => (
                      <label
                        key={`packet-${item.id}`}
                        className={`flex items-start gap-3 rounded-xl border bg-slate-900/60 px-3 py-2 text-sm text-slate-200 transition-colors duration-200 ${
                          activeChecklistIndex === index ? 'border-cyan-400/60 ring-1 ring-cyan-400/30' : 'border-slate-700/70'
                        }`}
                        onMouseEnter={() => setActiveChecklistIndex(index)}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(item.done)}
                          onChange={() => toggleChecklistItem(item.id)}
                          disabled={item.autoDerived}
                          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-400 transition-all duration-200"
                        />
                        <span className={`transition-all duration-200 ${item.done ? 'text-emerald-200 line-through decoration-emerald-400/70' : ''}`}>
                          {item.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4">
                    <button
                      className="premium-button premium-button-primary rounded-lg px-4 py-2 text-sm font-semibold text-slate-950"
                      onClick={() => {
                        void triggerPrimarySubmission();
                      }}
                      disabled={!operatorPacket || !readiness?.ready}
                      type="button"
                    >
                      Run Portal Submission
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                <OperatorPacketCard
                  packet={operatorPacket}
                  onSyncToEmr={handleSyncToEmr}
                  onRunPortalSubmission={handleRunPortalSubmission}
                />
                {viewMode === 'technical' ? (
                  <div className="glass-panel rounded-2xl p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-400">TinyFish Result Artifact</p>
                    <pre className="premium-code mt-4 max-h-48 overflow-auto rounded-xl p-3 text-xs text-slate-200">
                      {artifact ? JSON.stringify(artifact, null, 2) : '⚙️ Execution layer initialized. Awaiting first interaction...'}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          ) : uiTab === 'verdict' || uiTab === 'history' || uiTab === 'logs' || uiTab === 'configure' ? null : (
            <div className="glass-panel rounded-2xl p-4 text-sm text-slate-300">
              Select <span className="font-semibold text-white">Verdict</span> for the executive view, or{' '}
              <span className="font-semibold text-white">Operator Packet</span> for the full handoff export.
              </div>
          )}
          <input
            ref={importBundleInputRef}
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              void handleCaseBundleImport(event);
            }}
            type="file"
          />
          <input
            ref={importBatchIntakeInputRef}
            accept="application/json,.json,text/csv,.csv"
            className="hidden"
            onChange={(event) => {
              void handleBatchIntakeImport(event);
            }}
            type="file"
          />
        </section>
        {streamConnection === 'disconnected' || streamConnection === 'connecting' ? (
          <div
            className={`fixed left-4 right-4 top-24 z-[64] rounded-xl border px-3 py-2 text-xs sm:left-5 sm:right-5 md:left-8 md:right-8 ${
              streamConnection === 'disconnected'
                ? 'border-red-500/50 bg-red-500/15 text-red-100'
                : 'border-amber-500/50 bg-amber-500/15 text-amber-100'
            }`}
          >
            {streamConnection === 'disconnected'
              ? 'Connection lost. Retrying or start a new run.'
              : 'Connecting to live stream...'}
          </div>
        ) : null}
        {showShortcuts ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="glass-panel w-full max-w-xl rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-300">Keyboard Shortcuts</p>
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  onClick={() => setShowShortcuts(false)}
                  type="button"
                >
                  Esc
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">1-5</span> Switch tabs</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">O</span> Operator view</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">T</span> Technical view</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">R</span> Run workflow</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">J / K</span> Move checklist focus</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">Space</span> Toggle focused checklist item</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">Enter</span> Submit when ready</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">?</span> Toggle shortcuts</div>
                <div className="premium-subcard rounded-lg px-3 py-2"><span className="text-cyan-300">Esc</span> Close overlay / collapse sections</div>
              </div>
            </div>
          </div>
        ) : null}
        {completionToast ? (
          <button
            className="glass-panel fixed bottom-4 right-4 z-[65] w-[min(92vw,420px)] rounded-2xl border border-emerald-500/40 bg-slate-950/95 p-4 text-left shadow-[0_12px_30px_rgba(0,0,0,0.35)] transition-all duration-200 hover:border-emerald-400/70"
            onClick={() => {
              setViewMode('operator');
              setUiTab('verdict');
              setCompletionToast(null);
            }}
            type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-emerald-300">{completionToast.title}</p>
                <p className="mt-1 text-sm font-semibold text-white">{completionToast.message}</p>
                <p className="mt-1 text-xs text-slate-400">Click to jump to Summary</p>
              </div>
              <span className="text-xs text-slate-400">x</span>
            </div>
          </button>
        ) : null}
      </div>
      <BatchUploadDashboard
        batchIntake={batchIntake}
        operatorId={operatorUserId}
        practiceId={activeWorkspaceId || workspaceName || ''}
        connector="athena"
      />
    </main>
  );
}
