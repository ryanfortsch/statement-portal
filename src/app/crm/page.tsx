import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { ContactRow, ContactType, UnknownNumberRow } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import type { ContactReconcileSuggestionRow } from '@/lib/quo-reconcile';
import { CrmListClient } from './CrmListClient';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string };

export type LastTouch = { at: string; summary: string; channel: string };

async function getContacts(): Promise<{
  contacts: ContactRow[];
  properties: PropertyMini[];
  lastTouchByContact: Record<string, LastTouch>;
  unknownNumbers: UnknownNumberRow[];
  suggestions: ContactReconcileSuggestionRow[];
  error: string | null;
}> {
  const empty = { contacts: [], properties: [], lastTouchByContact: {}, unknownNumbers: [], suggestions: [] };
  if (!isHelmConfigured) {
    return { ...empty, error: 'Helm Supabase env vars are not set.' };
  }
  try {
    const [
      { data: contacts, error: cErr },
      { data: properties, error: pErr },
      { data: touches, error: tErr },
      { data: unknownNumbers },
      { data: suggestions },
    ] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      supabase.from('properties').select('id, name').order('name'),
      // All touches from the last 60 days; grouped client-side to "last per contact".
      supabase
        .from('contact_touches')
        .select('contact_id, touched_at, summary, channel')
        .gte('touched_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
        .order('touched_at', { ascending: false }),
      // Unknown-number triage queue. Errors ignored (fail-safe to empty).
      supabase
        .from('quo_unknown_numbers')
        .select('*')
        .eq('status', 'pending')
        .order('last_message_at', { ascending: false })
        .limit(50),
      // Quo address-book suggestions. Errors ignored (table may not be migrated yet).
      supabase
        .from('contact_reconcile_suggestions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    if (cErr) throw cErr;
    if (pErr) throw pErr;
    if (tErr) throw tErr;

    const lastTouchByContact: Record<string, LastTouch> = {};
    for (const t of (touches ?? []) as Array<{ contact_id: string; touched_at: string; summary: string; channel: string }>) {
      if (!lastTouchByContact[t.contact_id]) {
        lastTouchByContact[t.contact_id] = { at: t.touched_at, summary: t.summary, channel: t.channel };
      }
    }

    return {
      contacts: (contacts ?? []) as ContactRow[],
      properties: (properties ?? []) as PropertyMini[],
      lastTouchByContact,
      unknownNumbers: (unknownNumbers ?? []) as UnknownNumberRow[],
      suggestions: (suggestions ?? []) as ContactReconcileSuggestionRow[],
      error: null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function CrmPage() {
  const { contacts, properties, lastTouchByContact, unknownNumbers, suggestions, error } = await getContacts();

  const counts = {
    all: contacts.length,
    owner: contacts.filter((c) => c.type === 'owner').length,
    vendor: contacts.filter((c) => c.type === 'vendor').length,
    lead: contacts.filter((c) => c.type === 'lead').length,
    other: contacts.filter((c) => c.type === 'other').length,
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="crm" />

      <HelmHero
        eyebrow="Helm · CRM"
        title="The"
        emphasis="contacts ledger."
        description="Owners, vendors, leads. Every touch logged. Names you actually deal with."
      />

      {error ? (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
          <div
            style={{
              borderTop: '1px solid var(--negative)',
              borderBottom: '1px solid var(--negative)',
              padding: '24px 0',
            }}
          >
            <div className="eyebrow" style={{ color: 'var(--negative)', marginBottom: 8 }}>Database error</div>
            <pre
              className="font-mono"
              style={{
                fontSize: 11,
                color: 'var(--negative)',
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              {error}
            </pre>
          </div>
        </section>
      ) : (
        <CrmListClient
          contacts={contacts}
          properties={properties}
          counts={counts}
          lastTouchByContact={lastTouchByContact}
          unknownNumbers={unknownNumbers}
          suggestions={suggestions}
        />
      )}

      <HelmFooter module="CRM" right="Source: Helm" />
    </div>
  );
}

export type CrmPageCounts = Record<ContactType | 'all', number>;
export type { ContactRow };

export const VIEW_LABELS = CONTACT_TYPE_LABELS;
