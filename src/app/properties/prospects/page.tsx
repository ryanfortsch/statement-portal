import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { ProspectsPanel } from '@/components/projections/ProspectsPanel';
import { SubmitButton } from '@/components/SubmitButton';
import { createProspectProperty } from '../actions';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/** The prospect funnel, promoted from /properties?view=prospects to its own
 *  route. ProspectsPanel fetches its own data; this page supplies the chrome
 *  plus the quick add-a-prospect form (which lives with the funnel now that
 *  prospects have a home of their own). */
export default function ProspectsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Properties"
        title="All Rising Tide"
        emphasis="prospects."
        description="The prospect funnel, in one place."
      />

      <PropertiesTabBar active="prospects" />

      <ProspectsPanel />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <AddProspectForm />
      </section>

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}

/** Quiet create form for a PROSPECT property: a home we may sign, so the office
 *  can point Field packets and work slips at it before onboarding. Lands on the
 *  new property's page (add photos, coords tweaks, notes there). Invisible to
 *  statements / owners / operations until real onboarding activates it. */
function AddProspectForm() {
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
  const inp: React.CSSProperties = {
    font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)',
    border: '1px solid var(--rule)', padding: '8px 10px', minWidth: 170, borderRadius: 6,
  };
  return (
    <details style={{ marginTop: 44, maxWidth: 640 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
        + Add a prospective property
      </summary>
      <form
        action={createProspectProperty}
        style={{ marginTop: 14, border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <label style={lbl}>
          Name
          <input name="name" required placeholder="12 Marmion" style={inp} />
        </label>
        <label style={lbl}>
          Address
          <input name="address" required placeholder="12 Marmion Way" style={inp} />
        </label>
        <label style={lbl}>
          Town
          <input name="city" placeholder="Rockport" style={inp} />
        </label>
        <SubmitButton label="Add prospect" busyLabel="Adding…" style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '10px 18px', borderRadius: 6 }} />
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, width: '100%' }}>
          A home we may sign. You can point Field packets and work slips at it right away; it stays out of
          statements, owner tools, and the turnover board until it&apos;s onboarded for real.
        </div>
      </form>
    </details>
  );
}
