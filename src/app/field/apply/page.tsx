import type { Metadata } from 'next';
import { FieldShell } from '../FieldShell';
import { submitApplication } from './actions';
import { ApplyVideo } from './ApplyVideo';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Inspect with Rising Tide',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const input: React.CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: 15,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 5,
};
const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 20 };

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string; src?: string }>;
}) {
  const sp = await searchParams;

  if (sp.submitted) {
    return (
      <FieldShell showSignOut={false}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>Thanks — we got it</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          We&apos;ll review your application and follow up by email with next steps. If it&apos;s a fit, you&apos;ll get a
          personal link to set up your account and start claiming paid inspections near you.
        </p>
      </FieldShell>
    );
  }

  return (
    <FieldShell showSignOut={false}>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>Inspect with Rising Tide</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 520, marginBottom: 20 }}>
        Rising Tide manages short-term rentals across Cape Ann. We&apos;re a hands-on team, and we need
        a sharp, reliable local to help us cover more ground between guests. Flexible, paid-per-visit
        work you run from your phone. Visits run 20 to 90 minutes, usually 2 to 5 homes per trip.
      </p>
      <div style={{ maxWidth: 520, marginBottom: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>On every visit you cover three things:</div>
        {([
          ['Perfection', "the home should look flawless and guest-ready. You're the last set of eyes before check-in."],
          ['Maintenance', 'flag anything worn, leaking, or heading toward a repair, with a quick photo.'],
          ['Supplies & inventory', 'confirm the essentials are stocked and note anything running low.'],
        ] as const).map(([t, d]) => (
          <div key={t} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 6 }}>
            <span style={{ color: 'var(--signal)' }}>•</span>
            <span><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{t}:</strong> {d}</span>
          </div>
        ))}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '28px 0 24px', maxWidth: 520 }} />
      {sp.error && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 14, marginBottom: 18, borderRadius: 6 }}>
          Please add your name, a valid email, and a phone number.
        </div>
      )}

      <form action={submitApplication} style={{ maxWidth: 520, paddingBottom: 40 }}>
        <input type="hidden" name="source" value={sp.src ?? ''} />
        <label style={lbl}>
          Full name *
          <input name="full_name" required placeholder="Jordan Reed" style={input} />
        </label>
        <label style={lbl}>
          Email *
          <input name="email" type="email" required placeholder="you@example.com" style={input} />
        </label>
        <label style={lbl}>
          Phone *
          <input name="phone" type="tel" required placeholder="(978) 555-0123" style={input} />
        </label>
        <label style={lbl}>
          Where are you based? *
          <input name="area" required placeholder="Gloucester, Rockport, Beverly…" style={input} />
        </label>
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8, padding: 0 }}>
            Do you have a reliable vehicle? *
          </legend>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              <input type="radio" name="has_transport" value="yes" required /> Yes
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              <input type="radio" name="has_transport" value="no" /> No
            </label>
          </div>
        </fieldset>
        <label style={lbl}>
          When can you work?
          <input name="availability" placeholder="e.g. weekend afternoons (most turnovers are Wed–Sun)" style={input} />
        </label>
        <label style={lbl}>
          How did you hear about us?
          <input name="heard_about" placeholder="Indeed, a friend, Facebook…" style={input} />
        </label>
        <label style={lbl}>
          Tell us a little about yourself
          <textarea name="about" rows={4} placeholder="Any property, hospitality, cleaning, or home-maintenance experience? Why this work?" style={{ ...input, resize: 'vertical' }} />
        </label>
        <ApplyVideo />
        <button
          type="submit"
          style={{ background: 'var(--signal)', color: 'var(--paper)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '14px 30px' }}
        >
          Submit application
        </button>
      </form>
    </FieldShell>
  );
}
