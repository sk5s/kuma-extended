import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* .env is optional */
  }
}

loadEnvFile()

function withDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

const rawSlug = withDefault('KUMA_STATUS_PAGE_SLUG', 'default')
if (!rawSlug || /[\/?#\s]/.test(rawSlug)) {
  throw new Error(`Invalid KUMA_STATUS_PAGE_SLUG: ${JSON.stringify(rawSlug)}`)
}

export const config = {
  port: Number(withDefault('PORT', '3000')),
  kumaBaseUrl: withDefault('KUMA_BASE_URL', 'http://localhost:3001').replace(/\/+$/, ''),
  statusPageSlug: rawSlug,
  cacheTtlMs: Number(withDefault('CACHE_TTL_SECONDS', '60')) * 1000,
  kumaTimeoutMs: Number(withDefault('KUMA_TIMEOUT_MS', '10000')),
  allowedOrigin: withDefault('ALLOWED_ORIGIN', ''),
  rateLimit: {
    perMinute: Number(withDefault('RATE_LIMIT_PER_MINUTE', '120')),
    burst: Number(withDefault('RATE_LIMIT_BURST', '20'))
  }
} as const
