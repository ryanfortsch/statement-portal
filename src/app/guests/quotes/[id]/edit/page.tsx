import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuoteById, listQuotableProperties } from '@/lib/sca-quotes';
import { deriveQuoteStatus, displayTitle } from '@/lib/sca-quotes-types';
import { QuoteComposer } from '../../QuoteComposer';

export const dynamic = 'force-dynamic';

/**
 * Edit a quote that has not been accepted or voided. An accepted quote is
 * the record of what the guest paid, so it never changes; duplicate it to
 * offer new terms. The composer is the same one /new uses, seeded with the
 * row.
 */
export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getQuoteById(id);
  if (!quote) notFound();
  const status = deriveQuoteStatus(quote);
  if (status === 'accepted' || status === 'voided') notFound();

  const properties = await listQuotableProperties();

  return (
    <div className="flex-1 flex flex-col">
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href={`/guests/quotes/${quote.id}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← {displayTitle(quote.property_title)}
          </Link>
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
        >
          Edit quote
        </h1>
        {quote.sent_at && (
          <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640 }}>
            Already with the guest: resend from the detail page after you save.
          </p>
        )}
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        <QuoteComposer properties={properties} initial={quote} />
      </section>
    </div>
  );
}
