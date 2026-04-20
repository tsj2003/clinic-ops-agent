const SUCCESS_STATUSES = new Set(['COMPLETED', 'COMPLETE', 'SUCCEEDED', 'SUCCESS']);

function normalizeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'TinyFish discovery failed.');
}

export async function runTinyFishDiscovery({ seedUrl, goal, apiKey, baseUrl, timeoutMs = 120000 }) {
  if (!seedUrl || !goal || !apiKey || !baseUrl) {
    throw new Error('Missing TinyFish discovery configuration.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/automation/run-sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        url: seedUrl,
        goal,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new Error(normalizeError(error));
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new Error(`TinyFish discovery request failed with status ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let runId = '';
  let streamUrl = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith('data:')) {
          const rawPayload = line.slice(5).trim();
          if (rawPayload) {
            let event;
            try {
              event = JSON.parse(rawPayload);
            } catch {
              event = null;
            }

            if (event) {
              const type = String(event.type || '').toUpperCase();
              if (type === 'STARTED') {
                runId = event.run_id || runId;
              } else if (type === 'STREAMING_URL') {
                streamUrl = event.streaming_url || event.url || streamUrl;
              } else if (type === 'COMPLETE') {
                const status = String(event.status || '').toUpperCase();
                const result = event.result || {};
                if (SUCCESS_STATUSES.has(status) && result && Object.keys(result).length > 0) {
                  return {
                    runId,
                    streamUrl,
                    result,
                    status,
                  };
                }
                throw new Error(event.error || `TinyFish discovery ended with status ${status || 'UNKNOWN'}.`);
              }
            }
          }
        }

        newlineIndex = buffer.indexOf('\n');
      }
    }
  } catch (error) {
    throw new Error(normalizeError(error));
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  throw new Error('TinyFish discovery returned no structured result.');
}
