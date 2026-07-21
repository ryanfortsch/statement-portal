'use client';

/**
 * Detail card for an occupied calendar cell in the turnover calendar.
 * Surfaces booking context (guest, platform, dates, payout, confirmation)
 * without bouncing out to Guesty.
 *
 * Cross-device by design:
 *   - Desktop (hover-capable pointers): opens on mouse-enter, closes on
 *     mouse-leave ; the quick-preview behavior the old Radix Tooltip had.
 *   - Mobile / touch: a tap toggles it open (Radix Tooltip never opened on
 *     touch, so taps did nothing before). Tap outside or Escape closes.
 *
 * Built on a *controlled* Popover (Tooltip is hover/focus-only and can't
 * serve touch). `asChild` keeps the cell itself as the trigger so the
 * CSS-grid layout is preserved exactly; the card is purely additive.
 */

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export type CalendarCellTooltipData = {
  guestName: string | null;
  channel: string | null;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  hostPayout: number | null;
  confirmationCode: string | null;
  /** ISO time the guest physically keyed in (guest code) for a current stay,
   *  or null. Drives the "In residence" line + the calendar home glyph. */
  guestArrivedAt: string | null;
  /** Owner / maintenance hold (bookings.status = 'block'): titled from
   *  `hold` and stripped of guest-specific rows (channel, payout, code). */
  isBlock?: boolean;
  /** What the hold actually is, from the Guesty day mirror: the typed note
   *  ("Carpet Cleaning"), structured reason, and who created it. null for
   *  guest stays and for holds the mirror hasn't covered. */
  hold?: {
    kind: 'owner' | 'manual' | 'other';
    note: string | null;
    reason: string | null;
    createdBy: string | null;
    createdAt: string | null;
  } | null;
};

export function CalendarCellTooltip({
  data,
  departing,
  cellIsToday = false,
  children,
}: {
  data: CalendarCellTooltipData;
  /** On a turnover-day cell the morning belongs to a DIFFERENT stay than the
   *  night. Pass the departing stay here and the card stacks both: the
   *  departure above, the arrival (`data`) below — so the outgoing guest's
   *  details stop hiding behind a hover on the previous day. */
  departing?: CalendarCellTooltipData;
  /** True only for the today column. Turnover cells on other dates keep the
   *  date-neutral "Departing / Arriving" eyebrows — a Jul 12 flip hovered on
   *  Jul 6 must not claim anything is happening "today". */
  cellIsToday?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        // Hover preview on devices with a real pointer. Touch fires
        // pointerenter too, so gate on pointerType; taps fall through to
        // the trigger's built-in click toggle (controlled via onOpenChange).
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setOpen(false);
        }}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        // Read-only card, don't steal focus / scroll the page open on tap.
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={{
          width: 'auto',
          minWidth: 240,
          maxWidth: 320,
          background: 'var(--paper)',
          color: 'var(--ink)',
          border: '1px solid var(--ink)',
          padding: '14px 16px',
          fontSize: 12,
          lineHeight: 1.45,
          letterSpacing: 0,
          textTransform: 'none',
          borderRadius: 0,
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        }}
      >
        {departing ? (
          <>
            <StayBlock data={departing} eyebrow={cellIsToday ? 'Out today' : 'Departing'} />
            <div style={{ borderTop: '1px solid var(--rule)', margin: '12px 0' }} />
            <StayBlock data={data} eyebrow={cellIsToday ? 'In today' : 'Arriving'} />
          </>
        ) : (
          <StayBlock data={data} />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One stay's detail rows: name, channel, dates/payout/code grid, presence.
 *  Rendered once for a normal cell, twice (stacked, with Out/In eyebrows)
 *  for a turnover-day cell. Block holds get a stripped variant. */
function StayBlock({ data, eyebrow }: { data: CalendarCellTooltipData; eyebrow?: string }) {
  // A hold titles itself from the Guesty day mirror when it can: the typed
  // note wins ("Carpet Cleaning"), then the structured reason, then the
  // owner designation; a hold the mirror hasn't covered stays a plain
  // "Hold". The category line underneath plays the role the channel line
  // plays for a stay.
  const holdNote = data.hold?.note?.trim() || null;
  const holdReason = data.hold?.reason?.trim() || null;
  const isOwnerHold = data.hold?.kind === 'owner';
  const holdTitle = holdNote ?? holdReason ?? (isOwnerHold ? 'Owner hold' : 'Hold');
  // Guesty reasons sometimes already say "block" ("Owner block"), so only
  // append the word when it isn't there — never "Owner block block".
  let holdKind: string | null = null;
  if (data.hold) {
    if (isOwnerHold) holdKind = holdTitle === 'Owner hold' ? null : 'Owner block';
    else if (holdNote && holdReason)
      holdKind = /block$/i.test(holdReason) ? holdReason : `${holdReason} block`;
    else holdKind = 'Manual block';
  }
  return (
    <div>
      {eyebrow && (
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--signal)',
            fontWeight: 600,
            marginBottom: 3,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        className="font-serif"
        style={{
          fontSize: 16,
          fontWeight: 400,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginBottom: 2,
          fontStyle: data.isBlock ? 'italic' : 'normal',
        }}
      >
        {data.isBlock ? holdTitle : data.guestName || 'Unnamed guest'}
      </div>
      {data.isBlock && holdKind && (
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--tide-deep)',
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          {holdKind}
        </div>
      )}
      {!data.isBlock && data.channel && (
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--tide-deep)',
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          {data.channel}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', rowGap: 4, columnGap: 12 }}>
        <span style={{ color: 'var(--ink-4)' }}>{data.isBlock ? 'Held' : 'Stay'}</span>
        <span style={{ color: 'var(--ink)' }}>
          {formatShort(data.checkIn)} → {formatShort(data.checkOut)}
          {data.nights ? ` · ${data.nights} nt${data.nights === 1 ? '' : 's'}` : ''}
        </span>
        {!data.isBlock && data.hostPayout != null && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>Payout</span>
            <span className="tabular-nums" style={{ color: 'var(--ink)', fontWeight: 500 }}>
              {formatCurrency(data.hostPayout)}
            </span>
          </>
        )}
        {!data.isBlock && data.confirmationCode && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>Code</span>
            <span
              className="font-mono"
              style={{ color: 'var(--ink-3)', fontSize: 11, letterSpacing: '0.03em' }}
            >
              {data.confirmationCode}
            </span>
          </>
        )}
        {data.isBlock && data.hold?.createdBy && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>Set by</span>
            <span style={{ color: 'var(--ink)' }}>
              {friendlySetBy(data.hold.createdBy, data.hold.kind)}
              {data.hold.createdAt ? ` · ${formatShort(data.hold.createdAt.slice(0, 10))}` : ''}
            </span>
          </>
        )}
      </div>
      {/* Guest-presence: a green "in residence" line when the guest has
          physically keyed in on a guest code during this current stay. */}
      {data.guestArrivedAt && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--rule-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: 'var(--positive)',
            fontWeight: 500,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 3 2 11h2.2v9H10v-5.5h4V20h5.8v-9H22z" />
          </svg>
          In residence · keyed in {formatArrival(data.guestArrivedAt)}
        </div>
      )}
    </div>
  );
}

/** Who placed a hold, kept short: staff emails become a first name
 *  ("allie@risingtidestr.com" → "Allie"), an owner-portal block says so
 *  explicitly, anything else shows as-is. */
function friendlySetBy(email: string, kind: 'owner' | 'manual' | 'other'): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (domain === 'risingtidestr.com') {
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }
  return kind === 'owner' ? `Owner (${email})` : email;
}

function formatShort(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** "3:14p Sat": the guest's keypad entry time, in Eastern (the lock's local
 *  time), kept compact for the one-line in-residence row. */
function formatArrival(iso: string): string {
  try {
    const d = new Date(iso);
    const time = d
      .toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      })
      .replace(' AM', 'a')
      .replace(' PM', 'p');
    const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
    return `${time} ${day}`;
  } catch {
    return '';
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
