import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { enforceRateLimit, isValidHttpUrl, safeTrim, safeTrimToMax } from '@/lib/api-guards';
import { getRequestId, jsonError } from '@/lib/api-response';
import { buildFallbackLogPayload, parseRunnerLine } from '@/lib/demo-stream-line-parser';
import { classifyFailure, emitObservabilityEvent } from '@/lib/observability';
import { redactLogPayload } from '@/lib/privacy';
import { saveRun } from '@/lib/run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function withOverride(value, fallback) {
  return value && value.trim() ? value.trim() : fallback;
}

function maybeAssignEnv(target, key, value) {
  const normalized = safeTrimToMax(value, 4000);
  if (normalized) {
    target[key] = normalized;
  }
}

function normalizeCloseError(error) {
  if (!error) {
    return 'Runner failed before producing a terminal event.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export async function GET(request) {
  const requestId = getRequestId(request);
  const configuredLimit = Number.parseInt(process.env.DEMO_STREAM_RATE_LIMIT || '', 10);
  const streamRateLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 60;
  const rateLimited = enforceRateLimit(request, { key: 'demo-stream', limit: streamRateLimit, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  const encoder = new TextEncoder();
  const projectRoot = path.resolve(process.cwd(), '..');
  const runnerPath = path.join(projectRoot, 'stream_runner.py');
  const pythonBin = process.env.PYTHON_BIN || path.join(projectRoot, process.platform === 'win32' ? 'venv\\\\Scripts\\\\python.exe' : 'venv/bin/python3');
  const { searchParams } = new URL(request.url);

  const workflowUrl = safeTrim(searchParams.get('workflowUrl'));
  const contactWorkflowUrl = safeTrim(searchParams.get('contactWorkflowUrl'));
  if (workflowUrl && !isValidHttpUrl(workflowUrl)) {
    return jsonError({
      message: 'workflowUrl must be a valid http(s) URL.',
      requestId,
      status: 400,
      code: 'invalid_workflow_url',
    });
  }
  if (contactWorkflowUrl && !isValidHttpUrl(contactWorkflowUrl)) {
    return jsonError({
      message: 'contactWorkflowUrl must be a valid http(s) URL.',
      requestId,
      status: 400,
      code: 'invalid_contact_workflow_url',
    });
  }

  const appRunId = randomUUID();
  const workspaceId = searchParams.get('workspaceId')?.trim() || '';
  const workspaceName = searchParams.get('workspaceName')?.trim() || '';

  const childEnv = {
    ...process.env,
  };

  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_NAME',
    withOverride(searchParams.get('workflowName'), process.env.TINYFISH_WORKFLOW_NAME || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_URL',
    withOverride(searchParams.get('workflowUrl'), process.env.TINYFISH_WORKFLOW_URL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_WORKFLOW_GOAL',
    withOverride(searchParams.get('workflowGoal'), process.env.TINYFISH_WORKFLOW_GOAL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_NAME',
    withOverride(searchParams.get('contactWorkflowName'), process.env.TINYFISH_CONTACT_WORKFLOW_NAME || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_URL',
    withOverride(searchParams.get('contactWorkflowUrl'), process.env.TINYFISH_CONTACT_WORKFLOW_URL || ''),
  );
  maybeAssignEnv(
    childEnv,
    'TINYFISH_CONTACT_WORKFLOW_GOAL',
    withOverride(searchParams.get('contactWorkflowGoal'), process.env.TINYFISH_CONTACT_WORKFLOW_GOAL || ''),
  );
  maybeAssignEnv(childEnv, 'TINYFISH_PAYER_NAME', searchParams.get('payerName'));
  maybeAssignEnv(childEnv, 'TINYFISH_LINE_OF_BUSINESS', searchParams.get('lineOfBusiness'));
  maybeAssignEnv(childEnv, 'TINYFISH_MEMBER_STATE', searchParams.get('memberState'));
  maybeAssignEnv(childEnv, 'TINYFISH_SPECIALTY', searchParams.get('specialty'));
  maybeAssignEnv(childEnv, 'TINYFISH_CASE_LABEL', searchParams.get('caseLabel'));
  maybeAssignEnv(childEnv, 'TINYFISH_CASE_DIAGNOSIS', searchParams.get('diagnosis'));
  maybeAssignEnv(childEnv, 'TINYFISH_CASE_PROCEDURE', searchParams.get('procedureLabel'));
  maybeAssignEnv(childEnv, 'TINYFISH_CASE_CHART_SUMMARY', searchParams.get('chartSummary'));
  maybeAssignEnv(childEnv, 'TINYFISH_CASE_EVIDENCE_FILES', searchParams.get('evidenceFiles'));

  let procRef = null;
  let finalizeRef = null;

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let sawComplete = false;
      let sawResult = false;
      let sawError = false;
      let saveInFlight = false;
      let closeHandled = false;
      const proc = spawn(pythonBin, [runnerPath], {
        cwd: projectRoot,
        env: childEnv,
      });
      procRef = proc;

      const runRecord = {
        appRunId,
        status: 'running',
        mode: childEnv.TINYFISH_MODE || 'mock',
        startedAt: new Date().toISOString(),
        completedAt: '',
        failureReason: '',
        failure: null,
        workflow: {
          name: childEnv.TINYFISH_WORKFLOW_NAME || '',
          url: childEnv.TINYFISH_WORKFLOW_URL || '',
          goal: childEnv.TINYFISH_WORKFLOW_GOAL || '',
          contactName: childEnv.TINYFISH_CONTACT_WORKFLOW_NAME || '',
          contactUrl: childEnv.TINYFISH_CONTACT_WORKFLOW_URL || '',
          contactGoal: childEnv.TINYFISH_CONTACT_WORKFLOW_GOAL || '',
          caseId: '',
          procedure: '',
        },
        workspace: {
          id: workspaceId,
          name: workspaceName,
        },
        intake: {
          payerName: childEnv.TINYFISH_PAYER_NAME || '',
          lineOfBusiness: childEnv.TINYFISH_LINE_OF_BUSINESS || '',
          memberState: childEnv.TINYFISH_MEMBER_STATE || '',
          specialty: childEnv.TINYFISH_SPECIALTY || '',
          caseLabel: childEnv.TINYFISH_CASE_LABEL || '',
          diagnosis: childEnv.TINYFISH_CASE_DIAGNOSIS || '',
          procedureLabel: childEnv.TINYFISH_CASE_PROCEDURE || '',
          chartSummary: childEnv.TINYFISH_CASE_CHART_SUMMARY || '',
          evidenceFiles: childEnv.TINYFISH_CASE_EVIDENCE_FILES || '',
        },
        artifact: null,
        operatorPacket: null,
        readiness: null,
        proof: {
          runtimeMode: childEnv.TINYFISH_MODE || 'mock',
          policy: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
          contact: { status: 'idle', runId: '', sourceUrl: '', streamUrl: '', error: '' },
        },
        metrics: {
          totalSteps: 0,
          eventCount: 0,
          elapsedSeconds: 0,
        },
        logs: {
          thinking: [],
          execution: [],
        },
      };

      let buffer = '';

      const sendPayload = (payload) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          isClosed = true;
        }
      };

      const finalizeStream = async ({ closeError = null, exitCode = 0 } = {}) => {
        if (closeHandled) {
          return;
        }
        closeHandled = true;

        if (buffer.trim()) {
          flushLine(buffer);
          buffer = '';
        }

        if (!runRecord.completedAt) {
          runRecord.completedAt = new Date().toISOString();
        }

        if ((closeError || exitCode !== 0 || (!sawComplete && !sawResult)) && !runRecord.failure) {
          setFailure({
            stage: 'run',
            message:
              closeError !== null
                ? normalizeCloseError(closeError)
                : exitCode !== 0
                  ? `Python runner exited with code ${exitCode}.`
                  : 'Runner exited before emitting a terminal result.',
          });
        }

        await persistRun();

        if (isClosed) {
          return;
        }

        if (!sawComplete) {
          sendPayload({ type: 'complete' });
          sawComplete = true;
        }

        isClosed = true;
        try {
          controller.close();
        } catch {}
      };
      finalizeRef = finalizeStream;

      const appendLog = (channel, log) => {
        const target = channel === 'thinking' ? runRecord.logs.thinking : runRecord.logs.execution;
        target.push(log);
        if (target.length > 120) {
          target.shift();
        }
      };

      const setFailure = ({ stage = 'run', message = '', workflowKind = '' }) => {
        if (runRecord.failure && runRecord.failure.stage !== 'run') {
          return;
        }
        const failure = classifyFailure({ stage, message, workflowKind });
        runRecord.failure = failure;
        runRecord.failureReason = failure.message;
        sawError = true;
        sendPayload({
          type: 'failure',
          appRunId,
          ...failure,
        });
      };

      const trackPayload = (payload) => {
        if (payload.type === 'config') {
          runRecord.mode = payload.mode || runRecord.mode;
          runRecord.proof.runtimeMode = payload.mode || runRecord.proof.runtimeMode;
          runRecord.workflow = {
            ...runRecord.workflow,
            name: payload.workflowName || runRecord.workflow.name,
            url: payload.workflowUrl || runRecord.workflow.url,
            goal: payload.workflowGoal || runRecord.workflow.goal,
            contactName: payload.contactWorkflowName || runRecord.workflow.contactName,
            contactUrl: payload.contactWorkflowUrl || runRecord.workflow.contactUrl,
            caseId: payload.caseId || '',
            procedure: payload.procedure || '',
          };
          return;
        }

        if (payload.type === 'proof' && payload.workflowKind) {
          const previous = runRecord.proof[payload.workflowKind] || {};
          runRecord.proof[payload.workflowKind] = {
            ...previous,
            status: payload.status,
            runId: payload.runId ?? previous.runId ?? '',
            sourceUrl: payload.sourceUrl ?? previous.sourceUrl ?? '',
            streamUrl: payload.streamUrl ?? previous.streamUrl ?? '',
            error: payload.error ?? previous.error ?? '',
          };
          if (payload.status === 'failed') {
            setFailure({
              stage: payload.workflowKind,
              message: payload.error || `${payload.workflowKind} workflow failed.`,
              workflowKind: payload.workflowKind,
            });
          }
          return;
        }

        if (payload.type === 'artifact') {
          runRecord.artifact = {
            policyResult: payload.policyResult || null,
            contactResult: payload.contactResult || null,
          };
          return;
        }

        if (payload.type === 'packet') {
          runRecord.operatorPacket = payload.operatorPacket || null;
          return;
        }

        if (payload.type === 'result') {
          sawResult = true;
          runRecord.readiness = payload.readiness || null;
          return;
        }

        if (payload.type === 'log') {
          runRecord.metrics.totalSteps = payload.totalSteps || runRecord.metrics.totalSteps;
          runRecord.metrics.eventCount = Math.max(runRecord.metrics.eventCount, payload.index || 0);
          const log = {
            id: payload.id,
            time: payload.time,
            text: payload.text,
            level: payload.level,
          };
          appendLog(payload.channel, log);
          if (payload.level === 'error') {
            if (!runRecord.failure) {
              setFailure({
                stage: 'run',
                message: payload.text || 'Execution error',
              });
            }
          }
        }
      };

      const persistRun = async () => {
        if (saveInFlight) {
          return;
        }
        saveInFlight = true;
        const startedAtMs = Date.parse(runRecord.startedAt);
        const completedAtMs = Date.parse(runRecord.completedAt || new Date().toISOString());
        runRecord.metrics.elapsedSeconds =
          startedAtMs && completedAtMs ? Math.max(1, Math.round((completedAtMs - startedAtMs) / 1000)) : 0;
        runRecord.status = sawError && !sawResult ? 'failed' : 'completed';
        try {
          const persisted = await saveRun(runRecord);
          if (persisted?.run?.snapshotDiff) {
            sendPayload({
              type: 'snapshot_diff',
              snapshotDiff: persisted.run.snapshotDiff,
            });
          }
        } catch (error) {
          console.error('Failed to persist run history', error);
        }

        try {
          await emitObservabilityEvent({
            service: 'authpilot-web',
            signal: 'run_summary',
            appRunId: runRecord.appRunId,
            status: runRecord.status,
            mode: runRecord.mode,
            elapsedSeconds: runRecord.metrics.elapsedSeconds,
            eventCount: runRecord.metrics.eventCount,
            totalSteps: runRecord.metrics.totalSteps,
            workflowName: runRecord.workflow.name,
            workflowUrl: runRecord.workflow.url,
            contactWorkflowName: runRecord.workflow.contactName,
            contactWorkflowUrl: runRecord.workflow.contactUrl,
            caseId: runRecord.workflow.caseId,
            procedure: runRecord.workflow.procedure,
            failureCode: runRecord.failure?.code || '',
            failureStage: runRecord.failure?.stage || '',
            failureRetryable: runRecord.failure?.retryable ?? false,
            readinessReady: runRecord.readiness?.ready ?? null,
            readinessConfidence: runRecord.readiness?.confidence ?? null,
            missingEvidenceCount: runRecord.readiness?.missing_evidence?.length || 0,
            matchedEvidenceCount: runRecord.readiness?.supporting_evidence?.length || 0,
            policyRunStatus: runRecord.proof.policy.status,
            contactRunStatus: runRecord.proof.contact.status,
          });
        } catch (error) {
          console.error('Failed to emit Axiom telemetry', error);
        }
      };

      const flushLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || isClosed) return;
        const payload = parseRunnerLine(trimmed, {
          appRunId,
          workspaceId,
          workspaceName,
        });

        if (!payload) {
          return;
        }

        if (payload.type === 'complete') {
          sawComplete = true;
        }
        trackPayload(payload);
        sendPayload(payload);
      };

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(flushLine);
      });

      proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (!msg || isClosed) return;
        const payload = redactLogPayload(buildFallbackLogPayload({
          text: msg,
          level: 'error',
          idPrefix: 'stderr',
        }));
        trackPayload(payload);
        sendPayload(payload);
      });

      proc.on('error', (error) => {
        void finalizeStream({ closeError: error, exitCode: 0 });
      });

      proc.on('close', (code) => {
        void finalizeStream({ exitCode: code ?? 0 });
      });
    },
    cancel() {
      if (procRef && !procRef.killed) {
        try {
          procRef.kill('SIGTERM');
        } catch {}
      }

      if (finalizeRef) {
        void finalizeRef({ closeError: new Error('Client disconnected before stream completion.'), exitCode: 0 });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-request-id': requestId,
    },
  });
}
