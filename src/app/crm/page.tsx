import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { ContactRow, ContactType } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import { selectAllPaged } from '@/lib/paged-select';
import { CrmListClient } from './CrmListClient';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string };

export type LastTouch = { at: string; summary: string; channel: string };

async function getContacts(): Promise<{
  contacts: ContactRow[];
  properties: PropertyMini[];
  lastTouchByContact: Record<string, LastTouch>;
  error: string | null;
}> {
  const empty = { contacts: [], properties: [], lastTouchByContact: {} };
  if (!isHelmConfigured) {
    return { ...empty, error: 'Ask Ryan: this page is not set up.' };
  }
  try {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const [contacts, { data: properties, error: pErr }, touches] = await Promise.all([
      selectAllPaged<ContactRow>((from, to) => supabase.from('contacts').select('*').order('name').order('id').range(from, to)),
      supabase.from('properties').select('id, name').order('name'),
      // Every touch from the last 60 days, newest first, grouped below to
      // "last per contact". Paged: Quo writes a touch per message and call,
      // so the window passes PostgREST's 1,000-row page and a bare read
      // silently dropped the last touch of every older contact.
      selectAllPaged<{ contact_id: string; touched_at: string; summary: string; channel: string }>((from, to) =>
        supabase
          .from('contact_touches')
          .select('id, contact_id, touched_at, summary, channel')
          .gte('touched_at', since)
          .order('touched_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
    ]);
    if (pErr) throw pErr;

    const lastTouchByContact: Record<string, LastTouch> = {};
    for (const t of touches) {
      if (!lastTouchByContact[t.contact_id]) {
        lastTouchByContact[t.contact_id] = { at: t.touched_at, summary: t.summary, channel: t.channel };
      }
    }

    return {
      contacts,
      properties: (properties ?? []) as PropertyMini[],
      lastTouchByContact,
      error: null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function CrmPage() {
  const { contacts, properties, lastTouchByContact, error } = await getContacts();

  const counts = {
    all: contacts.length,
    owner: contacts.filter((c) => c.type === 'owner').length,
    vendor: contacts.filter((c) => c.type === 'vendor').length,
    lead: contacts.filter((c) => c.type === 'lead').length,
    other: contacts.filter((c) => c.type === 'other').length,
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      {/* Straight to the list: the number triage is a card on /messaging. */}
      <div style={{ paddingTop: 32 }} />

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
        />
      )}

      <HelmFooter module="CRM" right="Source: Helm" />
    </div>
  );
}

export type CrmPageCounts = Record<ContactType | 'all', number>;
export type { ContactRow };

export const VIEW_LABELS = CONTACT_TYPE_LABELS;
