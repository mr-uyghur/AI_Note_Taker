'use client';

import { useRouter } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-base">
      <header className="h-12 border-b border-border flex items-center justify-between px-6">
        <span className="text-default font-semibold tracking-tight">Utter</span>
        <button
          onClick={handleLogout}
          className="text-muted text-sm hover:text-default transition-colors"
        >
          Logout
        </button>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
