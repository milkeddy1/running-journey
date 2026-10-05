# running-bot

跑步訓練自動化對照與推播：**Garmin → Strava → Google Calendar 課表 → Discord**

跑完步、手錶同步到 Strava 後，Cloudflare Worker 收到 Strava webhook，抓取實際數據，
對照 Google 日曆上預先排定的課表，產出格式化報告推到 Discord 頻道。

```text
🏃 節奏跑 10K ｜ 2026-10-05
────────────────────
📋 課表　10 km @ 4:50–5:00 /km ｜ Z3–Z4
📊 實際　10.12 km ｜ 49:21 ｜ 4:53 /km
❤️ 心率　平均 162 ｜ 最高 178 ｜ Z3–Z4 佔 81%
────────────────────
✅ 距離　✅ 配速　✅ 心率
💡 跑後 30 分鐘內補充碳水 + 蛋白質，幫助肌肉修復
🔗 Strava 活動連結
```

## 架構

| 項目 | 選擇 |
|---|---|
| 執行環境 | Cloudflare Workers（免費方案） |
| 狀態儲存 | Cloudflare KV（token 快取、去重） |
| 資料來源 | Strava API v3（webhook + activities / laps / streams） |
| 課表來源 | Google Calendar API v3（Service Account，唯讀） |
| 推播 | Discord Webhook（Embed） |

```text
src/
├── index.ts        fetch handler：GET 訂閱驗證 / POST 事件接收
├── pipeline.ts     背景管線：去重 → Strava → Calendar → 對照 → Discord → 標記
├── strava.ts       token 輪替、activity / laps / streams
├── google-auth.ts  Service Account JWT（WebCrypto RS256）
├── calendar.ts     查詢當日活動、解析課表描述、挑選最接近的課表
├── compare.ts      對照規則（距離 / 配速 / 心率區間 / 間歇逐趟）
├── discord.ts      Embed 組裝與發送
├── format.ts       配速、時間、距離格式轉換
└── types.ts        Env 與各 API 型別
```

## 開發

```bash
npm install
npm test            # vitest（純邏輯：解析、對照、embed）
npm run typecheck
npm run check       # typecheck + test + wrangler deploy --dry-run
npm run dev         # wrangler dev，需先建立 .dev.vars（見 .dev.vars.example）
```

本機要接真實 Strava webhook 時，用 `cloudflared tunnel --url http://localhost:8787` 取得公開網址。

## 課表格式（Google Calendar 描述欄）

建立一個專用的「訓練」行事曆，標題自由填寫，描述欄用 `key: value`（一行一個）：

```text
type: tempo
distance: 10
pace: 4:50-5:00
hr_zone: Z3-Z4
```

間歇：

```text
type: interval
warmup: 2
reps: 6x800
pace: 3:50-4:00
rest: 2:00 jog
cooldown: 2
hr_zone: Z4-Z5
```

| 欄位 | 格式 | 說明 |
|---|---|---|
| `type` | `easy` / `long` / `tempo` / `interval` / `recovery` | 訓練型態（也接受中文：輕鬆跑、長跑、節奏跑、間歇、恢復跑） |
| `distance` | 公里數 | 總距離目標 |
| `duration` | `mm:ss` 或 `h:mm:ss` | 與 distance 擇一，有 distance 時優先比距離 |
| `pace` | `m:ss-m:ss` | 目標配速區間（每公里），`-`、`–`、`~` 皆可 |
| `hr_zone` | `Z2` 或 `Z3-Z4` | 目標心率區間 |
| `reps` | `次數x公尺`，如 `6x800`、`5x1km` | 間歇趟數與每趟距離 |
| `rest` | 自由文字 | 僅顯示，不比對 |
| `warmup` / `cooldown` | 公里數 | 僅顯示 |

無法辨識的行會被忽略；欄位缺少就跳過該項比對。當天有多個事件時，挑開始時間最接近活動開始時間、且有可解析欄位的那一筆。

## 對照規則

| 項目 | ✅ 達標 | ⚠️ 接近 | ❌ 未達 |
|---|---|---|---|
| 距離 / 時間 | ±5% 內 | ±5～15% | 超過 ±15% |
| 配速 | 落在區間內 | 偏離區間 ≤10 秒 | 偏離區間 >10 秒 |
| 心率區間 | 目標區間佔比 ≥70% | 50～70% | <50% |
| 間歇（每趟） | 該趟配速在區間內 | 偏離 ≤5 秒 | 偏離 >5 秒 |

- 心率區間以 `LTHR` 百分比計算：Z1 <85%、Z2 85–89%、Z3 90–94%、Z4 95–99%、Z5 ≥100%，用 streams 的 `time` 差值加權。
- 間歇：距離在單趟目標 ±10% 內的 lap 視為主課表趟，其餘視為熱身 / 休息 / 緩跑；趟數不足會標示「完成 X / Y 趟」。
- `easy` / `recovery` 只檢查「不快於區間下限」，跑太快標示 ⚠️。
- Embed 顏色：全 ✅ 綠、有 ⚠️ 黃、有 ❌ 紅、無課表灰。

門檻都集中在 `src/compare.ts` 的 `THRESHOLDS` 與 `ZONE_LOWER_BOUNDS`。

## 初次設定

### 1. Strava API 應用程式

1. 到 <https://www.strava.com/settings/api> 建立應用程式，記下 **Client ID / Client Secret**。
   Authorization Callback Domain 填 `localhost` 即可。
2. 取得第一組 refresh token（scope 要有 `activity:read_all`）：

   ```bash
   # 瀏覽器開啟（換成你的 client_id）
   open "https://www.strava.com/oauth/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=activity:read_all"
   # 授權後網址列會有 code=XXXX，拿來換 token
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=XXXX -d grant_type=authorization_code
   ```

   回應裡的 `refresh_token` 稍後寫進 KV；`athlete.id` 就是 `STRAVA_ATHLETE_ID`。

### 2. Google Calendar

1. Google Cloud Console：建立專案 → 啟用 **Google Calendar API** → 建立 **Service Account** → 新增金鑰（JSON）。
2. JSON 裡的 `client_email` 是 `GOOGLE_SA_EMAIL`，`private_key` 是 `GOOGLE_SA_PRIVATE_KEY`。
3. Google Calendar：建立「訓練」行事曆 → 設定 → **與特定使用者共用** → 加入 SA email，權限「查看所有活動詳細資料」。
4. 同一頁下方「整合日曆」複製 **日曆 ID**（`xxx@group.calendar.google.com`）→ `GOOGLE_CALENDAR_ID`。

> 個人 Gmail 不支援 domain-wide delegation，所以只能用分享的方式。

### 3. Discord

頻道設定 → 整合 → Webhook → 新 Webhook → 複製 URL → `DISCORD_WEBHOOK_URL`。

### 4. Cloudflare

```bash
npx wrangler login
npx wrangler kv namespace create STATE        # 把回傳的 id 填進 wrangler.toml
npx wrangler kv key put strava:refresh_token "<refresh_token>" --binding STATE --remote

npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_VERIFY_TOKEN     # 自訂任意字串
npx wrangler secret put GOOGLE_SA_EMAIL
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY   # 整段 PEM 貼上（含 BEGIN/END），或 \n 形式皆可
npx wrangler secret put DISCORD_WEBHOOK_URL
```

編輯 `wrangler.toml` 的 `[vars]`：`STRAVA_ATHLETE_ID`、`GOOGLE_CALENDAR_ID`、`LTHR`（`STRAVA_SUBSCRIPTION_ID` 先留空）。

部署方式二選一：

- `npm run deploy`
- Dashboard → Workers & Pages → Create → 連接此 GitHub repo（Workers Builds）；push `main` 自動部署，其他分支產生預覽版本。

### 5. 建立 Strava webhook 訂閱

```bash
STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
CALLBACK_URL=https://running-bot.<account>.workers.dev \
./scripts/create-subscription.sh
```

把回傳的 `id` 填入 `wrangler.toml` 的 `STRAVA_SUBSCRIPTION_ID`，再部署一次。
一個 Strava 應用程式只能有一個訂閱，可用 `./scripts/create-subscription.sh list` / `delete <id>` 管理。

### 6. 測試

跑一段短距離，或在 Strava 網頁手動建立一筆 Run 活動。幾秒內 Discord 應收到報告；
失敗時會收到紅色錯誤 embed，詳情在 Cloudflare Dashboard → Worker → Logs。

## KV 鍵值（binding `STATE`）

| Key | 內容 | TTL |
|---|---|---|
| `strava:refresh_token` | 最新 refresh token（首次手動寫入，之後自動輪替） | 無 |
| `strava:access_token` | `{ token, expires_at }` | 依 expires_at |
| `google:access_token` | `{ token, expires_at }` | 約 1 小時 |
| `processed:{activity_id}` | `1` | 7 天 |

## 邊界情境

| 情境 | 處理方式 |
|---|---|
| 當天沒有課表 | 照樣推送實際數據，標註「今日無排定課表」，灰色 |
| 當天有多個課表 | 挑開始時間最接近活動開始時間的那一筆 |
| 同一天跑兩次 | 各自獨立對照與推送 |
| Strava 重送事件 | KV 去重 |
| 非跑步活動 | 依 `sport_type` 過濾（Run / TrailRun / VirtualRun） |
| 活動之後被編輯（`update`） | 忽略 |
| Google Calendar 失敗 | 仍推送實際數據，附註行事曆讀取失敗 |
| 其他外部 API 失敗 | 推送錯誤 embed 到 Discord，`console.error` 進 Workers Logs |
| 沒有心率資料 | 跳過心率比對，顯示「無心率資料」 |

## 注意事項

- Strava 的 `start_date_local` 字尾是 `Z` 但其實是本地時間；查行事曆以它的「日期」為準，不是 Worker 執行時間。
- Strava 換發 token 時 refresh token 可能輪替，程式會自動把新的寫回 KV。
- 若要把數據交給 AI 模型產生評語，先確認 Strava 最新 API 條款（2024 年底的更新限制了 AI 相關用途）。
- `.dev.vars` 已在 `.gitignore`，不要提交。

## 迭代路線

- [x] v0.1 Webhook 驗證 + 抓 Strava 數據 → 推送 Discord
- [x] v0.2 Google Calendar 距離 / 配速對照
- [x] v0.3 心率區間分布（streams）
- [x] v0.4 間歇 laps 逐趟比對
- [ ] v0.5 每週摘要（Cron Trigger：週日晚上推送週跑量與課表完成率）
- [ ] 處理 `update` 事件、Discord slash command 查詢歷史紀錄
