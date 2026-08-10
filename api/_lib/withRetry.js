// Wraps a Supabase query (or any function returning { data, error }) and
// retries it a couple of times with a short backoff if it comes back with
// an error. This is aimed at transient, short-lived failures on Supabase's
// side (e.g. Cloudflare 522 timeouts) — not at masking real problems like
// bad queries or missing tables, which will still fail after the retries
// and get surfaced normally.
export async function withRetry(fn, { retries = 2, delayMs = 300 } = {}) {
  let lastResult
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResult = await fn()
    if (!lastResult?.error) return lastResult
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
  return lastResult
}
