'use client';

/**
 * Hover card for an occupied calendar cell in the Operations turnover
 * calendar. Lets the operator land on a cell with their eye and pick up
 * booking context (platform, dates, payout, confirmation) without
 * bouncing out to Guesty.
 *
 * Wraps the existing cell content as the Tooltip trigger via `asChild`
 * so the CSS-grid layout in CalendarGrid is preserved exactly — the
 * tooltip is purely additive. Each instance carries its own
 * TooltipProvider so the parent CalendarGrid can stay server-rendered
 * and just drop these in for cells that have a reservation.
 *
 * Follows the InfoTip pattern already used on /marketing for the small
 * superscript info tooltips, so the visual language stays consistent.
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: '1px solid var(--ink)',
            padding: '14px 16px',
            minWidth: 240,
            maxWidth: 320,
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
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
