import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { ContactRow, ContactTouchRow } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import type { WorkSlipRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import { ContactDetail } from './ContactDetail';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string };

export type ContactSlip = WorkSlipRow & { property_name: string };

async function getData(id: string): Promise<{
  contact: ContactRow;
  touches: ContactTouchRow[];
  properties: PropertyMini[];
  linkedSlips: ContactSlip[];
} | null> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!contact) return null;

  const c = contact as ContactRow;
  const linkedIds = c.linked_property_ids ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: touches }, { data: properties }, { data: slipsData }] = await Promise.all([
    supabase
      .from('contact_touches')
      .select('*')
      .eq('contact_id', id)
      .order('touched_at', { ascending: false }),
    supabase.from('properties').select('id, name').order('name'),
    linkedIds.length > 0
      ? supabase
          .from('work_slips')
          .select('*')
          .in('property_id', linkedIds)
          .in('status', ACTIVE_WORK_SLIP_STATUSES)
          .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as WorkSlipRow[] }),
  ]);

  const propertyMap = new Map<string, string>(
    ((properties ?? []) as PropertyMini[]).map((p) => [p.id, p.name])
  );
  const linkedSlips: ContactSlip[] = ((slipsData ?? []) as WorkSlipRow[]).map((s) => ({
    ...s,
    property_name: propertyMap.get(s.property_id) ?? s.property_id,
  }));

  return {
    contact: c,
    touches: (touches ?? []) as ContactTouchRow[],
    properties: (properties ?? []) as PropertyMini[],
    linkedSlips,
  };
}

type Params = { id: string };

export default async function ContactDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const [data, session] = await Promise.all([getData(id), auth()]);
  if (!data) notFound();
  const myEmail = session?.user?.email ?? '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="crm" />

      <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href="/crm"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Contacts
        </Link>
      </div>

      <ContactDetail
        contact={data.contact}
        touches={data.touches}
        properties={data.properties}
        linkedSlips={data.linkedSlips}
        myEmail={myEmail}
      />

      <HelmFooter module="CRM" right={`Contact · ${CONTACT_TYPE_LABELS[data.contact.type]}`} />
    </div>
  );
}
