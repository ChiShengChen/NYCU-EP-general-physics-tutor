# 普通物理 AI 助教 (NYCU 電物系)

基於 RAG (Retrieval-Augmented Generation) 架構的 AI 助教系統，專為陽明交通大學電子物理系「普通物理」課程（楊本立老師）設計。範圍：University Physics (Young & Freedman) Ch01–Ch31，涵蓋力學、振盪、流體、波動、聲學、熱學、電磁學與電路。

> 本專案由同系的 [`NYCU_EP_AI_tutor`](../NYCU_EP_AI_tutor)（雷射導論版）改造而來，主要差異：
> - 講義來源改為 31 章普通物理 PDF（`../普通物理_楊本立老師/`）
> - 資料模型由「週次」改為「章節」（`chapter_number = 1..31`）
> - 投影片儲存路徑：`slides/ch_{N}_page_{M}.jpg`
> - 概念圖譜重建為四類別：力學 / 振盪流體波動 / 熱學 / 電磁學

## 技術棧

| 類別 | 技術 | 用途 |
| :--- | :--- | :--- |
| Frontend | Next.js + React + Tailwind | 應用程式框架與 UI |
| AI SDK | Vercel AI SDK v6 | 串流、工具呼叫、結構化輸出 |
| LLM | Google Gemini 2.5 Flash | 文本生成、Vision PDF 解析、測驗出題 |
| Embedding | gemini-embedding-001（768 維） | 向量嵌入 |
| Vector DB | Supabase pgvector | 向量資料庫與後端服務 |
| Math | KaTeX | LaTeX 公式渲染 |
| Web Search | Brave Search API | 外部資訊檢索（選填） |

## 環境變數

| 變數名稱 | 必填 | 取得來源 |
| :--- | :--- | :--- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ✅ | https://aistudio.google.com/apikey |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase Dashboard（**請新開一個 project**，不要與雷射版共用） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 同上 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 同上 |
| `BRAVE_SEARCH_API_KEY` | ⚪ | https://brave.com/search/api/ |
| `CHAT_MODEL` | — | 預設 `gemini-2.5-flash` |
| `EMBEDDING_MODEL` | — | 預設 `gemini-embedding-001` |
| `VISION_MODEL` | — | 預設 `gemini-2.5-flash` |

## 快速入門

```bash
# 1) 安裝前端依賴
cd web && npm install

# 2) 安裝離線 pipeline 依賴（建議用獨立 venv）
cd ..
python -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

# 3) 在 Supabase SQL Editor 執行 supabase/migrations/001_initial.sql

# 4) 試跑 — 先解析 Ch01–Ch03 驗證 pipeline
python scripts/parse_pdfs.py --chapters 1-3
python scripts/extract_slides.py --chapters 1-3
python scripts/chunk_and_embed.py

# 5) 啟動開發伺服器
cd web && npm run dev
# 開啟 http://localhost:3000

# 6) 試跑 OK 後，跑完整 31 章
python scripts/parse_pdfs.py
python scripts/extract_slides.py
python scripts/chunk_and_embed.py
```

## 八種學習模式

教學模式、自由問答、自動測驗、考試模擬、概念圖譜、AI 學習計畫、學習儀表板、對話歷史。功能與雷射版一致，已重新標定為普通物理脈絡。

## 已知 TODO

- [ ] 概念圖譜為自動產生的初版（每章一個頭條概念），需要老師/同學 review 並調整節點與先修邊
- [ ] 期中／期末考的章節範圍依實際課程進度可能要再切分（目前預設 midterm = Ch01–Ch16, final = Ch17–Ch31）
- [ ] 教學模式 Header 目前只顯示 `Ch{NN}`，可加上中文章節標題
