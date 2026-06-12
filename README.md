# 普通物理 AI 助教 (NYCU 電物系)

🚀 **Live**: https://nycu-ep-general-physics-tutor.vercel.app
🩺 **Status**: https://nycu-ep-general-physics-tutor.vercel.app/health-check

基於 RAG (Retrieval-Augmented Generation) 架構的 AI 助教系統，專為陽明交通大學電子物理系「普通物理」課程（楊本立老師）設計。範圍：University Physics (Young & Freedman) Ch01–Ch31，涵蓋力學、振盪、流體、波動、聲學、熱學、電磁學與電路。

> 本專案由同系的 [`NYCU_EP_AI_tutor`](../NYCU_EP_AI_tutor)（雷射導論版）改造而來，主要差異：
> - 講義來源改為 31 章普通物理 PDF（`../普通物理_楊本立老師/`）
> - 資料模型由「週次」改為「章節」（`chapter_number = 1..31`）
> - 投影片儲存路徑：`slides/ch_{N}_page_{M}.jpg`
> - 概念圖譜重建為四類別：力學 / 振盪流體波動 / 熱學 / 電磁學

## 技術棧

| 類別 | 技術 | 用途 |
| :--- | :--- | :--- |
| Frontend | Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 | 應用程式框架與 UI |
| Data fetching | SWR + 全域 `apiFetcher` | 客戶端 cache / 自動 retry |
| AI SDK | Vercel AI SDK v6 | 串流、工具呼叫、結構化輸出 |
| LLM | Google Gemini 2.5 Flash / Flash-Lite / Pro | 分級用於不同 endpoint（看 `lib/models.ts`） |
| Embedding | gemini-embedding-001（768 維） | RAG 向量檢索 |
| DB | Supabase Postgres + pgvector | 資料、向量、Auth、RLS |
| Auth | Supabase Auth（Google / GitHub OAuth） | 登入 + 配額升級 |
| Math | KaTeX + remark-math + rehype-katex | LaTeX 公式渲染 |
| Test | Vitest 3 + @xmldom/xmldom | 單元測試（CI 跑） |
| CI | GitHub Actions（tsc + eslint + vitest） | 防止 prod build 噴錯 |
| 監測 | 自製 Sentry envelope（無 SDK 依賴）+ `/health-check` | Error reporting + uptime |
| Web Search | Brave Search API | 外部資訊檢索（選填） |

## 系統架構

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (Next.js client)                                         │
│   - ModeSelector  → 20+ 種學習模式 + 🛡️ 後台（僅 ADMIN_EMAILS）   │
│   - SWR 全域 fetcher、useStudentId、Theme、Auth UI                │
└────────────────────────────┬─────────────────────────────────────┘
                             │  /api/...
┌────────────────────────────▼─────────────────────────────────────┐
│ Next.js API Routes（App Router）                                  │
│                                                                  │
│  跨切面（每個 AI route 都會經過）：                                 │
│    1. initBreadcrumbs()        → AsyncLocalStorage 開新 scope     │
│    2. checkIpRateLimit()       → IP 滑動視窗 60/5min（breadcrumb）│
│    3. resolveStudentId()       → 以 auth session 蓋過 body id     │
│    4. checkDailyQuota()        → 2M auth / 5K anon（breadcrumb）  │
│    5. pickModel(mode)          → 依模式分 light/std/premium 模型   │
│    6. retrieveChunks() (RAG)   → pgvector + similarity            │
│    7. streamText / streamObject / generateObject                  │
│    8. logUsage() → token_usage  → 含 prompt_version、模型、學生   │
│    9. captureRouteError()      → throw 時連同 breadcrumbs 送 Sentry│
│                                                                  │
└──┬──────────────────────────────┬───────────────────────────────┬┘
   │                              │                               │
┌──▼────────────────┐  ┌──────────▼──────────┐  ┌─────────────────▼┐
│ Supabase Postgres │  │ Gemini API          │  │ Sentry (envelope)│
│ + pgvector + RLS  │  │ Flash / Flash-Lite /│  │ + breadcrumbs    │
│ + Auth (OAuth)    │  │ Pro 三層            │  │ + tags / extra   │
└───────────────────┘  └─────────────────────┘  └──────────────────┘
```

**主要資料表**

| Table | 用途 |
| :--- | :--- |
| `lecture_chunks` | 講義切片 + 768 維向量（pgvector），給 `retrieveChunks` 用 |
| `student_profiles` | 學生帳號（auth_user_id, email, display_name, last_signed_in_at） |
| `attempts` | 測驗/考試紀錄（jsonb questions + results + total_score） |
| `chat_messages` | 自由問答歷史（session_id, role, content） |
| `student_state` | 概念掌握度（concept text, mastery_score 0–1） |
| `reflections` | 學習反思 + AI 回饋 |
| `learning_goals` | 學習目標（每天/週/月） |
| `token_usage` | 每次 AI 呼叫的 token 計數 + cost + **prompt_version** |
| `question_reports` | 學生回報題目品質（含 resolved_at / resolved_by_email） |
| `chapter_previews` | 章節預習卡 cache（含 **prompt_version** 自動失效） |

完整 migration 列表見 [`supabase/migrations/`](supabase/migrations/)（目前到 019）。

**模式分級（`web/src/lib/models.ts`）**

```
light    preview / chapter-preview / hint / notes-quiz   → Flash-Lite（最便宜）
standard chat / quiz / reflection / regen / compare /    → Flash（預設）
         study-plan
premium  exam / export                                   → Pro（最貴最準）
```

可用 `MODEL_LIGHT` / `MODEL_STANDARD` / `MODEL_PREMIUM` 覆寫一整層，或用 `MODEL_<MODE>` 微調單個 endpoint。沒設就走 legacy `CHAT_MODEL` 或硬編碼 fallback。

## 環境變數

### 必要

| 變數名稱 | 取得來源 |
| :--- | :--- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | https://aistudio.google.com/apikey |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard（**請新開一個 project**，不要與雷射版共用） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上（**僅 server-side**） |

### 管理員 / 後台

| 變數名稱 | 用途 |
| :--- | :--- |
| `ADMIN_EMAILS` | 逗號分隔，能進 🛡️ 後台的帳號 email |
| `ADMIN_USAGE_WARN_TOKENS` | 學生用量黃色警示（預設 200000） |
| `ADMIN_USAGE_DANGER_TOKENS` | 學生用量紅色警示（預設 500000） |

### AI 模型分級

| 變數名稱 | 用途 |
| :--- | :--- |
| `MODEL_LIGHT` | light 層 fallback（建議 `gemini-2.5-flash-lite`） |
| `MODEL_STANDARD` | standard 層 fallback（建議 `gemini-2.5-flash`） |
| `MODEL_PREMIUM` | premium 層 fallback（建議 `gemini-2.5-pro`） |
| `MODEL_<MODE>` | 單一 endpoint override，例：`MODEL_EXAM=gemini-2.5-pro` |
| `CHAT_MODEL` | Legacy 全域，沒設模式 / 層 fallback 時用 |
| `PROMPT_VERSION` | 每次改 prompt 就 bump，會記到 `token_usage` 做 A/B 對照 |
| `PREVIEW_PROMPT_VERSION` | 章節預習專用 prompt 版本，bump 後 cache 自動失效 |

### 監測 / 選用

| 變數名稱 | 用途 |
| :--- | :--- |
| `SENTRY_DSN` | 啟用 server-side error report + breadcrumbs |
| `NEXT_PUBLIC_SENTRY_DSN` | 啟用 client error hook |
| `BRAVE_SEARCH_API_KEY` | Web 搜尋 tool（chat 模式選用） |

## 快速入門

```bash
# 1) 安裝前端依賴
cd web && npm install

# 2) 安裝離線 pipeline 依賴（建議用獨立 venv）
cd ..
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

# 3) 在 Supabase SQL Editor 跑遍 supabase/migrations/*.sql（001 → 019）
#    一次跑完一輪比逐個慢慢試還快。

# 4) 試跑 — 先解析 Ch01–Ch03 驗證 pipeline
python scripts/parse_pdfs.py --chapters 1-3
python scripts/extract_slides.py --chapters 1-3
python scripts/chunk_and_embed.py

# 5) 啟動開發伺服器
cd web && npm run dev
# 開啟 http://localhost:3000
# 系統健檢：http://localhost:3000/health-check

# 6) 試跑 OK 後，跑完整 31 章
python scripts/parse_pdfs.py
python scripts/extract_slides.py
python scripts/chunk_and_embed.py

# 7) 跑單元測試
cd web && npm test

# 8) （選用）改完 prompt 後跑 eval 看有沒有回歸
PROMPT_EVAL_BASE_URL=http://localhost:3000 npm run eval
```

## 學習模式（20+）

- **章節預習**：5–7 張概念卡，1 分鐘掃完一章重點（cache 過 → 不重 call）
- **教學模式**：依講義逐頁學習，AI 講解 + Vision PDF 截圖
- **自由問答**：純 chat，可上傳手寫照片給 AI 看 + 語音輸入
- **自動測驗**：依弱點概念出選擇/簡答題，含 hint 三層提示
- **費曼模式**：學生講給 AI 聽，AI 找漏洞反問
- **考試模擬**：midterm / final，含分數 + grading rubric + AI 回饋
- **概念圖譜**：36 章 dependency graph，點節點看先修 path
- **AI 學習計畫**：依 mastery + 目標生成每日讀書清單
- **學習儀表板**：mastery / streak / token 用量 / 弱點
- **對話歷史**：續聊任一場 session
- **錯題本**：自動收集答錯題，可一鍵 regenerate 變體
- **章節重點**：講義 OCR + 重點整理
- **校準回顧**：答題前自評信心 vs 實際對錯，校準學習觀感
- **每日 5 分鐘小複習**：依遺忘曲線挑題
- **概念對照**：兩個易混概念 side-by-side 比較
- **學習反思日誌**：寫日記 + AI 個別回饋
- **資料庫**：整合 library 檢索
- **學習目標管理**：日 / 週 / 月目標追蹤
- **物理模擬器**：互動式 simulators（PhET-style）
- **手寫筆記出題**：拍照上傳 → AI 出題回測筆記內容
- **🛡️ 後台**（僅 admins）：見下一節

## 🛡️ 管理員後台

`ModeSelector` 右上會看到 🛡️ 按鈕（前提：你 email 在 `ADMIN_EMAILS`）。三個 tab：

### 📊 Token 使用

- 30 / 7 / 90 / 全部 4 個時間區間
- 全班總體：呼叫數、tokens、估算成本、活躍學生數
- 每日 token bar chart
- 學生用量排行表（每頁 25，分頁可翻全班）
- 學生搜尋（email / 名字 fuzzy）
- 用量警示閥值（⚠️ 200K / 🚨 500K，可改 env）
- **點任一學生展開明細抽屜**：30 天每日 token chart、端點分布、自由問答 session list（可再點開看全對話）、測驗紀錄
- 端點用量分布表
- 🧪 Prompt 版本用量 A/B（≥2 版時自動顯示）
- ⬇ CSV 匯出：全班 / 單一學生 usage / chats / attempts

### 🏫 班級儀表板

- 註冊 / 活躍學生數、測驗總數、平均答對率
- **章節答對率熱圖**（1–36 章，紅 / 橙 / 綠分色）
- **全班最弱概念 Top 20**（每概念 ≥2 位學生才計）
- ⬇ Bulk CSV：全班 attempts、全班 tokens

### 🚩 問題回報

- 篩 open / resolved / all
- 標記已處理（含備註），自動記 `resolved_by_email`
- **每張卡片可展開那位學生的 StudentDetail 抽屜**，triage 時看脈絡

## 監測 / 維運

- **`/health-check` 頁**：Supabase ping、Gemini key 在不在、OAuth env、Sentry 設定、admin 設定。每 30 秒自動 refresh。
- **`/api/health-check`**：純 JSON 給 uptime monitor 用，critical 失敗回 503。
- **Sentry breadcrumbs**：每個 route 自動記 rate-limit / quota / ai.call 軌跡，throw 時連同 stack 送出。
- **Daily quota**：登入 2M / 匿名 5K（Asia/Taipei 00:00 重置）。
- **IP rate limit**：滑動視窗 60 calls / 5 min（in-memory，per-instance）。
- **CSP**：見 [`next.config.ts`](web/next.config.ts)。
- **RLS**：跑過 migration 016，每位學生只能讀寫自己的 row（admin 走 service-role 略過）。

## CI / Workflow

GitHub Actions 跑 `npx tsc --noEmit`（prod + tests 兩套 tsconfig）、`npx eslint .`、`npm test`。任何 `web/**` 變動都會跑。設定見 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

Vercel 接到 push 自動部署 main。改 env var 後**需要手動 Redeploy**才會生效（不要勾 Use existing Build Cache）。

## 已知 TODO

- [ ] 概念圖譜為自動產生的初版（每章一個頭條概念），需要老師/同學 review 並調整節點與先修邊
- [ ] 期中／期末考的章節範圍依實際課程進度可能要再切分（目前預設 midterm = Ch01–Ch16, final = Ch17–Ch31）
- [ ] 教學模式 Header 目前只顯示 `Ch{NN}`，可加上中文章節標題
- [ ] 老師自訂題庫（teacher role + 上傳介面）— 需要先談 schema
- [ ] eval harness 擴充到 chat / exam（目前只有 preview）
- [ ] pg_dump 自動備份（cron 或 Supabase Edge Function）
