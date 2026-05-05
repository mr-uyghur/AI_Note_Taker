import { useState, useEffect } from 'react';
import { Login } from './routes/Login';
import { Recorder } from './routes/Recorder';
import { getAuthState } from './lib/auth';

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    getAuthState()
      .then(setAuthed)
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <span className="text-muted text-sm">Loading…</span>
      </div>
    );
  }

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return <Recorder />;
}
