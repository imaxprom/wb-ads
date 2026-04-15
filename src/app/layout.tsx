import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WB Ads",
  description: "Дашборд управления рекламой Wildberries",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
