<p align="center">
  <img src="docs/logo.jpg" alt="kuma-extended logo" width="160" />
</p>

# kuma-extended

A small, focused API proxy that turns a published [Uptime Kuma](https://github.com/louislam/uptime-kuma) status page into a stable, cacheable JSON API for web and mobile clients.

`kuma-extended` is designed to live on the same internal network as Uptime Kuma. It wraps Kuma's public `/api/status-page/:slug` endpoint behind a fixed contract with TTL caching, per-IP rate limiting, security headers, and an opt-in CORS surface — so consumers don't have to.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-ESM-green?style=flat-square)
![Hono](https://img.shields.io/badge/built%20with-Hono-orange?style=flat-square)

## Why

Uptime Kuma ships a public status page endpoint, but consuming it directly has rough edges:

- **No caching** — every consumer request can reach Kuma, including thundering-herd patterns from multiple clients
- **Mixed payload** — presentation fields (`customCSS`, `theme`, `footerText`) are returned alongside data
- **Naming drift** — `maintenanceList` and other field names shift across Kuma versions
- **No browser hardening** — no CORS, no rate limiting, no security headers
- **No stable envelope** — error handling and metadata are inconsistent

`kuma-extended` isolates Kuma behind a single, version-controlled contract. The proxy is the only component that talks to Kuma; routes, types, and security live behind that boundary.

## Features

- **Stable JSON envelope** for both success and error responses
- **TTL cache** (default 60s) absorbs traffic spikes and protects the upstream
- **Per-IP token-bucket rate limiting** on the API surface, in-memory, with `Retry-After` on 429
- **Security headers** via Hono's `secureHeaders()` applied to every response
- **Opt-in CORS** via `ALLOWED_ORIGIN` — mobile clients are never affected
- **Slug validation** at startup, with `encodeURIComponent` at the upstream boundary
- **Bounded upstream fetch** via `AbortSignal.timeout`
- **Health endpoint** reporting Kuma's last successful sync and last error
- **Zero external runtime dependencies** beyond Hono, `@hono/node-server`, and Node's standard library
- **Single artifact deployment** — TypeScript compiles to a self-contained `dist/`

## Architecture

```
   ┌──────────┐    HTTPS    ┌──────────────────┐   HTTP    ┌─────────────────┐
   │  Web /   │  ────────▶  │   kuma-extended  │  ───────▶ │  Uptime Kuma    │
   │  Mobile  │             │   (Hono + Node)  │           │  /api/status-   │
   │  Client  │  ◀────────  │                  │  ◀─────── │   page/:slug    │
   └──────────┘    JSON     └──────────────────┘   JSON    └─────────────────┘
                                        │
                                        ▼
                                ┌───────────────┐
                                │  In-memory    │
                                │  TTL cache    │
                                └───────────────┘
```

Source layout:

```
src/
├── index.ts            # App assembly, security middleware, /healthz, error handling
├── config.ts           # .env parsing with fail-fast slug validation
├── types/kuma.ts       # Uptime Kuma status page response types
├── kuma/client.ts      # Sole layer that talks to Uptime Kuma (isolation boundary)
├── cache/memory.ts     # Generic TTL cache utility
├── middleware/
│   └── rateLimit.ts    # Token-bucket rate limit middleware (per IP, in-memory)
└── routes/
    └── v1/
        ├── index.ts    # v1 router aggregation
        └── status.ts   # GET /api/v1/status
```

The layering is enforced by convention (see `AGENTS.md`):

- **routes** — HTTP in/out, cache lookup, response envelope assembly. No Kuma knowledge.
- **kuma/client** — every call to Uptime Kuma. Changes to Kuma versions or transport live here.
- **cache** — generic TTL utility, reusable for any future endpoint.
- **middleware** — cross-cutting concerns (rate limit, security headers, CORS).

## Quick start

### Run from source

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000` and targets a Kuma instance on `http://localhost:3001` by default.

### Production build

```bash
npm run build
npm start
```

The build emits a self-contained `dist/` that runs on any Node.js host with ESM support.

### Run with Docker

The repository ships a multi-stage `Dockerfile` (Node 22 Alpine, non-root `app` user, `tini` init, and a `/healthz` `HEALTHCHECK`). A prebuilt image is published to Docker Hub and can be pulled directly:

```bash
docker run --rm -p 3000:3000 \
  -e KUMA_BASE_URL=http://uptime-kuma:3001 \
  -e KUMA_STATUS_PAGE_SLUG=default \
  sk5sapp/kuma-extended:latest
```

To build the image locally from source instead:

```bash
docker build -t kuma-extended .
docker run --rm -p 3000:3000 \
  -e KUMA_BASE_URL=http://uptime-kuma:3001 \
  -e KUMA_STATUS_PAGE_SLUG=default \
  kuma-extended
```

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to override defaults; `.env` is gitignored and not required.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listen port for the proxy |
| `KUMA_BASE_URL` | `http://localhost:3001` | Uptime Kuma base URL (trailing slashes are trimmed) |
| `KUMA_STATUS_PAGE_SLUG` | `default` | Status page slug; must not contain `/`, `?`, `#`, or whitespace |
| `CACHE_TTL_SECONDS` | `60` | TTL for cached Kuma responses |
| `KUMA_TIMEOUT_MS` | `10000` | Timeout when calling Kuma |
| `ALLOWED_ORIGIN` | _(empty)_ | CORS origin(s); comma-separated for multiple (e.g. `https://a.com,https://b.com`). Empty disables CORS |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-IP refill rate for the token bucket |
| `RATE_LIMIT_BURST` | `20` | Token bucket capacity (burst ceiling) |

An invalid `KUMA_STATUS_PAGE_SLUG` causes the process to exit on startup.

## API

All responses share the same envelope:

```json
{ "ok": true,  "data": { ... }, "meta": { ... } }
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

### `GET /api/v1/status`

Merged incident and maintenance feed for the configured status page.

```bash
curl http://localhost:3000/api/v1/status
```

```json
{
  "ok": true,
  "data": {
    "incidents": [
      {
        "id": 1,
        "title": "Elevated error rates on /api/orders",
        "active": true,
        "createdDate": "2026-08-28T06:00:00.000Z",
        "lastUpdatedDate": "2026-08-28T06:30:00.000Z"
      }
    ],
    "maintenances": [],
    "updatedAt": "2026-08-28T06:10:10.000Z"
  },
  "meta": { "cached": false }
}
```

- `incidents` and `maintenances` are pass-through from Kuma (Kuma's `maintenanceList` is renamed to `maintenances`).
- `meta.cached` is `true` when the response was served from cache.
- `data.updatedAt` is the ISO 8601 UTC timestamp at which the cached snapshot was taken.

### `GET /healthz`

Proxy liveness and Kuma's most recent sync state.

```json
{
  "ok": true,
  "uptimeSeconds": 3847,
  "kuma": {
    "lastSyncAt": "2026-08-28T06:10:10.000Z",
    "lastError": null
  }
}
```

`/healthz` is intentionally not rate-limited.

### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `429` | `RATE_LIMITED` | Token bucket empty for the caller's IP (response includes `Retry-After`) |
| `502` | `KUMA_UNAVAILABLE` | Kuma returned a non-2xx response |
| `504` | `KUMA_UNAVAILABLE` | Kuma unreachable or timed out |
| `500` | `INTERNAL_ERROR` | Unhandled exception (details logged server-side only) |

## Deployment

### Docker Compose

A typical setup with Uptime Kuma on the same host:

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    volumes:
      - ./kuma-data:/app/data
    ports:
      - "3001:3001"

  kuma-extended:
    image: sk5sapp/kuma-extended:latest
    restart: unless-stopped
    depends_on:
      - uptime-kuma
    environment:
      KUMA_BASE_URL: http://uptime-kuma:3001
      KUMA_STATUS_PAGE_SLUG: default
      ALLOWED_ORIGIN: https://status.example.com
    ports:
      - "3000:3000"
```

### Behind a reverse proxy

When fronted by nginx or Caddy, pass the client IP through so rate limiting keys correctly:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header Host $host;
}
```

## Security model

Hardening applied by default:

- `secureHeaders()` on every response (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy)
- Token-bucket rate limiting per IP on `/api/v1/*`
- CORS opt-in via `ALLOWED_ORIGIN`; mobile clients are unaffected
- Slug validation at startup, `encodeURIComponent` at the upstream boundary
- Generic `INTERNAL_ERROR` envelope — stack traces are logged server-side only
- Bounded upstream fetch via `AbortSignal.timeout`

`AGENTS.md` documents the full security model and the conventions for adding new middleware.

## Development

```bash
npm run dev      # tsx watch with hot reload
npm run build    # tsc → dist/
npm start        # node dist/index.js
```

TypeScript runs in strict mode with `verbatimModuleSyntax`; ESM imports require explicit `.js` extensions.

## Roadmap

- Additional read-only endpoints: monitor heartbeats, per-group status (see `AGENTS.md` for extension conventions)
- Pluggable cache backend (e.g. Redis) for multi-instance deployments
- Optional Socket.IO client for live Kuma pushes
- Prometheus metrics on `/metrics`

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Read `AGENTS.md` for layering rules, conventions, and the security model
2. Keep the public API envelope backwards-compatible — add fields to `meta`, never remove
3. Update `AGENTS.md` when changing architecture or env vars
4. Run `npm run build` to confirm the TypeScript build still passes

## License

[MIT](./LICENSE). The repository should ship with a `LICENSE` file in the project root; until one is added, all rights are reserved by default.

## Acknowledgments

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — the monitoring platform this proxy fronts
- [Hono](https://hono.dev/) — the web framework used throughout