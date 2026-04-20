import { redactFreeText } from '../privacy.js';

const DEFAULT_COMPOSIO_BASE_URL = 'https://backend.composio.dev';
const DISPATCH_CACHE = new Set();

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(raw = '') {
  const text = clean(raw, 200_000);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeStatus(value = '') {
  const normalized = clean(value, 80).toUpperCase().replace(/\s+/g, '_');
  if (['APPROVED', 'DENIED', 'INFO_REQUESTED', 'INFO_SUBMITTED_WAITING', 'PENDING'].includes(normalized)) {
    return normalized;
  }
  if (normalized.includes('APPROV')) return 'APPROVED';
  if (normalized.includes('DENI')) return 'DENIED';
  if (normalized.includes('INFO') || normalized.includes('REQUEST')) return 'INFO_REQUESTED';
  return 'PENDING';
}

function normalizeExceptionActionType(value = '') {
  const normalized = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (['nudge_doctor_slack', 'retry_with_healed_selector', 'request_submission_proof'].includes(normalized)) {
    return normalized;
  }
  return 'nudge_doctor_slack';
}

function resolveRunUrl(runId = '') {
  const base = clean(process.env.AUTHPILOT_RUN_URL_BASE, 1200).replace(/\/+$/, '');
  const normalizedRunId = clean(runId, 120);
  if (!base || !normalizedRunId) {
    return '';
  }
  return `${base}/${normalizedRunId}`;
}

function sanitizedExternalOutcome({ runId = '', authStatus = '', referenceId = '', clinicalGap = '' } = {}) {
  return {
    runId: clean(runId, 120),
    authStatus: normalizeStatus(authStatus),
    referenceId: clean(referenceId, 120),
    runUrl: resolveRunUrl(runId),
    clinicalGap: redactFreeText(clean(clinicalGap, 800), { maxLength: 800 }),
    timestamp: new Date().toISOString(),
  };
}

function fallbackCommunicationDecision(outcome) {
  const status = normalizeStatus(outcome.authStatus);
  if (status === 'APPROVED') {
    return {
      provider: 'local-fallback',
      channels: ['billing', 'scheduling'],
      reason: 'Approved outcomes trigger revenue and scheduling workflows.',
    };
  }
  if (status === 'DENIED' || status === 'INFO_REQUESTED') {
    return {
      provider: 'local-fallback',
      channels: ['slack'],
      reason: 'Denied/info requested outcomes require urgent operator alerting.',
    };
  }
  return {
    provider: 'local-fallback',
    channels: [],
    reason: 'No communication channel needed for non-terminal outcome.',
  };
}

export async function coordinateCommunicationAgentWithAg2({ outcome = {} } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return fallbackCommunicationDecision(outcome);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clean(process.env.AG2_API_KEY, 5000)
        ? { authorization: `Bearer ${clean(process.env.AG2_API_KEY, 5000)}` }
        : {}),
    },
    body: JSON.stringify({
      role: 'Communication Agent',
      objective:
        'Choose which external clinic communication tools must be triggered from auth outcome severity while preserving PHI-minimized payloads.',
      outcome,
      allowedChannels: ['slack', 'billing', 'scheduling'],
    }),
  });

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    return fallbackCommunicationDecision(outcome);
  }

  const channels = asArray(parsed.channels)
    .map((item) => clean(item, 40).toLowerCase())
    .filter((item) => ['slack', 'billing', 'scheduling'].includes(item));

  return {
    provider: 'ag2',
    channels: channels.length ? channels : fallbackCommunicationDecision(outcome).channels,
    reason: clean(parsed.reason || parsed.rationale, 400),
  };
}

async function createSdkClients() {
  const apiKey = clean(process.env.COMPOSIO_API_KEY, 5000);
  if (!apiKey) {
    return null;
  }

  const composioSdk = await import('composio-core');
  const ComposioClass = composioSdk.Composio || composioSdk.default?.Composio;
  const ToolSetClass = composioSdk.ComposioToolSet || composioSdk.default?.ComposioToolSet;

  if (!ComposioClass || !ToolSetClass) {
    throw new Error('Unable to resolve Composio SDK classes.');
  }

  const options = {
    apiKey,
    baseUrl: clean(process.env.COMPOSIO_BASE_URL, 1200) || DEFAULT_COMPOSIO_BASE_URL,
  };

  return {
    composio: new ComposioClass(options),
    toolset: new ToolSetClass(options),
  };
}

async function getDynamicToolRegistry({ sdkClients = null, registry = null } = {}) {
  if (registry) {
    return asArray(registry);
  }

  const clients = sdkClients || (await createSdkClients());
  if (!clients) {
    return [];
  }

  try {
    const tools = await clients.toolset.getToolsSchema({
      apps: [
        clean(process.env.COMPOSIO_APP_SLACK, 80) || 'SLACK',
        clean(process.env.COMPOSIO_APP_GOOGLE_SHEETS, 80) || 'GOOGLE_SHEETS',
        clean(process.env.COMPOSIO_APP_SALESFORCE, 80) || 'SALESFORCE',
        clean(process.env.COMPOSIO_APP_GMAIL, 80) || 'GMAIL',
        clean(process.env.COMPOSIO_APP_OUTLOOK, 80) || 'OUTLOOK',
      ],
    });
    return asArray(tools);
  } catch {
    return [];
  }
}

function normalizeToolEntry(tool = {}) {
  const entry = asObject(tool);
  return {
    action: clean(entry.action || entry.name || entry.slug || entry.key, 200),
    app: clean(entry.app || entry.appName || entry.tool || entry.integration || '', 80).toUpperCase(),
    description: clean(entry.description || entry.summary || '', 500),
    raw: entry,
  };
}

function pickToolFromRegistry(registry = [], { channel = '' } = {}) {
  const normalizedChannel = clean(channel, 40).toLowerCase();
  const desired = {
    slack: {
      appMatches: ['SLACK'],
      keywords: ['MESSAGE', 'SEND', 'POST', 'CHAT'],
    },
    billing: {
      appMatches: ['GOOGLE_SHEETS', 'SALESFORCE'],
      keywords: ['ROW', 'UPDATE', 'UPSERT', 'RECORD', 'CREATE'],
    },
    scheduling: {
      appMatches: ['GMAIL', 'OUTLOOK'],
      keywords: ['EMAIL', 'SEND', 'MAIL', 'MESSAGE', 'CREATE_DRAFT'],
    },
  }[normalizedChannel];

  if (!desired) {
    return null;
  }

  const candidates = asArray(registry)
    .map((tool) => normalizeToolEntry(tool))
    .filter((tool) => tool.action)
    .filter((tool) => desired.appMatches.includes(tool.app));

  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((tool) => {
      const haystack = `${tool.action} ${tool.description}`.toUpperCase();
      const score = desired.keywords.reduce((sum, keyword) => (haystack.includes(keyword) ? sum + 1 : sum), 0);
      return {
        ...tool,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function buildActionPayload({ channel = '', outcome = {} } = {}) {
  const status = normalizeStatus(outcome.authStatus);
  const referenceId = clean(outcome.referenceId, 120) || 'N/A';
  const runLink = clean(outcome.runUrl, 1200) || `run:${clean(outcome.runId, 120)}`;

  if (channel === 'slack') {
    return {
      channel: clean(process.env.COMPOSIO_SLACK_WAR_ROOM_CHANNEL, 120) || '#prior-auth-war-room',
      text: [
        `Auth Outcome: ${status}`,
        `Reference ID: ${referenceId}`,
        `Run: ${runLink}`,
        outcome.clinicalGap ? `Clinical Gap: ${clean(outcome.clinicalGap, 500)}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    };
  }

  if (channel === 'billing') {
    return {
      status,
      reference_id: referenceId,
      run_id: clean(outcome.runId, 120),
      run_link: runLink,
      tracker: clean(process.env.COMPOSIO_REVENUE_TRACKER_NAME, 200) || 'Revenue Readiness',
    };
  }

  if (channel === 'scheduling') {
    return {
      to:
        clean(outcome.patientSchedulingEmail, 240) ||
        clean(process.env.CLINIC_PATIENT_SCHEDULING_EMAIL, 240),
      subject: `Coverage confirmed: reference ${referenceId}`,
      body: [
        'Your authorization is approved. Please schedule your procedure at your earliest convenience.',
        `Reference ID: ${referenceId}`,
        `Run Link: ${runLink}`,
      ].join('\n\n'),
    };
  }

  return {};
}

async function executeRegistryAction({
  sdkClients = null,
  execute = null,
  action = '',
  params = {},
  runId = '',
} = {}) {
  const normalizedAction = clean(action, 200);
  if (!normalizedAction) {
    return {
      ok: false,
      skipped: true,
      reason: 'No composio action found from dynamic registry.',
    };
  }

  const actionParams = {
    ...asObject(params),
    client_id: clean(runId, 120),
  };

  if (typeof execute === 'function') {
    return execute({
      action: normalizedAction,
      params: actionParams,
      entityId: clean(runId, 120),
    });
  }

  const clients = sdkClients || (await createSdkClients());
  if (!clients) {
    return {
      ok: false,
      skipped: true,
      reason: 'COMPOSIO_API_KEY missing; bridge dispatch skipped.',
    };
  }

  return clients.toolset.executeAction({
    action: normalizedAction,
    params: actionParams,
    entityId: clean(runId, 120),
  });
}

export async function createComposioConnectLink({
  appName = '',
  adminEntityId = '',
  redirectUri = '',
  sdkClients = null,
} = {}) {
  const clients = sdkClients || (await createSdkClients());
  if (!clients) {
    return {
      ok: false,
      skipped: true,
      reason: 'COMPOSIO_API_KEY missing; connect link generation skipped.',
    };
  }

  const entityId = clean(adminEntityId, 120) || clean(process.env.COMPOSIO_ADMIN_ENTITY_ID, 120);
  const normalizedAppName = clean(appName, 120).toUpperCase();

  if (!entityId || !normalizedAppName) {
    return {
      ok: false,
      skipped: true,
      reason: 'adminEntityId and appName are required for connect links.',
    };
  }

  const entity = clients.composio.getEntity(entityId);
  const connection = await entity.initiateConnection({
    appName: normalizedAppName,
    redirectUri: clean(redirectUri, 1200) || clean(process.env.COMPOSIO_CONNECT_REDIRECT_URI, 1200),
  });

  const payload = asObject(connection);
  return {
    ok: true,
    appName: normalizedAppName,
    entityId,
    connectLink:
      clean(payload.redirectUrl || payload.connectLink || payload.url || payload.link, 2000) ||
      clean(payload?.data?.redirectUrl || payload?.data?.connectLink, 2000),
    raw: payload,
  };
}

export async function dispatchAuthOutcome({
  run = {},
  authStatus = '',
  referenceId = '',
  clinicalGap = '',
  sdkClients = null,
  registry = null,
  execute = null,
} = {}) {
  const outcome = sanitizedExternalOutcome({
    runId: clean(run?.appRunId, 120),
    authStatus,
    referenceId,
    clinicalGap,
  });

  if (!outcome.runId || !outcome.authStatus) {
    return {
      ok: false,
      skipped: true,
      reason: 'runId and authStatus are required for outcome dispatch.',
    };
  }

  const dedupeKey = `${outcome.runId}:${outcome.authStatus}`;
  if (DISPATCH_CACHE.has(dedupeKey)) {
    return {
      ok: true,
      skipped: true,
      reason: 'Duplicate outcome dispatch prevented by idempotency cache.',
      outcome,
    };
  }

  const communicationDecision = await coordinateCommunicationAgentWithAg2({
    outcome,
  });

  const channels = asArray(communicationDecision.channels)
    .map((item) => clean(item, 40).toLowerCase())
    .filter((item) => ['slack', 'billing', 'scheduling'].includes(item));

  if (!channels.length) {
    DISPATCH_CACHE.add(dedupeKey);
    return {
      ok: true,
      skipped: true,
      reason: 'No communication channels selected for this outcome.',
      outcome,
      communicationDecision,
      results: [],
    };
  }

  const dynamicRegistry = await getDynamicToolRegistry({ sdkClients, registry });

  const results = [];
  for (const channel of channels) {
    const chosen = pickToolFromRegistry(dynamicRegistry, { channel });
    const params = buildActionPayload({
      channel,
      outcome: {
        ...outcome,
        patientSchedulingEmail: clean(run?.intake?.patientEmail || run?.intake?.email, 240),
      },
    });
    const dispatchedParams = {
      ...asObject(params),
      client_id: outcome.runId,
    };

    const execution = await executeRegistryAction({
      sdkClients,
      execute,
      action: chosen?.action,
      params: dispatchedParams,
      runId: outcome.runId,
    });

    results.push({
      channel,
      action: clean(chosen?.action, 200),
      app: clean(chosen?.app, 80),
      params: dispatchedParams,
      execution: asObject(execution),
    });
  }

  DISPATCH_CACHE.add(dedupeKey);

  return {
    ok: true,
    skipped: false,
    idempotencyKey: dedupeKey,
    outcome,
    communicationDecision,
    results,
  };
}

export function _resetComposioDispatchCache() {
  DISPATCH_CACHE.clear();
}

export async function dispatchExceptionAction({
  run = {},
  actionType = '',
  note = '',
  sdkClients = null,
  registry = null,
  execute = null,
} = {}) {
  const runId = clean(run?.appRunId, 120);
  if (!runId) {
    return {
      ok: false,
      skipped: true,
      reason: 'runId is required for exception action dispatch.',
    };
  }

  const normalizedActionType = normalizeExceptionActionType(actionType);
  const dedupeKey = `${runId}:exception:${normalizedActionType}`;

  if (DISPATCH_CACHE.has(dedupeKey)) {
    return {
      ok: true,
      skipped: true,
      reason: 'Duplicate exception action prevented by idempotency cache.',
      idempotencyKey: dedupeKey,
    };
  }

  const dynamicRegistry = await getDynamicToolRegistry({ sdkClients, registry });
  const chosen = pickToolFromRegistry(dynamicRegistry, { channel: 'slack' });

  const emrStatus = clean(run?.operatorPacket?.emr_sync?.status || run?.emrSync?.status, 120);
  const messageByAction = {
    nudge_doctor_slack: `One-click fix requested: nudge physician for missing chart evidence.`,
    retry_with_healed_selector: `One-click fix requested: retry portal submission using healed selector overrides.`,
    request_submission_proof: `One-click fix requested: capture or verify payer proof artifact for submitted case.`,
  };

  const params = {
    channel: clean(process.env.COMPOSIO_SLACK_WAR_ROOM_CHANNEL, 120) || '#prior-auth-war-room',
    text: [
      `Exception Action: ${normalizedActionType}`,
      `Run: ${resolveRunUrl(runId) || runId}`,
      emrStatus ? `Current Status: ${emrStatus}` : '',
      redactFreeText(clean(note || messageByAction[normalizedActionType], 900), { maxLength: 900 }),
    ]
      .filter(Boolean)
      .join(' | '),
  };

  const dispatchedParams = {
    ...params,
    client_id: runId,
  };

  const execution = await executeRegistryAction({
    sdkClients,
    execute,
    action: chosen?.action,
    params: dispatchedParams,
    runId,
  });

  DISPATCH_CACHE.add(dedupeKey);

  return {
    ok: true,
    skipped: false,
    idempotencyKey: dedupeKey,
    actionType: normalizedActionType,
    result: {
      channel: 'slack',
      action: clean(chosen?.action, 200),
      app: clean(chosen?.app, 80),
      params: dispatchedParams,
      execution: asObject(execution),
    },
  };
}
