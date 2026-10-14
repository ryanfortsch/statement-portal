import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { auth } from '@/auth';
import { roleForEmail } from '@/lib/helm-access';
import { fieldDb } from '@/lib/field-db';
import { parseTrade } from '@/lib/field-types';
import { PROPERTIES } from '@/lib/properties';
import { todayET } from '@/lib/team-recipients';
import { handoffMonths, isMonth, type HandoffItem } from '@/lib/close-handoff';
import { loadHandoffItems } from '@/lib/close-handoff-db';
import { CloseHandoffBoard } from './CloseHandoffBoard';

export const dynamic = 'force-dynamic';

/**
 * The month-close handoff.
 *
 * Three days before the monthly statement close the operations manager
 * sends clean field data: repair costs, card charges by home, and cleaning
 * issues. This is where she adds them through the month and marks the month
 * sent. Open to staff on purpose; the money moves happen elsewhere. An item
 * reaches a statement only when an owner files it from the statement card
 * through the receipt path, or notes it on the period, so nothing entered
 * here changes a payout.
 */

type Loaded = { ok: true; items: HandoffItem[] } | { ok: false; error: string };

async function loadProperties(): Promise<{ id: string; name: string }[]> {
  const { data } = await fieldDb()
    .from('properties')
    .select('id,name,kind,is_active')
    .order('name');
  return ((data ?? []) as { id: string; name: string; kind: string | null; is_active: boolean | null }[])
    .filter((p) => p.kind !== 'hq' && p.is_active !== false)
    .map((p) => ({ id: p.id, name: p.name }));
}

export default async function CloseHandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const trade = parseTrade(sp.trade);
  const session = await auth();
  const email = session?.user?.email ?? '';
  const owner = roleForEmail(email) === 'owner';
  const today = todayET();
  const months = handoffMonths(today);
  const month = isMonth(sp.month) ? sp.month : months[months.length - 1];
  const offered = months.includes(month) ? months : [month, ...months];

  const [properties, loaded] = await Promise.all([
    loadProperties(),
    loadHandoffItems({ months: [month] })
      .then((items): Loaded => ({ ok: true, items }))
      .catch((e: unknown): Loaded => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="close" trade={trade} />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 2 }}>Field</div>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Close handoff</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20, maxWidth: 640 }}>
          The field data for the monthly statement close, by home: repair costs, card charges, and cleaning issues.
          Add items as the month goes, then mark the month sent three days before the close. Nothing here changes
          an owner&apos;s payout; Ryan files each item into the statement.
        </p>

        {!loaded.ok ? (
          <div role="alert" style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 13, borderRadius: 8, marginBottom: 24, lineHeight: 1.5 }}>
            The handoff can&apos;t be read yet: {loaded.error}
            <div style={{ color: 'var(--ink-3)', marginTop: 6 }}>
              Apply <code>supabase/migrations/20261014130000_close_handoff_items.sql</code> and this page fills in.
            </div>
          </div>
        ) : (
          <CloseHandoffBoard
            month={month}
            months={offered}
            today={today}
            trade={trade}
            items={loaded.items}
            properties={properties}
            statementHomes={Object.keys(PROPERTIES)}
            owner={owner}
            me={email}
          />
        )}
      </section>
      <HelmFooter />
    </div>
  );
}
