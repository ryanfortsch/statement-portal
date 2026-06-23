'use client';

import { useState, useTransition } from 'react';
import {
  issueTestCodeAction,
  issueGuestCodeAction,
  revokeGuestCodeAction,
  syncSeamDevicesAction,
  mapLockAction,
  removeLockCodeAction,
  type CodeActionResult,
} from './guest-code-actions';
import type { GuestCodeView } from '@/lib/guest-locks';

export function GuestCodesPanel({
  propertyId,
  view,
}: {
  propertyId: string;
  view: GuestCodeView;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sel, setSel] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<CodeActionResult>) => {
    setBusy(id);
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      setBusy(null);
    });
  };

  const { seamConfigured, locks, bookingRows, testCodes, unmappedLocks, lockCodes } = view;
  const hasLocks = locks.length > 0;

  return (
    <div style={{ paddingBottom: 6 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
        Programs a time-boxed PIN onto this property&apos;s Seam lock{locks.length > 1 ? 's' : ''} for a stay, and revokes it after.
        This does not text the guest — you issue and share the code yourself.
      </p>

      {msg && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderLeft: `3px solid ${msg.ok ? 'var(--positive)' : 'var(--negative)'}`,
            background: 'var(--paper-2)',
            fontSize: 13,
            color: msg.ok ? 'var(--ink)' : 'var(--negative)',
            lineHeight: 1.5,
          }}
        >
          {msg.text}
        </div>
      )}

      {!seamConfigured && (
        <div style={noteStyle}>
          <code>SEAM_API_KEY</code> isn&apos;t set in this environment yet, so no codes can be issued.
        </div>
      )}

      {seamConfigured && !hasLocks && (
        <div style={noteStyle}>
          No lock mapped to this property yet. Sync your Seam devices, then map this property&apos;s
          lock — no URLs or SQL needed.
        </div>
      )}

      {/* Sync + map controls — always visible when Seam is configured, so you
          can add additional locks even when one is already mapped. */}
      {seamConfigured && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={pending}
              onClick={() => run('sync', () => syncSeamDevicesAction(propertyId))}
              style={ghostBtn(pending && busy === 'sync')}
            >
              {pending && busy === 'sync' ? 'Syncing…' : 'Sync Seam devices'}
            </button>
            {unmappedLocks.length > 0 && (
              <>
                <select value={sel} onChange={(e) => setSel(e.target.value)} style={selectStyle}>
                  <option value="">{hasLocks ? '— add another lock —' : '— pick a lock —'}</option>
                  {unmappedLocks.map((l) => (
                    <option key={l.device_id} value={l.device_id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !sel}
                  onClick={() => run('map', () => mapLockAction(propertyId, sel))}
                  style={ghostBtn(pending && busy === 'map')}
                >
                  {pending && busy === 'map' ? 'Mapping…' : 'Map to this property'}
                </button>
              </>
            )}
          </div>
          {!hasLocks && unmappedLocks.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
              After syncing, any unmapped locks appear here to assign.
            </p>
          )}
        </div>
      )}

      {hasLocks && (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16 }}>
            {locks.length === 1 ? 'Lock' : 'Locks'}:{' '}
            {locks.map((l, i) => (
              <span key={l.device_id}>
                {i > 0 && <span style={{ color: 'var(--ink-4)' }}> · </span>}
                <strong style={{ color: 'var(--ink)' }}>{l.display_name ?? l.device_id}</strong>
              </span>
            ))}
          </div>

          {/* Test code */}
          <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 16, marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={labelStyle}>Pressure test</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run('test', () => issueTestCodeAction(propertyId))}
                style={ghostBtn(pending && busy === 'test')}
              >
                {pending && busy === 'test' ? 'Issuing…' : `Issue test code (3 hrs)${locks.length > 1 ? ` · ${locks.length} locks` : ''}`}
              </button>
            </div>
            {testCodes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {testCodes.map((c) => (
                  <div key={c.id} style={rowStyle}>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 18, letterSpacing: '.12em', color: 'var(--ink)' }}>
                      {c.code}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {c.ends_at ? `expires ${new Date(c.ends_at).toLocaleString()}` : ''}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(c.id, () => revokeGuestCodeAction(propertyId, c.id))}
                      style={revokeBtn(pending && busy === c.id)}
                    >
                      {pending && busy === c.id ? '…' : 'Revoke'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Currently on the lock(s) */}
          <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 16 }}>
            <span style={labelStyle}>Currently on the lock{locks.length > 1 ? 's' : ''}</span>
            {lockCodes.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10 }}>
                No codes on {locks.length === 1 ? 'this lock' : 'these locks'} (or Seam didn&apos;t return any).
              </p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {lockCodes.map((c) => (
                  <div key={c.access_code_id} style={rowStyle}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{c.name ?? 'Code'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                        {c.source === 'external' ? 'set outside Helm' : 'issued by Helm'}
                        {c.lock_name && locks.length > 1 ? ` · ${c.lock_name}` : ''}
                        {c.ends_at ? ` · until ${fmtDate(c.ends_at.slice(0, 10))}` : ''}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 18, letterSpacing: '.12em', color: 'var(--ink)' }}>
                      {c.code ?? '••••'}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm !== c.access_code_id) {
                          setConfirm(c.access_code_id);
                          setTimeout(() => setConfirm((v) => (v === c.access_code_id ? null : v)), 3000);
                          return;
                        }
                        setConfirm(null);
                        run(c.access_code_id, () => removeLockCodeAction(propertyId, c.access_code_id, c.source));
                      }}
                      style={revokeBtn(pending && busy === c.access_code_id)}
                    >
                      {pending && busy === c.access_code_id
                        ? '…'
                        : confirm === c.access_code_id
                          ? 'Confirm remove?'
                          : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming stays */}
          <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 16, marginTop: 22 }}>
            <span style={labelStyle}>Upcoming stays</span>
            {bookingRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10 }}>No upcoming confirmed bookings.</p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {bookingRows.map((b) => (
                  <div key={b.booking_id} style={rowStyle}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{b.guest_name ?? 'Guest'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                        {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                      </div>
                    </div>
                    {b.code ? (
                      <>
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 18, letterSpacing: '.12em', color: 'var(--ink)' }}>
                          {b.code.code}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(b.code!.id, () => revokeGuestCodeAction(propertyId, b.code!.id))}
                          style={revokeBtn(pending && busy === b.code.id)}
                        >
                          {pending && busy === b.code.id ? '…' : 'Revoke'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(b.booking_id, () => issueGuestCodeAction(propertyId, b.booking_id))}
                        style={ghostBtn(pending && busy === b.booking_id)}
                      >
                        {pending && busy === b.booking_id ? 'Issuing…' : `Issue code${locks.length > 1 ? ` · ${locks.length} locks` : ''}`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtDate(s: string): string {
  try {
    return new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 600,
};

const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  background: 'var(--paper-2)',
  borderLeft: '3px solid var(--rule)',
  padding: '10px 14px',
  marginBottom: 16,
  lineHeight: 1.5,
};

const selectStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '12px 0',
  borderBottom: '1px solid var(--rule)',
};

function ghostBtn(p: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink)',
    background: 'transparent',
    border: '1px solid var(--ink)',
    padding: '8px 14px',
    fontWeight: 600,
    cursor: p ? 'wait' : 'pointer',
    opacity: p ? 0.7 : 1,
    whiteSpace: 'nowrap',
  };
}

function revokeBtn(p: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-4)',
    background: 'transparent',
    border: 'none',
    cursor: p ? 'wait' : 'pointer',
    whiteSpace: 'nowrap',
  };
}
