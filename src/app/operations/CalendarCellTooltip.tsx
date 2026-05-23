'use client';

/**
 * Detail card for an occupied calendar cell in the turnover calendar.
 * Surfaces booking context (guest, platform, dates, payout, confirmation)
 * without bouncing out to Guesty.
 *
 * Cross-device by design:
 *   - Desktop (hover-capable pointers): opens on mouse-enter, closes on
 *     mouse-leave — the quick-preview behavior the old Radix Tooltip had.
 *   - Mobile / touch: a tap toggles it open (Radix Tooltip never opened on
 *     touch, so taps did nothing before). Tap outside or Escape closes.
 *
 * Built on a *controlled* Popover (Tooltip is hover/focus-only and can't
 * serve touch). `asChild` keeps the cell itself as the trigger so the
 * CSS-grid layout is preserved exactly — the card is purely additive.
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
};

export function CalendarCellTooltip({
  data,
  children,
}: {
  data: CalendarCellTooltipData;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        asChild
        // Hover preview on devices with a real pointer. Touch fires
        // pointerenter too, so gate on pointerType — taps fall through to
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
        // Read-only card — don't steal focus / scroll the page open on tap.
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
        <div
          className="font-serif"
          style={{
            fontSize: 16,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            marginBottom: 2,
          }}
        >
          {data.guestName || 'Unnamed guest'}
        </div>
        {data.channel && (
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
          <span style={{ color: 'var(--ink-4)' }}>Stay</span>
          <span style={{ color: 'var(--ink)' }}>
            {formatShort(data.checkIn)} → {formatShort(data.checkOut)}
            {data.nights ? ` · ${data.nights} nt${data.nights === 1 ? '' : 's'}` : ''}
          </span>
          {data.hostPayout != null && (
            <>
              <span style={{ color: 'var(--ink-4)' }}>Payout</span>
              <span className="tabular-nums" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                {formatCurrency(data.hostPayout)}
              </span>
            </>
          )}
          {data.confirmationCode && (
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
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatShort(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
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
