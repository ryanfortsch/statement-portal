import type { Metadata } from 'next';
import { FieldShell } from '../FieldShell';
import { submitApplication } from './actions';

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
const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 16 };

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
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 8 }}>Inspect with Rising Tide</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 520, marginBottom: 8 }}>
        Flexible, paid-per-visit work across Cape Ann, run from your phone. Claim inspection jobs near you, walk the
        home, confirm it&apos;s guest-ready. About 20 to 30 minutes per home, mostly early afternoons.
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: 24 }}>
        Typically $65 to $100 per inspection, depending on size and travel.
      </p>

      {sp.error && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 14, marginBottom: 18, borderRadius: 6 }}>
          Please add at least your name and a valid email.
        </div>
      )}

      <form action={submitApplication} style={{ maxWidth: 520 }}>
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
          Phone
          <input name="phone" type="tel" placeholder="(978) 555-0123" style={input} />
        </label>
        <label style={lbl}>
          Where are you based?
          <input name="area" placeholder="Gloucester, Rockport, Beverly…" style={input} />
        </label>
        <label style={lbl}>
          When can you work?
          <input name="availability" placeholder="e.g. weekend afternoons, weekday mornings" style={input} />
        </label>
        <label style={lbl}>
          Tell us a little about yourself
          <textarea name="about" rows={4} placeholder="Any property, hospitality, cleaning, or home-maintenance experience? Why this work?" style={{ ...input, resize: 'vertical' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink-3)', marginBottom: 24 }}>
          <input type="checkbox" name="has_transport" defaultChecked />
          I have my own transportation
        </label>
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
