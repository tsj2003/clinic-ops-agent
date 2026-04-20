export default function GuidedIntakePanel({
  intake,
  error,
  onChange,
  onGenerateDraft,
  intelligenceSuggestion,
  executionPlan,
  sourceDiscovery,
  onDiscoverLiveSources,
  onApplySuggestedUrls,
  onApplyPilotTemplate,
  onApplyStarterTemplate,
  advancedOpen,
  onToggleAdvanced,
  onExportCaseBundle,
  onImportCaseBundle,
  onImportBatchIntake,
}) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Guided Intake</p>
          <p className="mt-1 text-sm text-slate-300">
            Enter the payer, procedure, chart summary, and source URLs. We will generate the TinyFish workflow draft from this.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onApplyPilotTemplate ? (
            <>
              <button
                className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-100"
                onClick={() => onApplyPilotTemplate('spine_mri_commercial')}
                type="button"
              >
                Pilot template: Spine MRI
              </button>
              <button
                className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-100"
                onClick={() => onApplyPilotTemplate('pain_management_repeat_denial')}
                type="button"
              >
                Pilot template: Pain denial
              </button>
            </>
          ) : null}
          <button
            className="premium-button premium-button-primary rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-50"
            onClick={onGenerateDraft}
            type="button"
          >
            Generate draft
          </button>
          {intelligenceSuggestion ? (
            <button
              className="premium-button premium-button-success rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-50"
              onClick={onApplyStarterTemplate}
              type="button"
            >
              Use starter template
            </button>
          ) : null}
          <button
            className="premium-button rounded-lg border-violet-400/30 px-3 py-1.5 text-xs font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onDiscoverLiveSources}
            disabled={sourceDiscovery?.status === 'loading'}
            type="button"
          >
            {sourceDiscovery?.status === 'loading' ? 'Discovering...' : 'Discover live sources'}
          </button>
          <button
            className="premium-button premium-button-success rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-50"
            onClick={onExportCaseBundle}
            type="button"
          >
            Export case bundle
          </button>
          <button
            className="premium-button premium-button-warm rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-50"
            onClick={onImportCaseBundle}
            type="button"
          >
            Import case bundle
          </button>
          <button
            className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
            onClick={onImportBatchIntake}
            type="button"
          >
            Import intake CSV/JSON
          </button>
          <button
            className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
            onClick={onToggleAdvanced}
            type="button"
          >
            {advancedOpen ? 'Hide advanced' : 'Show advanced'}
          </button>
        </div>
      </div>

      {error ? <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 shadow-[0_10px_24px_rgba(127,29,29,0.18)]">{error}</p> : null}

      {intelligenceSuggestion ? (
        <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-[0_18px_40px_rgba(16,185,129,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
                  Payer intelligence
                </span>
                <span className="premium-chip rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                  {intelligenceSuggestion.confidence} confidence
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-white">{intelligenceSuggestion.suggestionSummary}</p>
              <p className="mt-1 text-xs text-emerald-100">{intelligenceSuggestion.sourceNote}</p>
            </div>
            <button
              className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
              onClick={onApplySuggestedUrls}
              type="button"
            >
              Apply URLs only
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Suggested policy starting point</p>
              <p className="mt-2 break-all text-xs text-cyan-200">{intelligenceSuggestion.suggestedPolicyUrl || 'No payer-specific policy library found yet.'}</p>
            </div>
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Suggested contact route</p>
              <p className="mt-2 break-all text-xs text-cyan-200">{intelligenceSuggestion.suggestedContactUrl || 'No payer-specific route page found yet.'}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Starter template</p>
              <p className="mt-2 text-sm font-medium text-white">
                {intelligenceSuggestion.template?.label || 'General prior auth starter'}
              </p>
              <p className="mt-2 text-xs text-slate-400">{intelligenceSuggestion.routeTitle}</p>
              <p className="mt-2 text-xs text-slate-400">
                Common CPTs: {intelligenceSuggestion.cptCodes?.length ? intelligenceSuggestion.cptCodes.join(', ') : 'Not mapped yet'}
              </p>
            </div>
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Portal route</p>
              <p className="mt-2 text-sm font-medium text-white">
                {intelligenceSuggestion.suggestedPortalName || 'Provider portal not mapped yet'}
              </p>
              <p className="mt-2 break-all text-xs text-cyan-200">
                {intelligenceSuggestion.suggestedPortalUrl || 'No public portal URL stored yet.'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Phone fallback: {intelligenceSuggestion.phoneFallback || 'Not mapped yet'}
              </p>
              {intelligenceSuggestion.routingStrategy ? (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 shadow-[0_10px_24px_rgba(180,83,9,0.08)]">
                  <p className="text-[11px] uppercase tracking-wide text-amber-100">Routing strategy</p>
                  <p className="mt-1 text-xs text-slate-200">
                    Mode:{' '}
                    {intelligenceSuggestion.routingStrategy.mode === 'vendor_first'
                      ? 'Vendor-first'
                      : intelligenceSuggestion.routingStrategy.mode === 'plan_lookup_then_vendor'
                        ? 'Plan lookup, then specialty vendor'
                        : intelligenceSuggestion.routingStrategy.mode === 'state_specific_plan'
                          ? 'State-specific plan route'
                        : intelligenceSuggestion.routingStrategy.mode}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Confidence: {intelligenceSuggestion.routingStrategy.confidence || 'medium'}
                  </p>
                  {intelligenceSuggestion.routingStrategy.vendorName ? (
                    <p className="mt-1 text-xs text-slate-200">
                      Delegated route hint: {intelligenceSuggestion.routingStrategy.vendorName}
                    </p>
                  ) : null}
                  {intelligenceSuggestion.routingStrategy.note ? (
                    <p className="mt-2 text-xs text-amber-100">{intelligenceSuggestion.routingStrategy.note}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {executionPlan ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-400">Authenticated portal target</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {executionPlan.authenticatedPortalTarget?.portalName || 'No authenticated target mapped yet'}
                </p>
                <p className="mt-2 break-all text-xs text-cyan-200">
                  {executionPlan.authenticatedPortalTarget?.portalUrl || 'No public portal URL stored yet.'}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Submission step:{' '}
                  {executionPlan.authenticatedPortalTarget?.likelySubmissionStepName || 'Not mapped yet'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Credentials: {executionPlan.authenticatedPortalTarget?.credentialsNeeded || 'Not mapped yet'}
                </p>
              </div>
              <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-400">Delegated vendor portal</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {executionPlan.vendorPortalTarget?.vendorName || 'No delegated vendor triggered'}
                </p>
                <p className="mt-2 break-all text-xs text-cyan-200">
                  {executionPlan.vendorPortalTarget?.portalUrl || 'No vendor portal selected.'}
                </p>
                <div className="mt-2 space-y-1">
                  {executionPlan.vendorPortalTarget?.commonRequiredFields?.length ? (
                    executionPlan.vendorPortalTarget.commonRequiredFields.slice(0, 4).map((item) => (
                      <p key={item} className="text-xs text-slate-200">
                        - {item}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No vendor-specific required fields mapped yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Workflow focus</p>
              <div className="mt-2 space-y-1">
                {intelligenceSuggestion.checklistFocus?.length ? (
                  intelligenceSuggestion.checklistFocus.map((item) => (
                    <p key={item} className="text-xs text-slate-200">
                      - {item}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">Add payer, procedure, and specialty to unlock sharper setup hints.</p>
                )}
              </div>
            </div>
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Common evidence language</p>
              <div className="mt-2 space-y-1">
                {intelligenceSuggestion.evidencePatterns?.length ? (
                  intelligenceSuggestion.evidencePatterns.slice(0, 3).map((item) => (
                    <p key={item} className="text-xs text-slate-200">
                      - {item}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No policy-language examples stored yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Procedure terminology</p>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Common names</p>
                  {intelligenceSuggestion.commonProcedureNames?.length ? (
                    intelligenceSuggestion.commonProcedureNames.slice(0, 4).map((item) => (
                      <p key={item} className="text-xs text-slate-200">
                        - {item}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No common procedure names stored yet.</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Payer terminology variants</p>
                  {intelligenceSuggestion.payerTerminologyVariants?.length ? (
                    intelligenceSuggestion.payerTerminologyVariants.slice(0, 4).map((item) => (
                      <p key={item} className="text-xs text-slate-200">
                        - {item}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No payer-facing terminology variants stored yet.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Typical supporting docs</p>
              <div className="mt-2 space-y-1">
                {intelligenceSuggestion.typicalSupportingDocuments?.length ? (
                  intelligenceSuggestion.typicalSupportingDocuments.slice(0, 5).map((item) => (
                    <p key={item} className="text-xs text-slate-200">
                      - {item}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No procedure-specific supporting documents stored yet.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Known failure patterns</p>
              <div className="mt-2 space-y-1">
                {intelligenceSuggestion.missingEvidencePatterns?.length ? (
                  intelligenceSuggestion.missingEvidencePatterns.slice(0, 3).map((item) => (
                    <p key={item} className="text-xs text-slate-200">
                      - {item}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No recurring missing-evidence patterns stored yet.</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-400">Scope and line of business</p>
              <p className="mt-2 text-xs text-slate-200">
                {intelligenceSuggestion.nationalScope || 'Scope not mapped yet'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {intelligenceSuggestion.payerType || 'Unknown payer type'} · {intelligenceSuggestion.country || 'Unknown country'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Supported lines: {intelligenceSuggestion.supportedLines?.length ? intelligenceSuggestion.supportedLines.join(', ') : 'Not mapped yet'}
              </p>
              <div className="mt-2 space-y-1">
                {intelligenceSuggestion.lineOfBusinessNotes ? (
                  <>
                    <p className="text-[11px] text-slate-400">Commercial: {intelligenceSuggestion.lineOfBusinessNotes.commercial || 'No note yet'}</p>
                    <p className="text-[11px] text-slate-400">
                      Medicare Advantage: {intelligenceSuggestion.lineOfBusinessNotes.medicareAdvantage || 'No note yet'}
                    </p>
                    <p className="text-[11px] text-slate-400">Medicaid: {intelligenceSuggestion.lineOfBusinessNotes.medicaid || 'No note yet'}</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">No line-of-business notes stored yet.</p>
                )}
              </div>
              {intelligenceSuggestion.selectedLineOfBusiness || intelligenceSuggestion.selectedState ? (
                <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2">
                  <p className="text-[11px] uppercase tracking-wide text-cyan-100">Active context</p>
                  <p className="mt-1 text-xs text-slate-200">
                    {intelligenceSuggestion.selectedState || 'State not set'}
                    {intelligenceSuggestion.selectedLineOfBusiness ? ` · ${intelligenceSuggestion.selectedLineOfBusiness}` : ''}
                  </p>
                  {intelligenceSuggestion.activeLineOfBusinessNote ? (
                    <p className="mt-1 text-xs text-slate-300">{intelligenceSuggestion.activeLineOfBusinessNote}</p>
                  ) : null}
                  {intelligenceSuggestion.contextPrecisionWarning ? (
                    <p className="mt-2 text-xs text-amber-100">{intelligenceSuggestion.contextPrecisionWarning}</p>
                  ) : null}
                </div>
              ) : null}
              {intelligenceSuggestion.directoryNotes ? (
                <p className="mt-2 text-xs text-amber-100">{intelligenceSuggestion.directoryNotes}</p>
              ) : null}
            </div>
          </div>

          {executionPlan ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-400">Downstream system targets</p>
                <div className="mt-2 space-y-2">
                  {executionPlan.downstreamTargets?.length ? (
                    executionPlan.downstreamTargets.map((target) => (
                      <div key={target.key || target.systemName} className="premium-subcard-soft rounded-lg p-2">
                        <p className="text-xs font-semibold text-white">{target.systemName}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{target.likelyPayloadFormat}</p>
                        <p className="mt-1 text-[11px] text-slate-300">{target.importMethod}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No downstream targets selected yet.</p>
                  )}
                </div>
              </div>
              <div className="premium-subcard rounded-xl p-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-400">PHI-safe defaults</p>
                <div className="mt-2 space-y-2">
                  {executionPlan.phiSafeDefaults?.length ? (
                    executionPlan.phiSafeDefaults.slice(0, 4).map((item) => (
                      <div key={item.topic} className="premium-subcard-soft rounded-lg p-2">
                        <p className="text-xs font-semibold text-white">{item.topic}</p>
                        <p className="mt-1 text-[11px] text-slate-300">{item.recommendedDefault}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">No PHI-safe defaults mapped yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {intelligenceSuggestion.routeNote ? (
            <p className="mt-3 text-xs text-slate-300">{intelligenceSuggestion.routeNote}</p>
          ) : null}
        </div>
      ) : null}

      {sourceDiscovery?.status && sourceDiscovery.status !== 'idle' ? (
        <div
          className={`mt-3 rounded-2xl border p-4 ${
            sourceDiscovery.status === 'live'
              ? 'border-cyan-500/30 bg-cyan-500/10'
              : sourceDiscovery.status === 'starter_fallback'
                ? 'border-amber-500/30 bg-amber-500/10'
                : sourceDiscovery.status === 'error'
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-slate-700 bg-slate-950/70'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
              {sourceDiscovery.status === 'live'
                ? 'Live TinyFish discovery'
                : sourceDiscovery.status === 'starter_fallback'
                  ? 'Starter fallback'
                  : sourceDiscovery.status === 'loading'
                    ? 'Discovering'
                    : sourceDiscovery.status}
            </span>
            {sourceDiscovery.result?.discovery?.usedTinyFish ? (
              <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                TinyFish used
              </span>
            ) : null}
          </div>

          <p className="mt-2 text-sm font-semibold text-white">
            {sourceDiscovery.error ||
              sourceDiscovery.result?.discovery?.summary ||
              'Source discovery updates will appear here.'}
          </p>

          {sourceDiscovery.result?.warning ? (
            <p className="mt-1 text-xs text-amber-100">{sourceDiscovery.result.warning}</p>
          ) : null}

          {sourceDiscovery.result?.discovery ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="premium-subcard rounded-xl p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Discovered policy source</p>
                <p className="mt-2 break-all text-xs text-cyan-200">{sourceDiscovery.result.discovery.effectivePolicyUrl || 'Not found yet'}</p>
                {sourceDiscovery.result.discovery.policy?.runId ? (
                  <p className="mt-2 text-[11px] text-slate-400">Run ID: {sourceDiscovery.result.discovery.policy.runId}</p>
                ) : null}
              </div>
              <div className="premium-subcard rounded-xl p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Discovered contact route</p>
                <p className="mt-2 break-all text-xs text-cyan-200">{sourceDiscovery.result.discovery.effectiveContactUrl || 'Not found yet'}</p>
                {sourceDiscovery.result.discovery.contact?.runId ? (
                  <p className="mt-2 text-[11px] text-slate-400">Run ID: {sourceDiscovery.result.discovery.contact.runId}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Payer name</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="Aetna"
            value={intake.payerName}
            onChange={(event) => onChange('payerName', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Line of business</span>
          <select
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            value={intake.lineOfBusiness}
            onChange={(event) => onChange('lineOfBusiness', event.target.value)}
          >
            <option value="">Select line of business</option>
            <option value="Commercial">Commercial</option>
            <option value="Marketplace">Marketplace</option>
            <option value="Medicare Advantage">Medicare Advantage</option>
            <option value="Medicaid">Medicaid</option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Member state</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm uppercase"
            placeholder="TX"
            value={intake.memberState}
            onChange={(event) => onChange('memberState', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Specialty</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="Spine"
            value={intake.specialty}
            onChange={(event) => onChange('specialty', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Procedure</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="MRI Lumbar Spine (CPT 72148)"
            value={intake.procedureLabel}
            onChange={(event) => onChange('procedureLabel', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Diagnosis</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="M54.5 - Low back pain"
            value={intake.diagnosis}
            onChange={(event) => onChange('diagnosis', event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Policy page URL</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="https://payer-site/policy-page"
            value={intake.policyPageUrl}
            onChange={(event) => onChange('policyPageUrl', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Contact page URL</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="https://payer-site/contact-page"
            value={intake.contactPageUrl}
            onChange={(event) => onChange('contactPageUrl', event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Case label</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="CASE-ORTHO-001"
            value={intake.caseLabel}
            onChange={(event) => onChange('caseLabel', event.target.value)}
          />
        </label>
        <label className="premium-label rounded-xl p-3 text-sm text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-400">Evidence files</span>
          <input
            className="premium-input mt-2 rounded-lg px-3 py-2 text-sm"
            placeholder="pt_notes.pdf, lumbar_xray.pdf"
            value={intake.evidenceFiles}
            onChange={(event) => onChange('evidenceFiles', event.target.value)}
          />
        </label>
      </div>

      <label className="premium-label mt-3 block rounded-xl p-3 text-sm text-slate-200">
        <span className="text-xs uppercase tracking-wide text-slate-400">Chart summary</span>
        <textarea
          className="premium-textarea mt-2 min-h-28 rounded-lg px-3 py-2 text-sm"
          placeholder="Patient has 8 weeks of lower back pain radiating to left leg. Completed 6 weeks of physical therapy with minimal improvement. Ibuprofen daily."
          value={intake.chartSummary}
          onChange={(event) => onChange('chartSummary', event.target.value)}
        />
      </label>
    </div>
  );
}
