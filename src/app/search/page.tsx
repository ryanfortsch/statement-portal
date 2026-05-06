import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow, TaskRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import type { ContactRow } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import { displayNameForEmail } from '@/lib/team';

export const dynamic = 'force-dynamic';

type SearchResults = {
  properties: HelmPropertyRow[];
  contacts: ContactRow[];
  slips: (WorkSlipRow & { property_name: string })[];
  tasks: TaskRow[];
};

async function search(q: string): Promise<SearchResults> {
  if (!isHelmConfigured || !q || q.length < 2) {
    return { properties: [], contacts: [], slips: [], tasks: [] };
  }

  const escaped = q.replace(/[%_,]/g, ' ').trim();
  const like = `%${escaped}%`;

  const [propRes, contactRes, slipRes, taskRes, propMapRes] = await Promise.all([
    supabase
      .from('properties')
      .select('*')
      .or(`name.ilike.${like},address.ilike.${like},title.ilike.${like},owner_full.ilike.${like},owner_last.ilike.${like}`)
      .order('name')
      .limit(20),
    supabase
      .from('contacts')
      .select('*')
      .or(`name.ilike.${like},organization.ilike.${like}`)
      .order('name')
      .limit(20),
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`)
      .order('priority', { ascending: false })
      .limit(40),     // pull a few extra so post-snooze filter can still hit limit 20
    supabase
      .from('tasks')
      .select('*')
      .in('status', ACTIVE_TASK_STATUSES)
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order('priority', { ascending: false })
      .limit(20),
    supabase.from('properties').select('id, name'),
  ]);

  const propertyMap = new Map<string, string>(
    ((propMapRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])
  );
  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    properties: (propRes.data ?? []) as HelmPropertyRow[],
    contacts: (contactRes.data ?? []) as ContactRow[],
    slips: ((slipRes.data ?? []) as WorkSlipRow[])
      .filter((s) => !s.snoozed_until || s.snoozed_until <= todayIso)
      .slice(0, 20)
      .map((s) => ({
        ...s,
        property_name: propertyMap.get(s.property_id) ?? s.property_id,
      })),
    tasks: (taskRes.data ?? []) as TaskRow[],
  };
}

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const results = await search(q);
  const total = results.properties.length + results.contacts.length + results.slips.length + results.tasks.length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Search</div>
        <h1
          className="font-serif"
          style={{ fontSize: 44, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}
        >
          {q ? `"${q}"` : 'Search Helm.'}
        </h1>

        <form action="/search" method="get" style={{ marginTop: 24 }}>
          <input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="Properties, owners, slips, tasks…"
            style={{
              width: '100%',
              maxWidth: 640,
              padding: '14px 18px',
              border: '1px solid var(--ink)',
              background: 'var(--paper)',
              fontSize: 16,
              color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
        </form>

        {q && (
          <p style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-3)' }}>
            {q.length < 2
              ? 'Type at least two characters.'
              : total === 0
                ? 'No matches across properties, contacts, slips, or tasks.'
                : `${total} result${total === 1 ? '' : 's'}: ${[
                    results.properties.length && `${results.properties.length} propert${results.properties.length === 1 ? 'y' : 'ies'}`,
                    results.contacts.length && `${results.contacts.length} contact${results.contacts.length === 1 ? '' : 's'}`,
                    results.slips.length && `${results.slips.length} slip${results.slips.length === 1 ? '' : 's'}`,
                    results.tasks.length && `${results.tasks.length} task${results.tasks.length === 1 ? '' : 's'}`,
                  ].filter(Boolean).join(', ')}`}
          </p>
        )}
      </section>

      <div style={{ flex: 1, width: '100%' }}>
        {results.properties.length > 0 && (
          <ResultGroup title="Properties" count={results.properties.length}>
            {results.properties.map((p) => (
              <Row key={p.id} href={`/properties/${p.id}`} primary={p.name} secondary={`${p.address} · ${p.owner_full}`} pill={p.is_active ? 'Active' : 'Inactive'} pillColor={p.is_active ? 'var(--positive)' : 'var(--ink-4)'} />
            ))}
          </ResultGroup>
        )}

        {results.contacts.length > 0 && (
          <ResultGroup title="Contacts" count={results.contacts.length}>
            {results.contacts.map((c) => (
              <Row
                key={c.id}
                href={`/crm/${c.id}`}
                primary={c.name}
                secondary={[c.organization, c.emails && c.emails[0]].filter(Boolean).join(' · ') || ''}
                pill={CONTACT_TYPE_LABELS[c.type]}
                pillColor={contactTypeColor(c.type)}
              />
            ))}
          </ResultGroup>
        )}

        {results.slips.length > 0 && (
          <ResultGroup title="Work Slips" count={results.slips.length}>
            {results.slips.map((s) => (
              <Row
                key={s.id}
                href={`/work/${s.id}`}
                primary={s.title}
                secondary={`${s.property_name}${s.location ? ` · ${s.location}` : ''} · ${s.assigned_to_email ? displayNameForEmail(s.assigned_to_email) : 'Unclaimed'}`}
                pill={s.priority}
                pillColor={s.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)'}
              />
            ))}
          </ResultGroup>
        )}

        {results.tasks.length > 0 && (
          <ResultGroup title="Tasks" count={results.tasks.length}>
            {results.tasks.map((t) => (
              <Row
                key={t.id}
                href={`/work/tasks/${t.id}`}
                primary={t.title}
                secondary={`${t.scope === 'corporate' ? 'Corporate' : 'Property'} · ${t.assigned_to_email ? displayNameForEmail(t.assigned_to_email) : 'Unassigned'}`}
                pill={t.priority}
                pillColor={t.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)'}
              />
            ))}
          </ResultGroup>
        )}
      </div>

      <HelmFooter module="Search" right="Source: Helm" />
    </div>
  );
}

function ResultGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{count}</span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>{children}</div>
    </section>
  );
}

function Row({
  href,
  primary,
  secondary,
  pill,
  pillColor,
}: {
  href: string;
  primary: string;
  secondary: string;
  pill?: string;
  pillColor?: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{primary}</div>
        {secondary && (
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{secondary}</div>
        )}
      </div>
      {pill && pillColor && (
        <span
          style={{
            fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
            color: pillColor,
            border: `1px solid ${pillColor}`,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {pill}
        </span>
      )}
      <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.18em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Open →
      </span>
    </Link>
  );
}

function contactTypeColor(type: string): string {
  switch (type) {
    case 'owner': return 'var(--tide-deep)';
    case 'vendor': return 'var(--ink-3)';
    case 'lead': return 'var(--signal)';
    default: return 'var(--ink-4)';
  }
}
