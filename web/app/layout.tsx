import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Utter',
  description: 'Meeting recording and transcription',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base text-default">
        {children}
      </body>
    </html>
  );
}
