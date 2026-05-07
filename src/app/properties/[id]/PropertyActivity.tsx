import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { displayNameForEmail } from '@/lib/team';
import type { HelmPropertyRow } from '@/lib/properties';

type ActivityKind =
  | 'slip-created'
  | 'slip-done'
  | 'slip-snoozed'
  | 'slip-owner-contacted'
  | 'inspection-completed'
  | 'plan-created'
  | 'property-note-created'
  | 'property-note-resolved'
  | 'property-contacted'
  | 'contact-touch';

export type ActivityEvent = {
  at: string;             // ISO timestamp
  kind: ActivityKind;
  actor: string | null;   // email — rendered as displayName
  label: string;          // primary text, e.g. "Filed kitchen leak"
  secondary?: string;     // small grey text, e.g. "in_progress · high"
  href?: string;          // click target
};

type Props = {
  property: HelmPropertyRow;
};

const KIND_GLYPH: Record<ActivityKind, string> = {
  'slip-created': '+',
  'slip-done': '✓',
  'slip-snoozed': 'z',
  'slip-owner-contacted': '→',
  'inspection-completed': '⚑',
  'plan-created': '◷',
  'property-note-created': '✎',
  'property-note-resolved': '✕',
  'property-contacted': '☎',
  'contact-touch': '☎',
};

const KIND_COLOR: Record<ActivityKind, string> = {
  'slip-created': 'var(--ink-3)',
  'slip-done': 'var(--positive)',
  'slip-snoozed': 'var(--tide-deep)',
  'slip-owner-contacted': 'var(--signal)',
  'inspection-completed': 'var(--tide-deep)',
  'plan-created': 'var(--tide-deep)',
  'property-note-created': 'var(--ink-3)',
  'property-note-resolved': 'var(--positive)',
  'property-contacted': 'var(--signal)',
  'contact-touch': 'var(--signal)',
};

/**
 * Property-scoped activity feed: rolls up slip lifecycle, owner contact
 * touches, inspections, plans, and property notes into a single time-
 * ordered list. Read-only — every event is sourced from data already
 * written by other Helm features. No new schema.
 *
 * Caps at the last 30 events so the list doesn't dominate the page on
 * properties with deep history.
 */
export async function PropertyActivity({ property }: Props) {
  const events = await loadActivity(property);
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          Activity
        </h2>
        <span className="eyebrow">
          {events.length === 0 ? 'no activity' : `last ${Math.min(events.length, 30)} of ${events.length}`}
        </span>
      </div>
      <PropertyActivityList events={events} />
    </section>
  );
}

/** Loads the same event stream the full PropertyActivity component renders.
 *  Exported so callers (e.g. the property page's CollapsibleSection wrapping)
 *  can derive their own summary chip without doing the queries twice. */
export async function loadPropertyActivity(property: HelmPropertyRow): Promise<ActivityEvent[]> {
  return loadActivity(property);
}

/** Body-only renderer — no `<section>`, no header, no eyebrow chip. The
 *  parent supplies the title (typically a CollapsibleSection summary line).
 *  Caps display at the most recent 30 events. */
export function PropertyActivityList({ events }: { events: ActivityEvent[] }) {
  const visible = events.slice(0, 30);
  if (events.length === 0) {
    return (
      <div style={{ padding: '4px 0 16px', color: 'var(--ink-3)', fontSize: 13 }}>
        No activity recorded for this property yet.
      </div>
    );
  }
  return (
    <div>
      {visible.map((e, i) => (
        <ActivityRow key={`${e.kind}-${e.at}-${i}`} event={e} />
      ))}
    </div>
  );
}

function ActivityRow({ event: e }: { event: ActivityEvent }) {
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          background: 'var(--paper-2)',
          color: KIND_COLOR[e.kind],
          fontSize: 11,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {KIND_GLYPH[e.kind]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          {e.actor && (
            <span style={{ fontWeight: 500 }}>{displayNameForEmail(e.actor)} </span>
          )}
          {e.label}
        </div>
        {e.secondary && (
          <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
            {e.secondary}
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-4)',
          letterSpacing: '.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {formatRelative(e.at)}
      </span>
    </div>
  );
  if (e.href) {
    return (
      <Link href={e.href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

async function loadActivity(p: HelmPropertyRow): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];

  // Pull every active + recent slip for this property (last 90 days of done
  // slips so the feed shows historical lifecycle, not just open work).
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Pull contact ids whose linked_property_ids includes this property.
  // Used as a key list for the contact_touches join below.
  const { data: linkedContactsData } = await supabase
    .from('contacts')
    .select('id, name')
    .contains('linked_property_ids', [p.id]);
  const linkedContactIds = ((linkedContactsData ?? []) as Array<{ id: string; name: string }>).map((c) => c.id);
  const linkedContactNames = new Map<string, string>(
    ((linkedContactsData ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );

  const [slipsRes, inspectionsRes, plansRes, notesRes, touchesRes] = await Promise.all([
    supabase
      .from('work_slips')
      .select('id, title, status, priority, created_at, created_by_email, completed_at, closed_by_email, owner_last_contacted_at, owner_action_type, owner_action_required, snoozed_at, snoozed_until, snoozed_by_email')
      .eq('property_id', p.id)
      .or(`created_at.gte.${ninetyDaysAgo},completed_at.gte.${ninetyDaysAgo},owner_last_contacted_at.gte.${ninetyDaysAgo},snoozed_at.gte.${ninetyDaysAgo}`)
      .limit(60),
    supabase
      .from('inspections')
      .select('id, inspector_name, completed_at, started_at, total_items, issue_count')
      .eq('property_id', p.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', ninetyDaysAgo)
      .order('completed_at', { ascending: false })
      .limit(20),
    supabase
      .from('inspection_plans')
      .select('id, planned_for_date, planned_by_email, assigned_to_email, created_at, checkin_date')
      .eq('property_id', p.id)
      .gte('created_at', ninetyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inspection_notes')
      .select('id, note_text, created_at, author_email, resolved_at, resolved_by_email')
      .eq('property_id', p.id)
      .eq('note_type', 'PROPERTY_NOTE')
      .gte('created_at', ninetyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20),
    linkedContactIds.length > 0
      ? supabase
          .from('contact_touches')
          .select('id, contact_id, touched_at, channel, summary, by_email, direction')
          .in('contact_id', linkedContactIds)
          .gte('touched_at', ninetyDaysAgo)
          .order('touched_at', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] as Array<{
          id: string; contact_id: string; touched_at: string;
          channel: string; summary: string; by_email: string;
          direction: 'outbound' | 'inbound';
        }> }),
  ]);

  for (const s of (slipsRes.data ?? []) as Array<{
    id: string; title: string; status: string; priority: string;
    created_at: string; created_by_email: string | null;
    completed_at: string | null; closed_by_email: string | null;
    owner_last_contacted_at: string | null;
    owner_action_type: string | null;
    owner_action_required: boolean;
    snoozed_at: string | null;
    snoozed_until: string | null;
    snoozed_by_email: string | null;
  }>) {
    if (s.created_at && s.created_at >= ninetyDaysAgo) {
      events.push({
        at: s.created_at,
        kind: 'slip-created',
        actor: s.created_by_email,
        label: `filed ${s.title}`,
        secondary: `${s.priority} · ${s.status.replace('_', ' ')}`,
        href: `/work/${s.id}`,
      });
    }
    if (s.completed_at) {
      events.push({
        at: s.completed_at,
        kind: 'slip-done',
        actor: s.closed_by_email,
        label: `marked done · ${s.title}`,
        href: `/work/${s.id}`,
      });
    }
    if (s.snoozed_at && s.snoozed_until) {
      events.push({
        at: s.snoozed_at,
        kind: 'slip-snoozed',
        actor: s.snoozed_by_email,
        label: `snoozed ${s.title} until ${s.snoozed_until}`,
        href: `/work/${s.id}`,
      });
    }
    if (s.owner_last_contacted_at) {
      events.push({
        at: s.owner_last_contacted_at,
        kind: 'slip-owner-contacted',
        actor: null, // We don't track who sent the draft; it's the system.
        label: `owner emailed about ${s.title}`,
        secondary: s.owner_action_type ? `action: ${s.owner_action_type}` : undefined,
        href: `/work/${s.id}`,
      });
    }
  }

  for (const ins of (inspectionsRes.data ?? []) as Array<{
    id: string; inspector_name: string; completed_at: string | null;
    started_at: string | null; total_items: number; issue_count: number;
  }>) {
    if (!ins.completed_at) continue;
    events.push({
      at: ins.completed_at,
      kind: 'inspection-completed',
      actor: null,
      label: `${ins.inspector_name} completed an inspection`,
      secondary: `${ins.total_items} items · ${ins.issue_count} issue${ins.issue_count === 1 ? '' : 's'}`,
      href: `/inspections/${ins.id}/summary`,
    });
  }

  for (const pl of (plansRes.data ?? []) as Array<{
    id: string; planned_for_date: string | null; planned_by_email: string;
    assigned_to_email: string | null; created_at: string; checkin_date: string;
  }>) {
    const inspectorBit = pl.assigned_to_email
      ? ` · assigned to ${displayNameForEmail(pl.assigned_to_email)}`
      : '';
    events.push({
      at: pl.created_at,
      kind: 'plan-created',
      actor: pl.planned_by_email,
      label: `planned an inspection for ${pl.planned_for_date ?? '(no date)'}${inspectorBit}`,
      secondary: `check-in ${pl.checkin_date}`,
      href: '/operations',
    });
  }

  for (const n of (notesRes.data ?? []) as Array<{
    id: string; note_text: string; created_at: string; author_email: string;
    resolved_at: string | null; resolved_by_email: string | null;
  }>) {
    events.push({
      at: n.created_at,
      kind: 'property-note-created',
      actor: n.author_email,
      label: `pinned a note: "${truncate(n.note_text, 80)}"`,
    });
    if (n.resolved_at) {
      events.push({
        at: n.resolved_at,
        kind: 'property-note-resolved',
        actor: n.resolved_by_email,
        label: `resolved note: "${truncate(n.note_text, 60)}"`,
      });
    }
  }

  // Property-level off-thread contact (latest only — the column is overwritten).
  if (p.owner_last_contacted_at && p.owner_last_contacted_at >= ninetyDaysAgo) {
    const channel = p.owner_last_contacted_via ?? 'other';
    events.push({
      at: p.owner_last_contacted_at,
      kind: 'property-contacted',
      actor: p.owner_last_contacted_by_email,
      label: `noted owner contact (${channel.replace('_', ' ')})`,
    });
  }

  // CRM contact touches on any contact linked to this property (#161).
  // Surfaces vendor/lead conversations alongside owner conversations,
  // and inbound replies captured by the Gmail sync cron (#172).
  for (const t of (touchesRes.data ?? []) as Array<{
    id: string; contact_id: string; touched_at: string;
    channel: string; summary: string; by_email: string;
    direction: 'outbound' | 'inbound';
  }>) {
    const contactName = linkedContactNames.get(t.contact_id) ?? 'a contact';
    const channel = t.channel.replace('_', ' ');
    if (t.direction === 'inbound') {
      events.push({
        at: t.touched_at,
        kind: 'contact-touch',
        actor: null,
        label: `${contactName} replied via ${channel}: "${truncate(t.summary, 60)}"`,
        href: `/crm/${t.contact_id}`,
      });
    } else {
      events.push({
        at: t.touched_at,
        kind: 'contact-touch',
        actor: t.by_email,
        label: `logged ${channel} touch with ${contactName}: "${truncate(t.summary, 60)}"`,
        href: `/crm/${t.contact_id}`,
      });
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return events;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
