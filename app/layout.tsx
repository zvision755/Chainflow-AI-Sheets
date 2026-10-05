import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChainFlow AI Sheets",
  description: "中文表格式 AI 工作流 · 依赖调度 · API 与 Agent 模式",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
