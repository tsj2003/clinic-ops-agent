import { emitAxiomEvents } from './observability/axiom-monitor.js';

function buildFailure(stage, code, message, retrySuggestion, retryable = true) {
  return {
    stage,
    code,
    message,
    retrySuggestion,
    retryable,
  };
}

export function classifyFailure({ stage = 'run', message = '', workflowKind = '' }) {
  const normalized = String(message || '').toLowerCase();
  const effectiveStage =
    stage === 'run' && workflowKind === 'policy'
      ? 'policy'
      : stage === 'run' && workflowKind === 'contact'
        ? 'contact'
        : stage;

  if (!normalized) {
    return buildFailure(
      effectiveStage,
      'unknown_failure',
      'The run failed without a structured error message.',
      'Retry the run once, then inspect execution logs and TinyFish proof for the failing step.',
    );
  }

  if (normalized.includes('missing live configuration')) {
    return buildFailure(
      'configuration',
      'missing_live_configuration',
      message,
      'Set all required TinyFish workflow fields and API keys before starting a live run.',
      false,
    );
  }

  if (normalized.includes('api key missing') || normalized.includes('missing tinyfish api key')) {
    return buildFailure(
      'configuration',
      'missing_api_key',
      message,
      'Set TINYFISH_API_KEY and restart the service before retrying.',
      false,
    );
  }

  if (normalized.includes('retry budget exhausted') || normalized.includes('failed after') && normalized.includes('attempt')) {
    return buildFailure(
      effectiveStage,
      'retry_exhausted',
      message,
      'Retry with a simpler workflow goal or a stable payer page, then escalate if repeated.',
      false,
    );
  }

  if (normalized.includes('python runner exited with code')) {
    return buildFailure(
      'runner',
      'runner_exit_nonzero',
      message,
      'Inspect backend logs and runner environment, then retry after resolving the runner exit.',
      false,
    );
  }

  if (normalized.includes('stream ended before a terminal complete event') || normalized.includes('runner exited before emitting a terminal result')) {
    return buildFailure(
      'stream',
      'terminal_event_missing',
      message,
      'Retry once. If repeated, inspect stream transport and TinyFish event integrity.',
    );
  }

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return buildFailure(
      effectiveStage,
      'timeout',
      message,
      effectiveStage === 'contact'
        ? 'Retry the contact lookup. If it keeps timing out, simplify the contact goal or verify the payer page is reachable.'
        : 'Retry the run. If it times out again, verify the payer page is reachable and tighten the TinyFish goal.',
    );
  }

  if (normalized.includes('invalid_workflow_url') || normalized.includes('invalid_contact_workflow_url')) {
    return buildFailure(
      'configuration',
      'invalid_workflow_url',
      message,
      'Provide valid http(s) workflow URLs for policy and contact steps.',
      false,
    );
  }

  if (
    normalized.includes('no policy result payload') ||
    normalized.includes('no contact result payload') ||
    normalized.includes('returned no')
  ) {
    return buildFailure(
      effectiveStage,
      'empty_result',
      message,
      effectiveStage === 'contact'
        ? 'Retry the routing step with a clearer provider-contact goal or a more specific payer contact page.'
        : 'Retry the policy extraction with a clearer goal or confirm the page contains the required policy text.',
    );
  }

  if (normalized.includes('cancelled') || normalized.includes('canceled')) {
    return buildFailure(
      effectiveStage,
      'workflow_cancelled',
      message,
      'Retry once. If the workflow cancels again, inspect the TinyFish run ID and contact support with the failing step.',
    );
  }

  if (normalized.includes('interrupted')) {
    return buildFailure(
      'stream',
      'stream_interrupted',
      message,
      'Refresh the page and retry. If the interruption repeats, inspect network stability and server logs.',
    );
  }

  if (effectiveStage === 'contact') {
    return buildFailure(
      'contact',
      'contact_lookup_failure',
      message,
      'Retry the routing step or use a more direct provider contact page for this payer.',
    );
  }

  if (effectiveStage === 'policy') {
    return buildFailure(
      'policy',
      'payer_page_failure',
      message,
      'Retry the policy step or confirm the payer policy page still loads and contains the expected requirements.',
    );
  }

  return buildFailure(
    effectiveStage,
    'system_error',
    message,
    'Retry once. If it fails again, inspect the saved run snapshot and execution logs before escalating.',
  );
}

export async function emitObservabilityEvent(event) {
  return emitAxiomEvents([event]);
}
