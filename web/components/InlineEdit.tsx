'use client';

import { useRef, useState } from 'react';

interface InlineEditProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  className?: string;
}

export default function InlineEdit({ value, onSave, className = '' }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commit() {
    if (draft.trim() === value || !draft.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        disabled={saving}
        className={[
          'bg-transparent border-b border-[var(--accent)] focus:outline-none',
          className,
        ].join(' ')}
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      title="Click to rename"
      className={['hover:opacity-70 transition-opacity text-left', className].join(' ')}
    >
      {value}
    </button>
  );
}
