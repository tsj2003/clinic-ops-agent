function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function joinUrl(baseUrl, suffix) {
  const base = clean(baseUrl, 1000).replace(/\/+$/, '');
  const path = clean(suffix, 500).replace(/^\/+/, '');
  if (!base || !path) {
    return '';
  }
  return `${base}/${path}`;
}

async function doPatch({ url, headers, body }) {
  if (!url) {
    return { ok: false, skipped: true, reason: 'Missing endpoint URL.' };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    response: parsed,
    message:
      clean(parsed.message || parsed.error || parsed.detail || '') ||
      (response.ok ? 'EMR task close-loop update completed.' : 'EMR task close-loop update failed.'),
  };
}

export async function closeLoopEmrTask({
  connector = '',
  run = {},
  payerReferenceId = '',
  proof = {},
  emrStatus = '',
  note = '',
} = {}) {
  const packet = asObject(run?.operatorPacket);
  const emrSync = asObject(packet.emr_sync);
  const taskId = clean(emrSync.external_emr_id || packet.external_emr_id || '', 120);

  const normalizedConnector = clean(connector || emrSync.connector || packet.emr_connector_hint, 40).toLowerCase();
  const submittedAt = clean(proof?.capturedAt || new Date().toISOString(), 60);
  const normalizedStatus = clean(emrStatus || 'SUBMITTED_TO_PAYER', 80);
  const normalizedNote = clean(note || '', 500);

  if (!taskId) {
    return {
      ok: false,
      skipped: true,
      reason: 'No external EMR task ID found on packet.',
    };
  }

  if (normalizedConnector === 'athena') {
    const baseUrl = clean(process.env.ATHENAHEALTH_BASE_URL, 1000);
    const token = clean(process.env.ATHENAHEALTH_ACCESS_TOKEN, 5000);
    const pathTemplate = clean(process.env.ATHENAHEALTH_TASK_PATCH_PATH || 'tasks/{taskId}', 200);
    const path = pathTemplate.replace('{taskId}', taskId);

    return doPatch({
      url: joinUrl(baseUrl, path),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: {
        status: normalizedStatus,
        payerReferenceId: clean(payerReferenceId, 120),
        submittedAt,
        proofScreenshotPath: clean(proof?.screenshotPath, 500),
        note: normalizedNote,
      },
    });
  }

  if (normalizedConnector === 'epic') {
    const baseUrl = clean(process.env.EPIC_FHIR_BASE_URL, 1000);
    const token = clean(process.env.EPIC_ACCESS_TOKEN, 5000);
    const endpoint = clean(process.env.EPIC_TASK_PATCH_ENDPOINT || 'Task/$update-status', 300);

    return doPatch({
      url: joinUrl(baseUrl, endpoint),
      headers: {
        'content-type': 'application/fhir+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'taskId', valueString: taskId },
          { name: 'status', valueCode: normalizedStatus },
          { name: 'payerReferenceId', valueString: clean(payerReferenceId, 120) },
          { name: 'submittedAt', valueDateTime: submittedAt },
          { name: 'proofScreenshotPath', valueUrl: clean(proof?.screenshotPath, 500) },
          ...(normalizedNote ? [{ name: 'note', valueString: normalizedNote }] : []),
        ],
      },
    });
  }

  return {
    ok: false,
    skipped: true,
    reason: `Unsupported connector for EMR close-loop: ${normalizedConnector || 'unknown'}`,
  };
}
