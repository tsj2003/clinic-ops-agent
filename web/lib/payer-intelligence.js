function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreAliasMatch(normalizedInput, alias) {
  const normalizedAlias = normalize(alias);
  if (!normalizedAlias) {
    return 0;
  }
  if (normalizedInput === normalizedAlias) {
    return 120 + normalizedAlias.length;
  }
  if (normalizedInput.startsWith(normalizedAlias)) {
    return 90 + normalizedAlias.length;
  }
  if (normalizedInput.includes(normalizedAlias)) {
    return 70 + normalizedAlias.length;
  }
  return 0;
}

const PAYER_PROFILES = [
  {
    key: 'aetna',
    displayName: 'Aetna',
    aliases: [
      'aetna',
      'aetna health',
      'aetna inc',
      'aetna ppo',
      'aetna medicare',
      'cvs aetna',
      'aetna cvs',
      'aetna better health',
    ],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare'],
    policyUrl: 'https://www.aetna.com/health-care-professionals/clinical-policy-bulletins/medical-clinical-policy-bulletins.html',
    contactUrl: 'https://www.aetna.com/health-care-professionals/health-care-professional-forms.html',
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '1-888-632-3862',
    routeNote: 'Electronic PA through Availity is preferred. Medicare Advantage uses a separate dedicated phone line and Medicaid is state-specific.',
    sourceNote: 'Expanded from the provided payer research and current official Aetna provider resources.',
    nationalScope: 'National',
    bestSeedUrl: 'https://www.aetna.com/insights/clinical-policy-and-quality.html',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Non-Medicare call center uses 1-888-632-3862. Availity and ePA are preferred.',
      medicareAdvantage: 'Dedicated Medicare line is 1-800-624-0756 and CMS hierarchy can change the routing logic.',
      medicaid: 'Aetna Better Health is state-specific and needs member-state-aware routing.',
    },
  },
  {
    key: 'cigna',
    displayName: 'Cigna Healthcare',
    aliases: ['cigna', 'cigna healthcare', 'cigna corp', 'cignaforhcp', 'evernorth'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare'],
    policyUrl: 'https://www.cigna.com/health-care-providers/coverage-and-claims/policies',
    contactUrl: 'https://www.cigna.com/health-care-providers/coverage-and-claims/precertification',
    portalName: 'Cigna for Health Care Professionals',
    portalUrl: 'https://cignaforhcp.cigna.com/app/login',
    phoneFallback: '1-800-882-4462',
    routeNote: 'Commercial routing starts in the standard Cigna provider portal, but multiple specialties are delegated to eviCore. Medicare Advantage uses a separate HSConnect flow.',
    sourceNote: 'Expanded from the provided payer research and current official Cigna provider coverage resources.',
    nationalScope: 'National',
    bestSeedUrl: 'https://cignaforhcp.cigna.com/',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'HMO and PPO behavior can differ. Radiology, MSK, and GI are commonly delegated to eviCore.',
      medicareAdvantage: 'Medicare Advantage must route through HSConnect / Medicare-specific workflows rather than the normal Cigna provider portal.',
      medicaid: 'Regional and state-specific implementations exist; do not assume a national Medicaid route.',
    },
  },
  {
    key: 'unitedhealthcare',
    displayName: 'UnitedHealthcare',
    aliases: [
      'unitedhealthcare',
      'united healthcare',
      'uhc',
      'uhcprovider',
      'unitedhealthcare services',
      'oxford',
      'surest',
      'community plan',
      'unitedhealthcare community plan',
    ],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.uhcprovider.com/en/policies-protocols/clinical-guidelines.html',
    contactUrl: 'https://www.uhcprovider.com/en/prior-auth-advance-notification/adv-notification-plan-reqs.html',
    portalName: 'UnitedHealthcare Provider Portal',
    portalUrl: 'https://secure.uhcprovider.com/',
    phoneFallback: '877-842-3210',
    routeNote: 'Use the Provider Portal first and check requirements by member because line-of-business logic changes dynamically. Medicaid flows are state-specific.',
    sourceNote: 'Expanded from the provided payer research and current UHCprovider prior authorization resources.',
    nationalScope: 'National with state-specific Medicaid',
    bestSeedUrl: 'https://www.uhcprovider.com/en/prior-auth-advance-notification.html',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Commercial plans include Oxford, Surest, and Mid-Atlantic variations.',
      medicareAdvantage: 'Some radiology services have different PA rules under Medicare Advantage, so MA needs separate handling.',
      medicaid: 'Community Plan routing is organized by state and may require separate call lines or tables.',
    },
  },
  {
    key: 'anthem-elevance',
    displayName: 'Anthem / Elevance Health',
    aliases: [
      'anthem',
      'elevance',
      'elevance health',
      'anthem blue cross',
      'anthem blue cross blue shield',
      'anthem bcbs',
      'anthem provider',
    ],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.anthem.com/provider/individual-commercial/prior-authorization',
    contactUrl: 'https://www.anthem.com/provider/prior-authorization',
    portalName: 'Availity Essentials / Interactive Care Reviewer',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '800-331-1476',
    routeNote: 'Digital routing runs through Interactive Care Reviewer in Availity, but specialty areas can pivot to Carelon and Medicaid can fragment by state.',
    sourceNote: 'Expanded from the provided Anthem / Elevance research and current provider resources.',
    nationalScope: 'National with state-specific lookup tools',
    bestSeedUrl: 'https://www.anthem.com/oh/provider/state-federal/resources/prior-authorization-requirements/lookup-tool',
    directoryNotes: 'State-specific plans and lookup tools can still override the generic Anthem route.',
    lineOfBusinessNotes: {
      commercial: 'Commercial authorizations typically use ICR and may return immediate determinations for some services.',
      medicareAdvantage: 'Uses the same digital tooling as commercial but CMS-driven logic underneath.',
      medicaid: 'Medicaid is heavily state-specific; Ohio in particular requires extra routing pivots.',
    },
  },
  {
    key: 'humana',
    displayName: 'Humana',
    aliases: ['humana', 'humana inc', 'humana medicare', 'careplus'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare'],
    policyUrl: 'https://mcp.humana.com/tad/tad_new/home.aspx?type=provider',
    contactUrl: 'https://provider.humana.com/coverage-claims/prior-authorizations',
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '800-523-0023',
    routeNote: 'Humana uses a search tool to determine whether the request belongs in Availity or a specialty vendor such as Cohere or Evolent.',
    sourceNote: 'Expanded from the provided Humana payer research.',
    nationalScope: 'National',
    bestSeedUrl: 'https://provider.humana.com/coverage-claims/prior-authorizations/prior-authorizations-search-tool',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Commercial routing stays closer to Availity and Humana call-center flows.',
      medicareAdvantage: 'Medicare Advantage commonly delegates imaging, MSK, sleep, and cardiovascular reviews to Cohere or Evolent.',
      medicaid: 'Medicaid is state-specific and should not default to Cohere unless explicitly documented.',
    },
  },
  {
    key: 'molina',
    displayName: 'Molina Healthcare',
    aliases: ['molina', 'molina healthcare', 'molina health', 'molina marketplace'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Medicaid', 'Medicare'],
    policyUrl: 'https://www.molinaclinicalpolicy.com',
    contactUrl: 'https://www.molinahealthcare.com/providers/tx/medicaid/forms/PA.aspx',
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com/molinahealthcare',
    phoneFallback: '855-665-4623',
    routeNote: 'Molina is migrating aggressively to Availity, but operational requirements still vary by state and line of business.',
    sourceNote: 'Expanded from the provided Molina payer research.',
    nationalScope: 'National clinical policies with state operational implementation',
    bestSeedUrl: 'https://www.molinahealthcare.com/marketplace/id/en-us/Providers',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Marketplace members are generally managed through the secure portal and Availity flows.',
      medicareAdvantage: 'Medicare Advantage and Dual Options are supported but still use plan-specific forms in some cases.',
      medicaid: 'Primary line of business; Texas, Ohio, New Mexico, Virginia, and Kentucky can differ materially.',
    },
  },
  {
    key: 'centene-ambetter',
    displayName: 'Centene / Ambetter',
    aliases: [
      'centene',
      'centene corporation',
      'ambetter',
      'ambetter health',
      'ambetter marketplace',
      'wellcare',
      'wellcare by allwell',
      'superior healthplan',
      'superior health plan',
    ],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Medicaid', 'Marketplace', 'Medicare'],
    policyUrl:
      'https://www.ambetterhealth.com/en/tx/provider-resources/manuals-and-forms/prior-authorization-requirements-for-health-insurance-marketplac/',
    contactUrl: 'https://www.ambetterhealth.com/en/mo/provider-resources/manuals-and-forms/pre-auth/',
    portalName: 'Ambetter Secure Provider Portal',
    portalUrl: 'https://provider.ambetterhealth.com',
    phoneFallback: '1-877-687-1196',
    routeNote: 'Highly fragmented by brand, state, and delegated specialty vendor. Expect TurningPoint and Evolent pivots for some specialties.',
    sourceNote: 'Expanded from the provided Centene / Ambetter payer research.',
    nationalScope: 'Highly fragmented',
    bestSeedUrl:
      'https://www.ambetterhealth.com/en/tx/provider-resources/manuals-and-forms/prior-authorization-requirements-for-health-insurance-marketplac/',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Ambetter marketplace plans are state-specific and frequently route through state plan portals.',
      medicareAdvantage: 'Wellcare-branded Medicare Advantage may have different rules and vendor relationships.',
      medicaid: 'Medicaid and CHIP are state-specific and often use separate prescreen or specialty vendor tools.',
    },
  },
  {
    key: 'kaiser',
    displayName: 'Kaiser Permanente',
    aliases: ['kaiser', 'kaiser permanente', 'kp', 'permanente advantage'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://healthy.kaiserpermanente.org/community-providers/authorizations',
    contactUrl: 'https://healthy.kaiserpermanente.org/community-providers/authorizations',
    portalName: 'KP Online-Affiliate / EpicLink',
    portalUrl: 'https://epiclink.kp.org/wma/epiclink_overview.htm',
    phoneFallback: '1-888-567-6847',
    routeNote: 'Kaiser is regionalized. Community-provider and out-of-area PPO rules are the safest public starting points, but local region selection matters.',
    sourceNote: 'Expanded from the provided Kaiser payer research.',
    nationalScope: 'Regionalized',
    bestSeedUrl: 'https://wa-provider.kaiserpermanente.org/home/pre-auth/search',
    directoryNotes: 'Integrated payer-provider model. Regional workflows can differ materially.',
    lineOfBusinessNotes: {
      commercial: 'Flexible Choice PPO and out-of-area plans are the most public-facing prior authorization flows.',
      medicareAdvantage: 'Medicare Advantage and Part B drug rules can differ from commercial routes.',
      medicaid: 'Regional implementations vary and should not be generalized across all Kaiser regions.',
    },
  },
  {
    key: 'florida-blue',
    displayName: 'Florida Blue',
    aliases: ['florida blue', 'bcbs florida', 'blue cross blue shield florida', 'flblue'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.floridablue.com/providers/medical-policies-guidelines/medical-policies',
    contactUrl: 'https://www.floridablue.com/providers/medical-pharmacy-info/medical-policy-pre-certification-pre-authorization',
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '1-800-727-2227',
    routeNote:
      'Florida Blue is one of the stronger BCBS plans for public routing, but specialty reviews can pivot to Lucet, Evolent, or other delegated vendors depending on the service line.',
    sourceNote: 'Expanded from the provided BCBS regional plan research.',
    nationalScope: 'Florida-specific plan',
    bestSeedUrl: 'https://www.floridablue.com/providers/medical-pharmacy-info/medical-policy-pre-certification-pre-authorization',
    directoryNotes: 'Prefix-based and specialty-vendor routing can change by service line.',
    lineOfBusinessNotes: {
      commercial: 'Commercial routing is relatively transparent and often starts in Availity.',
      medicareAdvantage: 'Medicare Advantage can still delegate to specialty vendors depending on the procedure class.',
      medicaid: 'State-program behavior can differ from the standard commercial flow.',
    },
  },
  {
    key: 'bcbsil',
    displayName: 'Blue Cross and Blue Shield of Illinois',
    aliases: ['bcbsil', 'blue cross blue shield of illinois', 'blue cross illinois', 'blue shield illinois'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.bcbsil.com/provider/clinical-resources/medical-policies',
    contactUrl: 'https://www.bcbsil.com/provider/claims/claims-eligibility/utilization-management/prior-authorization',
    portalName: 'Availity Essentials / BlueApprovR',
    portalUrl: 'https://www.bcbsil.com/provider/education/education-reference/provider-tools/blueapprovr',
    phoneFallback: '1-800-572-3089',
    routeNote:
      'BCBS Illinois has stronger digital tooling than the generic BCBS fallback, but specialty utilization management can still pivot to Carelon or eviCore.',
    sourceNote: 'Expanded from the provided BCBS Illinois plan research.',
    nationalScope: 'Illinois-specific plan',
    bestSeedUrl: 'https://www.bcbsil.com/provider/claims/claims-eligibility/utilization-management/prior-authorization',
    directoryNotes: 'BlueApprovR is being folded into broader Availity workflows, so digital tooling can shift over time.',
    lineOfBusinessNotes: {
      commercial: 'Commercial members can often use a digital lookup path before escalating to a specialty vendor.',
      medicareAdvantage: 'MA behavior can still use regional or specialty vendor logic.',
      medicaid: 'Medicaid products should be treated as plan-specific rather than assuming the same commercial route.',
    },
  },
  {
    key: 'bcbstx',
    displayName: 'Blue Cross and Blue Shield of Texas',
    aliases: ['bcbstx', 'blue cross blue shield of texas', 'blue cross texas', 'blue shield texas'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.bcbstx.com/member/medical-policies',
    contactUrl: 'https://www.bcbstx.com/find-care/prior-authorization',
    portalName: 'Availity Essentials / BlueApprovR',
    portalUrl: 'https://www.bcbstx.com/provider/education/education/tools/availity-authorizations',
    phoneFallback: '1-800-451-0287',
    routeNote:
      'BCBS Texas has a strong digital authorization path, but specialty reviews can still move into delegated vendor workflows and Medicaid variants are separate.',
    sourceNote: 'Expanded from the provided BCBS Texas plan research.',
    nationalScope: 'Texas-specific plan',
    bestSeedUrl: 'https://www.bcbstx.com/find-care/prior-authorization',
    directoryNotes: 'Texas Gold Carding and Medicaid program differences can change the operational route.',
    lineOfBusinessNotes: {
      commercial: 'Commercial flows usually begin in Availity or BlueApprovR before delegated specialty routing.',
      medicareAdvantage: 'MA products may differ from the standard commercial route by service line.',
      medicaid: 'STAR and related Medicaid lines require separate handling from the commercial path.',
    },
  },
  {
    key: 'blue-shield-california',
    displayName: 'Blue Shield of California',
    aliases: ['blue shield of california', 'blue shield california', 'blueshieldca', 'bsca'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.blueshieldca.com/en/provider/authorizations/authorization-list',
    contactUrl: 'https://www.blueshieldca.com/en/provider/authorizations',
    portalName: 'AuthAccel',
    portalUrl: 'https://www.blueshieldca.com/en/provider/authorizations',
    phoneFallback: '1-800-541-6652',
    routeNote:
      'Blue Shield of California is more specific than the generic BCBS fallback and often uses AuthAccel for PPO workflows, while some specialties are delegated to Evolent or other vendors.',
    sourceNote: 'Expanded from the provided Blue Shield of California plan research.',
    nationalScope: 'California-specific plan',
    bestSeedUrl: 'https://www.blueshieldca.com/en/provider/authorizations',
    directoryNotes: 'HMO members may still route through IPAs instead of the PPO/AuthAccel flow.',
    lineOfBusinessNotes: {
      commercial: 'PPO routing is the cleanest starting point. IPA delegation can override the expected route.',
      medicareAdvantage: 'Medicare-specific benefits may have separate operational guidance.',
      medicaid: 'Medicaid behavior is more plan-specific and should not default to the PPO path.',
    },
  },
  {
    key: 'az-blue',
    displayName: 'Blue Cross Blue Shield of Arizona',
    aliases: ['az blue', 'bcbsaz', 'blue cross blue shield of arizona', 'blue cross arizona', 'blue shield arizona'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.azblue.com/providers/medical-policies',
    contactUrl: 'https://www.azblue.com/prior-authorization-lookup',
    portalName: 'Availity Essentials',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '1-800-232-2340',
    routeNote:
      'Arizona Blue is relatively transparent and has a public prior authorization lookup, so start with the plan-specific lookup before escalating to vendor assumptions.',
    sourceNote: 'Expanded from the provided Arizona Blue plan research.',
    nationalScope: 'Arizona-specific plan',
    bestSeedUrl: 'https://www.azblue.com/prior-authorization-lookup',
    directoryNotes: null,
    lineOfBusinessNotes: {
      commercial: 'Commercial lookups are comparatively straightforward.',
      medicareAdvantage: 'MA still needs line-of-business-specific confirmation.',
      medicaid: 'Medicaid products should be validated against plan or state-specific rules.',
    },
  },
  {
    key: 'highmark',
    displayName: 'Highmark Blue Cross Blue Shield',
    aliases: ['highmark', 'highmark blue cross blue shield', 'highmark bcbs', 'highmark health'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://providers.highmark.com/policies-and-programs/medical-policies',
    contactUrl: 'https://providers.highmark.com/authorization.html',
    portalName: 'NaviNet / Availity Essentials',
    portalUrl: 'https://www.navinet.net',
    phoneFallback: '1-800-547-3627',
    routeNote:
      'Highmark is regional and less transparent than some BCBS plans. Start in NaviNet or the regional provider portal, then confirm whether a specialty vendor is involved.',
    sourceNote: 'Expanded from the provided Highmark plan research.',
    nationalScope: 'Regional BCBS plan',
    bestSeedUrl: 'https://providers.highmark.com/authorization.html',
    directoryNotes: 'Highmark often requires authentication for detailed code lookups, so the public route can stop short of the final answer.',
    lineOfBusinessNotes: {
      commercial: 'Commercial routing starts in Highmark tooling but may still branch to regional programs.',
      medicareAdvantage: 'MA products can use regional or delegated specialty tools.',
      medicaid: 'Medicaid products are plan-specific and should not assume the commercial route.',
    },
  },
  {
    key: 'bcbs-federation',
    displayName: 'Blue Cross Blue Shield Federation',
    aliases: ['bcbs', 'blue cross blue shield', 'blue cross', 'blue shield', 'bcbs plan'],
    payerType: 'Commercial',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.bcbs.com/providers',
    contactUrl: 'https://www.bcbs.com/contact-us',
    portalName: 'Plan-specific BCBS portal',
    portalUrl: 'https://www.availity.com',
    phoneFallback: '1-844-325-6251',
    routeNote: 'BCBS is federation-fragmented. Use plan-specific pages whenever possible, and expect specialty delegation to Carelon or eviCore in many regional plans.',
    sourceNote: 'Expanded from the provided BCBS / regional plan research.',
    nationalScope: 'National federation with state-specific plans',
    bestSeedUrl: 'https://www.bcbs.com/providers',
    directoryNotes: 'BCBS is a federation. State or regional plan matching is usually better than this generic fallback profile.',
    lineOfBusinessNotes: {
      commercial: 'BlueCard and local-plan logic create plan-specific routing differences.',
      medicareAdvantage: 'Many regional BCBS MA products delegate specialty UM to eviCore or plan-specific tools.',
      medicaid: 'State Medicaid products can be highly fragmented and should be treated cautiously.',
    },
  },
  {
    key: 'carelon',
    displayName: 'Carelon',
    aliases: ['carelon', 'carelon medical benefits management', 'carelonrx'],
    payerType: 'Vendor',
    country: 'US',
    supportedLines: ['Commercial', 'Medicare', 'Medicaid'],
    policyUrl: 'https://www.carelon.com/providers/guidelines',
    contactUrl: 'https://www.carelon.com/providers',
    portalName: 'Carelon Provider Portal',
    portalUrl: 'https://www.providerportal.com',
    phoneFallback: '800-859-5299',
    routeNote: 'Carelon is a delegated vendor rather than a payer. It should be suggested when Anthem/BCBS or specialty routing indicates a Carelon-managed workflow.',
    sourceNote: 'Expanded from the provided Carelon vendor research.',
    nationalScope: 'National delegated vendor',
    bestSeedUrl: 'https://www.carelonbehavioralhealth.com/providers/resources/provider-portals',
    directoryNotes: 'Delegated vendor rather than a payer. Use when the parent payer routes specialty requests out to Carelon.',
    lineOfBusinessNotes: {
      commercial: 'Frequently manages specialty commercial workflows for Anthem and some BCBS plans.',
      medicareAdvantage: 'Often involved in diagnostic or cardiac imaging for MA products when delegated by the payer.',
      medicaid: 'May manage delegated Medicaid specialty reviews depending on the parent plan.',
    },
  },
  {
    key: 'medicare',
    displayName: 'Medicare',
    aliases: ['medicare', 'cms medicare', 'original medicare'],
    payerType: 'Government',
    country: 'US',
    supportedLines: ['Medicare'],
    policyUrl: 'https://www.medicare.gov/coverage',
    contactUrl: 'https://www.medicare.gov/basics/get-started-with-medicare',
    portalName: 'Medicare.gov',
    portalUrl: 'https://www.medicare.gov',
    phoneFallback: '800-633-4227',
    routeNote: 'Use Medicare as a policy fallback only. Actual operational routing usually depends on the MAC, contractor, or Medicare Advantage plan involved.',
    sourceNote: 'Added from the provided payer directory as a generic government fallback.',
    nationalScope: 'National',
    bestSeedUrl: 'https://www.medicare.gov/coverage',
    directoryNotes: 'This is a generic fallback and should not replace plan-specific Medicare Advantage routing.',
    lineOfBusinessNotes: {
      commercial: 'Not applicable.',
      medicareAdvantage: 'Medicare Advantage should route to the specific payer or MA plan instead of generic Medicare.',
      medicaid: 'Not applicable.',
    },
  },
  {
    key: 'medicaid',
    displayName: 'Medicaid',
    aliases: ['medicaid', 'state medicaid', 'medicaid program'],
    payerType: 'Government',
    country: 'US',
    supportedLines: ['Medicaid'],
    policyUrl: 'https://www.medicaid.gov/medicaid/benefits/prior-authorization/index.html',
    contactUrl: 'https://www.medicaid.gov/about-us/contact-us/index.html',
    portalName: 'Medicaid.gov',
    portalUrl: 'https://www.medicaid.gov',
    phoneFallback: '',
    routeNote: 'Use Medicaid as a research fallback only. Real routing is state-specific and often delegated to managed-care plans.',
    sourceNote: 'Added from the provided payer directory as a generic government fallback.',
    nationalScope: 'State-specific programs',
    bestSeedUrl: 'https://www.medicaid.gov',
    directoryNotes: 'This is a generic fallback and should usually yield to a state or managed-care payer profile.',
    lineOfBusinessNotes: {
      commercial: 'Not applicable.',
      medicareAdvantage: 'Not applicable.',
      medicaid: 'State-specific program rules and managed-care plans control the operational route.',
    },
  },
];

const PROCEDURE_TEMPLATES = [
  {
    key: 'lumbar_mri',
    label: 'Lumbar MRI starter',
    matchers: [/lumbar/i, /lower back/i, /72148/, /72149/, /72158/, /mri/i],
    commonProcedureNames: [
      'Lumbar MRI',
      'MRI lumbar spine',
      'MRI lumbar spine without contrast',
      'MRI lumbar spine with contrast',
      'MRI lumbar spine with and without contrast',
    ],
    payerTerminologyVariants: ['lumbar spine MRI', 'MRI of the lumbar spine', 'lower back MRI', 'spinal MRI'],
    evidenceFocus: [
      'conservative therapy duration',
      'radicular symptoms',
      'prior medication or physical therapy response',
      'imaging or electrodiagnostic support',
    ],
    checklistFocus: ['physical therapy notes', 'medication trial history', 'pain duration', 'exam findings', 'prior imaging'],
    commonEvidencePhrases: [
      'unresponsive to conservative treatment for at least 4 weeks',
      'radicular pain as evidenced by history and physical exam',
      'structural or functional nerve root involvement',
    ],
    commonMissingEvidenceReasons: [
      'conservative care duration not clearly documented',
      'missing physical therapy or medication-trial details',
      'clinical notes omit location, duration, or severity of pain',
      'lack of conservative treatment documentation',
      'failure to document objective neurological findings',
      'imaging for acute low back pain without red flags',
      "vague clinical notes like 'chronic pain' without precise terminology",
    ],
    typicalSupportingDocuments: [
      'physical therapy notes',
      'medication trial history',
      'neurological examination',
      'prior x-ray reports',
      'clinical notes with pain duration and red-flag review',
    ],
    policySearchKeywords: ['lumbar MRI policy', 'radiculopathy conservative therapy lumbar spine', 'low back pain MRI policy'],
    routeSearchKeywords: [
      'prior authorization MRI spine provider portal',
      'radiology prior auth',
      'EviCore Provider Portal',
      'Availity Essentials',
      'Cohere Health Portal',
      'GuidingCare Authorization',
    ],
    cptCodes: ['72148', '72149', '72158'],
    routeTitle: 'Portal-ready lumbar MRI submission',
  },
  {
    key: 'cervical_mri',
    label: 'Cervical MRI starter',
    matchers: [/cervical/i, /neck/i, /72141/, /72142/, /72156/, /mri/i],
    commonProcedureNames: [
      'Cervical MRI',
      'MRI cervical spine',
      'MRI neck',
      'MRI cervical spine without contrast',
      'MRI cervical spine with and without contrast',
    ],
    payerTerminologyVariants: ['cervical spine MRI', 'MRI of the cervical spine', 'neck MRI'],
    evidenceFocus: [
      'failed conservative management',
      'neurologic findings',
      'predisposing conditions such as myelopathy or neoplasm',
      'concordant imaging rationale',
    ],
    checklistFocus: ['x-ray reports', 'neurologic exam findings', 'conservative care history', 'pain duration'],
    commonEvidencePhrases: [
      'known or suspected myelopathy',
      'clinical signs of spinal cord compression',
      'hyperreflexia or gait instability',
      'no improvement after 6 weeks of conservative therapy',
      'suspected spinal cord injury secondary to trauma',
    ],
    commonMissingEvidenceReasons: [
      'resolved or improving spinal pain',
      'routine imaging for acute neck pain without red flags',
      'lack of 6 weeks of conservative treatment',
    ],
    typicalSupportingDocuments: [
      'physical examination since onset of symptoms',
      'previous x-ray reports',
      'neurological evaluation',
      'consultant specialist referral',
    ],
    policySearchKeywords: ['cervical MRI policy', 'neck pain neurologic findings MRI', 'myelopathy cervical MRI'],
    routeSearchKeywords: [
      'cervical MRI prior auth provider portal',
      'EviCore',
      'Cohere Health',
      'Carelon Guidelines',
      'Availity Authorizations',
    ],
    cptCodes: ['72141', '72142', '72156'],
    routeTitle: 'Portal-ready cervical MRI submission',
  },
  {
    key: 'knee_mri',
    label: 'Knee MRI starter',
    matchers: [/knee/i, /73721/, /73722/, /73723/, /mri/i],
    commonProcedureNames: [
      'Knee MRI',
      'MRI knee',
      'MRI lower extremity joint knee',
      'MRI knee without contrast',
      'MRI knee with and without contrast',
    ],
    payerTerminologyVariants: ['knee MRI', 'MRI of the knee', 'MRI lower extremity joint'],
    evidenceFocus: [
      'persistent pain or swelling',
      'instability or locking symptoms',
      'failed conservative therapy',
      'x-ray or exam findings',
    ],
    checklistFocus: ['multi-view x-rays', 'conservative therapy notes', 'functional limitation', 'instability or locking symptoms'],
    commonEvidencePhrases: [
      'persistent true locking of the knee',
      'failure of at least 3 weeks of conservative therapy',
      'instability giving way secondary to injury',
      'multi-view x-rays ruled out fracture or loose body',
      'suspected osteochondritis dissecans',
    ],
    commonMissingEvidenceReasons: [
      'fitting of implants for total knee arthroplasty is not a medical necessity indication',
      'chronological age estimation is not a covered indication',
      'evaluation of routine degenerative joint disease without qualifying mechanical symptoms',
    ],
    typicalSupportingDocuments: [
      'plain x-ray reports with multiple views',
      'physical therapy notes',
      'injury history documentation',
      'clinical evaluation of mechanical symptoms',
    ],
    policySearchKeywords: ['Meniscal tear', 'ACL injury', 'Osteochondritis dissecans', 'Osteonecrosis', 'Loose body'],
    routeSearchKeywords: ['EviCore Musculoskeletal', 'Carelon', 'Availity Essentials', 'Cohere Health'],
    cptCodes: ['73721', '73722', '73723'],
    routeTitle: 'Portal-ready knee MRI submission',
  },
  {
    key: 'shoulder_mri',
    label: 'Shoulder MRI starter',
    matchers: [/shoulder/i, /73221/, /73222/, /73223/, /mri/i],
    commonProcedureNames: [
      'Shoulder MRI',
      'MRI shoulder',
      'MRI upper extremity joint shoulder',
      'MRI shoulder without contrast',
      'MRI shoulder with and without contrast',
    ],
    payerTerminologyVariants: ['shoulder MRI', 'MRI of the shoulder', 'MRI upper extremity joint'],
    evidenceFocus: [
      'severe pain and loss of function',
      'history of unsuccessful conservative therapy',
      'recent supporting imaging',
    ],
    checklistFocus: ['function loss details', 'therapy history', 'recent imaging', 'orthopedic exam findings'],
    commonEvidencePhrases: [
      'severe pain and loss of function of at least 6 months duration',
      'history of unsuccessful conservative therapy clearly addressed in the medical record',
      'imaging used to justify interventional procedures must be performed within 18 months',
    ],
    commonMissingEvidenceReasons: [
      'no documented functional loss',
      'missing conservative treatment history',
      'supporting imaging is outdated or absent',
    ],
    typicalSupportingDocuments: [
      'rotator cuff or instability physical examination',
      'physical therapy notes',
      'prior x-ray or ultrasound results',
      'orthopedic consultation note',
    ],
    policySearchKeywords: ['shoulder MRI policy', 'rotator cuff conservative therapy MRI', 'labral tear shoulder MRI'],
    routeSearchKeywords: ['Carelon joint surgery', 'Aetna shoulder MRI policy', 'shoulder MRI prior auth provider portal'],
    cptCodes: ['73221', '73222', '73223'],
    routeTitle: 'Portal-ready shoulder MRI submission',
  },
  {
    key: 'ct_spine',
    label: 'CT spine starter',
    matchers: [/ct/i, /spine/i, /72125/, /72128/, /72131/],
    commonProcedureNames: ['CT spine', 'CT cervical spine', 'CT thoracic spine', 'CT lumbar spine'],
    payerTerminologyVariants: ['CT of the spine', 'computed tomography spine', 'spinal CT'],
    evidenceFocus: [
      'hardware integrity or fusion status',
      'post-operative evaluation or pseudarthrosis concern',
      'abnormality seen on prior imaging',
    ],
    checklistFocus: ['operative reports', 'post-op symptom changes', 'x-ray reports', 'prior imaging abnormality'],
    commonEvidencePhrases: [
      'evaluate hardware integrity or fusion status',
      'assessment of post operative pseudarthrosis',
      'characterize a suspicious abnormality seen on prior imaging',
    ],
    commonMissingEvidenceReasons: [
      'missing operative or post-op context',
      'no recent symptom change documented',
      'insufficient prior imaging comparison',
    ],
    typicalSupportingDocuments: [
      'history and physical since change in symptoms',
      'operative reports',
      'x-ray reports ruling out fracture',
      'prior imaging showing suspicious abnormality',
    ],
    policySearchKeywords: ['CT spine policy', 'hardware integrity fusion status CT', 'pseudarthrosis post operative CT spine'],
    routeSearchKeywords: ['Availity Essentials', 'EviCore Provider Portal', 'Cohere Health'],
    cptCodes: ['72125', '72128', '72131'],
    routeTitle: 'Portal-ready CT spine submission',
  },
  {
    key: 'epidural_steroid_injection',
    label: 'Epidural steroid injection starter',
    matchers: [/epidural/i, /steroid injection/i, /esi/i, /62321/, /62323/, /64479/, /64483/],
    commonProcedureNames: [
      'Epidural steroid injection',
      'Transforaminal epidural steroid injection',
      'Interlaminar epidural steroid injection',
      'Lumbar epidural injection',
    ],
    payerTerminologyVariants: [
      'ESI',
      'epidural steroid injection',
      'transforaminal epidural injection',
      'interlaminar epidural injection',
    ],
    evidenceFocus: [
      'pain duration',
      'failed conservative therapy',
      'functional limitation',
      'supporting imaging for the injection target',
    ],
    checklistFocus: ['pain scores', 'therapy history', 'medication response', 'supporting imaging', 'target level'],
    commonEvidencePhrases: [
      'concordant objective evidence of radiculopathy',
      'at least 50 percent pain relief for 2 to 4 weeks',
      'documented increase in functional abilities',
      'failed 4 weeks of conservative care',
      'radicular pain from disc herniation',
    ],
    commonMissingEvidenceReasons: [
      'absence of objective neurological findings',
      'injection interval less than 2 weeks',
      'annual limit exceeded for the spinal region',
      'lack of 50 percent relief from prior injection',
      'injection series not individualized',
    ],
    typicalSupportingDocuments: [
      'neurological examination',
      'prior injection response documentation',
      'pain and functional limitation scores',
      'supporting MRI or CT at the target level',
    ],
    policySearchKeywords: ['epidural steroid injection policy', 'radicular pain conservative care injection'],
    routeSearchKeywords: ['Cohere Health', 'EviCore Healthcare', 'Carelon Interventional Pain', 'Availity services'],
    cptCodes: ['62321', '62323', '64479', '64483'],
    routeTitle: 'Portal-ready epidural injection submission',
  },
  {
    key: 'facet_injection',
    label: 'Facet injection starter',
    matchers: [/facet/i, /medial branch/i, /64490/, /64493/],
    commonProcedureNames: [
      'Facet injection',
      'Facet joint injection',
      'Medial branch block',
      'Paravertebral facet procedure',
    ],
    payerTerminologyVariants: ['Z-joint injection', 'Facet block', 'Medial branch injection', 'Paravertebral facet procedure'],
    evidenceFocus: [
      'pain aggravated by extension or rotation',
      'absence of untreated radiculopathy',
      'diagnostic block response expectations',
    ],
    checklistFocus: ['mechanical pain description', 'radiculopathy exclusion', 'block response history', 'prior conservative care'],
    commonEvidencePhrases: [
      'pain aggravated by extension, rotation, or lateral bending',
      'absence of untreated radiculopathy',
      '80 percent relief for the expected duration of local anesthetic',
    ],
    commonMissingEvidenceReasons: [
      'absence of 80 percent relief from the first diagnostic block',
      'treated as therapeutic rather than diagnostic',
      'radiofrequency ablation not considered where appropriate',
      'performing more than two levels per session',
    ],
    typicalSupportingDocuments: [
      'pain-provocation examination with extension or rotation',
      'diagnostic block response documentation',
      'conservative treatment history',
      'pain duration and axial pain localization notes',
    ],
    policySearchKeywords: ['Facet syndrome', 'Medial branch block', 'Axial spine pain', 'Facet loading', 'Zygapophyseal joint'],
    routeSearchKeywords: ['Cohere Health', 'Availity Essentials', 'EviCore Portal', 'GuidingCare Authorization'],
    cptCodes: ['64490', '64493'],
    routeTitle: 'Portal-ready facet injection submission',
  },
  {
    key: 'radiofrequency_ablation',
    label: 'Radiofrequency ablation starter',
    matchers: [/radiofrequency/i, /ablation/i, /rfa/i, /64633/, /64635/],
    commonProcedureNames: [
      'Radiofrequency ablation',
      'Facet denervation',
      'Medial branch neurotomy',
      'Facet RFA',
    ],
    payerTerminologyVariants: ['RFA', 'radiofrequency denervation', 'facet ablation', 'medial branch neurotomy'],
    evidenceFocus: [
      'successful diagnostic block response',
      'facet-mediated pain pattern',
      'failed conservative management',
    ],
    checklistFocus: ['diagnostic block relief', 'pain pattern documentation', 'therapy history', 'prior injections'],
    commonEvidencePhrases: [
      'two successful diagnostic medial branch blocks',
      'greater than 80 percent reduction in pain from blocks',
      'at least 50 percent pain relief for 6 months for repeat ablation',
      'absence of untreated radiculopathy',
      'denervation duration 40 seconds at 60 to 80 degrees',
    ],
    commonMissingEvidenceReasons: [
      'failure to document 80 percent relief from 2 blocks',
      'repeat procedure in less than 6 months',
      'unproven pulsed radiofrequency used',
      'lack of functional improvement documentation',
    ],
    typicalSupportingDocuments: [
      'documentation of two diagnostic medial branch blocks',
      'pain relief duration from prior blocks',
      'functional improvement documentation',
      'absence of untreated radiculopathy in clinical notes',
    ],
    policySearchKeywords: ['radiofrequency ablation policy', 'medial branch block relief RFA', 'facet denervation policy'],
    routeSearchKeywords: ['Cohere Health', 'Availity Essentials', 'EviCore Portal', 'Carelon Interventional Pain'],
    cptCodes: ['64633', '64635'],
    routeTitle: 'Portal-ready radiofrequency ablation submission',
  },
  {
    key: 'total_knee_arthroplasty',
    label: 'Total knee arthroplasty starter',
    matchers: [/total knee/i, /knee replacement/i, /arthroplasty/i, /27447/],
    commonProcedureNames: ['Total knee arthroplasty', 'Total knee replacement', 'Primary TKA'],
    payerTerminologyVariants: ['TKA', 'total knee replacement', 'knee arthroplasty'],
    evidenceFocus: [
      'function-limiting pain',
      'advanced radiographic degeneration',
      'failed provider-directed non-surgical management',
    ],
    checklistFocus: ['radiology report', 'walking tolerance', 'failed therapy and medication history', 'surgeon plan'],
    commonEvidencePhrases: [
      'Kellgren-Lawrence grade IV radiographic findings',
      'Outerbridge grade IV findings',
      'walking less than one quarter mile for at least 3 months',
      'failure of 3 months of conservative management',
      'loss of function interfering with activities of daily living',
    ],
    commonMissingEvidenceReasons: [
      'lack of advanced radiographic evidence',
      'insufficient duration of non-operative management',
      'active local or systemic infection',
      'severe weakness of quadriceps muscles',
    ],
    typicalSupportingDocuments: [
      'radiology report with Kellgren-Lawrence or equivalent severity',
      'walking tolerance and ADL limitation documentation',
      'failed physical therapy, injections, and medication history',
      'surgeon operative plan or consultation',
    ],
    policySearchKeywords: ['Osteoarthritis', 'Kellgren-Lawrence', 'Joint space narrowing', 'Avascular necrosis', 'Medical optimization'],
    routeSearchKeywords: ['Cohere Health Portal', 'Availity Essentials', 'Carelon Clinical Appropriateness Guidelines', 'EviCore Healthcare'],
    cptCodes: ['27447'],
    routeTitle: 'Portal-ready total knee arthroplasty submission',
  },
  {
    key: 'total_hip_arthroplasty',
    label: 'Total hip arthroplasty starter',
    matchers: [/total hip/i, /hip replacement/i, /arthroplasty/i, /27130/],
    commonProcedureNames: ['Total hip arthroplasty', 'Total hip replacement', 'Primary THA'],
    payerTerminologyVariants: ['THA', 'total hip replacement', 'hip arthroplasty'],
    evidenceFocus: [
      'advanced degenerative disease',
      'function-limiting pain',
      'failed provider-directed non-surgical management',
    ],
    checklistFocus: ['radiology report', 'gait or ambulation limits', 'failed conservative care', 'surgeon plan'],
    commonEvidencePhrases: [
      'advanced degenerative changes on imaging',
      'function-limiting hip pain',
      'failure of provider-directed non-surgical management',
    ],
    commonMissingEvidenceReasons: [
      'radiographic severity missing',
      'functional impairment insufficiently described',
      'conservative care history incomplete',
    ],
    typicalSupportingDocuments: [
      'hip radiology report',
      'gait or ambulation limitation documentation',
      'failed conservative care history',
      'orthopedic surgical consultation',
    ],
    policySearchKeywords: ['total hip arthroplasty policy', 'hip replacement conservative treatment radiographic changes'],
    routeSearchKeywords: ['Cohere Health Portal', 'Availity Essentials', 'Carelon Clinical Appropriateness Guidelines', 'EviCore Healthcare'],
    cptCodes: ['27130'],
    routeTitle: 'Portal-ready total hip arthroplasty submission',
  },
  {
    key: 'general_imaging',
    label: 'General imaging starter',
    matchers: [/mri/i, /ct/i, /pet/i, /imaging/i],
    commonProcedureNames: ['Diagnostic imaging', 'Advanced imaging', 'MRI or CT imaging'],
    payerTerminologyVariants: ['advanced imaging', 'diagnostic imaging', 'radiology services'],
    evidenceFocus: ['clinical indication', 'prior conservative management', 'duration or severity', 'supporting exam or imaging'],
    checklistFocus: ['clinical notes', 'prior treatment', 'exam findings', 'available imaging'],
    commonEvidencePhrases: ['medical necessity criteria', 'failed conservative management', 'supporting exam findings'],
    commonMissingEvidenceReasons: ['indication too vague', 'supporting exam absent', 'prior treatment history missing'],
    typicalSupportingDocuments: ['clinical notes', 'prior treatment history', 'exam findings', 'available imaging'],
    policySearchKeywords: ['medical policy imaging prior authorization'],
    routeSearchKeywords: ['imaging prior authorization provider portal'],
    cptCodes: [],
    routeTitle: 'Portal-ready imaging submission',
  },
];

const STATE_NAME_LOOKUP = {
  AZ: 'Arizona',
  CA: 'California',
  FL: 'Florida',
  IL: 'Illinois',
  KY: 'Kentucky',
  NM: 'New Mexico',
  OH: 'Ohio',
  TX: 'Texas',
  VA: 'Virginia',
  WA: 'Washington',
};

const LINE_OF_BUSINESS_LABELS = {
  commercial: 'Commercial',
  marketplace: 'Marketplace',
  medicare_advantage: 'Medicare Advantage',
  medicaid: 'Medicaid',
};

const DELEGATED_VENDOR_PROFILES = {
  carelon: {
    key: 'carelon',
    vendorName: 'Carelon',
    portalName: 'Carelon ProviderPortal',
    portalUrl: 'https://www.providerportal.com',
    discoveryUrl: 'https://www.carelon.com/providers',
  },
  evicore: {
    key: 'evicore',
    vendorName: 'eviCore',
    portalName: "eviCore Providers' Hub",
    portalUrl: 'https://www.evicore.com/provider',
    discoveryUrl: 'https://www.evicore.com/provider',
  },
  cohere: {
    key: 'cohere',
    vendorName: 'Cohere Health',
    portalName: 'Cohere Health Provider Hub',
    portalUrl: 'https://www.coherehealth.com/providers',
    discoveryUrl: 'https://www.coherehealth.com/providers',
  },
  evolent: {
    key: 'evolent',
    vendorName: 'Evolent / RadMD',
    portalName: 'Evolent RadMD',
    portalUrl: 'https://www1.radmd.com/',
    discoveryUrl: 'https://www1.radmd.com/',
  },
  turningpoint: {
    key: 'turningpoint',
    vendorName: 'TurningPoint Healthcare',
    portalName: 'TurningPoint Provider Portal',
    portalUrl: 'https://myturningpoint-healthcare.com/',
    discoveryUrl: 'https://myturningpoint-healthcare.com/',
  },
};

const ADVANCED_IMAGING_TEMPLATE_KEYS = new Set(['lumbar_mri', 'cervical_mri', 'knee_mri', 'shoulder_mri', 'ct_spine']);
const JOINT_SURGERY_TEMPLATE_KEYS = new Set(['total_knee_arthroplasty', 'total_hip_arthroplasty']);
const INTERVENTIONAL_PAIN_TEMPLATE_KEYS = new Set(['epidural_steroid_injection', 'facet_injection', 'radiofrequency_ablation']);

function normalizeStateCode(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const upper = raw.toUpperCase();
  if (STATE_NAME_LOOKUP[upper]) {
    return upper;
  }

  const normalized = normalize(raw);
  const match = Object.entries(STATE_NAME_LOOKUP).find(([, name]) => normalize(name) === normalized);
  return match ? match[0] : upper.slice(0, 2);
}

function formatStateLabel(stateCode) {
  return STATE_NAME_LOOKUP[stateCode] || stateCode || '';
}

function normalizeLineOfBusiness(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return '';
  }
  if (normalized.includes('marketplace') || normalized.includes('exchange')) {
    return 'marketplace';
  }
  if (normalized.includes('medicaid') || normalized.includes('chip')) {
    return 'medicaid';
  }
  if (normalized.includes('medicare') || normalized.includes('dual') || normalized === 'ma') {
    return 'medicare_advantage';
  }
  if (
    normalized.includes('commercial') ||
    normalized.includes('ppo') ||
    normalized.includes('hmo') ||
    normalized.includes('employer')
  ) {
    return 'commercial';
  }
  return '';
}

function inferLineOfBusiness(intake, payer) {
  const explicit = normalizeLineOfBusiness(intake?.lineOfBusiness);
  if (explicit) {
    return { key: explicit, inferred: false };
  }

  const normalizedPayer = normalize(intake?.payerName);
  if (normalizedPayer.includes('wellcare') || normalizedPayer.includes('medicare') || normalizedPayer.includes('dual complete')) {
    return { key: 'medicare_advantage', inferred: true };
  }
  if (
    normalizedPayer.includes('medicaid') ||
    normalizedPayer.includes('community plan') ||
    normalizedPayer.includes('better health') ||
    normalizedPayer.includes('superior healthplan')
  ) {
    return { key: 'medicaid', inferred: true };
  }
  if (normalizedPayer.includes('ambetter') || normalizedPayer.includes('marketplace')) {
    return { key: 'marketplace', inferred: true };
  }
  if (payer?.payerType === 'Government' && payer?.key === 'medicaid') {
    return { key: 'medicaid', inferred: true };
  }
  if (payer?.payerType === 'Government' && payer?.key === 'medicare') {
    return { key: 'medicare_advantage', inferred: true };
  }
  return { key: '', inferred: false };
}

function buildRoutingContext(intake, payer) {
  const lineOfBusiness = inferLineOfBusiness(intake, payer);
  const stateCode = normalizeStateCode(intake?.memberState);
  const stateLabel = formatStateLabel(stateCode);

  return {
    lineOfBusinessKey: lineOfBusiness.key,
    lineOfBusinessLabel: LINE_OF_BUSINESS_LABELS[lineOfBusiness.key] || '',
    inferredLineOfBusiness: lineOfBusiness.inferred,
    memberStateCode: stateCode,
    memberStateLabel: stateLabel,
    contextLabel: [stateLabel || stateCode, LINE_OF_BUSINESS_LABELS[lineOfBusiness.key] || ''].filter(Boolean).join(' '),
  };
}

function classifyProcedureTemplate(template) {
  const key = template?.key || '';
  return {
    advancedImaging: ADVANCED_IMAGING_TEMPLATE_KEYS.has(key),
    jointSurgery: JOINT_SURGERY_TEMPLATE_KEYS.has(key),
    interventionalPain: INTERVENTIONAL_PAIN_TEMPLATE_KEYS.has(key),
  };
}

function buildVendorFirstHint(vendorProfile, note, routeKeywords = [], confidence = 'high') {
  return {
    mode: 'vendor_first',
    confidence,
    vendorKey: vendorProfile.key,
    vendorName: vendorProfile.vendorName,
    portalNameOverride: vendorProfile.portalName,
    portalUrlOverride: vendorProfile.portalUrl,
    contactUrlOverride: vendorProfile.discoveryUrl,
    bestSeedUrl: vendorProfile.discoveryUrl,
    note,
    routeKeywords,
  };
}

function buildPlanLookupHint(vendorNames, note, routeKeywords = [], confidence = 'medium') {
  return {
    mode: 'plan_lookup_then_vendor',
    confidence,
    vendorKey: '',
    vendorName: vendorNames,
    portalNameOverride: '',
    portalUrlOverride: '',
    contactUrlOverride: '',
    bestSeedUrl: '',
    note,
    routeKeywords,
  };
}

function buildStateSpecificPlanHint(note, routeKeywords = [], confidence = 'medium', overrides = {}) {
  return {
    mode: 'state_specific_plan',
    confidence,
    vendorKey: '',
    vendorName: '',
    portalNameOverride: overrides.portalNameOverride || '',
    portalUrlOverride: overrides.portalUrlOverride || '',
    contactUrlOverride: overrides.contactUrlOverride || '',
    bestSeedUrl: overrides.bestSeedUrl || '',
    note,
    routeKeywords,
  };
}

function activeLineOfBusinessNote(payer, context) {
  if (!payer?.lineOfBusinessNotes || !context?.lineOfBusinessKey) {
    return '';
  }

  if (context.lineOfBusinessKey === 'marketplace') {
    return payer.lineOfBusinessNotes.commercial || '';
  }

  if (context.lineOfBusinessKey === 'medicare_advantage') {
    return payer.lineOfBusinessNotes.medicareAdvantage || '';
  }

  if (context.lineOfBusinessKey === 'medicaid') {
    return payer.lineOfBusinessNotes.medicaid || '';
  }

  return payer.lineOfBusinessNotes.commercial || '';
}

function buildPrecisionWarning(payer, context) {
  if (!payer) {
    return '';
  }

  if (payer.key === 'centene-ambetter' && !context.lineOfBusinessKey) {
    return 'Add line of business to distinguish Ambetter Marketplace, Wellcare Medicare Advantage, and Medicaid plan routing.';
  }

  if (['centene-ambetter', 'molina', 'medicaid', 'highmark', 'bcbs-federation'].includes(payer.key) && context.lineOfBusinessKey === 'medicaid' && !context.memberStateCode) {
    return 'Add member state to avoid wrong Medicaid routing for this payer.';
  }

  if (payer.key === 'medicaid' && !context.memberStateCode) {
    return 'Generic Medicaid routing is not reliable without the member state or managed-care plan.';
  }

  return '';
}

function buildDelegatedRouteHint(payer, template, intake) {
  if (!payer || !template) {
    return null;
  }

  const procedure = classifyProcedureTemplate(template);
  const isSpecialtyManaged = procedure.advancedImaging || procedure.interventionalPain || procedure.jointSurgery;
  const context = buildRoutingContext(intake, payer);
  const stateLabel = context.memberStateLabel || context.memberStateCode || 'the member state';
  const normalizedPayer = normalize(intake?.payerName);

  if (!isSpecialtyManaged) {
    if (['medicaid', 'molina'].includes(payer.key) && context.lineOfBusinessKey === 'medicaid') {
      return buildStateSpecificPlanHint(
        `${payer.displayName} Medicaid routing is state-specific. Confirm the ${stateLabel} managed-care plan and authorization matrix before portal work.`,
        ['state Medicaid prior authorization', `${stateLabel} ${payer.displayName} authorization matrix`],
        context.memberStateCode ? 'medium' : 'low',
      );
    }
    return null;
  }

  if (['anthem-elevance', 'florida-blue', 'blue-shield-california'].includes(payer.key)) {
    return buildVendorFirstHint(
      DELEGATED_VENDOR_PROFILES.carelon,
      `${payer.displayName} commonly routes imaging, interventional pain, and joint procedures through Carelon-managed specialty review.`,
      ['Carelon ProviderPortal', 'Carelon prior authorization', 'specialty care provider portal'],
    );
  }

  if (payer.key === 'cigna' && procedure.advancedImaging) {
    return buildVendorFirstHint(
      DELEGATED_VENDOR_PROFILES.evicore,
      'Cigna commonly delegates advanced imaging and musculoskeletal imaging reviews to eviCore.',
      ['eviCore Providers Hub', 'eviCore radiology', 'Cigna delegated vendor'],
    );
  }

  if (payer.key === 'humana' && (procedure.advancedImaging || procedure.jointSurgery)) {
    return buildVendorFirstHint(
      DELEGATED_VENDOR_PROFILES.cohere,
      'Humana often routes imaging and musculoskeletal utilization management through Cohere Health for these procedures.',
      ['Cohere Health', 'Humana delegated prior auth', 'musculoskeletal review vendor'],
    );
  }

  if (['bcbsil', 'bcbstx'].includes(payer.key)) {
    return buildPlanLookupHint(
      'Carelon or eviCore',
      `${payer.displayName} often starts in BlueApprovR or Availity, then pivots to Carelon or eviCore for specialty utilization management.`,
      ['BlueApprovR', 'Availity authorizations', 'Carelon', 'eviCore'],
    );
  }

  if (payer.key === 'bcbs-federation') {
    return buildPlanLookupHint(
      'Carelon or eviCore',
      'Generic BCBS plans are too fragmented to assume one vendor. Start with the regional BCBS portal, then confirm whether Carelon or eviCore manages the specialty workflow.',
      ['regional BCBS prior auth', 'Carelon', 'eviCore', 'plan-specific BCBS portal'],
      'low',
    );
  }

  if (payer.key === 'highmark') {
    return buildPlanLookupHint(
      'regional specialty vendor',
      'Highmark often requires regional portal checks before the delegated specialty vendor becomes clear.',
      ['NaviNet authorizations', 'Highmark authorization', 'regional specialty review'],
    );
  }

  if (payer.key === 'centene-ambetter') {
    if (context.lineOfBusinessKey === 'marketplace' || normalizedPayer.includes('ambetter')) {
      if (context.memberStateCode === 'TX') {
        if (procedure.advancedImaging || procedure.interventionalPain) {
          return buildVendorFirstHint(
            DELEGATED_VENDOR_PROFILES.evolent,
            'Ambetter from Superior HealthPlan in Texas routes high-tech imaging and interventional pain requests through RadMD / Evolent.',
            ['RadMD.com', 'Ambetter Texas imaging authorization', 'Superior HealthPlan prior authorization'],
            'high',
          );
        }

        if (procedure.jointSurgery) {
          return buildVendorFirstHint(
            DELEGATED_VENDOR_PROFILES.turningpoint,
            'Ambetter from Superior HealthPlan in Texas routes musculoskeletal surgical procedures through TurningPoint Healthcare.',
            ['TurningPoint Healthcare', 'myturningpoint-healthcare.com', 'Ambetter Texas musculoskeletal surgery'],
            'high',
          );
        }
      }

      if (context.memberStateCode === 'FL') {
        return buildStateSpecificPlanHint(
          'Ambetter from Sunshine Health in Florida uses a plan-specific provider toolkit, pre-auth check, and secure provider portal before any delegated specialty routing is assumed.',
          ['Ambetter Sunshine Health provider portal', 'Pre-Auth Check', 'Florida marketplace authorization'],
          'high',
          {
            portalNameOverride: 'Ambetter Sunshine Health Provider Portal',
            portalUrlOverride: 'https://ambetter.sunshinehealth.com/',
            contactUrlOverride: 'https://www.ambetterhealth.com/en/fl/providers/',
            bestSeedUrl: 'https://www.ambetterhealth.com/en/fl/providers/',
          },
        );
      }

      if (procedure.advancedImaging) {
        return buildVendorFirstHint(
          DELEGATED_VENDOR_PROFILES.evolent,
          `Ambetter marketplace routing commonly uses Evolent / RadMD for advanced imaging, but confirm the ${stateLabel} plan-specific workflow before submitting.`,
          ['Evolent RadMD', 'Ambetter imaging authorization', 'RadMD provider portal'],
          context.memberStateCode ? 'medium' : 'low',
        );
      }

      return buildPlanLookupHint(
        'Evolent or plan-specific specialty vendor',
        `Ambetter marketplace workflows remain state-specific. Start with the ${stateLabel} Ambetter provider route, then confirm whether Evolent or another specialty vendor handles this procedure.`,
        ['Ambetter provider portal', 'state plan authorization lookup', 'Evolent', 'specialty vendor'],
        context.memberStateCode ? 'medium' : 'low',
      );
    }

    if (context.lineOfBusinessKey === 'medicare_advantage' || normalizedPayer.includes('wellcare')) {
      if (context.memberStateCode === 'FL') {
        return buildStateSpecificPlanHint(
          'Wellcare Florida Medicare uses an authorization lookup plus secure provider portal as the preferred starting point before escalating to phone or fax.',
          ['Wellcare Florida authorization lookup', 'Wellcare secure provider portal', 'Florida Medicare prior authorization'],
          'high',
          {
            portalNameOverride: 'Wellcare Secure Provider Portal',
            portalUrlOverride: 'https://www.wellcare.com/florida/providers/medicare',
            contactUrlOverride: 'https://www.wellcare.com/florida/providers/authorization-lookup',
            bestSeedUrl: 'https://www.wellcare.com/florida/providers/authorization-lookup',
          },
        );
      }

      if (context.memberStateCode === 'TX') {
        return buildStateSpecificPlanHint(
          'Wellcare Texas Medicare uses its own authorization lookup and secure provider portal. Start there before assuming a delegated specialty vendor.',
          ['Wellcare authorization lookup', 'Wellcare secure provider portal', 'Texas Medicare prior authorization'],
          'high',
          {
            portalNameOverride: 'Wellcare Secure Provider Portal',
            portalUrlOverride: 'https://www.wellcare.com/texas/providers/medicare',
            contactUrlOverride: 'https://www.wellcare.com/texas/providers/authorization-lookup',
            bestSeedUrl: 'https://www.wellcare.com/texas/providers/authorization-lookup',
          },
        );
      }

      return buildStateSpecificPlanHint(
        `Wellcare / Centene Medicare Advantage routing is brand- and state-specific. Start in the plan portal for ${stateLabel} before assuming a delegated vendor for this procedure.`,
        ['Wellcare provider portal', 'Centene Medicare authorization', `${stateLabel} Medicare Advantage prior auth`],
        context.memberStateCode ? 'medium' : 'low',
      );
    }

    if (context.lineOfBusinessKey === 'medicaid' || normalizedPayer.includes('superior healthplan')) {
      if (context.memberStateCode === 'TX' && (procedure.advancedImaging || procedure.interventionalPain || procedure.jointSurgery)) {
        return buildVendorFirstHint(
          DELEGATED_VENDOR_PROFILES.evolent,
          'Superior HealthPlan Texas routes diagnostic imaging, interventional pain, and musculoskeletal surgical procedures through RadMD / Evolent.',
          ['RadMD.com', 'Superior HealthPlan prior authorization', 'Evolent Specialty Services'],
          'high',
        );
      }

      return buildStateSpecificPlanHint(
        `Centene Medicaid routing is state-specific. Confirm the managed-care plan for ${stateLabel} first; some specialty services can still pivot to vendors like TurningPoint or Evolent depending on the procedure class.`,
        ['state Medicaid plan portal', 'Superior HealthPlan prior authorization', 'TurningPoint', 'Evolent'],
        context.memberStateCode ? 'medium' : 'low',
        context.memberStateCode === 'TX'
          ? {
              portalNameOverride: 'Superior Secure Provider Portal',
              portalUrlOverride: 'https://provider.superiorhealthplan.com/',
              contactUrlOverride: 'https://www.superiorhealthplan.com/providers/preauth-check.html',
              bestSeedUrl: 'https://www.superiorhealthplan.com/providers/preauth-check.html',
            }
          : {},
      );
    }

    return buildPlanLookupHint(
      'brand-specific specialty vendor',
      'Centene is fragmented across Ambetter, Wellcare, and Medicaid plans. Add line of business and member state to improve routing precision before submitting.',
      ['Ambetter', 'Wellcare', 'state Medicaid plan', 'specialty vendor'],
      'low',
    );
  }

  if (payer.key === 'molina') {
    if (context.lineOfBusinessKey === 'medicaid') {
      return buildStateSpecificPlanHint(
        `Molina Medicaid routing is state-specific even though the digital path is more consolidated. Confirm the ${stateLabel} authorization matrix in Availity before portal work.`,
        ['Molina Medicaid prior authorization', 'Availity Molina', `${stateLabel} Molina authorization`],
        context.memberStateCode ? 'medium' : 'low',
        context.memberStateCode === 'VA'
          ? {
              contactUrlOverride: 'https://www.molinahealthcare.com/providers/va/medicaid/claims/authorization.aspx',
              bestSeedUrl: 'https://www.molinahealthcare.com/providers/va/medicaid/claims/authorization.aspx',
            }
          : {},
      );
    }

    if (context.lineOfBusinessKey === 'marketplace') {
      return buildStateSpecificPlanHint(
        `Molina marketplace routing is more consolidated, but still validate the ${stateLabel} marketplace rules before submission.`,
        ['Molina marketplace', 'Availity Molina', 'marketplace authorization lookup'],
        context.memberStateCode ? 'medium' : 'low',
      );
    }

    if (context.lineOfBusinessKey === 'medicare_advantage') {
      return buildStateSpecificPlanHint(
        `Molina Medicare and D-SNP workflows can still use plan-specific forms. Confirm the ${stateLabel} Medicare routing path before portal work.`,
        ['Molina Medicare prior authorization', 'Availity Molina', 'D-SNP authorization'],
        context.memberStateCode ? 'medium' : 'low',
      );
    }
  }

  if (payer.key === 'unitedhealthcare' && context.lineOfBusinessKey === 'medicaid') {
    return buildStateSpecificPlanHint(
      `UnitedHealthcare Community Plan routing is state-specific. Confirm the ${stateLabel} Community Plan rules and contact path before submission.`,
      ['UHC Community Plan', `${stateLabel} UHC Medicaid prior auth`, 'Community Plan authorization'],
      context.memberStateCode ? 'medium' : 'low',
      context.memberStateCode === 'TX'
        ? {
            contactUrlOverride:
              'https://www.uhcprovider.com/en/health-plans-by-state/texas-health-plans/tx-comm-plan-home/tx-cp-prior-auth.html',
            bestSeedUrl:
              'https://www.uhcprovider.com/en/health-plans-by-state/texas-health-plans/tx-comm-plan-home/tx-cp-prior-auth.html',
          }
        : context.memberStateCode == 'OH'
          ? {
              contactUrlOverride:
                'https://www.uhcprovider.com/en/health-plans-by-state/ohio-health-plans/oh-comm-plan-home/oh-cp-prior-auth.html',
              bestSeedUrl:
                'https://www.uhcprovider.com/en/health-plans-by-state/ohio-health-plans/oh-comm-plan-home/oh-cp-prior-auth.html',
            }
        : {},
    );
  }

  if (payer.key === 'aetna' && (context.lineOfBusinessKey === 'medicaid' || normalizedPayer.includes('better health'))) {
    return buildStateSpecificPlanHint(
      `Aetna Better Health routing is state-specific. Use the ${stateLabel} Medicaid plan guidance instead of the standard commercial Aetna route.`,
      ['Aetna Better Health prior authorization', `${stateLabel} Aetna Better Health`, 'state Medicaid payer portal'],
      context.memberStateCode ? 'medium' : 'low',
      context.memberStateCode === 'IL'
        ? {
            contactUrlOverride: 'https://www.aetnabetterhealth.com/illinois/providers/prior-auth',
            bestSeedUrl: 'https://www.aetnabetterhealth.com/illinois/providers/prior-auth',
          }
        : {},
    );
  }

  if (payer.key === 'medicaid') {
    return buildStateSpecificPlanHint(
      `Medicaid routing is state-specific. Confirm the managed-care plan and ${stateLabel} authorization rules before opening any portal workflow.`,
      ['state Medicaid prior authorization', 'managed care plan', `${stateLabel} Medicaid provider portal`],
      context.memberStateCode ? 'medium' : 'low',
    );
  }

  return null;
}

function matchPayerProfile(payerName) {
  const normalizedInput = normalize(payerName);
  if (!normalizedInput) {
    return null;
  }

  let bestProfile = null;
  let bestScore = 0;

  for (const payer of PAYER_PROFILES) {
    const score = payer.aliases.reduce((max, alias) => Math.max(max, scoreAliasMatch(normalizedInput, alias)), 0);
    if (score > bestScore) {
      bestProfile = payer;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestProfile : null;
}

function matchProcedureTemplate(procedureLabel, specialty) {
  const haystack = `${procedureLabel || ''} ${specialty || ''}`;

  if (!normalize(haystack)) {
    return null;
  }

  let bestTemplate = null;
  let bestScore = 0;

  for (const template of PROCEDURE_TEMPLATES) {
    const score = template.matchers.reduce((count, matcher) => count + (matcher.test(haystack) ? 1 : 0), 0);
    if (score > bestScore) {
      bestTemplate = template;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestTemplate : null;
}

function buildWorkflowGoals(intake, payer, template, routingHint, context, lineNote, precisionWarning) {
  const payerName = payer?.displayName || intake.payerName?.trim() || 'payer';
  const procedureLabel = intake.procedureLabel?.trim() || 'requested procedure';
  const specialty = intake.specialty?.trim() || 'specialty care';
  const contextText = context?.contextLabel ? ` for ${context.contextLabel}` : '';
  const focusText = template?.evidenceFocus?.join(', ') || 'medical necessity criteria and required documentation';
  const phraseText = template?.commonEvidencePhrases?.slice(0, 2).join('; ') || '';
  const terminologyText = template?.payerTerminologyVariants?.slice(0, 3).join(', ') || '';
  const documentText = template?.typicalSupportingDocuments?.slice(0, 3).join(', ') || '';
  const routeKeywords = [...new Set([...(template?.routeSearchKeywords || []), ...(routingHint?.routeKeywords || [])])];
  const routeKeywordText = routeKeywords.slice(0, 4).join(', ') || '';
  const routingText =
    routingHint?.vendorName && routingHint?.note
      ? ` Routing hint: this workflow may route through ${routingHint.vendorName}. ${routingHint.note}`
      : routingHint?.note
        ? ` Routing hint: ${routingHint.note}`
        : '';
  const lineText = lineNote ? ` Active line-of-business context: ${lineNote}` : '';
  const precisionText = precisionWarning ? ` Precision warning: ${precisionWarning}` : '';

  return {
    workflowName: `${payerName} ${procedureLabel} readiness check`,
    workflowGoal:
      `Read this ${payerName} policy page for ${procedureLabel} in ${specialty}${contextText}. ` +
      `Return compact JSON with keys: policy_name, evidence_requirements, page_url. ` +
      `Highlight payer-facing evidence expectations around ${focusText}.` +
      (phraseText ? ` Favor wording similar to: ${phraseText}.` : '') +
      (terminologyText ? ` Watch for terminology variants such as ${terminologyText}.` : '') +
      (documentText ? ` Supporting documentation often includes ${documentText}.` : '') +
      lineText +
      precisionText,
    contactWorkflowName: `${payerName} prior authorization route lookup`,
    contactWorkflowGoal:
      `For providers seeking prior authorization help for ${procedureLabel} in ${specialty}${contextText}, ` +
      'return compact JSON with keys: provider_precert_phone, provider_precert_notes, source_page_url. ' +
      'Prefer the exact provider submission route, delegated vendor, portal hint, or phone fallback when available.' +
      lineText +
      precisionText +
      routingText +
      (routeKeywordText ? ` Useful route keywords include ${routeKeywordText}.` : ''),
  };
}

export function getPayerProcedureSuggestion(intake) {
  const payer = matchPayerProfile(intake.payerName);
  const template = matchProcedureTemplate(intake.procedureLabel, intake.specialty);

  if (!payer && !template) {
    return null;
  }

  const context = buildRoutingContext(intake, payer);
  const routingStrategy = buildDelegatedRouteHint(payer, template, intake);
  const lineNote = activeLineOfBusinessNote(payer, context);
  const precisionWarning = buildPrecisionWarning(payer, context);
  const generated = buildWorkflowGoals(intake, payer, template, routingStrategy, context, lineNote, precisionWarning);
  const confidence = [payer, template].filter(Boolean).length === 2 ? 'high' : 'medium';
  const routeSearchKeywords = [...new Set([...(template?.routeSearchKeywords || []), ...(routingStrategy?.routeKeywords || [])])];
  const suggestionSummary =
    payer && template
      ? routingStrategy?.vendorName
        ? `${payer.displayName} matched with the ${template.label.toLowerCase()} template and a ${routingStrategy.vendorName} routing hint.`
        : `${payer.displayName} matched with the ${template.label.toLowerCase()} template.`
      : payer
        ? `${payer.displayName} matched from the expanded payer intelligence directory.`
        : `${template.label} matched from the requested procedure.`;

  return {
    payer,
    template,
    confidence,
    suggestionSummary,
    suggestedPolicyUrl: payer?.policyUrl || '',
    suggestedContactUrl: routingStrategy?.contactUrlOverride || payer?.contactUrl || '',
    suggestedPortalName: routingStrategy?.portalNameOverride || payer?.portalName || '',
    suggestedPortalUrl: routingStrategy?.portalUrlOverride || payer?.portalUrl || '',
    phoneFallback: payer?.phoneFallback || '',
    payerType: payer?.payerType || '',
    country: payer?.country || '',
    supportedLines: payer?.supportedLines || [],
    nationalScope: payer?.nationalScope || '',
    directoryNotes: payer?.directoryNotes || '',
    lineOfBusinessNotes: payer?.lineOfBusinessNotes || null,
    selectedLineOfBusiness: context.lineOfBusinessLabel,
    selectedLineOfBusinessKey: context.lineOfBusinessKey,
    selectedState: context.memberStateLabel || context.memberStateCode,
    activeLineOfBusinessNote: lineNote,
    contextPrecisionWarning: precisionWarning,
    bestSeedUrl: routingStrategy?.bestSeedUrl || payer?.bestSeedUrl || payer?.policyUrl || payer?.contactUrl || '',
    routeNote: [routingStrategy?.note, lineNote, precisionWarning, payer?.routeNote].filter(Boolean).join(' '),
    sourceNote: payer?.sourceNote || '',
    generatedConfig: generated,
    routingStrategy,
    checklistFocus: template?.checklistFocus || [],
    evidencePatterns: template?.commonEvidencePhrases || [],
    missingEvidencePatterns: template?.commonMissingEvidenceReasons || [],
    commonProcedureNames: template?.commonProcedureNames || [],
    payerTerminologyVariants: template?.payerTerminologyVariants || [],
    typicalSupportingDocuments: template?.typicalSupportingDocuments || [],
    policySearchKeywords: template?.policySearchKeywords || [],
    routeSearchKeywords,
    cptCodes: template?.cptCodes || [],
    routeTitle: template?.routeTitle || 'Portal-ready prior authorization handoff',
  };
}
