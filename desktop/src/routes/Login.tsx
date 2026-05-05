import { useState, FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { verifyAdmin } from '../lib/auth';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const ok = await verifyAdmin(username, password);
      if (ok) {
        onSuccess();
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError('Login failed. Is the app configured?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="bg-panel border border-border rounded-lg p-8 w-80">
        <h1 className="text-default text-lg font-semibold mb-6 tracking-tight">Utter</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-muted text-xs">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="bg-elev border border-border rounded px-3 py-2 text-default text-sm outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-muted text-xs">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="bg-elev border border-border rounded px-3 py-2 text-default text-sm outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}

          <Button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
