'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ConfidenceMeter from '@/components/ConfidenceMeter';
import ExecutionPanel from '@/components/ExecutionPanel';
import LogPanel from '@/components/LogPanel';
import StatusCard from '@/components/StatusCard';

const STATUS_BADGE = {
  idle: { text: '● Ready', tone: 'text-slate-100 border-slate-600 bg-slate-800/80' },
  running: { text: '🟢 Running', tone: 'text-emerald-100 border-emerald-500/40 bg-emerald-500/10' },
  error: { text: '🔴 Error', tone: 'text-red-100 border-red-500/50 bg-red-500/10' },
  recovering: { text: '🟡 Recovering', tone: 'text-amber-100 border-amber-500/50 bg-amber-500/10' },
  completed: { text: '✅ Completed', tone: 'text-cyan-100 border-cyan-500/50 bg-cyan-500/10' },
};

const DEFAULT_WORKFLOW = {
  name: 'Awaiting default TinyFish workflow',
  url: 'Awaiting live workflow URL',
  goal: '',
  contactName: 'Awaiting default contact workflow',
  contactUrl: 'Awaiting live contact URL',
  mode: 'autoplay',
  caseId: 'Awaiting run',
  procedure: 'Awaiting run',
};

function createInitialProofState() {
  return {
    runtimeMode: 'pending',
    policy: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
    contact: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
  };
}

export default function HomePage() {
  const [runMode, setRunMode] = useState('default');
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
  const [customConfig, setCustomConfig] = useState({
    workflowName: 'Custom policy readiness check',
    workflowUrl: '',
    workflowGoal: 'Read this payer policy page and return compact JSON with keys: policy_name, evidence_requirements, page_url.',
    contactWorkflowName: 'Custom prior authorization contact lookup',
    contactWorkflowUrl: '',
    contactWorkflowGoal:
      'For providers seeking prior authorization help, return compact JSON with keys: provider_precert_phone, provider_precert_notes, source_page_url.',
  });

  const sourceRef = useRef(null);
  const queueRef = useRef([]);
  const processingRef = useRef(false);
  const autoStartRef = useRef(false);
  const hasResultRef = useRef(false);
  const hasErrorRef = useRef(false);

  const summary = useMemo(() => {
    const elapsedSeconds = startedAt && endedAt ? Math.max(1, Math.round((endedAt - startedAt) / 1000)) : 0;
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
  }, [endedAt, liveStatus, readiness, startedAt]);

  const activeBadge = STATUS_BADGE[liveStatus] || STATUS_BADGE.idle;
  const policyActive = ['started', 'session_connected', 'completed', 'failed'].includes(proofState.policy.status);
  const contactActive = ['started', 'session_connected', 'completed', 'failed'].includes(proofState.contact.status);
  const verdictActive = liveStatus === 'completed' || liveStatus === 'error';

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
        caseId: payload.caseId,
        procedure: payload.procedure,
      });
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

    if (payload.type === 'packet') {
      setOperatorPacket(payload.operatorPacket);
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
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (message) => {
      const payload = JSON.parse(message.data);
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
      setErrorMoment({
        title: '❌ SUBMISSION FAILED',
        message: 'Live stream interrupted',
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
    setStep(0);
    setTotalSteps(0);
    setConfidence(0);
    setConfidenceTrend('neutral');
    setConfidenceText('🧠 Ready to analyze clinical input...');
    setLiveStatus('idle');
    setErrorMoment(null);
    setStartedAt(null);
    setEndedAt(null);
    setStatus({ queued: 1, processing: 0, needsEvidence: 0, ready: 0 });
    setWorkflow(runMode === 'default' ? DEFAULT_WORKFLOW : workflow);
    queueRef.current = [];
    processingRef.current = false;
    hasResultRef.current = false;
    hasErrorRef.current = false;
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

    const params = new URLSearchParams();
    Object.entries(customConfig).forEach(([key, value]) => {
      if (value?.trim()) {
        params.set(key, value.trim());
      }
    });

    startEventStream(params);
  };

  const updateCustomConfig = (key, value) => {
    setCustomConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main className="min-h-screen px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto grid max-w-[90vw] gap-6 lg:grid-cols-5">
        <section className="space-y-4 lg:col-span-2">
          <div className="overflow-hidden rounded-[32px] border border-slate-700/80 bg-slate-950/75 p-6 shadow-soft">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">TinyFish Live Build</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Clinic Ops Agent</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                  An adaptive prior-authorization agent that thinks, fails, recovers, and completes the workflow in
                  real time.
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeBadge.tone}`}>
                {activeBadge.text}
              </span>
            </div>

            <div className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    runMode === 'default'
                      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100'
                      : 'border-slate-700 bg-slate-950/70 text-slate-300'
                  }`}
                  onClick={() => setRunMode('default')}
                  type="button"
                >
                  <p className="font-semibold">Autoplay Live</p>
                  <p className="mt-1 text-xs">Autoplay the default TinyFish judge run on page load.</p>
                </button>
                <button
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    runMode === 'custom'
                      ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100'
                      : 'border-slate-700 bg-slate-950/70 text-slate-300'
                  }`}
                  onClick={() => setRunMode('custom')}
                  type="button"
                >
                  <p className="font-semibold">Custom Live</p>
                  <p className="mt-1 text-xs">Paste your own policy page, contact page, and TinyFish goals.</p>
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Workflow</p>
                  <p className="mt-2 text-sm font-medium text-white">{workflow.name}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Mode</p>
                  <p className="mt-2 text-sm font-medium capitalize text-white">{workflow.mode}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Case</p>
                  <p className="mt-2 text-sm font-medium text-white">{workflow.caseId || 'Awaiting run'}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Procedure</p>
                  <p className="mt-2 text-sm font-medium text-white">{workflow.procedure || 'Awaiting run'}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Follow-up workflow</p>
                <p className="mt-2 text-sm font-medium text-white">{workflow.contactName}</p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
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
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Policy run</p>
                    <p className="mt-2 text-sm font-medium text-white">{proofState.policy.status}</p>
                    <p className="mt-1 text-xs text-slate-400">{proofState.policy.runId || workflow.url}</p>
                    {proofState.policy.error && (
                      <p className="mt-2 text-xs text-red-300">{proofState.policy.error}</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Contact run</p>
                    <p className="mt-2 text-sm font-medium text-white">{proofState.contact.status}</p>
                    <p className="mt-1 text-xs text-slate-400">{proofState.contact.runId || workflow.contactUrl}</p>
                    {proofState.contact.error && (
                      <p className="mt-2 text-xs text-red-300">{proofState.contact.error}</p>
                    )}
                  </div>
                </div>
              </div>

              {runMode === 'custom' && (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                      <span className="text-xs uppercase tracking-wide text-slate-400">Policy workflow name</span>
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                        value={customConfig.workflowName}
                        onChange={(event) => updateCustomConfig('workflowName', event.target.value)}
                      />
                    </label>
                    <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                      <span className="text-xs uppercase tracking-wide text-slate-400">Contact workflow name</span>
                      <input
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                        value={customConfig.contactWorkflowName}
                        onChange={(event) => updateCustomConfig('contactWorkflowName', event.target.value)}
                      />
                    </label>
                  </div>

                  <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Policy page URL</span>
                    <input
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                      placeholder="https://payer-site/policy-page"
                      value={customConfig.workflowUrl}
                      onChange={(event) => updateCustomConfig('workflowUrl', event.target.value)}
                    />
                  </label>

                  <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Policy TinyFish goal</span>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                      value={customConfig.workflowGoal}
                      onChange={(event) => updateCustomConfig('workflowGoal', event.target.value)}
                    />
                  </label>

                  <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Contact page URL</span>
                    <input
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                      placeholder="https://payer-site/contact-page"
                      value={customConfig.contactWorkflowUrl}
                      onChange={(event) => updateCustomConfig('contactWorkflowUrl', event.target.value)}
                    />
                  </label>

                  <label className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Contact TinyFish goal</span>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none"
                      value={customConfig.contactWorkflowGoal}
                      onChange={(event) => updateCustomConfig('contactWorkflowGoal', event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  proofState.runtimeMode === 'live'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                    : proofState.runtimeMode === 'mock'
                      ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                      : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-100'
                }`}
              >
                {proofState.runtimeMode === 'live'
                  ? 'This run is using live TinyFish browser infrastructure. Run IDs and session state are shown above.'
                  : proofState.runtimeMode === 'mock'
                    ? 'This run is currently in mock mode. Switch TINYFISH_MODE=live for the strongest judge proof.'
                    : 'The page autostarts the default TinyFish workflow and will surface live browser proof as soon as the run begins.'}
              </div>
              {runMode === 'custom' && (
                <button
                  className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={() => runDemo('custom')}
                  disabled={isRunning}
                  type="button"
                >
                  {isRunning ? 'Running live workflow...' : 'Run custom readiness and contact lookup'}
                </button>
              )}
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                {runMode === 'default'
                  ? 'Autoplay enabled. The default mode now starts the real backend stream on page load.'
                  : 'Custom mode stays manual so you can edit URLs and TinyFish goals first.'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatusCard label="Queued" value={status.queued} tone="neutral" />
            <StatusCard label="Running" value={status.processing} tone="processing" />
            <StatusCard label="Needs Evidence" value={status.needsEvidence} tone="warning" />
            <StatusCard label="Ready" value={status.ready} tone="success" />
          </div>

          {errorMoment && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
              <div className="animate-[shake_420ms_ease-in-out] rounded-2xl border border-red-500/70 bg-red-500/10 p-8 shadow-[0_0_50px_rgba(239,68,68,0.4)]">
                <p className="text-center text-4xl font-bold text-red-100">{errorMoment.title}</p>
                <p className="mt-3 text-center text-xl text-red-50">{errorMoment.message}</p>
              </div>
            </div>
          )}

          <ConfidenceMeter value={confidence} trend={confidenceTrend} trendText={confidenceText} />

          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-slate-400">Step Indicator</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
              <span className={`rounded-full px-3 py-1 ${step >= 1 ? 'bg-cyan-500/20 text-cyan-100' : 'bg-slate-800'}`}>Case</span>
              <span>→</span>
              <span className={`rounded-full px-3 py-1 ${policyActive ? 'bg-sky-500/20 text-sky-100' : 'bg-slate-800'}`}>Policy</span>
              <span>→</span>
              <span className={`rounded-full px-3 py-1 ${contactActive ? 'bg-indigo-500/20 text-indigo-100' : 'bg-slate-800'}`}>Routing</span>
              <span>→</span>
              <span
                className={`rounded-full px-3 py-1 ${
                  verdictActive
                    ? liveStatus === 'error'
                      ? 'bg-red-500/20 text-red-100'
                      : 'bg-emerald-500/20 text-emerald-100'
                    : 'bg-slate-800'
                }`}
              >
                Verdict
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-slate-400">Submission Verdict</p>
            <h3 className="mt-2 text-3xl font-bold text-white">{summary.outcome}</h3>

            {liveStatus === 'completed' && readiness?.ready && (
              <div className="mt-4 space-y-2 text-lg">
                <p className="text-emerald-300">✔ Policy requirements extracted</p>
                <p className="text-emerald-300">✔ Chart matches documented payer criteria</p>
                <p className="text-emerald-300">✔ Provider precertification route identified</p>
              </div>
            )}

            {liveStatus === 'completed' && readiness && !readiness.ready && (
              <div className="mt-4 space-y-2 text-lg">
                <p className="text-amber-300">✔ Policy requirements extracted</p>
                <p className="text-amber-300">✔ Missing evidence surfaced before portal work</p>
                <p className="text-amber-300">✔ Next payer route identified for staff</p>
              </div>
            )}

            {liveStatus === 'error' && (
              <div className="mt-4 space-y-2 text-sm">
                <p className="text-red-300">Policy workflow did not return a usable result.</p>
                <p className="text-slate-300">Check the execution log and proof panel for the TinyFish failure reason.</p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Matched Evidence</p>
                <p className="mt-1 text-2xl font-bold text-cyan-300">{summary.matchingEvidence}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Missing Evidence</p>
                <p className="mt-1 text-2xl font-bold text-emerald-300">{summary.missingEvidence}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Elapsed</p>
                <p className="mt-1 text-2xl font-bold text-white">{summary.elapsedSeconds || '-'}s</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Events</p>
                <p className="mt-1 text-2xl font-bold text-white">{step || '-'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-slate-400">TinyFish Result Artifact</p>
            <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-slate-950/80 p-3 text-xs text-slate-200">
              {artifact ? JSON.stringify(artifact, null, 2) : '⚙️ Execution layer initialized. Awaiting first interaction...'}
            </pre>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-slate-400">Operator Handoff Packet</p>
            <pre className="mt-4 max-h-52 overflow-auto rounded-xl bg-slate-950/80 p-3 text-xs text-slate-200">
              {operatorPacket ? JSON.stringify(operatorPacket, null, 2) : '⚙️ Execution layer initialized. Awaiting first interaction...'}
            </pre>
          </div>
        </section>

        <section className="grid min-h-[72vh] grid-rows-2 gap-6 lg:col-span-3">
          <LogPanel title="Clinical reasoning" logs={thinkingLogs} isRunning={isRunning} />
          <ExecutionPanel logs={executionLogs} isRunning={isRunning} />
        </section>
      </div>
    </main>
  );
}
