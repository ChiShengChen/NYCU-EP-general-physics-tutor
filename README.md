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
│    2. checkIpRateLimit()       → IP 滑動視窗 60/5min（Upstash/mem）│
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
| `attempts` | 測驗/考試/口試紀錄（kind = quiz / exam / **oral**；jsonb questions + results + total_score；口試另存 **transcript**） |
| `attempt_analyses` | 每份 attempt 的 **AI 錯題分析** cache（錯因分類 + 講義頁碼 + 複習順序，含 prompt_version） |
| `chat_messages` | 自由問答歷史（session_id, role, content） |
| `student_state` | 概念掌握度（concept text, mastery_score 0–1） |
| `reflections` | 學習反思 + AI 回饋 |
| `learning_goals` | 學習目標（每天/週/月） |
| `token_usage` | 每次 AI 呼叫的 token 計數 + cost + **prompt_version** |
| `question_reports` | 學生回報題目品質（含 resolved_at / resolved_by_email） |
| `chapter_previews` | 章節預習卡 cache（含 **prompt_version** 自動失效） |

完整 migration 列表見 [`supabase/migrations/`](supabase/migrations/)（目前到 024；020 = attempts 加 `oral` kind + transcript，021 = `attempt_analyses`，022 = `review_cards`（SM-2），023 = `teacher_questions`，024 = `concept_graph_overrides` + history）。

**模式分級（`web/src/lib/models.ts`）**

```
light    preview / chapter-preview / hint / notes-quiz   → Flash-Lite（最便宜）
standard chat / quiz / reflection / regen / compare /    → Flash（預設）
         study-plan / oral（口試出題 + 追問）/ analysis（錯題分析）
premium  exam / export（口試最後評分也走 exam 層）        → Pro（最貴最準）
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
| `ANALYSIS_PROMPT_VERSION` | 錯題分析 prompt 版本，bump 後 `attempt_analyses` cache 自動失效 |
| `TEACHER_MIX_RATIO` | 老師題庫混入測驗 / 考試的比例（預設 0.3；題庫沒題就自動跳過） |
| `MODEL_ORAL` / `MODEL_ANALYSIS` | 口試 / 錯題分析的單一 endpoint override（預設走 standard 層） |

### 監測 / 選用

| 變數名稱 | 用途 |
| :--- | :--- |
| `SENTRY_DSN` | 啟用 server-side error report + breadcrumbs |
| `NEXT_PUBLIC_SENTRY_DSN` | 啟用 client error hook |
| `BRAVE_SEARCH_API_KEY` | Web 搜尋 tool（chat 模式選用） |
| `UPSTASH_REDIS_REST_URL` | IP rate limit 改用 Upstash Redis（跨 Vercel 實例一致）；Upstash Console → Database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | 同上；兩個都設才啟用，缺一就退回 in-memory |

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

# 8) （選用）改完 prompt 後跑 eval 看有沒有回歸（preview / chat / exam / oral 四種模式，會燒真實 token）
PROMPT_EVAL_BASE_URL=http://localhost:3000 npm run eval
npm run eval -- --only chat --dry-run   # 只跑單一模式 / 不打 server 只驗 request builder；詳見 web/scripts/eval/README.md
```

## 學習模式（20+）

- **章節預習**：5–7 張概念卡，1 分鐘掃完一章重點（cache 過 → 不重 call）
- **教學模式**：依講義逐頁學習，AI 講解 + Vision PDF 截圖
- **自由問答**：純 chat，可上傳手寫照片給 AI 看 + 語音輸入
- **自動測驗**：依弱點概念出選擇/簡答題，含 hint 三層提示；單章 / 跨章會混入老師題庫的題目（👩‍🏫 標記）
- **費曼模式**：學生講給 AI 聽，AI 找漏洞反問
- **考試模擬**：midterm / final，含分數 + grading rubric + AI 回饋；期末考另加 2 題光學操作題（各 5 分，總分 100），兩種考試都會混入老師題；總分 / 等第由 server 重算不信 LLM
- **概念圖譜**：36 章 dependency graph，點節點看先修 path
- **AI 學習計畫**：依 mastery + 目標生成每日讀書清單
- **學習儀表板**：mastery / streak / token 用量 / 弱點；**深入分析**：題型 × 正確率、章節 × 正確率、錯因分布（來自錯題分析）、時段 × 正確率、提示依賴；**班級百分位**（只給「全班前 N%」+ 直方圖，≥5 人才顯示，不露任何他人資料）
- **對話歷史**：續聊任一場 session
- **錯題本**：自動收集答錯題，可一鍵 regenerate 變體
- **AI 錯題分析**：測驗 / 考試 / 口試結束後一鍵分析——每題錯因分類（概念 / 計算 / 審題 / 不完整）、正確思路、**對應講義 Ch/Page（點了直接開教學模式那一頁）**、跨題共同錯誤模式與複習順序。結果快取在 `attempt_analyses`，測驗紀錄與錯題本都看得到；`lib/attempt-analysis.ts` 是純 server 函式，之後接 email 報告可直接重用
- **口試模擬**：AI 考官出 3 題（概念解釋 / 推導 / 情境應用），每題最多追問 2 次、不給提示；結束後依正確性 /4 · 完整性 /3 · 表達 /3 評分並給模範答案。範圍可選 1–3 章或依弱點；存成 `attempts.kind = 'oral'`
- **光學操作題**：Ch33 / Ch34 的自動測驗會多出 2 題「在光路圖上調到目標」的互動題（薄透鏡 / 球面鏡 / 折射與全反射），學生拉滑桿達成條件後提交，由薄透鏡 / 鏡公式 / Snell 定律在 server 端判定，不經 LLM
- **章節重點**：講義 OCR + 重點整理
- **校準回顧**：答題前自評信心 vs 實際對錯，校準學習觀感
- **每日 5 分鐘小複習**：**SM-2 間隔重複**——每題錯題自動變成一張卡（`review_cards`），有自己的 due date / ease / interval；到期才出現，自評「完全忘 / 有點忘 / 我會 / 秒答」決定下次間隔；首頁顯示今日到期數與 7 天預測
- **概念對照**：兩個易混概念 side-by-side 比較
- **學習反思日誌**：寫日記 + AI 個別回饋
- **資料庫**：整合 library 檢索
- **學習目標管理**：日 / 週 / 月目標追蹤
- **物理模擬器**：互動式 simulators（PhET-style）：自由落體、拋體、碰撞、彈簧、電場、RC 電路、薄透鏡、球面鏡、折射 / 全反射
- **手寫筆記出題**：拍照上傳 → AI 出題回測筆記內容
- **📜 考古題**：老師題庫裡標籤含 `考古題` + 年度-學期（`2024-期中` / `2023-期末`）的題目，依年度分組成一份份考題。每題可「對答案」（選擇題 server 直接比對、簡答題一次 AI 評分 0 / 0.5 / 1）、「📖 這題在講義哪裡」（RAG 找該章最相關 3 頁，點了直接開教學模式那一頁，不經 LLM）、「🔁 出一題類似的」（同概念同題型的變體，可再作答）。進度「已作答 n / N」存 localStorage；不寫 `attempts`，只更新 `student_state` 掌握度
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
- **🧭 全班錯因分布**：聚合所有學生的錯題分析——每章「概念錯 / 計算錯 / 審題錯 / 不完整 / 未作答」堆疊長條、全班總覽百分比、最常被點名的講義頁 Top 15。比答對率更能指出該怎麼講
- ⬇ Bulk CSV：全班 attempts、全班 tokens

### 🚩 問題回報

- 篩 open / resolved / all
- 標記已處理（含備註），自動記 `resolved_by_email`
- **每張卡片可展開那位學生的 StudentDetail 抽屜**，triage 時看脈絡

### 📚 題庫（老師自訂題目）

- 逐題表單（選擇 / 簡答、章節、難度、解析、tags）或 **CSV 批次匯入**（可下載範本；壞的列會逐列回報，不會整檔失敗）
- 依章節篩選、搜尋、停用 / 啟用、刪除、CSV 匯出
- 自動測驗（單章 / 跨章）與考試模擬會依章節把老師題**混入 AI 題**（預設 30%，`TEACHER_MIX_RATIO`），UI 顯示 👩‍🏫 老師題 標記；配分沿用被替換的題位
- **考古題標籤慣例**：一題要出現在學生端 📜 考古題，tags 要同時有 `考古題` 和一個「年度-學期」標籤（`2024-期中`、`2023-期末`，格式 `YYYY-任意文字`；CSV 的 tags 欄用 `;` 分隔，例如 `考古題;2024-期中`）。學生端依年度-學期分組、最新在前；只有 `考古題` 沒年度的會歸到「未分年度」。題庫 tab 有「📜 考古題」快速篩選。不需要新 migration

### 🕸️ 圖譜（概念圖譜人工校對）

- 章節先修圖譜的 **React Flow 編輯畫布**：拖把手連線 = 加先修邊（先修 → 後續）、點邊 = 移除、點節點 = 改標題 / 分類 / 隱藏；每一步都即時用 `applyGraphOverride()` 檢查，形成循環會直接列出循環路徑並拒絕
- 右側「未儲存變更」逐項列出 diff（可逐項 ↩ 撤銷）→ 儲存 PUT `/api/admin/graph`；「還原預設」清空覆寫；歷史紀錄保留每次儲存，可「回復到此版本」
- 程式內建的靜態圖譜仍是預設，老師改的只是存在 `concept_graph_overrides`（migration 024）的 **diff**；學生端 概念圖譜 / 前置缺口分析 / `/api/prereq-path` 都讀 `/api/concept-graph`（static + override 合併、`max-age=60`），DB 掛了就自動退回靜態圖譜

## 監測 / 維運

- **`/health-check` 頁**：Supabase ping、Gemini key 在不在、OAuth env、Sentry 設定、admin 設定、rate-limit store（in-memory / upstash + PING 延遲）。每 30 秒自動 refresh。
- **`/api/health-check`**：純 JSON 給 uptime monitor 用，critical 失敗回 503。
- **Sentry breadcrumbs**：每個 route 自動記 rate-limit / quota / ai.call 軌跡，throw 時連同 stack 送出。
- **Daily quota**：登入 2M / 匿名 5K（Asia/Taipei 00:00 重置）。
- **IP rate limit**：滑動視窗 60 calls / 5 min。設了 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` 就走 Upstash Redis（sorted-set sliding log，一次 `/pipeline` REST call，無 SDK 依賴，跨實例一致）；沒設就退回 in-memory（per-instance，Vercel 多實例下只是軟性防護）。Redis 失敗或 800 ms 沒回就 **fail open**（放行 + 每分鐘最多一則 `console.warn` + breadcrumb），不會因為 Redis 掛掉把學生擋在外面——daily quota 仍然兜底。
- **CSP**：見 [`next.config.ts`](web/next.config.ts)。
- **RLS**：跑過 migration 016，每位學生只能讀寫自己的 row（admin 走 service-role 略過）。

### 資料庫備份（pg_dump）

Vercel 跑不了 `pg_dump`，所以放在 GitHub Actions：[`backup.yml`](.github/workflows/backup.yml) 每天 **03:30 Asia/Taipei**（cron `30 19 * * *` UTC）跑 [`scripts/backup.sh`](scripts/backup.sh)，也可以在 Actions 頁 **Run workflow** 手動觸發。流程：裝 PGDG 的 `postgresql-client-17`（`pg_dump` 可以 dump 比自己舊的 server，Supabase 在 15 或 17 都行）→ `pg_dump --no-owner --no-privileges --format=custom --schema=public`（資料 + schema）加一份 `--schema-only` 純 SQL（方便 diff）→ gzip → 上傳成 workflow artifact（保留 30 天）→ 若有設 bucket 再 `curl` 到 Supabase Storage。dump 小於 10 KB 或沒有任何 `TABLE DATA` 直接 fail；連線字串會被 mask。

**GitHub Secrets**（repo → Settings → Secrets and variables → Actions → Secrets）：

| 名稱 | 必要 | 來源 |
| :--- | :---: | :--- |
| `SUPABASE_DB_URL` | ✅ | Supabase → **Project Settings → Database → Connection string**，Method 選 **Session pooler**（port **5432**）、格式選 URI，把 `[YOUR-PASSWORD]` 換成 DB 密碼。不要用 Transaction pooler（6543），`pg_dump` 不支援；Direct connection 也可以但需要 IPv6。 |
| `SUPABASE_URL` | 選用 | 同 `NEXT_PUBLIC_SUPABASE_URL`（`https://<ref>.supabase.co`），bucket 上傳用 |
| `SUPABASE_SERVICE_ROLE_KEY` | 選用 | 同 Vercel 那把，bucket 上傳用 |
| `BACKUP_BUCKET` | 選用 | Supabase Storage 的 **private** bucket 名稱（先在 Dashboard → Storage 建好，例如 `db-backups`）。三個都設了才會上傳，物件路徑 `daily/<YYYY>/<檔名>`，同名會 upsert |

**Repo Variables**：`UPLOAD_ARTIFACT=false` 關掉 artifact 上傳（手動跑時也可以用 input 覆蓋，預設 `true`）。

> ⚠️ **Artifact 存在 GitHub 上**，dump 裡有學生資料，所以只有 repo 是 **private** 才可以用 artifact。如果 repo 改成 public，**必須**設 `BACKUP_BUCKET`（走 Storage）並把 `UPLOAD_ARTIFACT` 設成 `false`；workflow 偵測到 public repo + artifact 開著會直接 fail，不會上傳。

**下載與還原**：

```bash
# 1) 拿 dump：Actions → DB backup → 某次 run → Artifacts，或用 gh
gh run list --workflow backup.yml --limit 5
gh run download <run-id> --dir backups/
#    bucket 版：Supabase Dashboard → Storage → db-backups → daily/<YYYY>/ 下載

# 2) 本機需要 pg_restore ≥ 17（brew install postgresql@17）
scripts/restore.sh backups/nycu-physics-20261019-0330.dump.gz "$TARGET_DB_URL"   # 會要你打 restore 確認；--yes 跳過、--jobs 4 平行
scripts/backup.sh --restore-hint backups/nycu-physics-20261019-0330.dump.gz     # 只印對應的 pg_restore 指令
```

還原用 `pg_restore --clean --if-exists --no-owner --no-privileges --schema=public`：dump 裡有的 public 物件會被 DROP 再建，目標庫才有的不動。**建議先還原到一個新開的 Supabase project 驗證**，再碰正式庫。注意：

- 只備份 `public` schema。`auth.users`（登入帳號）由 Supabase 管理不在 dump 裡，還原到新 project 時 `student_id` 對應的帳號要另外處理（Supabase 自己的每日備份仍然有）。
- Supabase 若升到 Postgres 18，`pg_dump` 17 會拒絕，要把 workflow 裡的 `postgresql-client-17` 跟著升。
- 本機也可以直接跑：`SUPABASE_DB_URL='...' scripts/backup.sh`，輸出到 `./backups/`（`BACKUP_DIR` 可改）；記得不要把 dump commit 進 repo。

## CI / Workflow

GitHub Actions 跑 `npx tsc --noEmit`（prod + tests 兩套 tsconfig）、`npx eslint .`、`npm test`。任何 `web/**` 變動都會跑。設定見 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

Vercel 接到 push 自動部署 main。改 env var 後**需要手動 Redeploy**才會生效（不要勾 Use existing Build Cache）。

另外兩支 workflow：[`smoke.yml`](.github/workflows/smoke.yml)（E2E，見下）與 [`backup.yml`](.github/workflows/backup.yml)（每日 pg_dump，見[資料庫備份](#資料庫備份pg_dump)）。

### E2E smoke

Playwright（`web/e2e/`）對**已部署的 URL** 跑一輪冒煙測試：首頁所有模式卡、鍵盤 `4` / `Esc`、教學模式 Ch05 投影片載入與翻頁、各選擇畫面、概念圖譜節點、9 個模擬器（SVG 無 `NaN`、滑桿會動讀數）、`/health-check` 與 `/api/health-check`。所有會打 Gemini 的 `/api/*` route 都在測試裡被 `page.route(...).abort()` 擋掉，任何 `console.error` / 未捕捉例外都會讓測試失敗，所以跑一次零 token 成本。

```bash
cd web && npm run e2e:install                      # 第一次：裝 Chromium
E2E_BASE_URL=https://nycu-ep-general-physics-tutor.vercel.app npm run e2e
npx playwright show-report playwright-report       # 看失敗截圖 / trace
```

沒設 `E2E_BASE_URL` 就打 `http://localhost:3000`（先 `npm run dev`）。GitHub Actions 的 [`smoke.yml`](.github/workflows/smoke.yml) 在每次 Vercel deployment 成功後自動對 `environment_url` 跑，也可以 `workflow_dispatch` 手動指定 `base_url`；失敗時 `playwright-report` 會上傳成 artifact。

## 已知 TODO

- [x] 概念圖譜為自動產生的初版（每章一個頭條概念），需要老師/同學 review 並調整節點與先修邊 → 後台 🕸️ 圖譜 tab（migration 024）
- [ ] 期中／期末考的章節範圍依實際課程進度可能要再切分（目前預設 midterm = Ch01–Ch16, final = Ch17–Ch31）
- [ ] 教學模式 Header 目前只顯示 `Ch{NN}`，可加上中文章節標題
- [x] 老師自訂題庫（後台 📚 題庫 tab + CSV 匯入，migration 023）
- [x] 概念圖譜編輯介面（老師拖節點 / 加先修邊）→ 後台 🕸️ 圖譜 tab
- [x] IP 限流改 Upstash Redis（設 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 即啟用，否則 in-memory fallback）
- [x] 考古題模式（老師在題庫加 `考古題` + `YYYY-期中/期末` 標籤即可，`/api/past-exams` + `past-exams.tsx`）
- [x] eval harness 擴充到 chat / exam / oral（`web/scripts/eval/`，regex / shape 檢查；LLM-as-judge 仍未做）
- [x] pg_dump 自動備份（GitHub Actions [`backup.yml`](.github/workflows/backup.yml) 每日 03:30 Asia/Taipei，artifact 30 天 + 選用 Supabase Storage bucket；`scripts/backup.sh` / `scripts/restore.sh`）
- [ ] 考完試自動 email 錯題分析報告（`renderAnalysisText()` 已可產出純文字版；還需 Resend/SMTP + cron）
- [ ] 口試加語音（TTS 唸題 + 現有語音輸入）；ScopeSelector 文案仍寫「20 題」，Ch33/34 實際為 22 題
