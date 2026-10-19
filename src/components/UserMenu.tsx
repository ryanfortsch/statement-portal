'use client';

/**
 * The avatar in HelmMasthead: a small menu with who is signed in, the
 * View as staff switch for an owner, and Sign out.
 *
 * Compact form: a single circular avatar with the user's first initial.
 * Reads the session via useSession() from next-auth/react (client-side)
 * so this component is safe to render anywhere, including inside a
 * 'use client' page tree like /statements. A previous server-component
 * version called auth() -> headers(), which threw "headers was called
 * outside a request scope" when /statements pulled HelmMasthead in.
 *
 * The switch reads the view the root layout resolved (useHelmView), never
 * the cookie: an owner in owner view gets "View as staff", an owner in
 * staff view "Back to owner view", and a staff login neither.
 *
 * Renders nothing while the session is loading or unauthenticated, so
 * the masthead on /auth/signin doesn't show a stray avatar.
 */

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useHelmView } from './HelmViewContext';
import { useViewAsSwitch } from './useViewAsSwitch';

export function UserMenu() {
  const { data: session, status } = useSession();
  const view = useHelmView();
  const { pending, toStaff, toOwner } = useViewAsSwitch();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status !== 'authenticated' || !session?.user?.email) return null;

  const email = session.user.email;
  const username = email.split('@')[0];
  const initial =
    (session.user.name || username).trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-label={`Account menu for ${username}`}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: view.viewingAsStaff ? 'var(--signal-soft)' : 'var(--paper-2)',
          border: open ? '1px solid var(--ink)' : '1px solid var(--rule)',
          color: 'var(--ink-2)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontFamily: 'inherit',
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            right: 0,
            zIndex: 60,
            minWidth: 230,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 14px 40px -16px rgba(30, 46, 52, 0.35)',
            padding: '6px 0',
          }}
        >
          <div style={{ padding: '8px 16px 10px', borderBottom: '1px solid var(--rule-soft)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500 }}>
              {view.viewingAsStaff ? 'Viewing as staff' : 'Signed in'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, overflowWrap: 'anywhere' }}>{email}</div>
          </div>
          {view.mayViewAsStaff && (
            <MenuItem disabled={pending} onPick={() => { setOpen(false); toStaff(); }}>
              View as staff
            </MenuItem>
          )}
          {view.viewingAsStaff && (
            <MenuItem disabled={pending} onPick={() => { setOpen(false); toOwner(); }}>
              Back to owner view
            </MenuItem>
          )}
          <MenuItem onPick={() => signOut({ callbackUrl: '/auth/signin' })}>Sign out</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onPick, disabled }: { children: React.ReactNode; onPick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      disabled={disabled}
      className="hover:bg-[var(--paper-2)]"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        padding: '9px 16px',
        fontFamily: 'inherit',
        fontSize: 14,
        color: 'var(--ink)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
