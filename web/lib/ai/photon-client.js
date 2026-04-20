const DEFAULT_PHOTON_BASE_URL = 'https://api.photon.ai/v1';
const DEFAULT_PHOTON_MODEL = 'deepseek-r1';

function clean(value, max = 6000) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJson(raw = '') {
  const text = clean(raw, 400_000);
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function dynamicImport(specifier) {
  return new Function('s', 'return import(s)')(specifier);
}

export async function createPhotonClient({ providedClient = null } = {}) {
  if (providedClient) {
    return { ok: true, provider: 'custom', client: providedClient };
  }

  try {
    const sdk = await dynamicImport('photon-sdk');
    const Photon = sdk?.Photon || sdk?.default?.Photon || sdk?.default;
    if (!Photon) {
      throw new Error('Photon SDK export missing.');
    }

    const apiKey = clean(process.env.PHOTON_API_KEY, 5000);
    if (!apiKey) {
      return { ok: false, skipped: true, reason: 'missing_photon_api_key', client: null };
    }

    const client = new Photon({
      apiKey,
      baseUrl: clean(process.env.PHOTON_BASE_URL, 1200) || DEFAULT_PHOTON_BASE_URL,
    });

    return {
      ok: true,
      provider: 'photon-sdk',
      client,
    };
  } catch {
    return { ok: false, skipped: true, reason: 'photon_sdk_unavailable', client: null };
  }
}

export async function runPhotonExecutiveAdjudication({
  prompt = {},
  model = '',
  client = null,
  fetchImpl = fetch,
} = {}) {
  const effectiveModel = clean(model, 160) || clean(process.env.PHOTON_ADJUDICATOR_MODEL, 160) || DEFAULT_PHOTON_MODEL;

  if (client && typeof client?.inference?.chat === 'function') {
    const response = await client.inference.chat({
      model: effectiveModel,
      messages: asObject(prompt).messages,
      response_format: asObject(prompt).response_format,
      temperature: 0,
      max_tokens: 700,
    });

    return {
      ok: true,
      provider: 'photon-sdk',
      model: effectiveModel,
      payload: asObject(response),
    };
  }

  const apiKey = clean(process.env.PHOTON_API_KEY, 5000);
  const baseUrl = clean(process.env.PHOTON_BASE_URL, 1200) || DEFAULT_PHOTON_BASE_URL;
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_photon_api_key',
      model: effectiveModel,
      payload: {},
    };
  }

  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      temperature: 0,
      max_tokens: 700,
      messages: asObject(prompt).messages,
      response_format: asObject(prompt).response_format,
    }),
    cache: 'no-store',
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: clean(payload?.error || payload?.message || `Photon request failed (${response.status}).`, 500),
      model: effectiveModel,
      payload,
    };
  }

  return {
    ok: true,
    provider: 'photon-http',
    model: effectiveModel,
    payload,
  };
}
