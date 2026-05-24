import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Joe Hudson Coach (G-010 web-app)',
  description: 'Minimal chat scaffold (E-040). Real coach lands in E-043.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
