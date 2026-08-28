import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitOptions {
  perMinute: number
  burst: number
}

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const STALE_MS = 5 * 60 * 1000
const PRUNE_THRESHOLD = 256

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const refillPerMs = opts.perMinute / 60_000
  const capacity = opts.burst
  return async (c, next) => {
    const now = Date.now()
    if (buckets.size > PRUNE_THRESHOLD) pruneStale(now)
    const key = clientKey(c)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now }
      buckets.set(key, bucket)
    } else {
      const elapsed = now - bucket.lastRefill
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs)
      bucket.lastRefill = now
    }
    if (bucket.tokens < 1) {
      const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000))
      c.header('Retry-After', String(retryAfterSec))
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        429
      )
    }
    bucket.tokens -= 1
    await next()
  }
}

function clientKey(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]
    if (first) return first.trim()
  }
  return c.req.header('x-real-ip') ?? 'unknown'
}

function pruneStale(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > STALE_MS) buckets.delete(key)
  }
}
