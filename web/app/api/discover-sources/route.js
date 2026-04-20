import { NextResponse } from 'next/server';

import { enforceRateLimit, safeTrimToMax } from '@/lib/api-guards';
import { emitAuditEvent } from '@/lib/audit-log';
import { getRequestId, jsonError, jsonSuccess, parseJsonBody } from '@/lib/api-response';
import { validateDiscoverSourcesPayload } from '@/lib/api-schemas';
import { getPayerProcedureSuggestion } from '@/lib/payer-intelligence';
import { runTinyFishDiscovery } from '@/lib/tinyfish-discovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clean(value) {
  return safeTrimToMax(value, 3000);
}

function buildContextText({ lineOfBusiness, memberState }) {
  const parts = [clean(memberState).toUpperCase(), clean(lineOfBusiness)].filter(Boolean);
  return parts.length ? ` for ${parts.join(' ')}` : '';
}

function buildPolicyDiscoveryGoal({ payerName, specialty, procedureLabel, lineOfBusiness, memberState }) {
  const contextText = buildContextText({ lineOfBusiness, memberState });
  return (
    `You are helping a clinic prepare prior authorization for ${procedureLabel || 'the requested procedure'} ` +
    `in ${specialty || 'specialty care'}${contextText} for ${payerName || 'the payer'}. ` +
    'Starting from this provider-facing payer page, find the best public policy page or policy library page most relevant to this procedure. ' +
    'Return compact JSON with keys: policy_page_url, policy_page_title, route_reason, source_page_url.'
  );
}

function buildContactDiscoveryGoal({ payerName, specialty, procedureLabel, lineOfBusiness, memberState }, suggestion) {
  const contextText = buildContextText({ lineOfBusiness, memberState });
  const routingHint = suggestion?.routingStrategy;
  const routingText =
    routingHint?.vendorName && routingHint?.note
      ? ` This procedure may route through ${routingHint.vendorName}. ${routingHint.note}`
      : routingHint?.note
        ? ` ${routingHint.note}`
        : '';

  return (
    `You are helping a clinic prepare prior authorization for ${procedureLabel || 'the requested procedure'} ` +
    `in ${specialty || 'specialty care'}${contextText} for ${payerName || 'the payer'}. ` +
    'Starting from this provider-facing payer page, find the best public prior authorization route page, provider contact page, or portal entry page. ' +
    routingText +
    'Return compact JSON with keys: contact_page_url, contact_page_title, provider_route_notes, source_page_url.'
  );
}

function buildStarterResponse(suggestion, mode = 'starter', warning = '') {
  const routingHint = suggestion?.routingStrategy;
  return {
    mode,
    warning,
    suggestion,
    discovery: {
      mode,
      usedTinyFish: false,
      summary: suggestion
        ? routingHint?.vendorName
          ? `Official starter URLs returned from the built-in payer intelligence layer with a ${routingHint.vendorName} routing hint.`
          : 'Official starter URLs returned from the built-in payer intelligence layer.'
        : 'No payer starter suggestion is available yet for this payer.',
      policy: {
        url: suggestion?.suggestedPolicyUrl || '',
        title: suggestion?.payer?.displayName ? `${suggestion.payer.displayName} policy entry point` : '',
        sourceUrl: suggestion?.suggestedPolicyUrl || '',
        notes: suggestion?.sourceNote || '',
        runId: '',
        streamUrl: '',
        discovered: false,
      },
      contact: {
        url: suggestion?.suggestedContactUrl || '',
        title: suggestion?.payer?.displayName ? `${suggestion.payer.displayName} prior auth route entry point` : '',
        sourceUrl: suggestion?.suggestedContactUrl || '',
        notes: suggestion?.routeNote || '',
        runId: '',
        streamUrl: '',
        discovered: false,
      },
      effectivePolicyUrl: suggestion?.suggestedPolicyUrl || '',
      effectiveContactUrl: suggestion?.suggestedContactUrl || '',
    },
  };
}

export async function POST(request) {
  const requestId = getRequestId(request);
  const rateLimited = enforceRateLimit(request, { key: 'discover-sources', limit: 20, windowMs: 60_000 });
  if (rateLimited) {
    rateLimited.headers.set('x-request-id', requestId);
    return rateLimited;
  }

  try {
    const body = await parseJsonBody(request, requestId);
    const validation = validateDiscoverSourcesPayload(body);
    if (!validation.ok) {
      return jsonError({
        message: validation.message,
        requestId,
        status: 400,
        code: 'invalid_discovery_payload',
      });
    }

    const input = {
      payerName: validation.data.payerName,
      lineOfBusiness: validation.data.lineOfBusiness,
      memberState: validation.data.memberState,
      specialty: validation.data.specialty,
      procedureLabel: validation.data.procedureLabel,
    };

    const suggestion = getPayerProcedureSuggestion(input);
    if (!suggestion) {
      await emitAuditEvent({
        requestId,
        action: 'discover-sources.post',
        outcome: 'unavailable',
        route: '/api/discover-sources',
        actor: 'staff',
        source: 'ui',
        details: {
          payerName: input.payerName,
          procedureLabel: input.procedureLabel,
        },
      });
      return jsonSuccess(
        {
          mode: 'unavailable',
          error: 'No curated payer intelligence is available yet for this payer. Add a manual policy/contact URL or expand the payer directory.',
          discovery: {
            mode: 'unavailable',
            usedTinyFish: false,
            summary:
              'No curated payer directory entry exists for this payer yet, so live discovery needs a researched starter domain or manual source URL.',
            policy: {
              url: '',
              title: '',
              sourceUrl: '',
              notes: '',
              runId: '',
              streamUrl: '',
              discovered: false,
            },
            contact: {
              url: '',
              title: '',
              sourceUrl: '',
              notes: '',
              runId: '',
              streamUrl: '',
              discovered: false,
            },
            effectivePolicyUrl: '',
            effectiveContactUrl: '',
          },
        },
        requestId,
      );
    }

    const preferLive = validation.data.preferLive;
    const apiKey = clean(process.env.TINYFISH_API_KEY);
    const baseUrl = clean(process.env.TINYFISH_API_BASE_URL) || 'https://agent.tinyfish.ai';

    if (!preferLive || !apiKey) {
      await emitAuditEvent({
        requestId,
        action: 'discover-sources.post',
        outcome: 'starter',
        route: '/api/discover-sources',
        actor: 'staff',
        source: 'ui',
        details: {
          payerName: input.payerName,
          procedureLabel: input.procedureLabel,
          mode: 'starter',
        },
      });
      return jsonSuccess(buildStarterResponse(suggestion), requestId);
    }

    const policySeedUrl =
      clean(validation.data.starterPolicyUrl) || suggestion.bestSeedUrl || suggestion.suggestedPolicyUrl;
    const contactSeedUrl =
      clean(validation.data.starterContactUrl) ||
      suggestion.routingStrategy?.bestSeedUrl ||
      suggestion.suggestedContactUrl ||
      suggestion.bestSeedUrl ||
      policySeedUrl;

    try {
      const [policyDiscovery, contactDiscovery] = await Promise.all([
        runTinyFishDiscovery({
          seedUrl: policySeedUrl,
          goal: buildPolicyDiscoveryGoal(input),
          apiKey,
          baseUrl,
        }),
        runTinyFishDiscovery({
          seedUrl: contactSeedUrl,
          goal: buildContactDiscoveryGoal(input, suggestion),
          apiKey,
          baseUrl,
        }),
      ]);

      const policyResult = policyDiscovery.result || {};
      const contactResult = contactDiscovery.result || {};

      const effectivePolicyUrl =
        clean(policyResult.policy_page_url) || suggestion.suggestedPolicyUrl || policySeedUrl;
      const effectiveContactUrl =
        clean(contactResult.contact_page_url) || suggestion.suggestedContactUrl || contactSeedUrl;

      await emitAuditEvent({
        requestId,
        action: 'discover-sources.post',
        outcome: 'success',
        route: '/api/discover-sources',
        actor: 'staff',
        source: 'ui',
        details: {
          payerName: input.payerName,
          procedureLabel: input.procedureLabel,
          mode: 'live',
        },
      });

      return jsonSuccess(
        {
          mode: 'live',
          suggestion,
          discovery: {
            mode: 'live',
            usedTinyFish: true,
            summary: 'TinyFish explored payer-facing pages and refined the best policy and provider routing entry points.',
            policy: {
              url: effectivePolicyUrl,
              title: clean(policyResult.policy_page_title),
              sourceUrl: clean(policyResult.source_page_url) || policySeedUrl,
              notes: clean(policyResult.route_reason) || suggestion.sourceNote || '',
              runId: policyDiscovery.runId || '',
              streamUrl: policyDiscovery.streamUrl || '',
              discovered: Boolean(clean(policyResult.policy_page_url)),
            },
            contact: {
              url: effectiveContactUrl,
              title: clean(contactResult.contact_page_title),
              sourceUrl: clean(contactResult.source_page_url) || contactSeedUrl,
              notes: clean(contactResult.provider_route_notes) || suggestion.routeNote || '',
              runId: contactDiscovery.runId || '',
              streamUrl: contactDiscovery.streamUrl || '',
              discovered: Boolean(clean(contactResult.contact_page_url)),
            },
            effectivePolicyUrl,
            effectiveContactUrl,
          },
        },
        requestId,
      );
    } catch (error) {
      await emitAuditEvent({
        requestId,
        action: 'discover-sources.post',
        outcome: 'starter_fallback',
        route: '/api/discover-sources',
        actor: 'staff',
        source: 'ui',
        details: {
          payerName: input.payerName,
          procedureLabel: input.procedureLabel,
          errorMessage: error instanceof Error ? error.message : 'TinyFish discovery failure',
        },
      });
      const fallback = buildStarterResponse(
        suggestion,
        'starter_fallback',
        error instanceof Error ? error.message : 'TinyFish discovery failed, so starter URLs were returned instead.',
      );
      return jsonSuccess(fallback, requestId);
    }
  } catch (error) {
    if (error?.code === 'invalid_json') {
      return jsonError({
        message: error.message,
        requestId,
        status: 400,
        code: error.code,
      });
    }

    return jsonError({
      message: error instanceof Error ? error.message : 'Unable to discover payer sources.',
      requestId,
      status: 500,
      code: 'discovery_failed',
    });
  }
}
