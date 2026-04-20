function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function buildWorkspaceName({ runId = '', agentName = 'portal' } = {}) {
  const safeRun = clean(runId, 120).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const safeAgent = clean(agentName, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `authpilot-${safeAgent}-${safeRun || Date.now().toString(36)}`.slice(0, 60);
}

export async function createEphemeralDaytonaWorkspace({
  runId = '',
  agentName = 'portal',
  clinicalArtifacts = [],
  credentialRefs = [],
  daytonaClient = null,
  fetchImpl = fetch,
} = {}) {
  const scopedArtifacts = asArray(clinicalArtifacts).map((item) => clean(item, 2000)).filter(Boolean);
  const scopedCredentialRefs = asArray(credentialRefs).map((item) => clean(item, 500)).filter(Boolean);

  const scopedAccess = {
    runId: clean(runId, 120),
    agentName: clean(agentName, 80),
    allowedClinicalArtifacts: scopedArtifacts,
    allowedCredentialRefs: scopedCredentialRefs,
  };

  if (daytonaClient && typeof daytonaClient.createWorkspace === 'function') {
    const created = await daytonaClient.createWorkspace({
      name: buildWorkspaceName({ runId, agentName }),
      labels: {
        purpose: 'authpilot-portal-isolation',
        runId: clean(runId, 120),
        agent: clean(agentName, 80),
      },
      access: scopedAccess,
      ttlSeconds: Math.max(60, Number(process.env.DAYTONA_EPHEMERAL_TTL_SECONDS) || 900),
    });

    return {
      ok: true,
      provider: 'daytona',
      workspaceId: clean(created?.id || created?.workspaceId, 120),
      scopedAccess,
      createdAt: nowIso(),
      raw: asObject(created),
    };
  }

  const apiKey = clean(process.env.DAYTONA_API_KEY, 5000);
  const baseUrl = clean(process.env.DAYTONA_BASE_URL, 1200);
  if (apiKey && baseUrl) {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/workspaces`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: buildWorkspaceName({ runId, agentName }),
        labels: {
          purpose: 'authpilot-portal-isolation',
          runId: clean(runId, 120),
          agent: clean(agentName, 80),
        },
        access: scopedAccess,
        ttlSeconds: Math.max(60, Number(process.env.DAYTONA_EPHEMERAL_TTL_SECONDS) || 900),
      }),
      cache: 'no-store',
    });

    const payload = asObject(await response.json().catch(() => ({})));
    if (!response.ok) {
      return {
        ok: false,
        provider: 'daytona',
        reason: clean(payload?.error || payload?.message || `Daytona create failed (${response.status}).`, 500),
        scopedAccess,
      };
    }

    return {
      ok: true,
      provider: 'daytona',
      workspaceId: clean(payload?.id || payload?.workspaceId, 120),
      scopedAccess,
      createdAt: nowIso(),
      raw: payload,
    };
  }

  return {
    ok: true,
    provider: 'local-fallback',
    workspaceId: clean(`local-${Date.now().toString(36)}`, 120),
    scopedAccess,
    createdAt: nowIso(),
    localSandbox: true,
  };
}

export async function destroyEphemeralDaytonaWorkspace({ workspaceId = '', daytonaClient = null, fetchImpl = fetch } = {}) {
  const id = clean(workspaceId, 120);
  if (!id) {
    return { ok: true, skipped: true, reason: 'missing_workspace_id' };
  }

  if (daytonaClient && typeof daytonaClient.destroyWorkspace === 'function') {
    await daytonaClient.destroyWorkspace({ workspaceId: id });
    return { ok: true, provider: 'daytona', workspaceId: id, destroyedAt: nowIso() };
  }

  const apiKey = clean(process.env.DAYTONA_API_KEY, 5000);
  const baseUrl = clean(process.env.DAYTONA_BASE_URL, 1200);
  if (apiKey && baseUrl) {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/workspaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const raw = await response.text();
      return {
        ok: false,
        provider: 'daytona',
        workspaceId: id,
        reason: clean(raw || `Daytona destroy failed (${response.status}).`, 500),
      };
    }

    return { ok: true, provider: 'daytona', workspaceId: id, destroyedAt: nowIso() };
  }

  return {
    ok: true,
    provider: 'local-fallback',
    workspaceId: id,
    destroyedAt: nowIso(),
  };
}

export async function withDaytonaSandbox({
  runId = '',
  agentName = 'portal',
  clinicalArtifacts = [],
  credentialRefs = [],
  execute = async () => ({}),
  daytonaClient = null,
  fetchImpl = fetch,
} = {}) {
  const sandbox = await createEphemeralDaytonaWorkspace({
    runId,
    agentName,
    clinicalArtifacts,
    credentialRefs,
    daytonaClient,
    fetchImpl,
  });

  let executionResult = null;
  let executionError = null;

  try {
    executionResult = await execute({ sandbox });
  } catch (error) {
    executionError = error;
  }

  const teardown = await destroyEphemeralDaytonaWorkspace({
    workspaceId: sandbox.workspaceId,
    daytonaClient,
    fetchImpl,
  });

  if (executionError) {
    throw executionError;
  }

  return {
    ok: true,
    sandbox,
    teardown,
    result: executionResult,
  };
}
