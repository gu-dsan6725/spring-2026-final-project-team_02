import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HERALD — Policy Memo Agent',
  description:
    'AI-powered policy memo writing with Hierarchical Evidence Review and Automated Legitimacy Detection (HERALD).',
  keywords: ['policy memo', 'HERALD', 'fact-checking', 'AI research', 'claim evaluation'],
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
