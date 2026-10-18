import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { GearGrid } from '@/components/GearGrid';
import { loadGearGrid, GEAR_ITEMS } from '@/lib/property-gear';
import { PropertiesTabBar } from '../PropertiesTabBar';
import { saveGearCellOffice } from './actions';

export const dynamic = 'force-dynamic';

/** Guest gear: which homes have a pack 'n play / high chair and where each
 *  lives. A fact about the homes, so it sits with them under Properties
 *  (it was a Work tab until 2026-10-18; /work/gear redirects here). The
 *  specialists' property-work board shows the same grid; both sides can
 *  correct it when gear moves. The grid's own hint line is the only prose. */
export default async function GuestGearPage() {
  const rows = await loadGearGrid();
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <div style={{ paddingTop: 20 }}>
        <PropertiesTabBar active="guest-gear" />
      </div>
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48, flex: 1 }}>
        <h1 className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 0, marginBottom: 22 }}>Guest gear</h1>
        <GearGrid items={GEAR_ITEMS} rows={rows} save={saveGearCellOffice} />
      </section>
      <HelmFooter module="Properties" right="Guest gear" />
    </div>
  );
}
