import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';
import { chargeBalance } from './actions';
import { balanceChargeConfirm } from '@/lib/irreversible-confirms';

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
 *
 * It lives under /payments (2026-10-18): it is a payments surface, not part
 * of the statement close. /statements/balance-charges redirects here
 * (next.config.ts), so the concierge's older work slips still land.
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
      <FinancialsTabs current="payments" />
      <HelmHero
        eyebrow="Helm · Payments"
        title="Balance charges"
        description="Far-future balances, charged to the card the guest saved at deposit once their date arrives."
      />

      <main className="max-w-[1100px] mx-auto px-10 pb-20 flex-1" style={{ width: '100%' }}>
        <div style={{ marginBottom: 24 }}>
          <Link href="/payments" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            ← Payments
          </Link>
        </div>

        {errCopy && (
          <div
            style={{
              borderLeft: '3px solid var(--signal)',
              background: 'var(--paper-2)',
              padding: '12px 16px',
              marginBottom: 20,
              fontSize: 13,
              color: 'var(--ink-2)',
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
                  confirm={balanceChargeConfirm(usd(r.balance_cents), r.guest_name)}
                  label={`Charge ${usd(r.balance_cents)} to card on file`}
                  busyLabel="Charging..."
                  disabled={!keys[r.property_id]}
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    padding: '10px 18px',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
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
                Send the guest a payment link for the balance instead (the stay&apos;s work slip has the details). Retry only if the failure looks transient.
              </Meta>
              <form action={chargeBalance} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton
                  confirm={balanceChargeConfirm(usd(r.balance_cents), r.guest_name)}
                  label="Retry charge"
                  busyLabel="Charging..."
                  disabled={!keys[r.property_id] || r.charge_after > todayIso}
                  spinnerTone="ink"
                  style={{
                    background: 'transparent',
                    color: 'var(--ink)',
                    padding: '9px 16px',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    border: '1px solid var(--ink)',
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
        className="font-serif"
        style={{
          fontSize: 18,
          fontWeight: 500,
          color: 'var(--ink)',
          margin: 0,
          paddingBottom: 10,
          borderBottom: '1px solid var(--ink)',
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </section>
  );
}

/** One balance: a ruled row like a statements card, signal-edged when it failed. */
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
        borderBottom: '1px dotted var(--rule)',
        borderLeft: tone === 'warn' ? '3px solid var(--signal)' : undefined,
        background: tone === 'warn' ? 'var(--paper-2)' : 'transparent',
        padding: tone === 'warn' ? '14px 16px' : '14px 0',
      }}
    >
      {children}
    </div>
  );
}

function RowHeader({ name, guest, amount }: { name: string; guest: string; amount: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <div className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
        {name} <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· {guest}</span>
      </div>
      <div className="font-serif tabular-nums" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>
        {amount}
      </div>
    </div>
  );
}

function Meta({ tone, children }: { tone?: 'warn'; children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        marginTop: 6,
        color: tone === 'warn' ? 'var(--signal)' : 'var(--ink-3)',
      }}
    >
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: '12px 0' }}>{text}</div>;
}
