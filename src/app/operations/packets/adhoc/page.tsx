import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadFieldProperties } from '@/lib/field-packets';
import { createAdHocPacketAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Create a STANDALONE ad hoc one-off job: a single task at a home, done by the
 *  same inspection specialists, riding the normal claim → work → approve → pay
 *  rails. Not a full inspection — just the task you describe. */
export default async function AdhocPacketPage() {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="field" />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const properties = (await loadFieldProperties()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[720px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Field packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Send a one-off job</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24, maxWidth: 560 }}>
          A single task at a home (drop something off, meet a vendor, grab a photo, swap a bulb). Done by the same
          specialists, on its own claim → do → approve → pay. Set the pay now; you can adjust it after the visit from
          the packet page. To add a one-off onto an inspector&apos;s existing run instead, use the packet page.
        </p>

        <form action={createAdHocPacketAction} style={{ maxWidth: 560 }}>
          <label style={lbl}>
            What&apos;s the job? *
            <input
              type="text"
              name="title"
              required
              maxLength={200}
              placeholder="e.g. Let the plumber in and lock up after"
              style={inp}
            />
          </label>
          <label style={lbl}>
            Property *
            <select name="property_id" required defaultValue="" style={inp}>
              <option value="" disabled>Choose the home…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.city ? ` · ${p.city.split(',')[0]}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            Day *
            <input type="date" name="visit_date" required style={inp} />
          </label>
          <label style={lbl}>
            Time <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional; blank means anytime that day)</span>
            <input type="time" name="visit_time" style={inp} />
          </label>
          <label style={lbl}>
            Pay $ *
            <input type="number" name="price_dollars" min={1} step={1} required placeholder="e.g. 25" style={inp} />
          </label>
          <label style={lbl}>
            Details <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(what exactly to do)</span>
            <textarea
              name="scope"
              rows={4}
              placeholder={'e.g. The plumber (Cape Ann Plumbing) is scheduled 1 to 3 PM to fix the guest-bath faucet. Let them in, stay while they work, take a photo of the finished repair, and lock up. Text the office if anything comes up.'}
              style={{ ...inp, resize: 'vertical' }}
            />
          </label>
          <label style={lbl}>
            Bring <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional; folds into the supply-run pick list)</span>
            <input type="text" name="bring_list" maxLength={2000} placeholder="e.g. a spare furnace filter" style={inp} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)', margin: '2px 0 4px' }}>
            <input type="checkbox" name="supply_run" />
            Start with a supply-closet bag pickup at 85 Eastern Ave
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" name="mode" value="publish" style={btnDark}>Publish to contractors</button>
            <button type="submit" name="mode" value="draft" style={btnGhost}>Save as draft</button>
          </div>
        </form>
      </section>
      <HelmFooter module="Field" right="One-off job" />
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
