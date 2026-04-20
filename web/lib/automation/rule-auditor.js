import { getRelevantPayerRules } from '../ai/mixedbread-client.js';
import { redactFreeText } from '../privacy.js';
import { closeLoopEmrTask } from './emr-close-loop.js';
import { updateRunCaseLifecycle } from '../run-store.js';

const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const DEFAULT_AUDIT_MODEL = 'accounts/fireworks/models/qwen2p5-vl-72b-instruct';

const JUSTIFICATION_AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hasGap', 'missingDataPoints', 'summary'],
  properties: {
    hasGap: { type: 'boolean' },
    missingDataPoints: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    },
    summary: { type: 'string' },
    confidence: { type: 'number' },
  },
};

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

export function buildRuleAuditorPrompt({ run = {}, topRule = null } = {}) {
  const payerId = clean(run?.intake?.payerName || run?.operatorPacket?.payer_name || '', 120).toLowerCase();
  const procedureCode = clean(run?.intake?.procedureCode || run?.operatorPacket?.procedure_code || '', 40).toUpperCase();

  return {
    role: 'Rule Auditor Agent',
    objective:
      'Validate that the clinical justification meets payer medical necessity criteria before portal submission and request remediation when gaps exist.',
    context: {
      runId: clean(run?.appRunId, 120),
      payerId,
      procedureCode,
      policyTitle: clean(topRule?.title, 300),
      policyUrl: clean(topRule?.sourceUrl, 1000),
    },
    outputContract: {
      statusWhenGap: 'PORTAL_ACTION_REQUIRED',
      requiredFields: ['hasGap', 'missingDataPoints', 'summary'],
    },
  };
}

export async function coordinateRuleAuditorWithAg2({ payload = {} } = {}) {
  const endpoint = clean(process.env.AG2_COORDINATOR_URL, 1200);
  if (!endpoint) {
    return {
      provider: 'local-fallback',
      decision: 'proceed',
      reason: 'AG2 not configured; proceeding with local auditor.',
      payload,
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(clean(process.env.AG2_API_KEY, 5000)
        ? { authorization: `Bearer ${clean(process.env.AG2_API_KEY, 5000)}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  const parsed = parseJson(raw);

  if (!response.ok) {
    return {
      provider: 'ag2',
      decision: 'proceed',
      reason: clean(parsed?.message || parsed?.error || 'AG2 coordination failed; defaulting to proceed.', 300),
      payload,
    };
  }

  return {
    provider: 'ag2',
    decision: clean(parsed.decision || 'proceed', 80),
    reason: clean(parsed.reason || parsed.rationale, 300),
    payload: asObject(parsed.payload) || payload,
  };
}

export async function auditClinicalJustificationAgainstRules({
  run = {},
  topRule = null,
} = {}) {
  const apiKey = clean(process.env.FIREWORKS_API_KEY, 5000);
  if (!apiKey) {
    throw new Error('FIREWORKS_API_KEY is required for justification audit.');
  }

  const clinicalNotes = redactFreeText(
    clean(
      run?.intake?.chartSummary ||
        run?.operatorPacket?.readiness_summary ||
        run?.readiness?.summary ||
        '',
      12_000,
    ),
    { maxLength: 12_000 },
  );

  const payerRuleText = clean(topRule?.text, 12_000);

  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: clean(process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL || DEFAULT_AUDIT_MODEL, 200),
      temperature: 0,
      max_tokens: 800,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'JustificationAuditSchema',
          strict: true,
          schema: JUSTIFICATION_AUDIT_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a prior authorization medical necessity auditor.',
            'Compare clinical notes to payer policy criteria and identify missing required data points.',
            'Return structured JSON only.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Payer policy title: ${clean(topRule?.title, 300) || 'Unknown policy'}`,
            `Payer policy URL: ${clean(topRule?.sourceUrl, 1000) || 'N/A'}`,
            `Policy criteria text:\n${payerRuleText || 'N/A'}`,
            `Clinical notes:\n${clinicalNotes || 'N/A'}`,
          ].join('\n\n'),
        },
      ],
    }),
  });

  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    throw new Error(clean(payload?.error?.message || payload?.message || 'Justification audit failed.', 500));
  }

  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    '{}';
  const parsed = parseJson(content);

  return {
    hasGap: Boolean(parsed.hasGap),
    missingDataPoints: asArray(parsed.missingDataPoints).map((item) => clean(item, 400)).filter(Boolean),
    summary: clean(parsed.summary, 2000),
    confidence: Number(parsed.confidence) || 0,
    modelUsed: clean(process.env.FIREWORKS_JUSTIFICATION_AUDIT_MODEL || DEFAULT_AUDIT_MODEL, 200),
  };
}

function normalizePayerId(run = {}) {
  const payer = clean(run?.intake?.payerName || run?.operatorPacket?.payer_name, 120).toLowerCase();
  return payer
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveProcedureCode(run = {}) {
  return clean(run?.intake?.procedureCode || run?.operatorPacket?.procedure_code, 40).toUpperCase();
}

export async function runJustificationAudit({ run = {} } = {}) {
  const procedureCode = resolveProcedureCode(run);
  const payerId = normalizePayerId(run);

  if (!procedureCode || !payerId) {
    throw new Error('Run must contain procedureCode and payer identifier for rule auditing.');
  }

  const retrieval = await getRelevantPayerRules(procedureCode, payerId, {
    clinicalContext: clean(run?.intake?.diagnosis || run?.operatorPacket?.diagnosis, 500),
    topK: 12,
  });

  const topRule = retrieval.topOne;
  if (!topRule) {
    throw new Error(`No payer policy rule found for ${payerId} ${procedureCode}.`);
  }

  const ag2Prompt = buildRuleAuditorPrompt({ run, topRule });
  const ag2Decision = await coordinateRuleAuditorWithAg2({ payload: ag2Prompt });
  if (clean(ag2Decision.decision, 40).toLowerCase() === 'skip') {
    return {
      skipped: true,
      reason: clean(ag2Decision.reason, 300),
      retrieval,
      decision: ag2Decision,
    };
  }

  const audit = await auditClinicalJustificationAgainstRules({ run, topRule });

  if (audit.hasGap) {
    const redactedSummary = redactFreeText(clean(audit.summary, 2000), { maxLength: 2000 });
    const redactedMissingDataPoints = asArray(audit.missingDataPoints)
      .map((item) => redactFreeText(clean(item, 300), { maxLength: 300 }))
      .filter(Boolean);

    const connectorHint = clean(
      run?.operatorPacket?.emr_sync?.connector || run?.operatorPacket?.emr_connector_hint || run?.emrSync?.connector || 'athena',
      40,
    ).toLowerCase();

    const emrPatch = await closeLoopEmrTask({
      connector: connectorHint,
      run,
      emrStatus: 'PORTAL_ACTION_REQUIRED',
      note: clean(
        [
          redactedSummary || 'Missing required medical necessity data points detected.',
          redactedMissingDataPoints.length
            ? `Missing evidence: ${redactedMissingDataPoints.join('; ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' | '),
        1000,
      ),
      proof: {
        capturedAt: new Date().toISOString(),
        screenshotPath: '',
      },
    });

    const lifecycle = await updateRunCaseLifecycle(run?.appRunId, {
      status: 'collecting_evidence',
      actor: 'rule-auditor',
      source: 'justification_preflight',
      eventNote: `Medical necessity gap found: ${clean(redactedSummary, 300)}`,
      emrSync: {
        connector: connectorHint,
        status: 'PORTAL_ACTION_REQUIRED',
        operation: 'justification_preflight_audit',
        message: clean(
          [
            redactedSummary,
            redactedMissingDataPoints.length
              ? `Missing evidence: ${redactedMissingDataPoints.join('; ')}`
              : '',
          ]
            .filter(Boolean)
            .join(' | '),
          1000,
        ),
        packetId: run?.operatorPacket?.case_id || run?.appRunId,
        lastSyncedAt: new Date().toISOString(),
      },
    });

    return {
      skipped: false,
      retrieval,
      topRule,
      audit,
      emrPatch,
      run: lifecycle.run,
    };
  }

  return {
    skipped: false,
    retrieval,
    topRule,
    audit,
    emrPatch: null,
    run,
  };
}
