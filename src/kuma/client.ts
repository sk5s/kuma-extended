import { config } from '../config.js'
import type { KumaStatusPage } from '../types/kuma.js'

export class KumaError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'KumaError'
    this.status = status
  }
}

export interface KumaClientState {
  lastSyncAt: string | null
  lastError: string | null
}

export const kumaState: KumaClientState = {
  lastSyncAt: null,
  lastError: null
}

export async function fetchStatusPage(): Promise<KumaStatusPage> {
  const url = `${config.kumaBaseUrl}/api/status-page/${config.statusPageSlug}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.kumaTimeoutMs) })
  } catch (err) {
    kumaState.lastError = err instanceof Error ? err.message : String(err)
    throw new KumaError(
      `Failed to reach Uptime Kuma at ${config.kumaBaseUrl}`,
      504
    )
  }
  if (!res.ok) {
    kumaState.lastError = `HTTP ${res.status}`
    throw new KumaError(
      `Uptime Kuma responded with HTTP ${res.status}`,
      502
    )
  }
  const data = (await res.json()) as KumaStatusPage
  kumaState.lastSyncAt = new Date().toISOString()
  kumaState.lastError = null
  return data
}
