import Link from 'next/link';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  isTrashNoticeHome,
  trashNoticeFor,
  TRASH_NOTICE_COLUMNS,
  type TrashNotice,
  type TrashNoticeSkip,
} from '@/lib/trash-notice';
import { TrashNoticeCard, trashNoticeCss } from '@/components/properties/TrashNoticeCard';
import { PrintAllButton } from './PrintAllButton';

export const dynamic = 'force-dynamic';

/**
 * Every Gloucester home's trash-day notice on one page, one 4 x 6 card per
 * printed page, so the whole fleet's fridge cards come out of the printer
 * as a stack. The review strip at the top (screen only, hidden in print)
 * lists each home with its resolved day, where the day came from, and where
 * the carts live, plus any home that gets no card and why.
 *
 * Auth-gated by the proxy like the rest of /properties; only the
 * per-property render page is public for the PDF path.
 */
async function loadFleet(): Promise<{ rows: HelmPropertyRow[]; error: string | null }> {
  if (!isServiceConfigured) return { rows: [], error: 'Helm Supabase env vars are not set.' };
  const { data, error } = await supabase.from('properties').select(TRASH_NOTICE_COLUMNS).order('name');
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as HelmPropertyRow[], error: null };
}

export default async function TrashNoticesPage() {
  const { rows, error } = await loadFleet();
  const results = rows.filter(isTrashNoticeHome).map(trashNoticeFor);
  const notices: TrashNotice[] = results.flatMap((r) => (r.ok ? [r.notice] : []));
  const skips: TrashNoticeSkip[] = results.flatMap((r) => (r.ok ? [] : [r.skip]));

  return (
    <>
      <style>{trashNoticeCss}</style>
      <style>{reviewCss}</style>
      <div className="rt-doc">
        <section className="rt-screen rt-review" aria-label="Review before printing">
          <div className="rt-review-top">
            <div>
              <Link href="/properties" className="rt-review-back">
                &larr; Properties
              </Link>
              <h1 className="rt-review-title">Trash day notices</h1>
              <p className="rt-review-lede">
                One 4 &times; 6 fridge card per active Gloucester home, in the order below. Print on
                4 &times; 6 stock with no margins; each card lands on its own page. The day comes from
                the DPW street list unless an operator set it on the property.
              </p>
            </div>
            {notices.length > 0 ? <PrintAllButton /> : null}
          </div>

          {error ? <p className="rt-review-error">{error}</p> : null}

          {notices.length > 0 ? (
            <table className="rt-review-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Home</th>
                  <th>Day</th>
                  <th>Source</th>
                  <th>Where the carts live</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n, i) => (
                  <tr key={n.propertyId}>
                    <td>{i + 1}</td>
                    <td>
                      <Link href={`/properties/${n.propertyId}`}>{n.propertyName}</Link>
                    </td>
                    <td>{n.day}</td>
                    <td>
                      {n.daySource === 'row' ? 'Set on the property' : 'DPW street list'}
                      {n.cartsHandledByUs ? <span className="rt-review-flag">We move the carts</span> : null}
                    </td>
                    <td className="rt-review-muted">{n.location ?? 'Nothing on file'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !error ? (
            <p className="rt-review-error">No active Gloucester home resolved a collection day.</p>
          ) : null}

          {skips.length > 0 ? (
            <div className="rt-review-skips">
              <div className="rt-review-skips-h">No card</div>
              {skips.map((s) => (
                <p key={s.propertyId}>
                  <Link href={`/properties/${s.propertyId}/edit#safety`}>{s.propertyName}</Link>: {s.reason}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        {notices.map((n) => (
          <TrashNoticeCard key={n.propertyId} notice={n} />
        ))}
      </div>
    </>
  );
}

const reviewCss = `
  .rt-review {
    flex: 0 0 100%;
    max-width: 816px;
    margin: 0 auto 8px;
    background: #F4ECD8;
    color: #0F2A44;
    padding: 26px 30px 22px;
    box-sizing: border-box;
    font-size: 13px;
    line-height: 1.5;
  }
  .rt-review-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .rt-review-back { font-size: 11px; letter-spacing: .06em; color: #0F2A44; opacity: .7; text-decoration: none; }
  .rt-review-title {
    margin: 10px 0 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-size: 30px;
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1.05;
  }
  .rt-review-lede { margin: 10px 0 0; max-width: 560px; opacity: .85; }
  .rt-review-error { margin: 16px 0 0; color: #8a2e1b; }
  .rt-review-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  .rt-review-table th {
    text-align: left;
    font-size: 9.5px;
    letter-spacing: .22em;
    text-transform: uppercase;
    font-weight: 600;
    opacity: .7;
    padding: 0 10px 8px 0;
    border-bottom: 1px solid #0F2A44;
  }
  .rt-review-table td { padding: 8px 10px 8px 0; border-bottom: 1px solid rgba(15, 42, 68, 0.18); vertical-align: top; }
  .rt-review-table a { color: #0F2A44; }
  .rt-review-muted { opacity: .7; }
  .rt-review-flag { display: block; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; font-weight: 600; margin-top: 2px; }
  .rt-review-skips { margin-top: 18px; padding-top: 14px; border-top: 1px solid #0F2A44; }
  .rt-review-skips-h { font-size: 9.5px; letter-spacing: .22em; text-transform: uppercase; font-weight: 600; opacity: .7; margin-bottom: 6px; }
  .rt-review-skips p { margin: 0 0 6px; }
  .rt-review-skips a { color: #0F2A44; }
`;
