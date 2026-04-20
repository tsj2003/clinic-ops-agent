import twilio from 'twilio';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import { redactFreeText } from '../privacy.js';
import { emitObservabilityEvent } from '../observability.js';
import { closeLoopEmrTask } from './emr-close-loop.js';
import { dispatchAuthOutcome } from './composio-bridge.js';
import { triggerRevenueEvent } from './billing-engine.js';
import { generateCombatBriefOnDenial } from './combat-brief.js';
import { listRunsForAnalytics, updateRunCaseLifecycle } from '../run-store.js';

const DEFAULT_FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_STATUS_MODEL = 'accounts/fireworks/models/llama-v3p3-70b-instruct';
const DEFAULT_MAX_CONCURRENT_CALLS = 2;

const VOICE_STATUS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['finalStatus', 'referenceNumber', 'summary'],
  properties: {
    finalStatus: { type: 'string' },
    referenceNumber: { type: 'string' },
    summary: { type: 'string' },
    confidence: { type: 'number' },
  },
};

const DTMF_NODES = {
  root: {
    node: 'root',
    tone: '1',
    next: 'auth_menu',
    keywords: ['authorizations', 'authorization', 'prior auth', 'utilization management'],
  },
  auth_menu: {
    node: 'auth_menu',
    tone: '2',
    next: 'status_menu',
    keywords: ['status', 'existing authorization', 'check status', 'precert status'],
  },
  status_menu: {
    node: 'status_menu',
    tone: '1',
    next: 'agent_or_result',
    keywords: ['member id', 'auth id', 'authorization id', 'tracking number', 'pending', 'approved', 'denied'],
  },
};

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(text) {
  const raw = clean(text, 200_000);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function cleanPhone(value) {
  return clean(value, 30).replace(/[^0-9+]/g, '');
}

function sanitizeName(value) {
  return clean(value, 120).replace(/[^a-zA-Z' -]/g, '').trim();
}

function normalizeStatus(value) {
  return clean(value, 80).toLowerCase();
}

function modelStatusKeyword(value) {
  const normalized = normalizeStatus(value);
  if (normalized.includes('approve')) return 'approved';
  if (normalized.includes('denied') || normalized.includes('declined')) return 'denied';
  if (normalized.includes('pending') || normalized.includes('review')) return 'pending';
  return 'unknown';
}

function regexEscape(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createVoiceClients() {
  const elevenLabsApiKey = clean(process.env.ELEVENLABS_API_KEY, 5000);
  const twilioAccountSid = clean(process.env.TWILIO_ACCOUNT_SID, 120);
  const twilioAuthToken = clean(process.env.TWILIO_AUTH_TOKEN, 5000);

  if (!elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is required for voice liaison.');
  }
  if (!twilioAccountSid || !twilioAuthToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for PSTN voice liaison.');
  }

  return {
    elevenlabs: new ElevenLabsClient({ apiKey: elevenLabsApiKey }),
    twilio: twilio(twilioAccountSid, twilioAuthToken),
  };
}

export function buildVoiceStatusSystemPrompt({
  clinicName = 'Clinic',
  patientLastName = '',
  npi = '',
  authId = '',
} = {}) {
  return [
    `You are an administrative assistant for ${clean(clinicName, 120) || 'the clinic'}.`,
    `Your goal is to check the status of Authorization for Patient ${sanitizeName(patientLastName) || '[LastName]'}.`,
    'Navigate the IVR, provide the NPI and Auth ID when prompted, and listen for keywords like Approved, Denied, or Pending.',
    `NPI: ${clean(npi, 40) || '[NPI]'}`,
    `Authorization ID: ${clean(authId, 120) || '[Auth ID]'}`,
    'Avoid sharing extra PHI. Keep responses minimal and administrative.',
  ].join('\n');
}

export async function createVoiceStatusAgent({
  clinicName = '',
  patientLastName = '',
  npi = '',
  authId = '',
} = {}) {
  const { elevenlabs } = createVoiceClients();
  const systemPrompt = buildVoiceStatusSystemPrompt({
    clinicName,
    patientLastName,
    npi,
    authId,
  });

  // We keep this call defensive because ElevenLabs session APIs evolve rapidly.
  // The returned object is enough for coordinator orchestration and testing.
  const session = {
    id: '',
    status: 'prepared',
  };

  try {
    if (typeof elevenlabs?.conversationalAi?.createSession === 'function') {
      const created = await elevenlabs.conversationalAi.createSession({
        metadata: {
          role: 'voice-status-agent',
        },
        firstMessage: 'Hello. I am calling to check a prior authorization status.',
        systemPrompt,
      });
      session.id = clean(created?.id || created?.sessionId, 120);
      session.status = clean(created?.status || 'active', 80);
    }
  } catch {
    // Best effort: continue with local session metadata.
  }

  return {
    provider: 'elevenlabs',
    systemPrompt,
    session,
  };
}

export function redactVoiceTranscript(transcript = '', { run = {}, clinicName = '' } = {}) {
  let redacted = redactFreeText(clean(transcript, 100_000), { maxLength: 100_000 });

  const firstName = sanitizeName(run?.intake?.firstName || run?.operatorPacket?.first_name || '');
  const lastName = sanitizeName(run?.intake?.lastName || run?.operatorPacket?.last_name || '');
  const clinic = sanitizeName(clinicName || run?.workspace?.name || '');
  const memberId = clean(run?.intake?.memberId || run?.operatorPacket?.member_id, 120);
  const patientId = clean(run?.intake?.patientId || run?.operatorPacket?.patient_id, 120);

  const tokens = [firstName, lastName, clinic, memberId, patientId].filter(Boolean);

  for (const token of tokens) {
    redacted = redacted.replace(new RegExp(regexEscape(token), 'gi'), '[REDACTED_ENTITY]');
  }

  return redacted;
}

export function createIvrStateMachine() {
  return {
    currentNode: 'root',
    sentTones: [],
    completed: false,
  };
}

export function advanceIvrStateMachine(machine = createIvrStateMachine(), transcriptChunk = '') {
  const chunk = normalizeStatus(transcriptChunk);
  if (!chunk || machine.completed) {
    return { ...machine, action: null };
  }

  const nodeConfig = DTMF_NODES[machine.currentNode] || null;
  if (!nodeConfig) {
    return { ...machine, action: null };
  }

  const detected = nodeConfig.keywords.some((keyword) => chunk.includes(normalizeStatus(keyword)));
  if (!detected) {
    return { ...machine, action: null };
  }

  const nextMachine = {
    ...machine,
    currentNode: nodeConfig.next,
    sentTones: [...machine.sentTones, nodeConfig.tone],
    completed: nodeConfig.next === 'agent_or_result',
    action: {
      type: 'send_dtmf',
      tone: nodeConfig.tone,
      node: nodeConfig.node,
    },
  };

  return nextMachine;
}

export async function sendDtmfTone({ callSid = '', tone = '' } = {}) {
  const normalizedCallSid = clean(callSid, 120);
  const normalizedTone = clean(tone, 20);
  if (!normalizedCallSid || !normalizedTone) {
    throw new Error('callSid and tone are required for DTMF signaling.');
  }

  const { twilio: twilioClient } = createVoiceClients();
  await twilioClient.calls(normalizedCallSid).update({
    twiml: `<Response><Play digits="ww${normalizedTone}" /></Response>`,
  });

  return {
    ok: true,
    callSid: normalizedCallSid,
    tone: normalizedTone,
  };
}

export async function placeVoiceStatusCheckCall({
  payerPhoneNumber = '',
  fromPhoneNumber = '',
  statusCallbackUrl = '',
  clinicName = '',
  authId = '',
} = {}) {
  const to = cleanPhone(payerPhoneNumber || process.env.VOICE_PAYER_PHONE_DEFAULT);
  const from = cleanPhone(fromPhoneNumber || process.env.TWILIO_PHONE_NUMBER);

  if (!to || !from) {
    throw new Error('payerPhoneNumber and TWILIO_PHONE_NUMBER are required to place voice status calls.');
  }

  const { twilio: twilioClient } = createVoiceClients();

  const intro = `Hello. This is ${clean(clinicName, 120) || 'the clinic'} calling to check authorization status for auth ${clean(authId, 80) || 'unknown'}.`;

  const call = await twilioClient.calls.create({
    to,
    from,
    twiml: `<Response><Say>${clean(intro, 300)}</Say><Pause length="1"/></Response>`,
    ...(clean(statusCallbackUrl, 1000)
      ? {
          statusCallback: clean(statusCallbackUrl, 1000),
          statusCallbackEvent: ['completed'],
        }
      : {}),
  });

  return {
    callSid: clean(call?.sid, 120),
    status: clean(call?.status, 80),
    to,
    from,
  };
}

export async function leaveHumanTransferVoicemail({
  callSid = '',
  authId = '',
  callbackNumber = '',
  clinicName = '',
} = {}) {
  const normalizedCallSid = clean(callSid, 120);
  if (!normalizedCallSid) {
    throw new Error('callSid is required to leave fallback voicemail.');
  }

  const message = [
    `Hello, this is ${clean(clinicName, 120) || 'the clinic'} following up on an authorization status check.`,
    `Authorization ID ${clean(authId, 120) || 'unknown'}.`,
    `Please return the call at ${clean(callbackNumber || process.env.CLINIC_CALLBACK_NUMBER, 30) || 'the number on file'}.`,
    'Thank you.',
  ].join(' ');

  const { twilio: twilioClient } = createVoiceClients();

  await twilioClient.calls(normalizedCallSid).update({
    twiml: `<Response><Say>${clean(message, 600)}</Say><Hangup/></Response>`,
  });

  return {
    ok: true,
    callSid: normalizedCallSid,
    message,
  };
}

export async function extractVoiceCallOutcomeWithFireworks({ transcript = '', runId = '', authId = '' } = {}) {
  const apiKey = clean(process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is required for voice transcript analysis.');
  }

  const fireworksBaseUrl = clean(process.env.FIREWORKS_BASE_URL, 1200) || DEFAULT_FIREWORKS_BASE_URL;

  const response = await fetch(`${fireworksBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: clean(process.env.FIREWORKS_VOICE_ANALYZER_MODEL || DEFAULT_STATUS_MODEL, 200),
      temperature: 0,
      max_tokens: 500,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'VoiceStatusOutcomeSchema',
          strict: true,
          schema: VOICE_STATUS_JSON_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'Extract the final prior authorization status from transcript text. Return approved, denied, pending, or unknown. Return any payer reference number.',
        },
        {
          role: 'user',
          content: [
            `Run ID: ${clean(runId, 120) || 'unknown'}`,
            `Authorization ID: ${clean(authId, 120) || 'unknown'}`,
            `Transcript:\n${clean(transcript, 60_000)}`,
          ].join('\n\n'),
        },
      ],
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.message || 'Voice transcript extraction failed.', 500));
  }

  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    '{}';
  const parsed = parseJson(content);

  return {
    finalStatus: modelStatusKeyword(parsed.finalStatus),
    referenceNumber: clean(parsed.referenceNumber, 200),
    summary: clean(parsed.summary, 4000),
    confidence: Number(parsed.confidence) || 0,
    modelUsed: clean(process.env.FIREWORKS_VOICE_ANALYZER_MODEL || DEFAULT_STATUS_MODEL, 200),
  };
}

export function mapVoiceOutcomeToEmrStatus(status = '') {
  const normalized = modelStatusKeyword(status);

  if (normalized === 'approved') {
    return {
      emrStatus: 'EMR_TASK_APPROVED',
      lifecycleStatus: 'submitted',
    };
  }
  if (normalized === 'denied') {
    return {
      emrStatus: 'EMR_TASK_DENIED',
      lifecycleStatus: 'escalated',
    };
  }
  return {
    emrStatus: 'INFO_SUBMITTED_WAITING',
    lifecycleStatus: 'submitted',
  };
}

export function shouldTriggerVoiceCoordinatorCall(run = {}, nowMs = Date.now()) {
  const status = clean(run?.caseLifecycle?.status || run?.status, 80).toLowerCase();
  if (status !== 'submitted') {
    return false;
  }

  const updatedAtRaw = run?.caseLifecycle?.updatedAt || run?.completedAt || run?.startedAt || '';
  const updatedAtMs = Date.parse(updatedAtRaw);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  const hoursSinceUpdate = (nowMs - updatedAtMs) / (1000 * 60 * 60);
  return hoursSinceUpdate > 48;
}

export function buildVoiceCoordinatorPrompt({ run = {} } = {}) {
  return {
    role: 'Voice Coordinator',
    objective: 'Trigger IVR status checks for prior authorizations stalled >48h, enforce concurrency caps, and produce structured call instructions.',
    run: {
      appRunId: clean(run?.appRunId, 120),
      caseId: clean(run?.operatorPacket?.case_id, 120),
      payerName: clean(run?.operatorPacket?.payer_name || run?.intake?.payerName, 160),
      authId: clean(run?.operatorPacket?.case_id || run?.operatorPacket?.authorization_id, 160),
    },
    constraints: {
      maxConcurrentCalls: DEFAULT_MAX_CONCURRENT_CALLS,
      fallback: 'If human transfer is reached, leave voicemail with auth ID and callback number.',
    },
  };
}

export async function coordinateVoiceCallWithAg2(payload = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return {
      provider: 'local-fallback',
      decision: 'proceed',
      rationale: 'AG2 coordinator URL not configured; defaulting to local coordinator.',
      payload,
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clean(process.env.AG2_API_KEY, 5000) ? { authorization: `Bearer ${clean(process.env.AG2_API_KEY, 5000)}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    return {
      provider: 'ag2',
      decision: 'proceed',
      rationale: clean(parsed?.error || parsed?.message || 'AG2 call failed; proceeding with local fallback.', 300),
      payload,
    };
  }

  return {
    provider: 'ag2',
    decision: clean(parsed.decision || 'proceed', 40),
    rationale: clean(parsed.rationale, 300),
    payload: asObject(parsed.payload) || payload,
  };
}

export async function runVoiceCoordinator({
  maxConcurrentCalls = DEFAULT_MAX_CONCURRENT_CALLS,
  triggerCall,
} = {}) {
  const { runs } = await listRunsForAnalytics(250);
  const eligible = (Array.isArray(runs) ? runs : []).filter((run) => shouldTriggerVoiceCoordinatorCall(run));
  const maxCalls = Math.max(1, Math.min(DEFAULT_MAX_CONCURRENT_CALLS, Number(maxConcurrentCalls) || DEFAULT_MAX_CONCURRENT_CALLS));
  const toDispatch = eligible.slice(0, maxCalls);

  const results = [];

  for (const run of toDispatch) {
    const coordinationPrompt = buildVoiceCoordinatorPrompt({ run });
    const ag2Decision = await coordinateVoiceCallWithAg2(coordinationPrompt);

    if (normalizeStatus(ag2Decision.decision) === 'skip') {
      results.push({
        runId: run.appRunId,
        dispatched: false,
        reason: clean(ag2Decision.rationale || 'Skipped by coordinator.', 300),
      });
      continue;
    }

    const action =
      typeof triggerCall === 'function'
        ? await triggerCall(run, ag2Decision)
        : {
            dispatched: false,
            reason: 'No call trigger provided.',
          };

    results.push({
      runId: run.appRunId,
      ...asObject(action),
    });
  }

  await emitObservabilityEvent({
    service: 'authpilot-web',
    signal: 'voice_coordinator_run',
    totalEligible: eligible.length,
    dispatched: results.filter((item) => item.dispatched).length,
    skipped: results.filter((item) => !item.dispatched).length,
  }).catch(() => null);

  return {
    ok: true,
    maxConcurrentCalls: maxCalls,
    totalEligible: eligible.length,
    results,
  };
}

export async function processVoiceTranscriptOutcome({
  run = {},
  transcript = '',
  reachedHumanTransfer = false,
  callSid = '',
  clinicName = '',
  callbackNumber = '',
} = {}) {
  const redactedTranscript = redactVoiceTranscript(transcript, { run, clinicName });

  if (reachedHumanTransfer && clean(callSid, 120)) {
    await leaveHumanTransferVoicemail({
      callSid,
      authId: run?.operatorPacket?.case_id || run?.appRunId,
      callbackNumber,
      clinicName,
    });
  }

  const analysis = await extractVoiceCallOutcomeWithFireworks({
    transcript: redactedTranscript,
    runId: run?.appRunId,
    authId: run?.operatorPacket?.case_id || run?.operatorPacket?.authorization_id,
  });

  const mapped = mapVoiceOutcomeToEmrStatus(analysis.finalStatus);
  const connectorHint = clean(
    run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.emr_connector_hint || run?.emrSync?.connector || 'athena',
    60,
  ).toLowerCase();

  const emrPatch = await closeLoopEmrTask({
    connector: connectorHint,
    run,
    payerReferenceId: analysis.referenceNumber,
    emrStatus: mapped.emrStatus,
    note: clean(analysis.summary, 400),
    proof: {
      capturedAt: new Date().toISOString(),
      screenshotPath: '',
    },
  });

  const updated = await updateRunCaseLifecycle(run?.appRunId, {
    status: mapped.lifecycleStatus,
    actor: 'voice-agent',
    source: 'voice_status_webhook',
    eventNote: `Voice status update: ${analysis.finalStatus}. Ref: ${clean(analysis.referenceNumber, 120) || 'none'}`,
    emrSync: {
      connector: connectorHint,
      status: mapped.emrStatus,
      payerReferenceId: clean(analysis.referenceNumber, 120),
      operation: 'voice_status_check',
      message: clean(analysis.summary, 1000),
      packetId: run?.operatorPacket?.case_id || run?.appRunId,
      lastSyncedAt: new Date().toISOString(),
    },
  });

  const externalStatus =
    analysis.finalStatus === 'approved'
      ? 'APPROVED'
      : analysis.finalStatus === 'denied'
        ? 'DENIED'
        : 'PENDING';

  const composioDispatch = await dispatchAuthOutcome({
    run,
    authStatus: externalStatus,
    referenceId: analysis.referenceNumber,
    clinicalGap: '',
  }).catch((error) => ({
    ok: false,
    skipped: true,
    reason: error instanceof Error ? error.message : 'Composio dispatch failed.',
  }));

  const billing =
    externalStatus === 'APPROVED'
      ? await triggerRevenueEvent({
          run: updated.run,
          coordinatorStatus: 'APPROVED',
          payerReferenceId: analysis.referenceNumber,
          source: 'voice_liaison',
        }).catch((error) => ({
          ok: false,
          skipped: true,
          reason: error instanceof Error ? error.message : 'Revenue trigger failed.',
        }))
      : { ok: false, skipped: true, reason: 'Not approved.' };

  const combatBrief =
    externalStatus === 'DENIED'
      ? await generateCombatBriefOnDenial({
          run: updated.run,
          denialStatus: 'DENIED',
          denialReason: analysis.summary,
          payerReferenceId: analysis.referenceNumber,
          source: 'voice_liaison',
        }).catch((error) => ({
          ok: false,
          skipped: true,
          reason: error instanceof Error ? error.message : 'Combat brief generation failed.',
        }))
      : { ok: false, skipped: true, reason: 'Not denied.' };

  return {
    redactedTranscript,
    analysis,
    mapped,
    emrPatch,
    composioDispatch,
    billing,
    combatBrief,
    run: updated.run,
  };
}
