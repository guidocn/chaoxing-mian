import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '超星云刷课平台',
    template: '%s | 超星云刷课',
  },
  description: '多账号并行的超星学习通云端自动刷课平台，支持视频、文档、测验任务点自动完成。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>{children}</body>
    </html>
  );
}
