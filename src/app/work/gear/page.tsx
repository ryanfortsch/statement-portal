import Link from 'next/link';
import { HelmFooter } from '@/components/HelmFooter';
import { GearGrid } from '@/components/GearGrid';
import { loadGearGrid, GEAR_ITEMS } from '@/lib/property-gear';
import { saveGearCellOffice } from './actions';

export const dynamic = 'force-dynamic';

/** The office view of the guest-gear matrix: which homes have a pack 'n play
 *  / high chair and where each lives. Same grid the specialists see on their
 *  property-work board; both sides can correct it when gear moves. The page
 *  title is the strip's tab name, and the grid's own hint line is the only
 *  prose: the table says what it is. */
export default async function GearPage() {
  const rows = await loadGearGrid();
  return (
    <>
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link
          href="/work"
          style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          ← All Work
        </Link>
        <h1 className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12, marginBottom: 22 }}>Gear</h1>
        <GearGrid items={GEAR_ITEMS} rows={rows} save={saveGearCellOffice} />
      </section>
      <HelmFooter module="Work" right="Gear" />
    </>
  );
}
