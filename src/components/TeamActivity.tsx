import Link from 'next/link';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { displayNameForEmail } from '@/lib/team';

type ActivityKind =
  | 'slip-created'
  | 'slip-done'
  | 'slip-snoozed'
  | 'slip-owner-contacted'
  | 'inspection-completed'
  | 'plan-created'
  | 'property-note-created'
  | 'property-contacted'
  | 'contact-touch';

type ActivityEvent = {
  at: string;
  kind: ActivityKind;
  actor: string | null;
  property: string;       // display name (for contact-touch: contact name)
  label: string;          // verb phrase, e.g. "filed kitchen leak"
  href?: string;
};

const KIND_GLYPH: Record<ActivityKind, string> = {
  'slip-created': '+',
  'slip-done': '✓',
  'slip-snoozed': 'z',
  'slip-owner-contacted': '→',
  'inspection-completed': '⚑',
  'plan-created': '◷',
  'property-note-created': '✎',
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
  'property-contacted': 'var(--signal)',
  'contact-touch': 'var(--signal)',
};

type Props = {
  /** Max events to fetch. Anything beyond `initialVisible` hides behind a
   *  <details> expander. Default 20. */
  limit?: number;
  /** How many events render unfolded by default. Default 5. */
  initialVisible?: number;
  /** Suppress the internal "Recent Activity" heading. Used when the
   *  component is rendered inside the home feed tabs, where the tab label
   *  already names the panel. */
  hideHeading?: boolean;
};

/**
 * Team-wide activity feed. Same event kinds as PropertyActivity (#156)
 * but rolled up across every property and rendered with the property
 * name shown alongside the actor/action.
 *
 * On the home: shows the most recent `initialVisible` (default 5) and
 * hides the rest behind a "See more" disclosure so the section stays
 * short. Clicking the disclosure expands the full fetched list.
 *
 * Compounds with #156 — clicking into a property still shows the
 * property-scoped feed; this is just the cross-property entry point.
 */
export async function TeamActivity({ limit = 20, initialVisible = 5, hideHeading = false }: Props) {
  const events = await loadTeamActivity(limit);

  // Hide the whole section on quiet days. When activity is empty, the
  // "Recent Activity / no recent activity" wall is more noise than signal
  // on the home; the user knows where to find activity when there is some.
  // In tab mode we still show an empty note so the tab isn't blank.
  if (events.length === 0) {
    if (!hideHeading) return null;
    return (
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', padding: '28px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          No team activity in the past 7 days.
        </div>
      </section>
    );
  }

  const visible = events.slice(0, initialVisible);
  const hidden = events.slice(initialVisible);

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
      {!hideHeading && (
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Recent Activity
          </h2>
          <span className="eyebrow">past 7 days</span>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {visible.map((e, i) => (
          <ActivityRow key={`${e.kind}-${e.at}-${i}`} event={e} />
        ))}
        {hidden.length > 0 && (
          <details style={{ marginTop: 0 }}>
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                padding: '14px 0',
                fontSize: 11,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 500,
                color: 'var(--ink-3)',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              See {hidden.length} more →
            </summary>
            {hidden.map((e, i) => (
              <ActivityRow key={`${e.kind}-${e.at}-${initialVisible + i}`} event={e} />
            ))}
          </details>
        )}
      </div>
    </section>
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
          {e.actor && <span style={{ fontWeight: 500 }}>{displayNameForEmail(e.actor)} </span>}
          {e.label}{' '}
          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{e.property}</span>
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
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

async function loadTeamActivity(limit: number): Promise<ActivityEvent[]> {
  // Hot window: last 7 days. Tight enough that the home stays focused;
  // anyone who wants deeper history clicks into a property and uses #156's
  // 90-day feed there.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const events: ActivityEvent[] = [];

  type PropMini = { id: string; name: string };
  const propRes = await supabase.from('properties').select('id, name');
  const propertyMap = new Map<string, string>();
  for (const p of (propRes.data ?? []) as PropMini[]) propertyMap.set(p.id, p.name);

  const [slipsRes, inspectionsRes, plansRes, notesRes, contactedPropsRes, touchesRes] = await Promise.all([
    supabase
      .from('work_slips')
      .select('id, property_id, title, created_at, created_by_email, completed_at, closed_by_email, owner_last_contacted_at, snoozed_at, snoozed_until, snoozed_by_email')
      .or(`created_at.gte.${cutoff},completed_at.gte.${cutoff},owner_last_contacted_at.gte.${cutoff},snoozed_at.gte.${cutoff}`)
      .limit(80),
    supabase
      .from('inspections')
      .select('id, property_id, inspector_name, completed_at, total_items, issue_count')
      .not('completed_at', 'is', null)
      .gte('completed_at', cutoff)
      .order('completed_at', { ascending: false })
      .limit(20),
    supabase
      .from('inspection_plans')
      .select('id, property_id, planned_for_date, planned_by_email, assigned_to_email, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('inspection_notes')
      .select('id, property_id, note_text, created_at, author_email')
      .eq('note_type', 'PROPERTY_NOTE')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('properties')
      .select('id, name, owner_last_contacted_at, owner_last_contacted_via, owner_last_contacted_by_email')
      .gte('owner_last_contacted_at', cutoff),
    supabase
      .from('contact_touches')
      .select('id, contact_id, touched_at, channel, summary, by_email, direction, contacts!inner(id, name, type)')
      .gte('touched_at', cutoff)
      .order('touched_at', { ascending: false })
      .limit(40),
  ]);

  for (const s of (slipsRes.data ?? []) as Array<{
    id: string; property_id: string; title: string;
    created_at: string; created_by_email: string | null;
    completed_at: string | null; closed_by_email: string | null;
    owner_last_contacted_at: string | null;
    snoozed_at: string | null;
    snoozed_until: string | null;
    snoozed_by_email: string | null;
  }>) {
    const propName = propertyMap.get(s.property_id) ?? '(property)';
    if (s.created_at && s.created_at >= cutoff) {
      events.push({
        at: s.created_at,
        kind: 'slip-created',
        actor: s.created_by_email,
        property: propName,
        label: `filed "${truncate(s.title, 60)}" at`,
        href: `/work/${s.id}`,
      });
    }
    if (s.completed_at && s.completed_at >= cutoff) {
      events.push({
        at: s.completed_at,
        kind: 'slip-done',
        actor: s.closed_by_email,
        property: propName,
        label: `marked "${truncate(s.title, 60)}" done at`,
        href: `/work/${s.id}`,
      });
    }
    if (s.owner_last_contacted_at && s.owner_last_contacted_at >= cutoff) {
      events.push({
        at: s.owner_last_contacted_at,
        kind: 'slip-owner-contacted',
        actor: null,
        property: propName,
        label: `owner emailed about "${truncate(s.title, 60)}" at`,
        href: `/work/${s.id}`,
      });
    }
    if (s.snoozed_at && s.snoozed_at >= cutoff && s.snoozed_until) {
      events.push({
        at: s.snoozed_at,
        kind: 'slip-snoozed',
        actor: s.snoozed_by_email,
        property: propName,
        label: `snoozed "${truncate(s.title, 60)}" until ${s.snoozed_until} at`,
        href: `/work/${s.id}`,
      });
    }
  }

  for (const ins of (inspectionsRes.data ?? []) as Array<{
    id: string; property_id: string; inspector_name: string;
    completed_at: string | null; total_items: number; issue_count: number;
  }>) {
    if (!ins.completed_at) continue;
    events.push({
      at: ins.completed_at,
      kind: 'inspection-completed',
      actor: null,
      property: propertyMap.get(ins.property_id) ?? '(property)',
      label: `${ins.inspector_name} completed an inspection at`,
      href: `/inspections/${ins.id}/summary`,
    });
  }

  for (const pl of (plansRes.data ?? []) as Array<{
    id: string; property_id: string; planned_for_date: string | null;
    planned_by_email: string; assigned_to_email: string | null; created_at: string;
  }>) {
    const inspectorBit = pl.assigned_to_email ? ` (assigned ${displayNameForEmail(pl.assigned_to_email)})` : '';
    events.push({
      at: pl.created_at,
      kind: 'plan-created',
      actor: pl.planned_by_email,
      property: propertyMap.get(pl.property_id) ?? '(property)',
      label: `planned an inspection${inspectorBit} for ${pl.planned_for_date ?? '(no date)'} at`,
      href: '/operations',
    });
  }

  for (const n of (notesRes.data ?? []) as Array<{
    id: string; property_id: string; note_text: string; created_at: string; author_email: string;
  }>) {
    events.push({
      at: n.created_at,
      kind: 'property-note-created',
      actor: n.author_email,
      property: propertyMap.get(n.property_id) ?? '(property)',
      label: `pinned "${truncate(n.note_text, 60)}" at`,
      href: `/properties/${n.property_id}`,
    });
  }

  for (const p of (contactedPropsRes.data ?? []) as Array<{
    id: string; name: string; owner_last_contacted_at: string | null;
    owner_last_contacted_via: string | null; owner_last_contacted_by_email: string | null;
  }>) {
    if (!p.owner_last_contacted_at) continue;
    const channel = (p.owner_last_contacted_via ?? 'other').replace('_', ' ');
    events.push({
      at: p.owner_last_contacted_at,
      kind: 'property-contacted',
      actor: p.owner_last_contacted_by_email,
      property: p.name,
      label: `noted owner contact (${channel}) at`,
      href: `/properties/${p.id}`,
    });
  }

  // CRM contact touches — surface every recent touch logged via /crm/[id]
  // OR captured inbound via the Gmail sync cron (#172). The "property"
  // slot here holds the contact name; for outbound touches the actor is
  // the team member who logged it, for inbound replies the actor is null
  // and the contact name itself takes the "who" slot.
  for (const t of (touchesRes.data ?? []) as Array<{
    id: string;
    contact_id: string;
    touched_at: string;
    channel: string;
    summary: string;
    by_email: string;
    direction: 'outbound' | 'inbound';
    contacts: { id: string; name: string; type: string } | { id: string; name: string; type: string }[] | null;
  }>) {
    const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    if (!contact) continue;
    const channel = t.channel.replace('_', ' ');
    if (t.direction === 'inbound') {
      events.push({
        at: t.touched_at,
        kind: 'contact-touch',
        actor: null,
        property: contact.name,
        label: `replied via ${channel} ("${truncate(t.summary, 60)}") —`,
        href: `/crm/${t.contact_id}`,
      });
    } else {
      events.push({
        at: t.touched_at,
        kind: 'contact-touch',
        actor: t.by_email,
        property: contact.name,
        label: `logged ${channel} touch ("${truncate(t.summary, 60)}") with`,
        href: `/crm/${t.contact_id}`,
      });
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.slice(0, limit);
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
