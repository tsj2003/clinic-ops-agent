import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { processClinicalRecord } from '../ai/fireworks-client.js';
import { getRelevantPayerRules } from '../ai/mixedbread-client.js';
import { redactFreeText } from '../privacy.js';
import { runJustificationAudit } from './rule-auditor.js';
import { updateRunCaseLifecycle } from '../run-store.js';

const DEFAULT_FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_RED_TEAM_MODEL = 'accounts/fireworks/models/llama-v3p3-70b-instruct';
const DEFAULT_DENIAL_RISK_THRESHOLD = 40;
const DENIAL_REWORK_COST_USD = 100;
const EXTRACTION_LATENCY_FLOOR_MS = 5000;

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonSafe(raw = '') {
  const text = clean(raw, 300_000);
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

function normalizePayerId(run = {}) {
  const payer = clean(run?.intake?.payerName || run?.operatorPacket?.payer_name, 120).toLowerCase();
  return payer
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProcedureCode(run = {}) {
  return clean(run?.intake?.procedureCode || run?.operatorPacket?.procedure_code, 40)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, asNumber(ms, 0))));
}

function policyTraceDir() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '.data', 'pilot-vault', 'automation', 'denial-simulator');
}

async function writeTrace({ runId = '', trace = {} } = {}) {
  const targetDir = policyTraceDir();
  await fs.mkdir(targetDir, { recursive: true });

  const redacted = {
    runId: clean(runId, 120),
    recordedAt: nowIso(),
    policyId: clean(trace.policyId, 220),
    denialProbabilityScore: asNumber(trace.denialProbabilityScore, 0),
    denialReason: redactFreeText(clean(trace.denialReason, 2000), { maxLength: 2000 }),
    missingDocumentation: asArray(trace.missingDocumentation)
      .map((item) => redactFreeText(clean(item, 400), { maxLength: 400 }))
      .filter(Boolean),
    model: clean(trace.model, 240),
    simulatorProvider: clean(trace.simulatorProvider, 120),
    source: clean(trace.source, 120),
    policyCitation: {
      policy_id: clean(trace.policyId, 220),
      sourceUrl: clean(trace.policySourceUrl, 1200),
    },
  };

  const fileName = `${clean(runId || 'run', 120)}-${Date.now().toString(36)}.json`;
  const targetPath = path.join(targetDir, fileName);
  await fs.writeFile(targetPath, `${JSON.stringify(redacted, null, 2)}\n`, 'utf-8');

  return {
    ok: true,
    tracePath: targetPath,
    traceFile: fileName,
  };
}

async function createYottaClient(providedClient = null) {
  if (providedClient) {
    return providedClient;
  }

  const apiKey = clean(process.env.YOTTA_LABS_API_KEY, 5000);
  if (!apiKey) {
    return null;
  }

  try {
    const sdk = await dynamicImport('yotta-labs');
    const YottaLabs = sdk?.YottaLabs || sdk?.default?.YottaLabs || sdk?.default;
    if (!YottaLabs) {
      return null;
    }
    return new YottaLabs({
      apiKey,
      baseUrl: clean(process.env.YOTTA_LABS_BASE_URL, 1200),
    });
  } catch {
    return null;
  }
}

async function yottaTrack({ client = null, event = '', properties = {} } = {}) {
  if (!client) {
    return { ok: false, skipped: true, reason: 'missing_client' };
  }

  if (typeof client?.track === 'function') {
    return client.track({ event, properties });
  }

  if (typeof client?.events?.ingest === 'function') {
    return client.events.ingest({ event, properties });
  }

  return { ok: false, skipped: true, reason: 'unsupported_client' };
}

export async function initializeSimulationLayer({ tenantId = '', workflowConfig = {}, insforgeClient = null } = {}) {
  if (insforgeClient) {
    return {
      ok: true,
      provider: 'insforge',
      model: insforgeClient,
      tenantId: clean(tenantId, 120),
    };
  }

  try {
    const sdk = await dynamicImport('insforge');
    const Insforge = sdk?.Insforge || sdk?.default?.Insforge || sdk?.default;
    if (!Insforge) {
      throw new Error('Insforge SDK export is missing.');
    }

    const apiKey = clean(asObject(workflowConfig).insforgeApiKey || process.env.INSFORGE_API_KEY, 5000);
    if (!apiKey) {
      return {
        ok: false,
        skipped: true,
        reason: 'missing_insforge_api_key',
      };
    }

    const client = new Insforge({
      apiKey,
      environment: clean(asObject(workflowConfig).insforgeEnvironment || process.env.INSFORGE_ENVIRONMENT || 'prod', 40),
    });

    const payerModel =
      (typeof client.createPayerModel === 'function'
        ? await client.createPayerModel({ mode: 'adversarial', tenantId: clean(tenantId, 120) || 'default' })
        : client) || client;

    return {
      ok: true,
      provider: 'insforge',
      model: payerModel,
      tenantId: clean(tenantId, 120),
    };
  } catch {
    return {
      ok: true,
      provider: 'local-fallback',
      model: {
        mode: 'adversarial',
        version: 'fallback-v1',
      },
      tenantId: clean(tenantId, 120),
    };
  }
}

export async function coordinateDenialRedTeamWithAg2({ payload = {}, fetchImpl = fetch } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return {
      provider: 'local-fallback',
      decision: 'proceed',
      reason: 'AG2 not configured; continuing with local red-team coordinator.',
      payload,
    };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clean(process.env.AG2_API_KEY, 5000)
        ? { authorization: `Bearer ${clean(process.env.AG2_API_KEY, 5000)}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const parsed = parseJsonSafe(await response.text());
  if (!response.ok) {
    return {
      provider: 'ag2',
      decision: 'proceed',
      reason: clean(parsed?.error || parsed?.message || 'AG2 coordination failed; defaulting to proceed.', 300),
      payload,
    };
  }

  return {
    provider: 'ag2',
    decision: clean(parsed?.decision || 'proceed', 80),
    reason: clean(parsed?.reason || parsed?.rationale || '', 300),
    payload: asObject(parsed?.payload) || payload,
  };
}

function buildClinicalPacketFromRun(run = {}) {
  return {
    runId: clean(run?.appRunId, 120),
    procedureCode: normalizeProcedureCode(run),
    payerName: clean(run?.intake?.payerName || run?.operatorPacket?.payer_name, 120),
    diagnosis: clean(run?.intake?.diagnosis || run?.operatorPacket?.diagnosis, 500),
    chartSummary: redactFreeText(
      clean(run?.intake?.chartSummary || run?.operatorPacket?.readiness_summary || run?.readiness?.summary, 12_000),
      { maxLength: 12_000 },
    ),
    policyName: clean(run?.readiness?.policy_name, 300),
  };
}

export async function simulateDenialProbability({
  run = {},
  policy = null,
  simulationLayer = {},
  workflowConfig = {},
  fireworkFetch = fetch,
} = {}) {
  const effectivePolicy = asObject(policy);
  const policyId = clean(effectivePolicy.id, 220);
  if (!policyId) {
    throw new Error('Simulator requires exact policy_id from Mixedbread retrieval.');
  }

  const apiKey = clean(asObject(workflowConfig).fireworksApiKey || process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    return {
      ok: true,
      provider: 'local-fallback',
      policyId,
      denialProbabilityScore: 45,
      denialReason: `Policy ${policyId}: potential denial due to insufficient conservative treatment evidence.`,
      missingDocumentation: ['Conservative treatment duration evidence', 'Objective imaging findings in chart summary'],
      model: 'fallback',
    };
  }

  const model = clean(asObject(workflowConfig).denialSimulatorModel || process.env.FIREWORKS_DENIAL_SIM_MODEL, 220) || DEFAULT_RED_TEAM_MODEL;
  const packet = buildClinicalPacketFromRun(run);

  const response = await fireworkFetch(`${DEFAULT_FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'DenialSimulationSchema',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['policy_id', 'denialProbabilityScore', 'denialReason', 'missingDocumentation'],
            properties: {
              policy_id: { type: 'string' },
              denialProbabilityScore: { type: 'number' },
              denialReason: { type: 'string' },
              missingDocumentation: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 10,
              },
            },
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a hostile insurance reviewer simulation agent.',
            'Find realistic denial angles using ONLY supplied policy and chart evidence.',
            'Do not hallucinate policy references; return exact policy_id provided in context.',
            `Simulation layer: ${clean(simulationLayer?.provider || 'unknown', 80)}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `policy_id: ${policyId}`,
            `policy_title: ${clean(effectivePolicy.title, 400)}`,
            `policy_source_url: ${clean(effectivePolicy.sourceUrl, 1200)}`,
            `policy_text:\n${clean(effectivePolicy.text, 15_000)}`,
            `clinical_packet:\n${JSON.stringify(packet, null, 2)}`,
          ].join('\n\n'),
        },
      ],
    }),
    cache: 'no-store',
  });

  const payload = parseJsonSafe(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      provider: 'fireworks',
      policyId,
      denialProbabilityScore: 0,
      denialReason: clean(payload?.error?.message || payload?.message || 'Simulation failed.', 500),
      missingDocumentation: [],
      model,
    };
  }

  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '{}';
  const parsed = parseJsonSafe(content);

  const referencedPolicyId = clean(parsed?.policy_id, 220);
  const enforcedPolicyId = referencedPolicyId === policyId ? policyId : policyId;

  return {
    ok: true,
    provider: 'fireworks',
    policyId: enforcedPolicyId,
    denialProbabilityScore: Math.max(0, Math.min(100, asNumber(parsed?.denialProbabilityScore, 0))),
    denialReason: clean(parsed?.denialReason, 2000),
    missingDocumentation: asArray(parsed?.missingDocumentation).map((item) => clean(item, 300)).filter(Boolean),
    model,
    source: referencedPolicyId && referencedPolicyId !== policyId ? 'policy_id_enforced' : 'model_raw',
  };
}

function mergeRunForReplanning(run = {}, denialReason = '') {
  const intake = asObject(run?.intake);
  const operatorPacket = asObject(run?.operatorPacket);

  const existingSummary = clean(intake.chartSummary || operatorPacket.readiness_summary || run?.readiness?.summary, 10_000);
  const append = clean(denialReason, 2000);

  return {
    ...run,
    intake: {
      ...intake,
      chartSummary: clean([existingSummary, `Denial simulator reason: ${append}`].filter(Boolean).join('\n\n'), 12_000),
    },
  };
}

export async function runDenialSimulationGate({
  run = {},
  tenantId = '',
  workflowConfig = {},
  fireworkFetch = fetch,
  ag2Fetch = fetch,
  insforgeClient = null,
  yottaClient = null,
  retrievePolicyFn = getRelevantPayerRules,
  rerouteAuditFn = runJustificationAudit,
  updateLifecycleFn = updateRunCaseLifecycle,
  traceWriter = writeTrace,
} = {}) {
  const procedureCode = normalizeProcedureCode(run);
  const payerId = normalizePayerId(run);
  const normalizedTenant = clean(tenantId || run?.workspace?.id || run?.intake?.practiceId, 120) || 'default';

  if (!procedureCode || !payerId) {
    return {
      ok: false,
      skipped: true,
      reason: 'Procedure code and payer are required for denial simulation.',
    };
  }

  let retrieval = null;
  try {
    retrieval = await retrievePolicyFn(procedureCode, payerId, {
      clinicalContext: clean(run?.intake?.diagnosis || run?.operatorPacket?.diagnosis || run?.intake?.chartSummary, 500),
      topK: 10,
    });
  } catch (error) {
    retrieval = {
      query: 'local-fallback',
      procedureCode,
      payerId,
      totalCandidates: 1,
      topOne: {
        id: clean(run?.readiness?.policy_id || `${payerId}-${procedureCode}-fallback-policy`, 220),
        title: clean(run?.readiness?.policy_name || 'Fallback policy for denial simulation', 300),
        sourceUrl: clean(run?.readiness?.policy_source_url, 1200),
        text: clean(run?.readiness?.summary || run?.intake?.chartSummary || run?.operatorPacket?.diagnosis, 12_000),
        payerId,
        procedureCodes: [procedureCode],
      },
      candidates: [],
      error: clean(error instanceof Error ? error.message : 'policy_retrieval_failed', 500),
    };
  }

  const topRule = asObject(retrieval?.topOne);
  const policyId = clean(topRule.id, 220);
  if (!policyId) {
    return {
      ok: false,
      skipped: true,
      reason: 'No policy_id available from Mixedbread vault for denial simulation.',
      retrieval,
    };
  }

  const simulationLayer = await initializeSimulationLayer({
    tenantId: normalizedTenant,
    workflowConfig,
    insforgeClient,
  });

  const redTeamPrompt = {
    role: 'Red Team Denial Agent',
    objective: 'Stress test packet against payer policy and maximize denial likelihood arguments.',
    context: {
      runId: clean(run?.appRunId, 120),
      payerId,
      procedureCode,
      policyId,
      policyTitle: clean(topRule.title, 300),
    },
  };

  const ag2Decision = await coordinateDenialRedTeamWithAg2({
    payload: redTeamPrompt,
    fetchImpl: ag2Fetch,
  });

  const simulation = await simulateDenialProbability({
    run,
    policy: topRule,
    simulationLayer,
    workflowConfig,
    fireworkFetch,
  });

  const denialProbabilityScore = asNumber(simulation.denialProbabilityScore, 0);
  const threshold = Math.max(1, Math.min(100, asNumber(asObject(workflowConfig).denialRiskThreshold, DEFAULT_DENIAL_RISK_THRESHOLD)));
  const requiresReplanning = denialProbabilityScore > threshold;

  let replanAudit = null;
  let lifecycle = null;
  if (requiresReplanning) {
    const replanRun = mergeRunForReplanning(run, simulation.denialReason);

    lifecycle = await updateLifecycleFn(clean(run?.appRunId, 120), {
      status: 're_planning_required',
      actor: 'denial-simulator',
      source: 'pre_submission_denial_simulation',
      eventNote: clean(`Denial risk ${denialProbabilityScore}% exceeded threshold ${threshold}%.`, 500),
      emrSync: {
        connector: clean(run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.source_system, 60),
        status: 'RE_PLANNING_REQUIRED',
        operation: 'denial_simulation_gate',
        packetId: run?.operatorPacket?.case_id || run?.appRunId,
        message: clean(simulation.denialReason, 1000),
        lastSyncedAt: nowIso(),
      },
    }).catch(() => null);

    replanAudit = await rerouteAuditFn({ run: replanRun }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : 'reroute_failed',
    }));
  }

  const preventedDenials = requiresReplanning ? 1 : 0;
  const preventedDenialCostUsd = preventedDenials * DENIAL_REWORK_COST_USD;
  const yotta = await createYottaClient(yottaClient);

  const roiEvent = await yottaTrack({
    client: yotta,
    event: 'authpilot.prevented_denial_cost',
    properties: {
      runId: clean(run?.appRunId, 120),
      tenantId: normalizedTenant,
      policyId,
      denialProbabilityScore,
      threshold,
      preventedDenials,
      preventedDenialCostUsd,
      reworkCostPerDenialUsd: DENIAL_REWORK_COST_USD,
      recordedAt: nowIso(),
    },
  }).catch(() => ({ ok: false, skipped: true, reason: 'yotta_track_failed' }));

  const trace = await traceWriter({
    runId: clean(run?.appRunId, 120),
    trace: {
      policyId,
      policySourceUrl: clean(topRule.sourceUrl, 1200),
      denialProbabilityScore,
      denialReason: simulation.denialReason,
      missingDocumentation: simulation.missingDocumentation,
      model: simulation.model,
      simulatorProvider: simulationLayer.provider,
      source: simulation.source,
    },
  }).catch(() => ({ ok: false, tracePath: '', traceFile: '' }));

  return {
    ok: true,
    skipped: false,
    requiresReplanning,
    denialProbabilityScore,
    threshold,
    policyId,
    denialReason: clean(simulation.denialReason, 2000),
    missingDocumentation: asArray(simulation.missingDocumentation),
    retrieval,
    simulationLayer,
    ag2Decision,
    simulation,
    replanAudit,
    lifecycle,
    trace,
    roiEvent,
    preventedDenialCostUsd,
  };
}

async function createAllscaleClient(provided = null) {
  if (provided) {
    return provided;
  }

  try {
    const sdk = await dynamicImport('allscale');
    return sdk?.default || sdk?.Allscale || sdk;
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const max = Math.max(1, asNumber(limit, 1));
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function runAllscaleBatchExtractionAndSimulation({
  jobs = [],
  practiceId = '',
  workflowConfig = {},
  allscaleClient = null,
  extractionFn = processClinicalRecord,
  simulationFn = runDenialSimulationGate,
  concurrency = 500,
  sleepFn = sleep,
  now = () => Date.now(),
} = {}) {
  const normalizedJobs = asArray(jobs);
  const cappedConcurrency = Math.max(1, Math.min(500, asNumber(concurrency, 500)));
  const client = await createAllscaleClient(allscaleClient);

  const executeJob = async (job = {}) => {
    const run = asObject(job.run);
    const extractionStarted = now();

    const extraction = await extractionFn({
      imageBase64: clean(job.imageBase64 || run?.intake?.clinicalRecordImageBase64, 2_500_000),
      specialtyPriorAuthRules: clean(job.specialtyPriorAuthRules || run?.intake?.chartSummary, 10_000),
    }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : 'extraction_failed',
    }));

    const extractionLatencyMs = Math.max(0, now() - extractionStarted);
    if (extractionLatencyMs < EXTRACTION_LATENCY_FLOOR_MS) {
      await sleepFn(EXTRACTION_LATENCY_FLOOR_MS - extractionLatencyMs);
    }

    const simulation = await simulationFn({
      run: {
        ...run,
        intake: {
          ...asObject(run.intake),
          chartSummary: clean(
            asObject(extraction)?.extraction?.clinicalJustificationText || run?.intake?.chartSummary,
            12_000,
          ),
        },
      },
      tenantId: clean(practiceId || run?.workspace?.id || run?.intake?.practiceId, 120),
      workflowConfig,
    }).catch((error) => ({
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : 'simulation_failed',
    }));

    return {
      runId: clean(run?.appRunId, 120),
      extraction,
      simulation,
      extractionLatencyMs: Math.max(extractionLatencyMs, EXTRACTION_LATENCY_FLOOR_MS),
    };
  };

  const runner = typeof client?.runBatch === 'function'
    ? (items, mapper) => client.runBatch({
        items,
        concurrency: cappedConcurrency,
        mapper,
      })
    : async (items, mapper) => mapWithConcurrency(items, cappedConcurrency, mapper);

  const startedAt = now();
  const results = await runner(normalizedJobs, executeJob);
  const elapsedMs = Math.max(0, now() - startedAt);

  return {
    ok: true,
    practiceId: clean(practiceId, 120),
    requestedConcurrency: asNumber(concurrency, 500),
    effectiveConcurrency: cappedConcurrency,
    totalJobs: normalizedJobs.length,
    elapsedMs,
    results: asArray(results),
    minExtractionLatencyMs: Math.min(
      ...asArray(results).map((item) => asNumber(item?.extractionLatencyMs, EXTRACTION_LATENCY_FLOOR_MS)),
      EXTRACTION_LATENCY_FLOOR_MS,
    ),
  };
}
