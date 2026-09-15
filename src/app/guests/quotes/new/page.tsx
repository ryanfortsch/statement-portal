import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { listQuotableProperties } from '@/lib/sca-quotes';
import { isIsoDay } from '@/lib/sca-quotes-types';
import { QuoteComposer, type QuotePrefill } from '../QuoteComposer';

export const dynamic = 'force-dynamic';

/**
 * New custom quote. Accepts a prefill in the query string so the Guests
 * queue can hand over a 2027 pre-release request (property, dates, first
 * name, source) with one click. Helm ids arrive from several older
 * spellings; the aliases below fold them onto the registry id.
 */
const PROPERTY_ALIASES: Record<string, string> = {
  '3_south_street': '3_south_st',
  '3_windward_pt': '3_windward',
};

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? '').trim();
}

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Search> }) {
  const [properties, sp] = await Promise.all([listQuotableProperties(), searchParams]);

  const rawProperty = first(sp.property);
  const propertyId = PROPERTY_ALIASES[rawProperty] ?? rawProperty;
  const checkIn = first(sp.check_in);
  const checkOut = first(sp.check_out);
  const guests = Math.round(Number(first(sp.guests)));

  const prefill: QuotePrefill = {
    property_id: properties.some((p) => p.id === propertyId) ? propertyId : undefined,
    check_in: isIsoDay(checkIn) ? checkIn : undefined,
    check_out: isIsoDay(checkOut) ? checkOut : undefined,
    guests: guests >= 1 && guests <= 30 ? guests : undefined,
    first: first(sp.first) || undefined,
    last: first(sp.last) || undefined,
    email: first(sp.email) || undefined,
    phone: first(sp.phone) || undefined,
    source_kind: first(sp.source) || undefined,
    source_ref: first(sp.source_ref) || undefined,
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/quotes" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← Quotes
          </Link>
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
        >
          New quote
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640 }}>
          Pick the home and the dates, set the price, and save. The detail page has the guest link and
          the send buttons; nothing goes out until you press one.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        <QuoteComposer properties={properties} prefill={prefill} />
      </section>
    </div>
  );
}
