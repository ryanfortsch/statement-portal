import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import { loadApplications, type ContractorApplication } from '@/lib/field-packets';
import { CopyCode } from '@/app/field/CopyCode';
import { inviteApplicant, declineApplicant, reopenApplicant } from './actions';

export const dynamic = 'force-dynamic';

function fmtWhen(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

const SOURCES = ['indeed', 'facebook', 'nextdoor', 'craigslist', 'referral'];

export default async function ApplicantsPage() {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const apps = await loadApplications();
  const active = apps.filter((a) => a.status === 'new' || a.status === 'reviewing');
  const invited = apps.filter((a) => a.status === 'invited');
  const declined = apps.filter((a) => a.status === 'declined');
  const base = fieldBaseUrl();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/contractors" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Contractors</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Applicants</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20, maxWidth: 620 }}>
          People who applied through the public link. Invite the good ones (we email them a portal link and they
          onboard themselves) or decline. Post the job anywhere and point it at these links:
        </p>

        {/* Shareable apply links, tagged by source for attribution */}
        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 28, background: 'var(--paper-2, #fff)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
            Apply links
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13, alignItems: 'baseline' }}>
            {SOURCES.map((s) => (
              <div key={s} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--ink-4)', textTransform: 'capitalize' }}>{s}</span>
                <CopyCode value={`${base}/field/apply?src=${s}`} mono={false} />
              </div>
            ))}
          </div>
        </div>

        {active.length === 0 && (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No new applicants right now.</p>
        )}

        {active.map((a) => (
          <ApplicantCard key={a.id} a={a} />
        ))}

        {invited.length > 0 && (
          <Closed title={`Invited · ${invited.length}`} apps={invited} />
        )}
        {declined.length > 0 && (
          <Closed title={`Declined · ${declined.length}`} apps={declined} />
        )}
      </section>
      <HelmFooter module="Field" right="Applicants" />
    </div>
  );
}

function ApplicantCard({ a }: { a: ContractorApplication }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginBottom: 12, background: 'var(--paper-2, #fff)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span className="font-serif" style={{ fontSize: 17 }}>{a.full_name}</span>
          {a.trade !== 'inspection' && (
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px', marginLeft: 8 }}>{a.trade}</span>
          )}
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
            {a.email}{a.phone ? ` · ${a.phone}` : ''}{a.area ? ` · ${a.area}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right' }}>
          {fmtWhen(a.created_at)}{a.source ? ` · via ${a.source}` : ''}
        </div>
      </div>
      {(a.availability || a.about || a.has_transport != null) && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.55 }}>
          {a.availability && <div><span style={{ color: 'var(--ink-4)' }}>Available:</span> {a.availability}</div>}
          {a.has_transport != null && <div><span style={{ color: 'var(--ink-4)' }}>Transport:</span> {a.has_transport ? 'yes' : 'no'}</div>}
          {a.about && <div style={{ marginTop: 4 }}>{a.about}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <form action={inviteApplicant} style={{ margin: 0 }}>
          <input type="hidden" name="application_id" value={a.id} />
          <button type="submit" style={btnDark}>Invite</button>
        </form>
        <form action={declineApplicant} style={{ margin: 0 }}>
          <input type="hidden" name="application_id" value={a.id} />
          <button type="submit" style={btnGhost}>Decline</button>
        </form>
      </div>
    </div>
  );
}

function Closed({ title, apps }: { title: string; apps: ContractorApplication[] }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>{title}</h2>
      {apps.map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)', opacity: 0.7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>{a.full_name} <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>· {a.email}</span></span>
          <form action={reopenApplicant} style={{ margin: 0 }}>
            <input type="hidden" name="application_id" value={a.id} />
            <button type="submit" style={{ ...btnGhost, padding: '4px 10px' }}>Reopen</button>
          </form>
        </div>
      ))}
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
  padding: '9px 18px',
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
  padding: '9px 18px',
};
