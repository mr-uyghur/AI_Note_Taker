'use client';

import { useState } from 'react';
import type { Recording } from '@shared/types';

interface ShareToggleProps {
  recording: Recording;
}

export default function ShareToggle({ recording }: ShareToggleProps) {
  const [enabled, setEnabled] = useState(recording.share.enabled);
  const [token, setToken] = useState(recording.share.token);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = token
    ? `${window.location.origin}/s/${token}`
    : null;

  async function toggle() {
    setLoading(true);
    const res = await fetch(`/api/recordings/${recording._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share: { enabled: !enabled } }),
    });
    if (res.ok) {
      const updated = (await res.json()) as Recording;
      setEnabled(updated.share.enabled);
      setToken(updated.share.token);
      if (updated.share.enabled && updated.share.token) {
        const url = `${window.location.origin}/s/${updated.share.token}`;
        await navigator.clipboard.writeText(url).catch(() => null);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
    setLoading(false);
  }

  async function copy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-muted text-sm">Share</span>
        <button
          onClick={toggle}
          disabled={loading}
          className={[
            'relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50',
            enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-elevated)]',
          ].join(' ')}
          aria-pressed={enabled}
        >
          <span
            className={[
              'inline-block h-4 w-4 mt-0.5 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0.5',
            ].join(' ')}
          />
        </button>
      </div>

      {enabled && shareUrl && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={shareUrl}
            className="flex-1 bg-[var(--bg-elevated)] text-muted text-xs px-3 py-1.5 rounded border border-[var(--border)] select-all"
          />
          <button
            onClick={copy}
            className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
