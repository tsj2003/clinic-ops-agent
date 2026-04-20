function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function runWithTimeout(work, timeoutMs = 5000, { message = 'Operation timed out.' } = {}) {
  const limit = Math.max(1, asNumber(timeoutMs, 5000));
  let timer = null;

  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(String(message || 'Operation timed out.')));
        }, limit);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
