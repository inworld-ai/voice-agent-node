import type { Metadata } from 'next';
import { ThemeProvider } from './providers/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voice Agent Application',
  description: 'AI voice agent powered by Inworld AI',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
