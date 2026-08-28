import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config.js'
import { KumaError, kumaState } from './kuma/client.js'
import v1 from './routes/v1/index.js'

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof KumaError) {
    return c.json(
      {
        ok: false,
        error: { code: 'KUMA_UNAVAILABLE', message: err.message }
      },
      err.status as 502 | 504
    )
  }
  console.error(err)
  return c.json(
    { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500
  )
})

app.get('/healthz', (c) => {
  return c.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    kuma: {
      lastSyncAt: kumaState.lastSyncAt,
      lastError: kumaState.lastError
    }
  })
})

app.route('/api/v1', v1)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
