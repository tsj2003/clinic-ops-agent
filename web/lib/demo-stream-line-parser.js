import { redactLogPayload } from './privacy.js';

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

export function buildFallbackLogPayload({ text, level = 'info', idPrefix = 'raw', now = nowTime } = {}) {
  return redactLogPayload({
    type: 'log',
    channel: 'execution',
    level,
    id: `${idPrefix}-${Date.now()}`,
    index: 0,
    totalSteps: 0,
    time: now(),
    text,
  });
}

export function parseRunnerLine(line, { appRunId = '', workspaceId = '', workspaceName = '', now = nowTime } = {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.type === 'config') {
      parsed.appRunId = appRunId;
      parsed.workspaceId = workspaceId;
      parsed.workspaceName = workspaceName;
    }

    if (parsed?.type === 'log') {
      return redactLogPayload(parsed);
    }

    return parsed;
  } catch {
    return buildFallbackLogPayload({ text: trimmed, now });
  }
}
