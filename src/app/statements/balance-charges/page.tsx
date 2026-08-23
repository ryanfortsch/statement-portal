import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';
import { chargeBalance } from './actions';

/**
 * Saved-card balance charges for far-future direct bookings.
 *
 * Rows arrive from stay-concierge the moment a save_card booking deposit
 * turns paid (/api/balance-charges). Each is the guest's remaining balance,
 * pre-authorized at deposit checkout for an off-session charge on the card
 * they saved. Once charge_after arrives (Jan 2 of the stay year, or 3 weeks
 * before check-in if sooner) the row goes hot and the Charge button fires
 * the PaymentIntent in the property's own Stripe account - one click, no
 * link minting, no guest chasing. The concierge's balance work slip points
 * here; failures fall back to a hand-sent payment link.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Row = {
  id: string;
  request_key: string;
  property_id: string;
  guest_name: string;
  guest_email: string;
  window_start: string | null;
  window_end: string | null;
  balance_cents: number;
  charge_after: string;
  status: string;
  charge_attempts: number;
  stripe_payment_intent_id: string | null;
  charged_at: string | null;
  charged_by_email: string | null;
  failure_code: string | null;
  failure_message: string | null;
  failed_at: string | null;
  created_at: string;
};

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const ERR_COPY: Record<string, string> = {
  not_due: 'That balance is not chargeable yet - its charge date has not arrived.',
  no_key:
    'No Stripe key is configured for that property (STRIPE_KEY_<ID> in Vercel), so the charge could not be attempted.',
};

export default async function BalanceChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const sp = await searchParams;
  const errCopy = sp.err ? ERR_COPY[sp.err] : undefined;

  if (!isServiceConfigured) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <main className="max-w-[900px] mx-auto px-10 py-16">
          <p>Supabase service role is not configured in this environment.</p>
        </main>
      </div>
    );
  }

  const { data } = await supabase
    .from('balance_charges')
    .select('*')
    .order('charge_after', { ascending: true });
  const rows = (data ?? []) as Row[];

  const propIds = [...new Set(rows.map((r) => r.property_id))];
  const nameById = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: props } = await supabase.from('properties').select('id, name').in('id', propIds);
    for (const p of props ?? []) nameById.set(p.id as string, (p.name as string) || (p.id as string));
  }
  const keys = getStripeKeysMap();

  const todayIso = new Date().toISOString().slice(0, 10);
  const due = rows.filter((r) => ['scheduled', 'charging'].includes(r.status) && r.charge_after <= todayIso);
  const failed = rows.filter((r) => r.status === 'failed');
  const upcoming = rows.filter((r) => r.status === 'scheduled' && r.charge_after > todayIso);
  const charged = rows
    .filter((r) => r.status === 'charged')
    .sort((a, b) => (b.charged_at || '').localeCompare(a.charged_at || ''))
    .slice(0, 12);

  const propName = (r: Row) => nameById.get(r.property_id) || r.property_id;
  const windowDesc = (r: Row) =>
    r.window_start && r.window_end ? `${fmtDate(r.window_start)} - ${fmtDate(r.window_end)}` : 'window TBD';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero
        eyebrow="Helm · Statements"
        title="Balance charges,"
        emphasis="one click."
        description="Far-future booking balances pre-authorized on the card saved at deposit time. When a charge date arrives, approve it here - Helm charges the property's own Stripe account off-session, sends Stripe's receipt, and the payment flows to the statements extras queue."
      />

      <main className="max-w-[1000px] mx-auto px-10 pb-20 flex-1" style={{ width: '100%' }}>
        <div style={{ marginBottom: 24 }}>
          <Link href="/statements" style={{ fontSize: 13, opacity: 0.7 }}>
            ← Back to Statements
          </Link>
        </div>

        {errCopy && (
          <div
            style={{
              border: '1px solid rgba(200,90,58,0.5)',
              background: 'rgba(200,90,58,0.08)',
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            {errCopy}
          </div>
        )}

        <Section title={`Due now (${due.length})`}>
          {due.length === 0 && <Empty text="Nothing is due. Rows go hot on their charge date." />}
          {due.map((r) => (
            <Card key={r.id} id={`row-${r.id}`}>
              <RowHeader
                name={propName(r)}
                guest={r.guest_name || 'Guest'}
                amount={usd(r.balance_cents)}
              />
              <Meta>
                Stay {windowDesc(r)} · chargeable since {fmtDate(r.charge_after)}
                {r.guest_email ? ` · receipt to ${r.guest_email}` : ' · no receipt email on file'}
              </Meta>
              {r.status === 'charging' && (
                <Meta tone="warn">
                  A previous attempt is marked in flight (or died mid-attempt). Check the
                  property&apos;s Stripe dashboard for a recent PaymentIntent before retrying.
                </Meta>
              )}
              {!keys[r.property_id] && (
                <Meta tone="warn">
                  No Stripe key configured for this property (STRIPE_KEY_
                  {r.property_id.toUpperCase()}) - the charge cannot run until it is set in Vercel.
                </Meta>
              )}
              <form action={chargeBalance} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton
                  label={`Charge ${usd(r.balance_cents)} to card on file`}
                  busyLabel="Charging..."
                  disabled={!keys[r.property_id]}
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    borderRadius: 8,
                    padding: '10px 18px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: 'none',
                  }}
                />
              </form>
            </Card>
          ))}
        </Section>

        <Section title={`Failed (${failed.length})`}>
          {failed.length === 0 && <Empty text="No failed charges." />}
          {failed.map((r) => (
            <Card key={r.id} id={`row-${r.id}`} tone="warn">
              <RowHeader
                name={propName(r)}
                guest={r.guest_name || 'Guest'}
                amount={usd(r.balance_cents)}
              />
              <Meta>
                Stay {windowDesc(r)} · attempt {r.charge_attempts} failed {fmtDate(r.failed_at?.slice(0, 10) || null)}
              </Meta>
              <Meta tone="warn">
                {r.failure_code}
                {r.failure_message ? ` - ${r.failure_message}` : ''}
              </Meta>
              <Meta>
                Fallback: mint and send the guest a payment link for the balance instead (the
                concierge&apos;s work slip on this stay carries the details). Retry only if the
                failure looks transient.
              </Meta>
              <form action={chargeBalance} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton
                  label="Retry charge"
                  busyLabel="Charging..."
                  disabled={!keys[r.property_id] || r.charge_after > todayIso}
                  spinnerTone="ink"
                  style={{
                    background: 'transparent',
                    color: 'var(--ink)',
                    borderRadius: 8,
                    padding: '9px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid rgba(30,46,52,0.35)',
                  }}
                />
              </form>
            </Card>
          ))}
        </Section>

        <Section title={`Upcoming (${upcoming.length})`}>
          {upcoming.length === 0 && <Empty text="No future balances registered yet." />}
          {upcoming.map((r) => (
            <Card key={r.id} id={`row-${r.id}`}>
              <RowHeader
                name={propName(r)}
                guest={r.guest_name || 'Guest'}
                amount={usd(r.balance_cents)}
              />
              <Meta>
                Stay {windowDesc(r)} · charge opens {fmtDate(r.charge_after)}
                {keys[r.property_id] ? '' : ' · no Stripe key configured yet'}
              </Meta>
            </Card>
          ))}
        </Section>

        <Section title="Recently charged">
          {charged.length === 0 && <Empty text="Nothing charged yet." />}
          {charged.map((r) => (
            <Card key={r.id} id={`row-${r.id}`}>
              <RowHeader
                name={propName(r)}
                guest={r.guest_name || 'Guest'}
                amount={usd(r.balance_cents)}
              />
              <Meta>
                Charged {fmtDate(r.charged_at?.slice(0, 10) || null)} by {r.charged_by_email || '?'} ·{' '}
                {r.stripe_payment_intent_id || ''} · flows to the extras queue on the next Stripe sync
              </Meta>
            </Card>
          ))}
        </Section>
      </main>
      <HelmFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontSize: 22,
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

function Card({
  id,
  tone,
  children,
}: {
  id: string;
  tone?: 'warn';
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      style={{
        border: tone === 'warn' ? '1px solid rgba(200,90,58,0.5)' : '1px solid rgba(30,46,52,0.15)',
        background: tone === 'warn' ? 'rgba(200,90,58,0.05)' : 'rgba(255,255,255,0.55)',
        borderRadius: 12,
        padding: '16px 20px',
      }}
    >
      {children}
    </div>
  );
}

function RowHeader({ name, guest, amount }: { name: string; guest: string; amount: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {name} <span style={{ opacity: 0.6, fontWeight: 400 }}>· {guest}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono-dash), ui-monospace, monospace', fontSize: 16, fontWeight: 600 }}>
        {amount}
      </div>
    </div>
  );
}

function Meta({ tone, children }: { tone?: 'warn'; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        marginTop: 6,
        opacity: tone === 'warn' ? 1 : 0.7,
        color: tone === 'warn' ? '#c85a3a' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 13, opacity: 0.55 }}>{text}</div>;
}
