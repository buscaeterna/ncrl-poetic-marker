import type { Metadata } from "next";
import "./globals.css";

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "ncrl-poetic-marker";
const basePath =
  process.env.GITHUB_PAGES === "true" ? `/${repositoryName}` : "";

export const metadata: Metadata = {
  title: "Разметчик стихов НКРЯ",
  description: "Локальный редактор и валидатор метрической разметки поэтических текстов.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
