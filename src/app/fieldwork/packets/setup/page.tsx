import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured, fieldDb } from '@/lib/field-db';
import { loadFieldProperties } from '@/lib/field-packets';
import { setupPriceCents, setupMinutes } from '@/lib/field-pricing';
import { createSetupPacketAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Create a property-setup packet: staging a new home for photos + outfitting
 *  it for operations. One home, 2 to 4 hours, done by the same inspection
 *  specialists; rides the normal claim → work → approve → pay rails. */
export default async function SetupPacketPage() {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const properties = (await loadFieldProperties()).sort((a, b) => a.name.localeCompare(b.name));
  // For the record-a-past-visit mode: who could have done the work.
  const { data: cData } = await fieldDb()
    .from('contractors')
    .select('id, full_name')
    .eq('trade', 'inspection')
    .eq('status', 'active')
    .order('full_name');
  const contractors = (cData ?? []) as { id: string; full_name: string }[];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="packets" trade="inspection" />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Set up a new property</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 560 }}>
          Staging for photos and outfitting for operations: one home, 2 to 4 hours on site. Publishing sends it to
          your specialists to claim like any other packet; you can attach extra task slips from the packet page after
          it&apos;s created.
        </p>

        <form action={createSetupPacketAction} style={{ maxWidth: 560 }}>
          <label style={lbl}>
            Property *
            <select name="property_id" required defaultValue="" style={inp}>
              <option value="" disabled>Choose the home…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.kind === 'prospect' ? ' · prospect' : ''}
                  {p.bedrooms ? ` · ${p.bedrooms} BR` : ''}
                  {` · suggested $${Math.round(setupPriceCents(p.bedrooms) / 100)} (~${Math.round(setupMinutes(p.bedrooms) / 60 * 10) / 10}h)`}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            Setup day *
            <input type="date" name="visit_date" required style={inp} />
          </label>
          <label style={lbl}>
            Earliest start <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional; they can begin any time from here, blank means anytime that day)</span>
            <input type="time" name="visit_time" style={inp} />
          </label>
          <label style={lbl}>
            Pay $ <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(leave blank to price by home size at $40/hr)</span>
            <input type="number" name="price_dollars" min={0} step={1} placeholder="auto" style={inp} />
          </label>
          <label style={lbl}>
            Scope <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(what the specialist walks in to do)</span>
            <textarea
              name="scope"
              rows={5}
              placeholder={'e.g. Stage every room for the photo shoot (beds made hotel-style, pillows karate-chopped, counters clear). Unbox and place the linen + towel sets. Stock the kitchen starter kit, bathroom consumables, and the supply bin. Hang the house manual and wifi card. Flag anything missing or damaged with photos.'}
              style={{ ...inp, resize: 'vertical' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '2px 0 4px' }}>
            <input type="checkbox" name="supply_run" />
            Include a supply-closet bag pickup at 85 Eastern Ave as stop 1
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" name="mode" value="publish" style={btnDark}>Publish to contractors</button>
            <button type="submit" name="mode" value="draft" style={btnGhost}>Save as draft</button>
          </div>

          {/* The forgot-to-put-one-in path: the setup already happened and the
              office is recording it after the fact. Lands SUBMITTED, awarded
              to whoever did it, straight in the approve queue - never
              published, no texts, no door codes. */}
          <details style={{ marginTop: 22, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
            <summary style={{ fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600, cursor: 'pointer' }}>
              Already happened? Record a past setup ▾
            </summary>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '10px 0 12px', maxWidth: 520, lineHeight: 1.5 }}>
              For a setup that was done but never put in: pick the day it happened above (today or earlier), choose who
              did it, and it lands directly in your approve queue - ready for final pay and mark-paid. Nothing is
              published and nobody gets texted.
            </p>
            <label style={lbl}>
              Done by *
              <select name="done_by" defaultValue="" style={inp}>
                <option value="" disabled>Who did the work…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </label>
            <button type="submit" name="mode" value="record" style={btnGhost}>Record past visit</button>
          </details>
        </form>
      </section>
      <HelmFooter module="Field" right="Property setup" />
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 18, fontWeight: 500 };
const inp: React.CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 6,
  boxSizing: 'border-box',
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '12px 22px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '12px 22px',
};
