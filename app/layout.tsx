import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mailbox Pool',
  description: 'Shared mailbox queue for distributed workers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
