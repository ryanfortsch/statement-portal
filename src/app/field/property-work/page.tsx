import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { onboardingComplete } from '@/lib/field-types';
import { loadPropertyWorkBoard } from '@/lib/field-work-board';
import { FieldShell } from '../FieldShell';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { BoardSlipDone, BoardNewSlip } from './BoardControls';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Property work · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function ageLabel(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

const PRIORITY_TINT: Record<string, string> = { high: 'var(--signal)', normal: 'var(--ink-4)', low: 'var(--ink-4)' };

/** The office-granted all-properties slip board: see every home's open work,
 *  mark what you fix, file what you find. Gated on contractors.work_board_access
 *  (explicit approval — this page names the whole portfolio). */
export default async function PropertyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ ontrip?: string }>;
}) {
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();
  if (!contractor || contractor.status !== 'active' || !contractor.work_board_access || !onboardingComplete(contractor)) {
    redirect('/field');
  }

  const board = await loadPropertyWorkBoard();
  const totalSlips = board.groups.reduce((a, g) => a + g.slips.length, 0);

  return (
    <FieldShell contractorName={contractor.full_name}>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: '16px 0 6px' }}>Property work</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: '0 0 20px', maxWidth: 560, lineHeight: 1.55 }}>
        Every home&apos;s open work slips. Mark what you fix, file what you spot. These are unscheduled and unpaid
        extras unless the office puts one on a trip; anything unclear, call the office.
      </p>

      {sp.ontrip === '1' && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
          That one is already on a scheduled trip, so it closes through the trip instead.
        </div>
      )}

      <div style={{ marginBottom: 26 }}>
        <BoardNewSlip properties={board.properties} />
      </div>

      {totalSlips === 0 && (
        <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>Nothing open right now. Nice.</p>
      )}

      {board.groups.map((g) => (
        <section key={g.propertyId} style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '1px solid var(--ink)', paddingBottom: 8, marginBottom: 4 }}>
            <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 400, margin: 0 }}>{g.propertyName}</h2>
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{g.slips.length} open</span>
          </div>
          {g.slips.map((slip) => (
            <div key={slip.id} style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>{slip.title}</span>
                {slip.priority === 'high' && (
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: PRIORITY_TINT.high }}>high</span>
                )}
                <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 'auto' }}>{ageLabel(slip.created_at)}</span>
              </div>
              {slip.description && (
                <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{slip.description}</div>
              )}
              {slip.location && (
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>{slip.location}</div>
              )}
              {slip.photo_urls.length > 0 && <PhotoThumbs urls={slip.photo_urls} size={56} />}
              <BoardSlipDone slipId={slip.id} />
            </div>
          ))}
        </section>
      ))}

      {board.onTripCount > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 6 }}>
          {board.onTripCount} more {board.onTripCount === 1 ? 'slip is' : 'slips are'} already on scheduled trips and close there.
        </p>
      )}
    </FieldShell>
  );
}
