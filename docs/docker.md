# Docker 操作指南

把 `kuma-extended` 包成 Docker image、推到 Docker Hub 與 GitHub Container Registry(GHCR),以及部署方式的完整說明。

## 檔案總覽

| 檔案 | 用途 |
|---|---|
| `Dockerfile` | 多階段 build,`node:22-alpine` 基礎映像 |
| `.dockerignore` | 排除本機開發檔、敏感檔案 |
| `.github/workflows/docker-publish.yml` | CI/CD:build 並推到 Docker Hub + GHCR |

---

## 一、本地建置與測試

### 建置 image

```bash
docker build -t kuma-extended:dev .
```

多階段 build 會依序執行:

1. **`deps`** — `npm ci` 安裝所有依賴(給 build 用)
2. **`builder`** — 跑 `tsc` 編譯 TypeScript 到 `dist/`
3. **`runner`** — 重新 `npm ci --omit=dev`,只裝 production 依賴,複製 `dist/`

最終映像約 80–100 MB。

### 本地啟動

```bash
docker run --rm -p 3000:3000 \
  -e KUMA_BASE_URL=http://host.docker.internal:3001 \
  -e KUMA_STATUS_PAGE_SLUG=default \
  kuma-extended:dev
```

- macOS / Windows:用 `host.docker.internal` 連到 host 上的 Kuma
- Linux(預設 bridge 網路):用 `172.17.0.1`
- 確認運作:`curl http://localhost:3000/healthz`

---

## 二、CI/CD:推到 Docker Hub + GHCR

Workflow 檔:`.github/workflows/docker-publish.yml`

### 觸發時機

| 方式 | 條件 | 產生的 tag |
|---|---|---|
| **自動** | push tag `v*.*.*`(如 `v1.0.0`) | `1.0.0`、`1.0`、`latest`、`sha-abc1234` |
| **手動** | GitHub → Actions → `docker-publish` → Run workflow | `latest`、`sha-abc1234`(不含 semver) |

兩個 registry 都會同步推:`docker.io/<user>/kuma-extended` 與 `ghcr.io/<owner>/kuma-extended`。

### 設定步驟

#### 1. 改 placeholder

打開 `.github/workflows/docker-publish.yml`,第 11 行:

```yaml
IMAGE_OWNER_DOCKERHUB: <your-dockerhub-username>
```

改成你的 Docker Hub username。

#### 2. 加 GitHub Secrets

repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | 值 |
|---|---|
| `DOCKERHUB_USERNAME` | 你的 Docker Hub 帳號 |
| `DOCKERHUB_TOKEN` | Docker Hub → Account Settings → Security → **New Access Token**(別用密碼) |

GHCR 用內建的 `GITHUB_TOKEN`,免設定;workflow 已宣告 `packages: write` 權限。

#### 3. 首次發布

```bash
git add Dockerfile .dockerignore .github/
git commit -m "ci: docker image publish workflow"
git push origin main

git tag v0.1.0
git push origin v0.1.0
```

---

## 三、部署

### docker run(單機)

```bash
docker pull ghcr.io/<your-username>/kuma-extended:1.0.0

docker run -d --name kuma-extended --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e KUMA_BASE_URL=http://uptime-kuma:3001 \
  -e KUMA_STATUS_PAGE_SLUG=default \
  -e CACHE_TTL_SECONDS=60 \
  -e ALLOWED_ORIGIN=https://status.example.com \
  ghcr.io/<your-username>/kuma-extended:1.0.0
```

### docker-compose(含 Kuma)

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
    image: ghcr.io/<your-username>/kuma-extended:1.0.0
    restart: unless-stopped
    depends_on:
      - uptime-kuma
    environment:
      PORT: 3000
      KUMA_BASE_URL: http://uptime-kuma:3001
      KUMA_STATUS_PAGE_SLUG: default
      ALLOWED_ORIGIN: https://status.example.com
    ports:
      - "3000:3000"
```

### 映像健康檢查

Image 內建 `HEALTHCHECK`,每 30 秒打 `/healthz`:

```bash
docker inspect --format '{{json .State.Health}}' kuma-extended
```

`docker ps` 也會顯示 `(healthy)` 狀態。

---

## 四、Image 細節

| 屬性 | 值 |
|---|---|
| 基礎映像 | `node:22-alpine` |
| 多重架構 | `linux/amd64`、`linux/arm64`(Pi、其他 ARM 伺服器可用) |
| 啟動使用者 | 非 root(`app` user) |
| 訊號處理 | `tini`(正確處理 SIGTERM,讓 `docker stop` 優雅退出) |
| 健康檢查 | `wget http://127.0.0.1:$PORT/healthz`,每 30 秒,失敗 3 次標記 unhealthy |
| 快取策略 | `cache-from/cache-to: type=gha`(GitHub Actions cache,加速 CI) |

---

## 五、常見問題

### 手動 dispatch 沒產生 semver tag?
設計如此。手動觸發代表開發中測試,只推 `latest` 與 `sha-xxx`。要發布版本請打 `v*.*.*` tag。

### GHCR image 預設 private,怎麼公開?
repo → **Packages** → 該 package → **Package settings** → **Change visibility** → **Public**。

### 只想支援單一架構加速 build?
改 `.github/workflows/docker-publish.yml` 的 `Build and push` step:

```yaml
platforms: linux/amd64   # 拿掉 arm64
```

### 想加 SBOM / provenance?
在 `Build and push` step 加:

```yaml
provenance: mode=max
sbom: true
```

### 本地 build 失敗但 CI 通過?
通常是 `.dockerignore` 漏寫。檢查有沒有意外把 `node_modules` 或 `.env` 複製進 image(`docker build --progress=plain .` 看詳細步驟)。

### 反向代理後 rate limit 全部變同一個 IP?
要讓 proxy 看到真正的 client IP,nginx 範例:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header Host $host;
}
```

Proxy 的 `X-Forwarded-For` 取第一段作為 rate limit key(見 `src/middleware/rateLimit.ts`)。
