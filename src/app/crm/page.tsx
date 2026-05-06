import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { ContactRow, ContactType } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import { CrmListClient } from './CrmListClient';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string };

async function getContacts(): Promise<{ contacts: ContactRow[]; properties: PropertyMini[]; error: string | null }> {
  if (!isHelmConfigured) {
    return { contacts: [], properties: [], error: 'Helm Supabase env vars are not set.' };
  }
  try {
    const [{ data: contacts, error: cErr }, { data: properties, error: pErr }] = await Promise.all([
      supabase.from('contacts').select('*').order('name'),
      supabase.from('properties').select('id, name').order('name'),
    ]);
    if (cErr) throw cErr;
    if (pErr) throw pErr;
    return {
      contacts: (contacts ?? []) as ContactRow[],
      properties: (properties ?? []) as PropertyMini[],
      error: null,
    };
  } catch (err) {
    return { contacts: [], properties: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function CrmPage() {
  const { contacts, properties, error } = await getContacts();

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
        />
      )}

      <HelmFooter module="CRM" right="Source: Helm" />
    </div>
  );
}

export type CrmPageCounts = Record<ContactType | 'all', number>;
export type { ContactRow };

// Eyebrow → glance use only; primary list rendering lives in the client.
export const VIEW_LABELS = CONTACT_TYPE_LABELS;
