import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import type { ContractorRow } from '@/lib/field-types';
import { inviteContractor } from '../packets/actions';

export const dynamic = 'force-dynamic';

const STATUS_TINT: Record<string, string> = {
  invited: 'var(--ink-4)',
  onboarding: 'var(--signal)',
  active: 'var(--positive)',
  paused: 'var(--ink-4)',
  archived: 'var(--ink-4)',
};

export default async function ContractorsPage() {
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

  const { data } = await fieldDb()
    .from('contractors')
    .select('*')
    .order('created_at', { ascending: false });
  const contractors = (data ?? []) as ContractorRow[];
  const base = fieldBaseUrl();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Field packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Contractors</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24 }}>
          Invite an inspector and we email them a personal portal link. They set up their account (W-9 +
          agreement) before they can claim paid work.
        </p>

        <form action={inviteContractor} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '1px solid var(--rule)', paddingBottom: 22, marginBottom: 22 }}>
          <label style={lbl}>
            Name
            <input name="full_name" required placeholder="Marcus Reed" style={inp} />
          </label>
          <label style={lbl}>
            Email
            <input name="email" type="email" required placeholder="marcus@example.com" style={inp} />
          </label>
          <label style={lbl}>
            Phone
            <input name="phone" type="tel" placeholder="(978) 555-0123" style={inp} />
          </label>
          <button type="submit" style={btnDark}>Send invite</button>
        </form>

        {contractors.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No contractors yet.</p>
        ) : (
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {contractors.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="font-serif" style={{ fontSize: 16 }}>{c.full_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
                </div>
                <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: STATUS_TINT[c.status] ?? 'var(--ink-4)' }}>
                  {c.status}
                  {c.w9_on_file ? ' · W-9' : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono-dash), monospace', wordBreak: 'break-all', maxWidth: 280 }}>
                  {base}/field/{c.portal_token}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <HelmFooter module="Field" right="Contractor roster" />
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
const inp: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  minWidth: 180,
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 18px',
};
