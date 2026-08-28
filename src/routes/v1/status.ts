import { Hono } from 'hono'
import { cacheGet, cacheSet } from '../../cache/memory.js'
import { config } from '../../config.js'
import { fetchStatusPage } from '../../kuma/client.js'
import type { Incident, Maintenance } from '../../types/kuma.js'

export interface StatusSnapshot {
  incidents: Incident[]
  maintenances: Maintenance[]
  updatedAt: string
}

const CACHE_KEY = 'v1:status-page'

const router = new Hono()

router.get('/status', async (c) => {
  const cached = cacheGet<StatusSnapshot>(CACHE_KEY)
  if (cached) {
    return c.json({ ok: true, data: cached, meta: { cached: true } })
  }
  const page = await fetchStatusPage()
  const snapshot: StatusSnapshot = {
    incidents: page.incidents,
    maintenances: page.maintenanceList,
    updatedAt: new Date().toISOString()
  }
  cacheSet(CACHE_KEY, snapshot, config.cacheTtlMs)
  return c.json({ ok: true, data: snapshot, meta: { cached: false } })
})

export default router
