import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/components/theme-provider";
import { Providers } from "@/components/providers";

const SITE_URL = "https://nycu-ep-general-physics-tutor.vercel.app";
const SITE_TITLE = "普通物理 AI 助教";
const SITE_DESCRIPTION = "NYCU 電物系普通物理課程（楊本立老師）AI 助教系統 — RAG + Gemini + 32 章教材，含蘇格拉底引導、費曼學習、章節 / 跨章節測驗、信心校準、錯題本、每日 5 分鐘複習等十餘種主動學習工具。";

export const metadata: Metadata = {
  title: { default: SITE_TITLE, template: `%s · ${SITE_TITLE}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_TITLE,
  authors: [{ name: "NYCU EP" }],
  keywords: ["NYCU", "普通物理", "AI 助教", "Physics tutor", "RAG", "Gemini"],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "zh_TW",
    url: SITE_URL,
    siteName: SITE_TITLE,
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* Apply stored theme before React hydrates to avoid FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
