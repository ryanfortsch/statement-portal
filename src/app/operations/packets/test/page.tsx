import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadFieldTestState, type FieldTestPacket } from '@/lib/field-test';
import { dollars } from '@/lib/field-types';
import { CopyCode } from '@/app/field/CopyCode';
import { seedFieldTestAction, resetFieldTestAction } from './actions';

export const dynamic = 'force-dynamic';

const STATE_TINT: Record<string, string> = {
  published: '#7a5512',
  claimed: 'var(--tide-deep)',
  in_progress: 'var(--tide-deep)',
  submitted: 'var(--signal)',
  approved: 'var(--positive)',
  draft: 'var(--ink-4)',
  cancelled: 'var(--ink-4)',
};

export default async function FieldTestPage() {
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

  const state = await loadFieldTestState();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Field packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Field test console</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20, maxWidth: 640 }}>
          Drive the whole Field flow end to end, on every side. Seed creates two onboarded test contractors (an
          inspector and a maintenance pro), a few test work slips, and one published packet of each trade ready to
          claim. Reset wipes all of it (and the old Demo Inspector). No real contractors are texted — the test
          contractors have no phone.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
          <form action={seedFieldTestAction}>
            <button type="submit" style={btnDark}>{state.seeded ? 'Re-seed test data' : 'Seed test data'}</button>
          </form>
          {(state.seeded || state.hasLegacyDemo) && (
            <form action={resetFieldTestAction}>
              <button type="submit" style={btnGhost} title="Delete all test data + the old Demo Inspector">Reset / wipe test data</button>
            </form>
          )}
        </div>

        {/* Runbook */}
        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 20px', marginBottom: 28, background: 'var(--paper-2, #fff)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
            The full loop
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.7 }}>
            <li><strong>Seed</strong> the test data above.</li>
            <li>Open a contractor portal link below in a <strong>separate browser / incognito window</strong> (so it doesn&apos;t collide with your staff login).</li>
            <li><strong>Test onboarding</strong>: open the <em>&ldquo;not onboarded&rdquo;</em> inspector&apos;s link — you&apos;ll see the new-inspector setup (W-9 + agreement + home address). Complete it and that inspector goes active and can claim. (This is exactly what a new Perfection inspector walks through.)</li>
            <li>As the already-<strong>onboarded inspector</strong>: claim the test inspection packet, run the inspection, submit.</li>
            <li>As the <strong>maintenance</strong> pro: claim the test maintenance packet, mark each job done with a note, submit.</li>
            <li>Back here as staff: on the <Link href="/operations/packets" style={{ color: 'var(--tide-deep)' }}>packets board</Link>, <strong>Approve</strong> each submitted packet, then <strong>Mark paid</strong>.</li>
            <li>Try the operator side yourself too: bundle from the calendar or the <Link href="/operations/packets/maintenance" style={{ color: 'var(--tide-deep)' }}>Maintenance jobs</Link> page.</li>
            <li><strong>Reset</strong> when you&apos;re done.</li>
          </ol>
        </div>

        {/* Contractors */}
        {state.contractors.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              Test contractors
            </h2>
            {state.contractors.map((c) => {
              const link = `${state.baseUrl}/field/${c.portal_token}`;
              return (
                <div key={c.id} style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 10, background: 'var(--paper-2, #fff)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span className="font-serif" style={{ fontSize: 16 }}>{c.full_name}</span>
                    <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px' }}>{c.trade}</span>
                    <span style={{ fontSize: 12, color: c.onboarded ? 'var(--positive)' : 'var(--signal)' }}>
                      {c.onboarded ? 'onboarded ✓ can claim' : 'not onboarded — open the link to walk W-9 + agreement'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
                    <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600, textDecoration: 'none' }}>
                      Open portal ↗
                    </a>
                    <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                      <CopyCode value={link} mono={false} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Packets */}
        {state.packets.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              Test packets
            </h2>
            {state.packets.map((p) => (
              <PacketRow key={p.id} p={p} />
            ))}
          </div>
        )}

        {state.seeded && (
          <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            {state.openTestSlips} open test work {state.openTestSlips === 1 ? 'slip' : 'slips'} available to bundle on the{' '}
            <Link href="/operations/packets/maintenance" style={{ color: 'var(--tide-deep)' }}>Maintenance jobs</Link> page.
          </p>
        )}

        {!state.seeded && state.hasLegacyDemo && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            A legacy &ldquo;Demo Inspector&rdquo; and its packets are still in the system. Reset above will clear them.
          </p>
        )}
      </section>
      <HelmFooter module="Field" right="Test console" />
    </div>
  );
}

function PacketRow({ p }: { p: FieldTestPacket }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'var(--paper-2, #fff)' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="font-serif" style={{ fontSize: 15 }}>{p.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
          {p.trade} · {p.stop_count} {p.stop_count === 1 ? 'stop' : 'stops'} · {dollars(p.posted_price_cents)} · {p.visit_date}
        </div>
      </div>
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, color: STATE_TINT[p.status] ?? 'var(--ink-4)', whiteSpace: 'nowrap' }}>
        {p.status.replace('_', ' ')}
      </span>
      <Link href={`/operations/packets/${p.id}`} style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none' }}>Operator view →</Link>
      <Link href={`/field/packet/${p.id}`} target="_blank" style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none' }}>Contractor view ↗</Link>
    </div>
  );
}

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
  padding: '11px 20px',
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
  padding: '11px 20px',
};
