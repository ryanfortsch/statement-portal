import type { CompetitorEvent } from '@/lib/competitors/events';

type Props = {
  events: CompetitorEvent[];
  lastSyncAt: string | null;
};

/**
 * "Recent changes" feed on the competitor detail page. Renders the last N
 * inventory events (added / dropped / returned) as an editorial timeline.
 * No infinite scroll — phase 1 just shows the most recent batch and lets
 * Dotti know at a glance what shifted.
 */
export function RecentChanges({ events, lastSyncAt }: Props) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span>Recent changes</span>
        {lastSyncAt && (
          <span style={{ color: 'var(--ink-4)', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
            Last sync · {formatRelative(lastSyncAt)}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--rule)',
            padding: '24px 22px',
            color: 'var(--ink-4)',
            fontSize: 13,
          }}
        >
          No inventory changes recorded yet. The weekly cron runs Sunday 8am UTC; or click <em style={{ fontStyle: 'italic' }}>Sync inventory now</em> above to seed the tracker from the current listings file.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {events.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event: e }: { event: CompetitorEvent }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr 130px',
        gap: 16,
        alignItems: 'baseline',
        padding: '12px 0',
        borderBottom: '1px solid var(--rule)',
        fontSize: 13,
      }}
    >
      <EventChip type={e.eventType} />
      <span className="font-serif" style={{ fontSize: 15, color: 'var(--ink)' }}>
        {e.listingName}
      </span>
      <span
        title={new Date(e.detectedAt).toLocaleString()}
        style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right', whiteSpace: 'nowrap' }}
      >
        {formatRelative(e.detectedAt)}
      </span>
    </div>
  );
}

function EventChip({ type }: { type: CompetitorEvent['eventType'] }) {
  const config = {
    added:    { label: 'NEW',      color: 'var(--positive)', bg: 'rgba(58, 107, 74, 0.14)' },
    dropped:  { label: 'DROPPED',  color: 'var(--negative)', bg: 'rgba(138, 58, 46, 0.12)' },
    returned: { label: 'RETURNED', color: 'var(--tide-deep)', bg: 'rgba(46, 92, 110, 0.14)' },
    changed:  { label: 'CHANGED',  color: 'var(--ink)',      bg: 'rgba(30, 46, 52, 0.08)' },
    renamed:  { label: 'RENAMED',  color: 'var(--ink)',      bg: 'rgba(30, 46, 52, 0.08)' },
  }[type];
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.18em',
        color: config.color,
        background: config.bg,
        padding: '3px 8px',
        textAlign: 'center',
        justifySelf: 'start',
      }}
    >
      {config.label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
