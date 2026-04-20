import { getRelevantPayerRules } from '../ai/mixedbread-client.js';
import { createPhotonClient, runPhotonExecutiveAdjudication } from '../ai/photon-client.js';
import { redactFreeText } from '../privacy.js';

function clean(value, max = 8000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(raw = '') {
  const text = clean(raw, 500_000);
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

function procedureCode(run = {}) {
  return clean(run?.intake?.procedureCode || run?.operatorPacket?.procedure_code, 40).toUpperCase();
}

function payerId(run = {}) {
  return clean(run?.intake?.payerName || run?.operatorPacket?.payer_name, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function runGiskardAudit({ run = {}, policy = {}, justificationPacket = {}, giskardClient = null } = {}) {
  const packetText = clean(justificationPacket?.text || run?.intake?.chartSummary || run?.readiness?.summary, 20_000);

  if (giskardClient && typeof giskardClient.scan === 'function') {
    const scanned = await giskardClient.scan({
      input: {
        packetText,
        policyText: clean(policy?.text, 20_000),
      },
      tests: ['hallucination', 'bias', 'contradiction'],
    });

    const findings = asArray(scanned?.findings);
    return {
      ok: true,
      provider: 'giskard-sdk',
      hallucinationDetected: findings.some((item) => /halluc/i.test(clean(item?.type, 80))),
      biasDetected: findings.some((item) => /bias/i.test(clean(item?.type, 80))),
      contradictionDetected: findings.some((item) => /contradiction/i.test(clean(item?.type, 80))),
      findings,
    };
  }

  const normalized = packetText.toLowerCase();
  const contradictionDetected = /no pain/.test(normalized) && /severe pain/.test(normalized);
  const hallucinationDetected = /(as proven|always approved|guaranteed)/i.test(packetText);
  const biasDetected = /(non[- ]compliant patient|difficult patient)/i.test(packetText);

  return {
    ok: true,
    provider: 'local-fallback',
    hallucinationDetected,
    biasDetected,
    contradictionDetected,
    findings: [
      { type: 'hallucination', detected: hallucinationDetected },
      { type: 'bias', detected: biasDetected },
      { type: 'contradiction', detected: contradictionDetected },
    ],
  };
}

export async function coordinateExecutiveAdjudicatorWithAg2({ payload = {}, fetchImpl = fetch } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return {
      provider: 'local-fallback',
      decision: 'proceed',
      reason: 'AG2 not configured; proceeding with local executive adjudicator workflow.',
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

  const parsed = parseJson(await response.text());
  if (!response.ok) {
    return {
      provider: 'ag2',
      decision: 'proceed',
      reason: clean(parsed?.error || parsed?.message || 'AG2 adjudicator routing failed; proceeding.', 300),
      payload,
    };
  }

  return {
    provider: 'ag2',
    decision: clean(parsed?.decision || 'proceed', 80),
    reason: clean(parsed?.reason || parsed?.rationale, 300),
    payload: asObject(parsed?.payload) || payload,
  };
}

function strictCitationFail(result = {}) {
  const claims = asArray(result?.claims);
  if (!claims.length) {
    return true;
  }
  return claims.some((claim) => !clean(claim?.note_timestamp, 80) || !clean(claim?.page_number, 40));
}

function redactReasoningPath(reasoningPath = {}) {
  return parseJson(
    redactFreeText(clean(JSON.stringify(asObject(reasoningPath)), 60_000), {
      maxLength: 60_000,
    }),
  );
}

function buildAdjudicationPrompt({ run = {}, policy = {}, justificationPacket = {}, giskard = {} } = {}) {
  return {
    messages: [
      {
        role: 'system',
        content: [
          'You are the Executive Adjudicator agent for medical-necessity integrity validation.',
          'Verify only evidence that exists in source notes and payer policy.',
          'Use strict citations for each claim with note_timestamp and page_number.',
          'If any claim cannot be cited, set integrityScore to 0 and include failure reason.',
          'Return strict JSON only.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `run_id: ${clean(run?.appRunId, 120)}`,
          `procedure_code: ${procedureCode(run)}`,
          `policy_id: ${clean(policy?.id, 220)}`,
          `policy_text:\n${clean(policy?.text, 20_000)}`,
          `clinical_notes:\n${clean(run?.intake?.chartSummary || '', 20_000)}`,
          `justification_packet:\n${clean(justificationPacket?.text || '', 20_000)}`,
          `giskard_findings:\n${JSON.stringify(asObject(giskard), null, 2)}`,
        ].join('\n\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ExecutiveAdjudicationSchema',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['integrityScore', 'decision', 'claims', 'reasoningPath'],
          properties: {
            integrityScore: { type: 'number' },
            decision: { type: 'string' },
            rationale: { type: 'string' },
            claims: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['claim', 'note_timestamp', 'page_number', 'policy_id'],
                properties: {
                  claim: { type: 'string' },
                  note_timestamp: { type: 'string' },
                  page_number: { type: 'string' },
                  policy_id: { type: 'string' },
                },
              },
            },
            reasoningPath: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
    },
  };
}

export async function runBlockingReasoningAdjudication({
  run = {},
  policy = null,
  justificationPacket = {},
  integrityThreshold = 0.95,
  photonClient = null,
  photonFetch = fetch,
  giskardClient = null,
  ag2Fetch = fetch,
  retrievePolicyFn = getRelevantPayerRules,
} = {}) {
  const cpt = procedureCode(run);
  const payer = payerId(run);
  if (!cpt || !payer) {
    return {
      ok: false,
      blocked: true,
      integrityScore: 0,
      reason: 'Missing procedure or payer context for adjudication.',
      reasoningPath: { stage: 'input_validation' },
    };
  }

  const retrieval = policy
    ? { topOne: asObject(policy), totalCandidates: 1 }
    : await retrievePolicyFn(cpt, payer, {
        clinicalContext: clean(run?.intake?.diagnosis || run?.operatorPacket?.diagnosis, 500),
        topK: 8,
      });

  const topPolicy = asObject(retrieval?.topOne);
  if (!clean(topPolicy?.id, 220)) {
    return {
      ok: false,
      blocked: true,
      integrityScore: 0,
      reason: 'No policy_id available from Mixedbread retrieval.',
      reasoningPath: { stage: 'policy_retrieval' },
    };
  }

  const giskard = await runGiskardAudit({
    run,
    policy: topPolicy,
    justificationPacket,
    giskardClient,
  });

  const ag2 = await coordinateExecutiveAdjudicatorWithAg2({
    payload: {
      role: 'Executive Adjudicator',
      objective: 'Validate evidence-policy alignment before sovereign intent signing.',
      context: {
        runId: clean(run?.appRunId, 120),
        policyId: clean(topPolicy?.id, 220),
      },
    },
    fetchImpl: ag2Fetch,
  });

  const prompt = buildAdjudicationPrompt({
    run,
    policy: topPolicy,
    justificationPacket,
    giskard,
  });

  const photon = await createPhotonClient({ providedClient: photonClient });
  const response = await runPhotonExecutiveAdjudication({
    prompt,
    client: photon?.client,
    fetchImpl: photonFetch,
  });

  if (!response.ok) {
    return {
      ok: false,
      blocked: true,
      integrityScore: 0,
      reason: clean(response.reason || 'Executive adjudication failed.', 500),
      retrieval,
      giskard,
      ag2,
      reasoningPath: { stage: 'photon_execution_failed' },
    };
  }

  const content =
    response?.payload?.choices?.[0]?.message?.content ||
    response?.payload?.choices?.[0]?.text ||
    '{}';
  const parsed = parseJson(content);

  let integrityScore = Math.max(0, Math.min(1, Number(parsed?.integrityScore) || 0));
  const claims = asArray(parsed?.claims);
  const citationFailure = strictCitationFail({ claims });

  if (citationFailure) {
    integrityScore = 0;
  }

  if (giskard.hallucinationDetected || giskard.biasDetected || giskard.contradictionDetected) {
    integrityScore = Math.min(integrityScore, 0.8);
  }

  const blocked = integrityScore < Number(integrityThreshold);

  return {
    ok: true,
    blocked,
    integrityScore,
    threshold: Number(integrityThreshold),
    reason: blocked
      ? clean(parsed?.rationale || 'Integrity score below required threshold.', 800)
      : clean(parsed?.rationale || 'Integrity threshold satisfied.', 800),
    policy: {
      id: clean(topPolicy?.id, 220),
      title: clean(topPolicy?.title, 300),
      sourceUrl: clean(topPolicy?.sourceUrl, 1200),
    },
    claims: claims.map((item) => ({
      claim: clean(item?.claim, 1000),
      note_timestamp: clean(item?.note_timestamp, 80),
      page_number: clean(item?.page_number, 40),
      policy_id: clean(item?.policy_id, 220) || clean(topPolicy?.id, 220),
    })),
    decision: clean(parsed?.decision, 120),
    giskard,
    ag2,
    photon: {
      provider: clean(response.provider, 80),
      model: clean(response.model, 160),
    },
    retrieval,
    reasoningPath: redactReasoningPath(asObject(parsed?.reasoningPath)),
  };
}
