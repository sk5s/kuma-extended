# AGENTS.md

Uptime Kuma API Proxy — 部署於與 Uptime Kuma 同內網的 Hono 服務,將 Kuma 的狀態頁資料(事件、維護)轉為穩定的 REST API,供網頁或 App 前端顯示服務狀態。

## 技術棧

- Node.js + TypeScript (ESM, NodeNext)
- Hono + @hono/node-server
- 開發工具:tsx (watch)、tsc
- 無資料庫,無其他外部依賴

## 常用指令

```bash
npm install        # 安裝依賴
npm run dev        # 開發(tsx watch,熱重載),監聽 PORT(預設 3000)
npm run build      # tsc 編譯至 dist/
npm start          # 執行 node dist/index.js
```

## 環境設定

複製 `.env.example` 為 `.env`(已 gitignore)。`.env` 非必需,未提供時使用預設值。

| 變數 | 預設值 | 說明 |
|---|---|---|
| `PORT` | `3000` | Proxy 監聽埠 |
| `KUMA_BASE_URL` | `http://localhost:3001` | Uptime Kuma 位址(結尾斜線會自動移除) |
| `KUMA_STATUS_PAGE_SLUG` | `default` | Kuma 狀態頁 slug;不可包含 `/ ? #` 或空白,啟動時驗證 |
| `CACHE_TTL_SECONDS` | `60` | 對 Kuma 的請求快取時間(秒) |
| `KUMA_TIMEOUT_MS` | `10000` | 呼叫 Kuma 的逾時(毫秒) |
| `ALLOWED_ORIGIN` | _(空)_ | CORS 允許的來源;留空 = 不啟用 CORS(瀏覽器跨來源請求會被擋,App 不受影響) |
| `RATE_LIMIT_PER_MINUTE` | `120` | `/api/v1/*` 每 IP 每分鐘 token-bucket refill 速率 |
| `RATE_LIMIT_BURST` | `20` | token-bucket 容量(瞬時 burst 上限) |

注意:此服務依賴 Kuma 的**公開** status page endpoint(`/api/status-page/:slug`),目標狀態頁必須已發布(published)。

## 架構

```
src/
├── index.ts            # 進入點:app 組裝、安全 middleware(secureHeaders + 可選 CORS + rate limit)、/healthz、錯誤處理、掛載 /api/v1
├── config.ts           # 讀取 .env(自帶輕量解析,無 dotenv 依賴),匯出 config 物件;含 slug 驗證
├── types/kuma.ts       # Uptime Kuma status page 回應的型別(以實際 API 回應為準)
├── kuma/client.ts      # Kuma API 客戶端(唯一與 Kuma 溝通的隔離層)+ KumaError + 連線狀態 kumaState;slug 經 encodeURIComponent
├── cache/memory.ts     # 泛型 TTL 記憶體快取(cacheGet / cacheSet / cacheClear)
├── middleware/
│   └── rateLimit.ts    # Token-bucket rate limit middleware(in-memory,per IP,key 來自 X-Forwarded-For / X-Real-IP)
└── routes/
    └── v1/
        ├── index.ts    # v1 路由彙整
        └── status.ts   # GET /api/v1/status(含 StatusSnapshot 型別、快取邏輯)
```

### 分層原則

- **routes 層**:只做 HTTP 進出、快取判斷、回應 envelope 組裝,不含 Kuma 細節
- **kuma/client 層**:所有對 Kuma 的呼叫集中於此;Kuma 版本升級(v1→v2)或改用 Socket.IO 取資料時,只改這層與 types
- **cache 層**:獨立泛型工具,任何 route 都能使用不同 key / TTL

## API 規格(v1)

### GET /api/v1/status

合併回傳事件與維護資訊。成功:

```json
{
  "ok": true,
  "data": {
    "incidents": [ ... ],
    "maintenances": [ ... ],
    "updatedAt": "2026-08-28T06:10:10.000Z"
  },
  "meta": { "cached": true }
}
```

- `incidents` / `maintenances` 為 Kuma 原始欄位(pass-through,欄位見 `src/types/kuma.ts`);Kuma 的 `maintenanceList` 更名為 `maintenances`
- `meta.cached`:`true` 表示回應來自快取;`updatedAt` 為快取快照建立時間(ISO 8601 UTC)
- 快取:60 秒(由 `CACHE_TTL_SECONDS` 控制),TTL 內重複請求不會打到 Kuma

### GET /healthz

Proxy 健康檢查,附帶對 Kuma 的最近同步狀態(`lastSyncAt` / `lastError`),供監控與除錯。不回傳 Kuma 設定資訊(位址、slug 等)。

### 錯誤格式(統一 envelope)

```json
{
  "ok": false,
  "error": { "code": "KUMA_UNAVAILABLE", "message": "..." }
}
```

- Kuma 連線失敗/逾時 → HTTP 504;Kuma 回應非 2xx → HTTP 502
- Rate limit 超過 → HTTP 429(`RATE_LIMITED`),附 `Retry-After` header
- 其餘未預期錯誤 → HTTP 500(`INTERNAL_ERROR`),詳細堆疊只記錄於 server log

## 安全防護

透過 Hono middleware 在 `index.ts` 集中掛載(順序由外而內):

1. **`secureHeaders()`** — 全域套用,設定 `X-Content-Type-Options`、`X-Frame-Options`、`Strict-Transport-Security`、`Referrer-Policy` 等瀏覽器側防護 header。對 JSON API + App 為主的場景無實質攻擊面,但加上是業界慣例。
2. **`cors()`** — 僅在 `ALLOWED_ORIGIN` 非空時掛在 `/api/*`;空字串 = 不啟用 CORS。手機 App 不受 CORS 影響(直接 HTTP request),只有瀏覽器跨來源網頁前端需設定。
3. **`rateLimit()`** — token-bucket middleware 掛在 `/api/v1/*`,per IP(`X-Forwarded-For` 第一段 → `X-Real-IP` → `unknown`),in-memory,5 分鐘未使用自動清理。設計目的是防止 thundering-herd / 流量放大打到 Kuma;`/healthz` 不限流。

## 升級與擴充慣例(重要)

1. **路由版本化**:所有 API 掛在 `/api/v1` 下。破壞性變更 → 新增 `/api/v2` 並保留 v1;新增欄位屬非破壞性,直接加在 v1
2. **新增讀取類 endpoint**(如 heartbeats、monitor 狀態):
   - 若公開 REST endpoint 可取得 → 在 `kuma/client.ts` 加 fetch 函式
   - 若需要認證/即時資料 → 在 client 層加入 Socket.IO 客戶端(socket.io-client),對 routes 層維持 async 函式介面
   - 在 `types/kuma.ts` 補型別、`routes/v1/` 新增路由檔並於 `routes/v1/index.ts` 掛載
3. **回應一律使用 envelope**:`{ ok, data, meta }` / `{ ok, error: { code, message } }`,新增欄位放進 `meta`
4. **不對 Kuma 資料做過度加工**:pass-through 為原則,僅更名必要欄位;篩選(如只取 `active` 事件)留給前端,避免 proxy 假設過多
5. **Kuma 版本升級流程**:比對新版 status page 回應 → 更新 `types/kuma.ts` → 若欄位有破壞性變更,在 client 層轉換為內部穩定格式,route 層不動

## 程式碼慣例

- ESM:相對 import 必須帶 `.js` 副檔名(tsc NodeNext 規範)
- TypeScript strict;型別定義集中於 `types/`
- 程式碼不加註解;說明寫在本檔案
- 錯誤處理:Kuma 相關錯誤丟 `KumaError`,由 `index.ts` 的 `app.onError` 統一轉換
- 認證:目前無(純內網);若未來需要,在 `index.ts` 於 `/api` 掛載前加入 bearer/auth middleware
- 安全 middleware(secureHeaders、CORS、rate limit)集中在 `index.ts`;如需新增更複雜的 middleware,放 `src/middleware/` 為獨立檔案再由 `index.ts` 引入掛載
