function safeValue(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function safeArray(items) {
  return Array.isArray(items) ? items : [];
}

export function buildCaseBundle({
  workspaceId = '',
  workspaceName = '',
  intake = null,
  config = null,
  suggestion = null,
  executionPlan = null,
} = {}) {
  return {
    schemaVersion: '2026-04-10.authpilot.case-bundle.v1',
    exportedAt: new Date().toISOString(),
    product: 'AuthPilot AI',
    workspace: {
      id: workspaceId || '',
      name: workspaceName || '',
    },
    intake: intake || {},
    config: config || {},
    intelligence: suggestion
      ? {
          summary: suggestion.suggestionSummary || '',
          confidence: suggestion.confidence || 'medium',
          suggestedPolicyUrl: suggestion.suggestedPolicyUrl || '',
          suggestedContactUrl: suggestion.suggestedContactUrl || '',
          suggestedPortalName: suggestion.suggestedPortalName || '',
          suggestedPortalUrl: suggestion.suggestedPortalUrl || '',
          routeTitle: suggestion.routeTitle || '',
          routeNote: suggestion.routeNote || '',
        }
      : null,
    executionPlan: executionPlan
      ? {
          authenticatedPortalTarget: executionPlan.authenticatedPortalTarget
            ? {
                key: executionPlan.authenticatedPortalTarget.key || '',
                portalName: executionPlan.authenticatedPortalTarget.portalName || '',
                portalUrl: executionPlan.authenticatedPortalTarget.portalUrl || '',
                likelySubmissionStepName: executionPlan.authenticatedPortalTarget.likelySubmissionStepName || '',
              }
            : null,
          vendorPortalTarget: executionPlan.vendorPortalTarget
            ? {
                key: executionPlan.vendorPortalTarget.key || '',
                vendorName: executionPlan.vendorPortalTarget.vendorName || '',
                portalUrl: executionPlan.vendorPortalTarget.portalUrl || '',
              }
            : null,
          downstreamTargets: safeArray(executionPlan.downstreamTargets).map((target) => ({
            key: target.key || '',
            systemName: target.systemName || '',
            likelyPayloadFormat: target.likelyPayloadFormat || '',
            importMethod: target.importMethod || '',
            url: target.url || '',
          })),
        }
      : null,
  };
}

export function parseCaseBundle(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The selected file is not a valid AuthPilot case bundle.');
  }

  const intake = parsed.intake;
  const config = parsed.config;

  if (!intake || typeof intake !== 'object' || !config || typeof config !== 'object') {
    throw new Error('The case bundle is missing intake or workflow configuration data.');
  }

  return {
    workspaceId: parsed.workspace?.id || '',
    workspaceName: parsed.workspace?.name || '',
    intake,
    config,
    intelligence: parsed.intelligence || null,
    executionPlan: parsed.executionPlan || null,
  };
}

export function buildOperatorPacketCsv(packet) {
  const rows = [
    ['section', 'field', 'value'],
    ['case', 'case_id', packet?.case_id || ''],
    ['case', 'payer_name', packet?.payer_name || ''],
    ['case', 'line_of_business', packet?.line_of_business || ''],
    ['case', 'member_state', packet?.member_state || ''],
    ['case', 'specialty', packet?.specialty || ''],
    ['case', 'diagnosis', packet?.diagnosis || ''],
    ['case', 'procedure', packet?.procedure || ''],
    ['verdict', 'submission_ready', packet?.submission_ready ? 'Yes' : 'No'],
    ['verdict', 'recommended_action', packet?.recommended_action || ''],
    ['routing', 'policy_name', packet?.policy_name || ''],
    ['routing', 'provider_precert_phone', packet?.provider_precert_phone || ''],
    ['routing', 'provider_precert_notes', packet?.provider_precert_notes || ''],
    ['routing', 'policy_url', packet?.policy_url || ''],
    ['routing', 'contact_url', packet?.contact_url || ''],
    ['portal_handoff', 'next_step_title', packet?.portal_handoff?.next_step_title || ''],
    ['portal_handoff', 'preferred_channel', packet?.portal_handoff?.preferred_channel || ''],
    ['portal_handoff', 'portal_entry_url', packet?.portal_handoff?.portal_entry_url || ''],
    ['portal_handoff', 'phone_fallback', packet?.portal_handoff?.phone_fallback || ''],
    ['portal_handoff', 'delegated_vendor_hint', packet?.portal_handoff?.delegated_vendor_hint || ''],
    ['portal_handoff', 'route_rationale', packet?.portal_handoff?.route_rationale || ''],
    ['authenticated_portal_target', 'portal_name', packet?.authenticated_portal_target?.portalName || ''],
    ['authenticated_portal_target', 'portal_url', packet?.authenticated_portal_target?.portalUrl || ''],
    ['authenticated_portal_target', 'submission_step', packet?.authenticated_portal_target?.likelySubmissionStepName || ''],
    ['authenticated_portal_target', 'credentials_needed', packet?.authenticated_portal_target?.credentialsNeeded || ''],
    ['vendor_portal_target', 'vendor_name', packet?.vendor_portal_target?.vendorName || ''],
    ['vendor_portal_target', 'portal_url', packet?.vendor_portal_target?.portalUrl || ''],
    ['vendor_portal_target', 'upload_step_present', packet?.vendor_portal_target?.uploadStepPresent ? 'Yes' : 'No'],
    ['submission_prep', 'status', packet?.submission_prep?.status || ''],
    ['submission_prep', 'readiness_gate', packet?.submission_prep?.readiness_gate || ''],
    ['submission_prep', 'owner', packet?.submission_prep?.owner || ''],
    ['submission_prep', 'route_review_required', packet?.submission_prep?.route_review_required ? 'Yes' : 'No'],
    ['submission_prep', 'next_review_trigger', packet?.submission_prep?.review_summary?.next_review_trigger || ''],
  ];

  safeArray(packet?.supporting_evidence).forEach((item, index) => {
    rows.push(['supporting_evidence', `${index + 1}`, item]);
  });
  safeArray(packet?.missing_evidence).forEach((item, index) => {
    rows.push(['missing_evidence', `${index + 1}`, item]);
  });
  safeArray(packet?.submission_checklist).forEach((item, index) => {
    rows.push(['submission_checklist', `${index + 1}`, item]);
  });
  safeArray(packet?.available_evidence_files).forEach((item, index) => {
    rows.push(['available_evidence_files', `${index + 1}`, item]);
  });
  safeArray(packet?.submission_prep?.blockers).forEach((item, index) => {
    rows.push(['blockers', `${index + 1}.title`, item?.title || '']);
    rows.push(['blockers', `${index + 1}.severity`, item?.severity || '']);
    rows.push(['blockers', `${index + 1}.detail`, item?.detail || '']);
    rows.push(['blockers', `${index + 1}.resolution`, item?.resolution || '']);
  });

  Object.entries(packet?.submission_prep?.tasks || {}).forEach(([group, items]) => {
    safeArray(items).forEach((item, index) => {
      rows.push([`submission_tasks.${group}`, `${index + 1}`, item]);
    });
  });

  safeArray(packet?.downstream_targets).forEach((target, index) => {
    rows.push(['downstream_targets', `${index + 1}.system_name`, target?.systemName || '']);
    rows.push(['downstream_targets', `${index + 1}.payload_format`, target?.likelyPayloadFormat || '']);
    rows.push(['downstream_targets', `${index + 1}.import_method`, target?.importMethod || '']);
    rows.push(['downstream_targets', `${index + 1}.url`, target?.url || '']);
  });

  safeArray(packet?.phi_safe_defaults).forEach((item, index) => {
    rows.push(['phi_safe_defaults', `${index + 1}.topic`, item?.topic || '']);
    rows.push(['phi_safe_defaults', `${index + 1}.recommended_default`, item?.recommendedDefault || '']);
    rows.push(['phi_safe_defaults', `${index + 1}.implementation_implication`, item?.implementationImplication || '']);
  });

  return rows
    .map((row) =>
      row
        .map((value) => `"${safeValue(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    .join('\n');
}
