function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function includesAny(normalizedValue, patterns = []) {
  return patterns.some((pattern) => normalizedValue.includes(normalize(pattern)));
}

const AUTHENTICATED_PORTAL_TARGETS = [
  {
    key: 'aetna-availity',
    payerMatchers: ['aetna'],
    portalName: 'Availity Essentials',
    portalUrl: 'https://essentials.availity.com/',
    lineOfBusiness: ['Commercial', 'Medicare', 'Medicaid'],
    memberScope: ['National', 'WV', 'IL', 'FL', 'GA'],
    likelySubmissionStepName: 'Authorization Add - Step 4: Submit current clinicals',
    docsDescribeFlow: true,
    credentialsNeeded: 'Availity User ID/Password, Type 1 NPI, and individual Aetna PIN',
    attachmentsSupported: true,
    targetAssessment:
      'Excellent first target because the IAR check can short-circuit the flow before full submission and clinical questionnaires can trigger fast approvals.',
    sources: ['https://essentials.availity.com/'],
  },
  {
    key: 'uhc-paan',
    payerMatchers: ['unitedhealthcare', 'uhc', 'community plan', 'oxford', 'surest'],
    portalName: 'UnitedHealthcare Provider Portal (PAAN)',
    portalUrl: 'https://www.uhcprovider.com/',
    lineOfBusiness: ['Commercial', 'Medicare Advantage', 'Community Plan'],
    memberScope: ['National', 'TX', 'GA', 'NY'],
    likelySubmissionStepName: 'Create New Submissions',
    docsDescribeFlow: true,
    credentialsNeeded: 'One Healthcare ID and Password',
    attachmentsSupported: true,
    targetAssessment:
      'Good first target due to standardized national tooling and TrackIt monitoring after submission.',
    sources: ['https://www.uhcprovider.com/'],
  },
  {
    key: 'anthem-icr',
    payerMatchers: ['anthem', 'elevance', 'florida blue', 'anthem blue cross'],
    portalName: 'Interactive Care Reviewer via Availity',
    portalUrl: 'https://www.availity.com',
    lineOfBusiness: ['Commercial', 'Medicaid', 'Medicare'],
    memberScope: ['NY', 'IN', 'NV', 'WI', 'KY'],
    likelySubmissionStepName: 'Submit on Case Overview page',
    docsDescribeFlow: true,
    credentialsNeeded: 'Availity User ID/Password with Authorization and Referral Request role',
    attachmentsSupported: true,
    targetAssessment:
      'Strong target because it can pick up workflows that originated offline and supports attachment uploads inside the clinical details step.',
    sources: ['https://www.availity.com'],
  },
  {
    key: 'cigna-for-hcp',
    payerMatchers: ['cigna', 'cigna healthcare', 'cignaforhcp'],
    portalName: 'Cigna for Health Care Professionals',
    portalUrl: 'https://cignaforhcp.cigna.com/',
    lineOfBusiness: ['Medical', 'Medical Pharmacy'],
    memberScope: ['National'],
    likelySubmissionStepName: 'Submit Request',
    docsDescribeFlow: true,
    credentialsNeeded: 'Cigna.com Services User ID, Password, and 2-Step Authentication',
    attachmentsSupported: true,
    targetAssessment:
      'Good target because the portal supports real-time requirement checks and short-lived drafts while waiting for more clinical data.',
    sources: ['https://cignaforhcp.cigna.com/'],
  },
  {
    key: 'humana-availity-cohere',
    payerMatchers: ['humana', 'careplus'],
    portalName: 'Availity Essentials / Cohere Health',
    portalUrl: 'https://www.availity.com',
    lineOfBusiness: ['Commercial', 'Medicare Advantage', 'Medicaid'],
    memberScope: ['National'],
    likelySubmissionStepName: 'Complete Questionnaire',
    docsDescribeFlow: true,
    credentialsNeeded: 'Availity User ID/Password; Cohere requires separate registration',
    attachmentsSupported: true,
    targetAssessment:
      'Moderate target because delegated routing makes the first step choosing the correct portal instead of blindly submitting.',
    sources: ['https://www.availity.com', 'https://next.coherehealth.com'],
  },
  {
    key: 'florida-blue-availity',
    payerMatchers: ['florida blue'],
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com',
    lineOfBusiness: ['Commercial', 'Medicare'],
    memberScope: ['Florida'],
    likelySubmissionStepName: 'Add Attachments via Authorization/Referral Dashboard',
    docsDescribeFlow: true,
    credentialsNeeded: 'Availity User ID/Password',
    attachmentsSupported: true,
    targetAssessment:
      'Good regional target because the payer explicitly documents a newer attachment workflow and a concentrated geographic footprint makes pilot execution cleaner.',
    sources: ['https://www.availity.com'],
  },
];

const VENDOR_PORTAL_RULES = [
  {
    key: 'evicore',
    vendorName: 'eviCore healthcare',
    payerMatchers: ['humana', 'cigna', 'aetna', 'bcbs', 'wellcare', 'highmark', 'priority health', 'health alliance'],
    procedureMatchers: ['mri', 'ct', 'pet', 'radiology', 'cardiology', 'musculoskeletal', 'pain', 'sleep', 'physical therapy'],
    portalUrl: 'https://www.evicore.com/provider',
    uploadStepPresent: true,
    commonRequiredFields: ['Ordering NPI', 'TIN', 'member ID', 'date of birth', 'CPT codes', 'signs and symptoms', 'supporting imaging'],
    knownFailurePoints: [
      'Urgent status misuse can reclassify the request and delay processing.',
      'Missing documentation triggers follow-up outreach and removes the speed advantage of portal submission.',
      'Eligibility must still be verified on the payer site before vendor submission.',
    ],
  },
  {
    key: 'cohere',
    vendorName: 'Cohere Health',
    payerMatchers: ['humana', 'geisinger', 'blue cross nc'],
    procedureMatchers: ['musculoskeletal', 'orthopedic', 'joint', 'cardiovascular', 'diagnostic imaging', 'sleep'],
    portalUrl: 'https://next.coherehealth.com',
    uploadStepPresent: true,
    commonRequiredFields: ['Member ID', 'date of birth', 'ICD-10 code', 'procedure codes', 'place of service', 'NPI', 'Tax ID'],
    knownFailurePoints: [
      'Activation links expire quickly and require registration restart.',
      'Submitted referral requests cannot be edited.',
      'Missing information forces manual review and loses auto-approval speed.',
    ],
  },
  {
    key: 'evolent',
    vendorName: 'Evolent / RadMD',
    payerMatchers: ['superior healthplan', 'meridian', 'blue shield ca', 'wellcare', 'nh healthy families', 'communitycare', 'ambetter'],
    procedureMatchers: ['advanced imaging', 'mri', 'ct', 'pet', 'cardiology', 'musculoskeletal', 'interventional pain', 'physical medicine'],
    portalUrl: 'https://www.radmd.com',
    uploadStepPresent: true,
    commonRequiredFields: ['Ordering NPI', 'TIN', 'member name', 'member ID', 'CPT code', 'physical exam findings', 'conservative treatment history'],
    knownFailurePoints: [
      'Authorization validity windows expire quickly by plan.',
      'Expedited requests may require phone submission instead of the portal.',
      'Maintenance windows can make the portal unavailable during scheduled periods.',
    ],
  },
  {
    key: 'turningpoint',
    vendorName: 'TurningPoint Healthcare Solutions',
    payerMatchers: ['sunflower', 'horizon', 'priority health', 'health net', 'blue cross nc', 'ambetter'],
    procedureMatchers: ['musculoskeletal', 'spinal surgery', 'cardiology', 'ent', 'wound care', 'arthroplasty'],
    portalUrl: 'https://www.myturningpoint-healthcare.com',
    uploadStepPresent: true,
    commonRequiredFields: ['Physician', 'practice', 'ICD-10 diagnosis', 'CPT code', 'site of service'],
    knownFailurePoints: [
      'Action Required drafts stay pended until resolved.',
      'SmartScan only rescans supplemental documents once.',
      'Medicare retrospective requests are prohibited.',
    ],
  },
  {
    key: 'carelon',
    vendorName: 'Carelon Medical Benefits Management',
    payerMatchers: ['anthem', 'aetna', 'horizon', 'blue cross nc', 'carefirst', 'bcbsri'],
    procedureMatchers: ['radiology', 'cardiology', 'oncology', 'musculoskeletal', 'sleep', 'genetic testing', 'post acute'],
    portalUrl: 'https://providers.carelonmedicalbenefitsmanagement.com',
    uploadStepPresent: true,
    commonRequiredFields: ['Provider NPI', 'Tax ID', 'member ID', 'date of birth', 'clinical worksheet'],
    knownFailurePoints: [
      'Member ID identification errors can produce false no-auth signals.',
      'Recent MFA migrations can disrupt older user accounts.',
      'Site-of-care rules can pend requests if the selected facility is wrong.',
    ],
  },
  {
    key: 'availity',
    vendorName: 'Availity',
    payerMatchers: ['humana', 'highmark', 'premera', 'aetna', 'lifewise', 'bcbs wyoming', 'florida blue', 'anthem'],
    procedureMatchers: ['general prior auth', 'authorization', 'clinical upload', 'attachments'],
    portalUrl: 'https://www.availity.com',
    uploadStepPresent: true,
    commonRequiredFields: ['Member ID', 'provider NPI', 'Tax ID', 'start of care date', 'CPT codes', 'ICD-10 codes'],
    knownFailurePoints: [
      'SC01 security errors can require cache clearing or waiting for recovery.',
      'Member ID validation can fail while payer files are still updating.',
      'Login lockouts can occur after unusual activity detection.',
    ],
  },
];

const DOWNSTREAM_INTEGRATION_TARGETS = [
  {
    key: 'epic',
    systemName: 'Epic',
    category: 'Enterprise EHR',
    likelyPayloadFormat: 'FHIR R4 JSON',
    importMethod: 'FHIR REST API using $submit-attachment or DocumentReference',
    bestFirstIntegrationUseCase: 'Radiology, oncology, and high-complexity specialty imaging packet delivery.',
    url: 'https://fhir.epic.com/',
    specialtyMatchers: ['spine', 'ortho', 'pain', 'radiology', 'oncology'],
  },
  {
    key: 'athena',
    systemName: 'athenahealth',
    category: 'Cloud EHR, PM, and RCM',
    likelyPayloadFormat: 'REST JSON or FHIR R4 JSON',
    importMethod: 'POST clinical documents and tasks into athenaOne',
    bestFirstIntegrationUseCase: 'Orthopedic surgery and specialty referral authorization tracker workflows.',
    url: 'https://docs.athenahealth.com/api/api-ref/document',
    specialtyMatchers: ['ortho', 'spine', 'pain'],
  },
  {
    key: 'ecw',
    systemName: 'eClinicalWorks',
    category: 'Ambulatory EHR and Practice Management',
    likelyPayloadFormat: 'HL7 v2 or FHIR R4 JSON',
    importMethod: 'FHIR App Orchard or HL7 MDM/ORU to patient documents and task alerts',
    bestFirstIntegrationUseCase: 'Medication prior auth and authorization tracker alerts in ambulatory workflows.',
    url: 'https://fhir.eclinicalworks.com/',
    specialtyMatchers: ['pain', 'primary care', 'ambulatory'],
  },
  {
    key: 'oracle-health',
    systemName: 'Oracle Health / Cerner',
    category: 'Enterprise EHR',
    likelyPayloadFormat: 'FHIR R4 JSON',
    importMethod: 'POST DocumentReference or Task via Ignite APIs',
    bestFirstIntegrationUseCase: 'Inpatient discharge and post-acute authorization preparation.',
    url: 'https://docs.oracle.com/en/industries/health/millennium-platform-apis/index.html',
    specialtyMatchers: ['post acute', 'inpatient'],
  },
  {
    key: 'nextgen',
    systemName: 'NextGen Healthcare',
    category: 'Ambulatory specialty EHR and PMS',
    likelyPayloadFormat: 'Proprietary JSON or FHIR R4 JSON',
    importMethod: 'POST tasks or clinical documents through NextGen APIs',
    bestFirstIntegrationUseCase: 'Sleep medicine and DME documentation gap resolution.',
    url: 'https://www.nextgen.com/api',
    specialtyMatchers: ['sleep', 'dme', 'ortho'],
  },
];

const PHI_SAFE_DEFAULTS = [
  {
    topic: 'Log redaction',
    recommendedDefault: 'Metadata-only logging with explicit key redaction.',
    implementationImplication: 'Never persist raw chart summaries or direct identifiers inside operational logs.',
    facing: 'backend',
  },
  {
    topic: 'Retention periods',
    recommendedDefault: 'Short hot retention with longer cold retention policies.',
    implementationImplication: 'Separate app-facing recent run history from long-term immutable archival storage.',
    facing: 'backend',
  },
  {
    topic: 'File export safety',
    recommendedDefault: 'Short-lived exports with user-bound downloads.',
    implementationImplication: 'Exports should contain only minimum necessary fields and never include raw source chart text by default.',
    facing: 'both',
  },
  {
    topic: 'Audit trails',
    recommendedDefault: 'Append-only who/what/when/where/why/outcome entries.',
    implementationImplication: 'Case lifecycle changes and staff notes should always append history rather than overwrite it.',
    facing: 'both',
  },
  {
    topic: 'Synthetic and real data separation',
    recommendedDefault: 'Strict environment segregation.',
    implementationImplication: 'Demo-safe defaults must remain separate from any future real-data deployment path.',
    facing: 'backend',
  },
];

function matchTargetByPayer(payerName) {
  const normalizedPayer = normalize(payerName);
  return AUTHENTICATED_PORTAL_TARGETS.find((target) => includesAny(normalizedPayer, target.payerMatchers)) || null;
}

function matchVendorPortal({ vendorName = '', payerName = '', procedureLabel = '', specialty = '' } = {}) {
  const normalizedVendor = normalize(vendorName);
  const normalizedPayer = normalize(payerName);
  const normalizedProcedure = normalize(`${procedureLabel} ${specialty}`);

  if (normalizedVendor) {
    const direct = VENDOR_PORTAL_RULES.find((rule) => includesAny(normalizedVendor, [rule.vendorName, rule.key]));
    if (direct) {
      return direct;
    }
  }

  return (
    VENDOR_PORTAL_RULES.find(
      (rule) =>
        includesAny(normalizedPayer, rule.payerMatchers) &&
        includesAny(normalizedProcedure, rule.procedureMatchers),
    ) || null
  );
}

function chooseDownstreamTargets({ specialty = '', procedureLabel = '', payerName = '' } = {}) {
  const normalized = normalize(`${specialty} ${procedureLabel} ${payerName}`);
  const matches = DOWNSTREAM_INTEGRATION_TARGETS.filter((target) => includesAny(normalized, target.specialtyMatchers));
  return (matches.length ? matches : DOWNSTREAM_INTEGRATION_TARGETS.slice(0, 2)).slice(0, 3);
}

export function getPortalExecutionPlan({
  payerName = '',
  lineOfBusiness = '',
  memberState = '',
  procedureLabel = '',
  specialty = '',
  vendorName = '',
} = {}) {
  const portalTarget = matchTargetByPayer(payerName);
  const vendorPortal = matchVendorPortal({ vendorName, payerName, procedureLabel, specialty });
  const downstreamTargets = chooseDownstreamTargets({ specialty, procedureLabel, payerName });

  return {
    authenticatedPortalTarget: portalTarget
      ? {
          ...portalTarget,
          lineOfBusinessLabel: lineOfBusiness || '',
          memberStateLabel: memberState || '',
        }
      : null,
    vendorPortalTarget: vendorPortal || null,
    downstreamTargets,
    phiSafeDefaults: PHI_SAFE_DEFAULTS,
  };
}

export function buildWebhookReadyExport(packet) {
  const plan = getPortalExecutionPlan({
    payerName: packet?.payer_name || '',
    lineOfBusiness: packet?.line_of_business || '',
    memberState: packet?.member_state || '',
    procedureLabel: packet?.procedure || '',
    specialty: packet?.specialty || '',
    vendorName: packet?.portal_handoff?.delegated_vendor_hint || '',
  });

  return {
    schemaVersion: '2026-04-13.authpilot.webhook.v1',
    exportedAt: new Date().toISOString(),
    source: 'AuthPilot AI',
    eventType: 'submission_prep_ready',
    case: {
      id: packet?.case_id || '',
      payerName: packet?.payer_name || '',
      lineOfBusiness: packet?.line_of_business || '',
      memberState: packet?.member_state || '',
      specialty: packet?.specialty || '',
      diagnosis: packet?.diagnosis || '',
      procedure: packet?.procedure || '',
      submissionReady: Boolean(packet?.submission_ready),
      recommendedAction: packet?.recommended_action || '',
      lifecycleStatus: packet?.case_lifecycle?.status || 'new',
    },
    readiness: {
      supportingEvidence: packet?.supporting_evidence || [],
      missingEvidence: packet?.missing_evidence || [],
      checklist: packet?.submission_checklist || [],
    },
    routing: {
      policyUrl: packet?.policy_url || '',
      contactUrl: packet?.contact_url || '',
      phoneFallback: packet?.provider_precert_phone || '',
      routeRationale: packet?.portal_handoff?.route_rationale || '',
      delegatedVendor: packet?.portal_handoff?.delegated_vendor_hint || '',
    },
    executionPlan: {
      authenticatedPortalTarget: plan.authenticatedPortalTarget
        ? {
            portalName: plan.authenticatedPortalTarget.portalName,
            portalUrl: plan.authenticatedPortalTarget.portalUrl,
            likelySubmissionStepName: plan.authenticatedPortalTarget.likelySubmissionStepName,
            credentialsNeeded: plan.authenticatedPortalTarget.credentialsNeeded,
            attachmentsSupported: plan.authenticatedPortalTarget.attachmentsSupported,
          }
        : null,
      vendorPortalTarget: plan.vendorPortalTarget
        ? {
            vendorName: plan.vendorPortalTarget.vendorName,
            portalUrl: plan.vendorPortalTarget.portalUrl,
            uploadStepPresent: plan.vendorPortalTarget.uploadStepPresent,
            commonRequiredFields: plan.vendorPortalTarget.commonRequiredFields,
          }
        : null,
      downstreamTargets: plan.downstreamTargets.map((target) => ({
        systemName: target.systemName,
        category: target.category,
        likelyPayloadFormat: target.likelyPayloadFormat,
        importMethod: target.importMethod,
        url: target.url,
      })),
    },
    minimumNecessaryNotice:
      'This export is webhook-ready and intentionally excludes raw chart-summary free text. Add PHI only after secure downstream transport and role controls are in place.',
  };
}

export function enrichOperatorPacketWithExecutionPlan(packet) {
  if (!packet) {
    return packet;
  }

  const plan = getPortalExecutionPlan({
    payerName: packet.payer_name || '',
    lineOfBusiness: packet.line_of_business || '',
    memberState: packet.member_state || '',
    procedureLabel: packet.procedure || '',
    specialty: packet.specialty || '',
    vendorName: packet.portal_handoff?.delegated_vendor_hint || '',
  });

  return {
    ...packet,
    authenticated_portal_target: plan.authenticatedPortalTarget,
    vendor_portal_target: plan.vendorPortalTarget,
    downstream_targets: plan.downstreamTargets,
    phi_safe_defaults: plan.phiSafeDefaults,
  };
}
