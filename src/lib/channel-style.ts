/**
 * Channel color + label helpers shared by the turnover list and the
 * occupancy calendar. Kept muted to fit the editorial palette: a thin
 * spine on calendar blocks, a small dot in the turnover list.
 */

export function channelAccent(channel: string | null): string {
  const c = (channel || '').toLowerCase();
  if (c.includes('airbnb')) return 'var(--negative)'; // rust — Airbnb is red
  if (c.includes('vrbo') || c.includes('homeaway')) return 'var(--tide)'; // blue
  if (c.includes('booking')) return 'var(--tide-deep)'; // navy — Booking.com
  if (c.includes('direct') || c.includes('manual')) return 'var(--positive)'; // green — our own
  if (c.includes('block')) return 'var(--ink-4)'; // grey — owner/maintenance block
  return 'var(--ink-4)';
}

export function channelLabel(channel: string | null): string {
  const c = (channel || '').toLowerCase();
  if (c.includes('airbnb')) return 'Airbnb';
  if (c.includes('vrbo') || c.includes('homeaway')) return 'VRBO';
  if (c.includes('booking')) return 'Booking.com';
  if (c.includes('direct') || c.includes('manual')) return 'Direct';
  if (c.includes('block')) return 'Block';
  return channel || 'Other';
}
