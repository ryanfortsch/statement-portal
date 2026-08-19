import Link from 'next/link';
import { HelmFooter } from '@/components/HelmFooter';
import { GearGrid } from '@/components/GearGrid';
import { loadGearGrid, GEAR_ITEMS } from '@/lib/property-gear';
import { saveGearCellOffice } from './actions';

export const dynamic = 'force-dynamic';

/** The office view of the guest-gear matrix: which homes have a pack 'n play
 *  / high chair and where each lives. Same grid the specialists see on their
 *  property-work board; both sides can correct it when gear moves. */
export default async function GearPage() {
  const rows = await loadGearGrid();
  return (
    <>
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/work" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← The board</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Guest gear</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 22, maxWidth: 560 }}>
          Which homes have gear on hand and where it lives. The field specialists see this same grid on their
          property-work board, so whoever moves a pack &apos;n play fixes the map.
        </p>
        <GearGrid items={GEAR_ITEMS} rows={rows} save={saveGearCellOffice} />
      </section>
      <HelmFooter module="Work" right="Guest gear" />
    </>
  );
}
