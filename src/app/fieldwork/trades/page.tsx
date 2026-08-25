import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { parseTrade } from '@/lib/field-types';
import {
  byCategory,
  categoryLabel,
  coiDaysLeft,
  compareVendors,
  categoryRank,
  dialable,
  formatPhone,
  STANDING_META,
  TRADE_CATEGORIES,
  type TradeVendorRow,
} from '@/lib/trades';
import { VendorForm } from './VendorForm';
import { markVendorUsed, setVendorArchived } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Trades: the directory of outside vendors we call when something breaks.
 *
 * Sits in the Field section because it answers the same question the rest
 * of Field answers -- who goes to the house -- for the half of the answer
 * that isn't our own 1099 roster. It is deliberately trade-agnostic: the
 * ?trade= param rides through so the tab strip returns you to the job type
 * you came from, but a plumber is a plumber no matter which lens you left.
 *
 * The page is built around the 9 PM question. The after-hours rail is
 * first, every number is a one-tap tel:/sms: link, and the list is sorted
 * so the first call for a trade sits at the top of its section.
 */

type Loaded =
  | { ok: true; vendors: TradeVendorRow[] }
  | { ok: false; error: string };

async function loadVendors(): Promise<Loaded> {
  const { data, error } = await fieldDb()
    .from('trade_vendors')
    .select('*')
    .order('name');
  if (error) return { ok: false, error: error.message };
  return { ok: true, vendors: (data ?? []) as TradeVendorRow[] };
}

async function loadProperties(): Promise<{ id: string; name: string }[]> {
  const { data } = await fieldDb()
    .from('properties')
    .select('id,name,kind')
    .order('name');
  return ((data ?? []) as { id: string; name: string; kind: string | null }[])
    .filter((p) => p.kind !== 'hq')
    .map((p) => ({ id: p.id, name: p.name }));
}

function matches(v: TradeVendorRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    v.name, v.contact_name, categoryLabel(v.category), v.category,
    v.phone, v.after_hours_phone, v.email, v.service_area, v.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string; cat?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const trade = parseTrade(sp.trade);
  const cat = sp.cat ?? '';
  const q = (sp.q ?? '').trim().toLowerCase();

  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const [loaded, properties] = await Promise.all([loadVendors(), loadProperties()]);
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));

  const all = loaded.ok ? loaded.vendors : [];
  const live = all.filter((v) => !v.archived_at);
  const retired = all.filter((v) => v.archived_at).sort(compareVendors);

  const filtered = live.filter((v) => (!cat || v.category === cat) && matches(v, q));
  const groups = byCategory(filtered);
  const onCall = live
    .filter((v) => v.emergency && v.standing !== 'do_not_use')
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || compareVendors(a, b));

  // Only offer filter chips for trades we actually have someone in.
  const populated = new Set(live.map((v) => v.category));
  const chips = TRADE_CATEGORIES.filter((c) => populated.has(c.id));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="trades" trade={trade} />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 2 }}>Field</div>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Trades &amp; vendors</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20, maxWidth: 620 }}>
          Who we call when something breaks. Outside companies we hire by the job: plumbers, electricians, appliance
          techs, pest control. Separate from the roster, which is our own 1099 crew.
        </p>

        {!loaded.ok && (
          <div role="alert" style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 13, borderRadius: 8, marginBottom: 24, lineHeight: 1.5 }}>
            The directory can&apos;t be read yet: {loaded.error}
            <div style={{ color: 'var(--ink-3)', marginTop: 6 }}>
              Apply <code>supabase/migrations/20260825b_trade_vendors.sql</code> and this page fills in.
            </div>
          </div>
        )}

        {/* The 9 PM rail: who picks up after hours, one tap each. */}
        {onCall.length > 0 && (
          <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, background: 'var(--paper-2, #fff)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              After hours
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px 20px' }}>
              {onCall.map((v) => {
                const num = dialable(v.after_hours_phone) ?? dialable(v.phone);
                return (
                  <div key={v.id} style={{ fontSize: 13, lineHeight: 1.45 }}>
                    <span style={{ color: 'var(--ink-4)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {categoryLabel(v.category)}
                    </span>
                    <div>
                      <a href={`#v-${v.id}`} style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 500 }}>{v.name}</a>
                      {num ? (
                        <>
                          {' · '}
                          <a href={`tel:${num}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                            {formatPhone(v.after_hours_phone ?? v.phone)}
                          </a>
                        </>
                      ) : (
                        <span style={{ color: 'var(--signal)', fontSize: 12 }}> · no number on file</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Find: plain GET form, no client JS. */}
        {live.length > 0 && (
          <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input type="hidden" name="trade" value={trade} />
            {cat && <input type="hidden" name="cat" value={cat} />}
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Search trades, names, numbers…"
              style={{ font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 12px', minWidth: 260, flex: '1 1 260px' }}
            />
            <button type="submit" style={btnGhostSm}>Search</button>
          </form>
        )}

        {chips.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 22 }}>
            <Chip label="All trades" href={`/fieldwork/trades?trade=${trade}${q ? `&q=${encodeURIComponent(q)}` : ''}`} active={!cat} />
            {chips.map((c) => (
              <Chip
                key={c.id}
                label={c.label}
                href={`/fieldwork/trades?trade=${trade}&cat=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                active={cat === c.id}
              />
            ))}
          </div>
        )}

        {loaded.ok && live.length === 0 && (
          <p style={{ color: 'var(--ink-4)', fontSize: 14, marginBottom: 24 }}>
            Nobody in the directory yet. Add the first one below.
          </p>
        )}
        {loaded.ok && live.length > 0 && filtered.length === 0 && (
          <p style={{ color: 'var(--ink-4)', fontSize: 14, marginBottom: 24 }}>Nothing matches that.</p>
        )}

        {groups.map((g) => (
          <div key={g.id} style={{ marginBottom: 30 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              {g.label} · {g.vendors.length}
            </h2>
            {g.vendors.map((v) => (
              <VendorCard key={v.id} v={v} trade={trade} propertyName={propertyName} properties={properties} />
            ))}
          </div>
        ))}

        <details style={{ marginTop: 8, borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
          <summary style={summary}>+ Add a vendor</summary>
          <div style={{ marginTop: 18 }}>
            <VendorForm properties={properties} trade={trade} defaultCategory={cat || undefined} />
          </div>
        </details>

        {retired.length > 0 && (
          <details style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
            <summary style={summary}>Retired · {retired.length}</summary>
            <div style={{ marginTop: 12 }}>
              {retired.map((v) => (
                <div key={v.id} id={`v-${v.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)', opacity: 0.7, flexWrap: 'wrap', scrollMarginTop: 90 }}>
                  <span style={{ fontSize: 14 }}>
                    {v.name}
                    <span style={{ color: 'var(--ink-4)', fontSize: 12 }}> · {categoryLabel(v.category)}</span>
                  </span>
                  <form action={setVendorArchived} style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="trade" value={trade} />
                    <input type="hidden" name="archived" value="0" />
                    <SubmitButton label="Bring back" busyLabel="Restoring…" style={btnGhostSm} spinnerTone="ink" />
                  </form>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
      <HelmFooter module="Field" right={`${live.length} ${live.length === 1 ? 'vendor' : 'vendors'}`} />
    </div>
  );
}

function Chip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      style={{
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        fontWeight: 600,
        textDecoration: 'none',
        borderRadius: 999,
        padding: '5px 12px',
        border: '1px solid var(--rule)',
        color: active ? 'var(--paper)' : 'var(--ink-3)',
        background: active ? 'var(--ink)' : 'transparent',
      }}
    >
      {label}
    </a>
  );
}

function VendorCard({
  v,
  trade,
  propertyName,
  properties,
}: {
  v: TradeVendorRow;
  trade: string;
  propertyName: Map<string, string>;
  properties: { id: string; name: string }[];
}) {
  const m = STANDING_META[v.standing];
  const num = dialable(v.phone);
  const afterNum = dialable(v.after_hours_phone);
  const coi = coiDaysLeft(v.coi_expires_on);
  const homes = v.property_ids.length
    ? v.property_ids.map((id) => propertyName.get(id) ?? id).join(', ')
    : 'Whole fleet';

  const facts: string[] = [];
  if (v.service_area) facts.push(v.service_area);
  if (v.rate_note) facts.push(v.rate_note);
  if (v.account_number) facts.push(`Acct ${v.account_number}`);
  if (v.license_number) facts.push(`Lic ${v.license_number}`);
  if (v.insured === true && coi === null) facts.push('Insured');
  if (v.insured === false) facts.push('Not insured');
  if (v.w9_on_file) facts.push('W-9 on file');

  return (
    <div id={`v-${v.id}`} style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 10, background: 'var(--paper-2, #fff)', scrollMarginTop: 90 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span className="font-serif" style={{ fontSize: 17 }}>{v.name}</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: m.tint, background: m.bg, borderRadius: 999, padding: '2px 9px', marginLeft: 8, whiteSpace: 'nowrap' }}>
            {m.label}
          </span>
          {v.emergency && (
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--signal)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 8px', marginLeft: 6, whiteSpace: 'nowrap' }}>
              After hours
            </span>
          )}
          {v.contact_name && <span style={{ fontSize: 12.5, color: 'var(--ink-4)', marginLeft: 8 }}>ask for {v.contact_name}</span>}
        </div>
        {v.last_used_on && (
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>last used {v.last_used_on}</span>
        )}
      </div>

      <div style={{ fontSize: 12.5, marginTop: 5, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {num ? (
          <>
            <a href={`tel:${num}`} style={link}>{formatPhone(v.phone)}</a>
            <a href={`sms:${num}`} style={{ ...link, fontSize: 11, fontWeight: 600 }}>Text</a>
          </>
        ) : (
          <span style={{ color: 'var(--signal)' }}>No number on file</span>
        )}
        {afterNum && (
          <>
            <span style={{ color: 'var(--rule)' }}>·</span>
            <a href={`tel:${afterNum}`} style={link}>{formatPhone(v.after_hours_phone)}</a>
            <span style={{ color: 'var(--ink-4)', fontSize: 11 }}>after hours</span>
          </>
        )}
        {v.email && (
          <>
            <span style={{ color: 'var(--rule)' }}>·</span>
            <a href={`mailto:${v.email}`} style={link}>{v.email}</a>
          </>
        )}
        {v.website && (
          <>
            <span style={{ color: 'var(--rule)' }}>·</span>
            <a href={v.website} target="_blank" rel="noopener noreferrer" style={link}>Site ↗</a>
          </>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 6, lineHeight: 1.5 }}>
        {homes}
        {facts.length > 0 && ` · ${facts.join(' · ')}`}
        {coi !== null && (
          <span style={{ color: coi <= 30 ? 'var(--signal)' : 'var(--ink-4)', fontWeight: coi <= 30 ? 600 : 400 }}>
            {' · '}
            {coi < 0 ? `COI expired ${v.coi_expires_on}` : `COI good to ${v.coi_expires_on}`}
          </span>
        )}
      </div>

      {v.notes && <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>{v.notes}</div>}

      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <form action={markVendorUsed} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="trade" value={trade} />
          <SubmitButton label="Used today" busyLabel="Noting…" style={btnGhostSm} spinnerTone="ink" />
        </form>
        <form action={setVendorArchived} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="trade" value={trade} />
          <input type="hidden" name="archived" value="1" />
          <SubmitButton label="Retire" busyLabel="Retiring…" style={btnGhostSm} spinnerTone="ink" />
        </form>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ ...summary, fontSize: 11 }}>Edit</summary>
        <div style={{ marginTop: 14 }}>
          <VendorForm vendor={v} properties={properties} trade={trade} />
        </div>
      </details>
    </div>
  );
}

const link: React.CSSProperties = { color: 'var(--tide-deep)', textDecoration: 'none' };
const summary: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  color: 'var(--ink-3)',
};
const btnGhostSm: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '6px 14px',
};
