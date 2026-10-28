import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "工时簿 · 勤工俭学",
  description: "学生填报、负责人审核与月度工时费用汇总",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
