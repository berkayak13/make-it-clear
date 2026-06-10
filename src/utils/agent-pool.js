// Shared sub-agent dispatch machinery for the extraction and renarration
// pipelines: a bounded worker pool plus transient-error retry. Both pipelines
// fan sub-agent LLM calls through these so concurrency and retry behavior stay
// consistent.

// Runs `mapper` over `items` with at most `limit` calls in flight. The OpenAI
// Responses endpoint is HTTP/2, so in-flight calls multiplex over one warm
// connection — wall-clock time is the number of sequential waves, not calls.
export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Transient failures (timeouts, rate limits, 5xx, network blips) are worth one
// retry — a single slow/flaky call should not lose a whole sub-agent's content.
function isTransientError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /timed out|timeout|rate limit|429|temporarily|server error|bad gateway|gateway timeout|\b5\d\d\b|network|fetch failed|connection|socket|econn/.test(message);
}

export async function callWithRetry(fn, { retries = 1, shouldStop } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      // Stop if out of retries, the error is not transient, or the caller's
      // budget says the run is already over (don't burn it retrying).
      if (attempt >= retries || !isTransientError(error)) throw error;
      if (shouldStop?.()) throw error;
      // Brief jittered backoff: an immediate retry into the same rate-limit
      // window just fails again, and the jitter de-synchronizes the many
      // parallel sub-agents that tripped the limiter together.
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1500));
    }
  }
  throw lastError;
}
