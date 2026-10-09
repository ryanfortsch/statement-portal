import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { trashNoticeFor, TRASH_NOTICE_COLUMNS } from '@/lib/trash-notice';
import { TrashNoticeCard, trashNoticeCss } from '@/components/properties/TrashNoticeCard';

export const dynamic = 'force-dynamic';

/**
 * Stay Cape Ann trash-day notice, one home. A 4 x 6 inch fridge card that
 * names the collection day and nudges the guest to bring the trash down and
 * roll the carts out the night before. Gloucester only; a home with no
 * resolved day gets the reason instead of a card, never a guess.
 *
 * Public past the proxy (PROPERTY_DELIVERABLE_RE) so the Puppeteer PDF path
 * can reach it. It renders nothing sensitive: the day, the city rule, and
 * where the carts live. /properties/trash-notices prints the whole fleet.
 */
export default async function TrashNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabase.from('properties').select(TRASH_NOTICE_COLUMNS).eq('id', id).maybeSingle();
  if (!data) notFound();
  const p = data as unknown as HelmPropertyRow;

  const result = trashNoticeFor(p);

  return (
    <>
      <style>{trashNoticeCss}</style>
      <div className="rt-doc">
        {result.ok ? (
          <TrashNoticeCard notice={result.notice} />
        ) : (
          <div
            style={{
              maxWidth: 384,
              background: '#F4ECD8',
              color: '#0F2A44',
              padding: '28px 30px',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 22, marginBottom: 10 }}>
              No notice for {p.name}
            </div>
            {result.skip.reason}
          </div>
        )}
      </div>
    </>
  );
}
