'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TEAM_MEMBERS,
  type TeamMember,
  getTeamMember,
  initialsForEmail,
  displayNameForEmail,
} from '@/lib/team';

type Props = {
  /** Currently assigned email, or null/empty for unassigned. */
  value: string | null;
  /** Called when the user picks a team member, clears, or types a custom email. */
  onChange: (next: string | null) => void;
  /** Disable while a parent action is in flight. */
  disabled?: boolean;
  /** Show "Assign to me" (current user's email) as a quick-pick row. */
  myEmail?: string | null;
  /** Optional placeholder text for the trigger when nothing is selected. */
  placeholder?: string;
};

/**
 * Editorial-styled assignee picker. Trigger shows initials + name. Open
 * panel lists active TEAM_MEMBERS, plus an "Assign to me" quick row, an
 * "Unassign" row, and a "Custom email…" escape hatch for one-off
 * contractors. Returns the canonical email string (or null).
 *
 * Stays out of HTML form submission — the parent reads `value` from
 * its own state.
 */
export function TeamPicker({ value, onChange, disabled, myEmail, placeholder = 'Unassigned' }: Props) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // `pointerdown` covers mouse, touch, and pen in one event. iOS
    // Safari can fail to fire `mousedown` reliably on touch inside
    // certain modal contexts, which is why tapping a picker row
    // looked like nothing happened on a phone — the close detection
    // missed the tap entirely.
    function onDoc(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCustomMode(false);
      }
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  const selectedMember = getTeamMember(value);
  const display = value ? displayNameForEmail(value) : placeholder;
  const initials = value ? initialsForEmail(value) : '+';

  function pick(email: string | null) {
    onChange(email);
    setOpen(false);
    setCustomMode(false);
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = customEmail.trim();
    if (!trimmed) return;
    pick(trimmed);
    setCustomEmail('');
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px 6px 6px',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          color: 'var(--ink)',
          cursor: disabled ? 'default' : 'pointer',
          fontSize: 13,
          minWidth: 160,
        }}
      >
        <Avatar initials={initials} dimmed={!value} />
        <span style={{ flex: 1, textAlign: 'left', color: value ? 'var(--ink)' : 'var(--ink-3)' }}>
          {display}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>▾</span>
      </button>

      {/* Backdrop only renders on mobile (CSS hides it on wider screens).
          Lets us darken the page behind the bottom-sheet panel so it
          reads clearly as a contextual modal, plus gives a tap target
          for dismiss outside the picker. */}
      {open && <div className="rt-team-picker-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div
          className="rt-team-picker-panel"
          // Inline styles cover the desktop dropdown layout; the CSS
          // class flips them to a bottom-sheet at <=640px. Inline takes
          // precedence over class only for the properties listed here,
          // so the @media block uses !important to override.
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 60,
            minWidth: 240,
            maxHeight: '60vh',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            boxShadow: '0 8px 28px rgba(30, 46, 52, 0.12)',
            padding: 4,
          }}
        >
          {customMode ? (
            <form onSubmit={applyCustom} style={{ padding: 8 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Custom email</div>
              <input
                type="email"
                autoFocus
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                placeholder="contractor@example.com"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--rule)',
                  background: 'var(--paper)',
                  fontSize: 13,
                  color: 'var(--ink)',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="submit" style={pickerActionBtn(true)}>Assign</button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    setCustomEmail('');
                  }}
                  style={pickerActionBtn(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {myEmail && !TEAM_MEMBERS.some((m) => m.email === myEmail) && (
                <PickerRow
                  initials={initialsForEmail(myEmail)}
                  primary="Assign to me"
                  secondary={myEmail}
                  selected={value === myEmail}
                  onClick={() => pick(myEmail)}
                />
              )}
              {myEmail && TEAM_MEMBERS.some((m) => m.email === myEmail) && (
                <PickerRow
                  initials={initialsForEmail(myEmail)}
                  primary="Assign to me"
                  secondary={displayNameForEmail(myEmail)}
                  selected={value === myEmail}
                  onClick={() => pick(myEmail)}
                />
              )}

              {TEAM_MEMBERS.filter((m) => m.active).map((m: TeamMember) => (
                <PickerRow
                  key={m.email}
                  initials={m.initials}
                  primary={m.name}
                  secondary={`${m.role} · ${m.email}`}
                  selected={value === m.email}
                  onClick={() => pick(m.email)}
                />
              ))}

              <div style={{ borderTop: '1px solid var(--rule)', marginTop: 4, paddingTop: 4 }}>
                {value && !selectedMember && (
                  <PickerRow
                    initials={initialsForEmail(value)}
                    primary="Custom"
                    secondary={value}
                    selected
                    onClick={() => {}}
                  />
                )}
                <PickerRow
                  initials="+"
                  primary="Custom email…"
                  secondary="One-off contractor"
                  onClick={() => setCustomMode(true)}
                />
                {value && (
                  <PickerRow
                    initials="·"
                    primary="Unassign"
                    secondary="Leave open for anyone"
                    onClick={() => pick(null)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  initials,
  primary,
  secondary,
  selected,
  onClick,
}: {
  initials: string;
  primary: string;
  secondary?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        // Was 8/10. Bumped to 12/12 so each row clears a 44px touch
        // target (the iOS recommended minimum); previously rows were
        // ~36px tall and adjacent ones were easy to mis-tap on a phone.
        padding: '12px',
        background: selected ? 'var(--paper-2)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--ink)',
      }}
    >
      <Avatar initials={initials} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>{primary}</div>
        {secondary && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {secondary}
          </div>
        )}
      </div>
      {selected && <span style={{ fontSize: 11, color: 'var(--signal)' }}>✓</span>}
    </button>
  );
}

function Avatar({ initials, dimmed }: { initials: string; dimmed?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: dimmed ? 'transparent' : 'var(--ink)',
        border: dimmed ? '1px dashed var(--rule)' : '1px solid var(--ink)',
        color: dimmed ? 'var(--ink-3)' : 'var(--paper)',
        fontSize: 10,
        letterSpacing: '.04em',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

function pickerActionBtn(primary: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '6px 10px',
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 500,
    cursor: 'pointer',
    background: primary ? 'var(--ink)' : 'transparent',
    color: primary ? 'var(--paper)' : 'var(--ink-3)',
    border: '1px solid var(--ink)',
  };
}
