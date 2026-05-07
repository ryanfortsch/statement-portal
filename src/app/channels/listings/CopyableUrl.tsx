'use client';

import { useState } from 'react';

export function CopyableUrl({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        readOnly
        value={value}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className="font-mono"
        style={{
          fontSize: 11,
          padding: '8px 10px',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          color: 'var(--ink)',
          width: '100%',
        }}
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // ignore — readOnly input lets the user select manually
          }
        }}
        style={{
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          fontWeight: 600,
          padding: '8px 14px',
          background: copied ? 'var(--positive)' : 'var(--ink)',
          color: 'var(--paper)',
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
