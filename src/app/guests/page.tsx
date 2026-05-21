import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { getGuestStats, listContacts, listSegments, listCampaigns } from '@/lib/guests';
import { displayName, formatTagLabel, type GuestContact, type GuestStatus } from '@/lib/guests-types';
import { getLastGuestySyncStatus } from '@/lib/guests-guesty-sync';
import { manuallyAddContact, syncFromGuesty } from './actions';

export const dynamic = 'force-dynamic';

type SearchParams = {
  q?: string;
  tag?: string;
  status?: GuestStatus | 'all';
  imported?: string;
  synced?: string;
  updated?: string;
  scanned?: string;
};

export default async function GuestPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const search = sp.q?.trim() || '';
  const tag = sp.tag?.trim() || '';
  const status = (sp.status as GuestStatus | 'all' | undefined) || 'all';
  const justImported = sp.imported ? Number(sp.imported) : 0;
  const syncedInserted = sp.synced ? Number(sp.synced) : 0;
  const syncedUpdated = sp.updated ? Number(sp.updated) : 0;
  const syncedScanned = sp.scanned ? Number(sp.scanned) : 0;

  const [stats, contacts, segments, campaigns, guestySync] = await Promise.all([
    getGuestStats(),
    listContacts({ search, tag, status, limit: 200 }),
    listSegments(),
    listCampaigns(),
    getLastGuestySyncStatus(),
  ]);

  const lastGuestySyncRel = guestySync.last_synced_at
    ? formatRelativeTime(guestySync.last_synced_at)
    : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Guests</div>
        <h1 className="font-serif" style={{
          fontSize: 44,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          maxWidth: 720,
        }}>
          The list, <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>kept close.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Subscribers, segments, and campaigns. Where The Weekly lives, where new signups land, and where every send is logged.
        </p>
      </section>

      {/* STATS STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat label="Subscribers" value={stats.configured ? String(stats.subscribers) : '—'} sub={stats.configured ? 'opted in' : 'configure env vars'} />
          <Stat label="Total Contacts" value={stats.configured ? String(stats.totalContacts) : '—'} sub={stats.unsubscribed > 0 ? `${stats.unsubscribed} unsubscribed` : ''} />
          <Stat label="Last 30 Days" value={String(stats.recentSignups)} sub="new signups" />
          <Stat label="Bounced" value={String(stats.bounced)} sub={stats.bounced > 0 ? 'needs cleanup' : 'clean list'} accent={stats.bounced > 0} last />
        </div>
      </section>

      {/* JUST IMPORTED FLASH */}
      {justImported > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div
            style={{
              borderLeft: '3px solid var(--positive, #2d6b50)',
              padding: '12px 16px',
              background: 'var(--paper-2, #f4f0e6)',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          >
            Imported <strong>{justImported}</strong> contacts. The list below is now sorted by signup date.
          </div>
        </section>
      )}

      {/* JUST SYNCED FROM GUESTY FLASH */}
      {(syncedInserted > 0 || syncedUpdated > 0 || syncedScanned > 0) && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div
            style={{
              borderLeft: '3px solid var(--positive, #2d6b50)',
              padding: '12px 16px',
              background: 'var(--paper-2, #f4f0e6)',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          >
            Guesty sync: scanned <strong>{syncedScanned}</strong> guests, added <strong>{syncedInserted}</strong>, updated <strong>{syncedUpdated}</strong>.
          </div>
        </section>
      )}

      {/* ACTIONS BAR */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/guests/import" style={primaryButtonStyle}>
            Import CSV →
          </Link>
          <form action={syncFromGuesty}>
            <button type="submit" style={secondaryButtonStyle} title="Pull guest emails from Guesty into the contact list">
              Sync from Guesty{lastGuestySyncRel ? ` · ${lastGuestySyncRel}` : ''}
            </button>
          </form>
          <Link href="/guests/campaigns" style={secondaryButtonStyle}>
            Campaigns ({campaigns.length})
          </Link>
          <Link href="/guests/campaigns/new" style={secondaryButtonStyle}>
            New Campaign
          </Link>
          <Link href="/guests/segments" style={secondaryButtonStyle}>
            Segments ({segments.length})
          </Link>
          <Link href="/guests/marketing" style={secondaryButtonStyle}>
            Marketing Memory
          </Link>
          <span style={{ flex: 1 }} />
          <details style={{ position: 'relative' }}>
            <summary style={{ ...secondaryButtonStyle, cursor: 'pointer', listStyle: 'none' }}>
              + Add Contact
            </summary>
            <form
              action={manuallyAddContact}
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                background: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: 16,
                width: 320,
                zIndex: 10,
                display: 'grid',
                gap: 8,
              }}
            >
              <input name="email" type="email" placeholder="email@example.com" required style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input name="first_name" placeholder="First" style={inputStyle} />
                <input name="last_name" placeholder="Last" style={inputStyle} />
              </div>
              <input name="tags" placeholder="tags, comma, separated" style={inputStyle} />
              <button type="submit" style={primaryButtonStyle}>Add</button>
            </form>
          </details>
        </div>
      </section>

      {/* SEARCH + TAG FILTERS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search email or name"
            style={{ ...inputStyle, flex: 1, minWidth: 240 }}
          />
          <select name="status" defaultValue={status} style={selectStyle}>
            <option value="all">All statuses</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="pending">Pending</option>
          </select>
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button type="submit" style={secondaryButtonStyle}>Filter</button>
          {(search || tag || status !== 'all') && (
            <Link href="/guests" style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'underline' }}>
              Clear
            </Link>
          )}
        </form>

        {/* Tag pills */}
        {stats.topTags.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {stats.topTags.map((t) => {
              const active = t.tag === tag;
              const params = new URLSearchParams();
              if (search) params.set('q', search);
              if (status !== 'all') params.set('status', status);
              if (!active) params.set('tag', t.tag);
              const href = `/guests${params.toString() ? '?' + params.toString() : ''}`;
              return (
                <Link
                  key={t.tag}
                  href={href}
                  style={{
                    fontSize: 11,
                    letterSpacing: '.04em',
                    padding: '4px 10px',
                    border: '1px solid ' + (active ? 'var(--ink)' : 'var(--rule)'),
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--paper)' : 'var(--ink-3)',
                    textDecoration: 'none',
                    borderRadius: 0,
                  }}
                >
                  {formatTagLabel(t.tag)} · {t.count}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* CONTACTS LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Contacts
          </h2>
          <span className="eyebrow">
            {contacts.length === 200 ? 'showing first 200' : `${contacts.length} ${contacts.length === 1 ? 'match' : 'matches'}`}
          </span>
        </div>

        {!stats.configured ? (
          <EmptyBlock body="Helm Supabase env vars are not set." />
        ) : contacts.length === 0 ? (
          stats.totalContacts === 0 ? (
            <EmptyBlock
              body="No contacts yet."
              hint={
                <>
                  Run the migration at{' '}
                  <code className="font-mono">supabase/migrations/20260504_create_audience.sql</code>{' '}
                  in Helm&apos;s Supabase SQL Editor, then import your Squarespace export.
                </>
              }
            />
          ) : (
            <EmptyBlock body="No contacts match this filter." />
          )
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {contacts.map((c, i) => (
              <ContactRow key={c.id} contact={c} number={String(i + 1).padStart(3, '0')} />
            ))}
          </div>
        )}
      </section>

      {/* CAMPAIGNS PEEK */}
      {campaigns.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Recent Campaigns
            </h2>
            <Link href="/guests/campaigns" style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '.18em', textTransform: 'uppercase' }}>
              All →
            </Link>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {campaigns.slice(0, 5).map((c) => (
              <Link
                key={c.id}
                href={`/guests/campaigns/${c.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr auto auto',
                  gap: 24,
                  padding: '16px 0',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span className="eyebrow">{c.status}</span>
                <span style={{ fontSize: 14, color: 'var(--ink)' }}>{c.name}</span>
                <span className="tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {c.recipient_count != null ? `${c.recipient_count} recipients` : ''}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {c.sent_at ? new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Draft'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Guests</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm &middot; Delivery: Resend
          </span>
        </div>
      </footer>
    </div>
  );
}

function ContactRow({ contact, number }: { contact: GuestContact; number: string }) {
  const isSubscribed = contact.status === 'subscribed';
  const subtitleParts: string[] = [];
  if (contact.email !== displayName(contact).toLowerCase()) subtitleParts.push(contact.email);
  if (contact.source_detail) subtitleParts.push(contact.source_detail);

  return (
    <Link
      href={`/guests/${contact.id}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', opacity: isSubscribed ? 1 : 0.55 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 1fr auto auto',
          gap: 20,
          alignItems: 'baseline',
          padding: '14px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.08em' }}>
          {number}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName(contact)}
          </div>
          {subtitleParts.length > 0 && (
            <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitleParts.join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 280, justifyContent: 'flex-end' }}>
          {contact.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                letterSpacing: '.04em',
                padding: '2px 6px',
                border: '1px solid var(--rule)',
                color: 'var(--ink-3)',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTagLabel(t)}
            </span>
          ))}
          {contact.tags.length > 4 && (
            <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>+{contact.tags.length - 4}</span>
          )}
        </div>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color:
              contact.status === 'subscribed' ? 'var(--ink)' :
              contact.status === 'bounced' ? 'var(--signal)' :
              'var(--ink-4)',
            whiteSpace: 'nowrap',
          }}
        >
          {contact.status}
        </span>
      </div>
    </Link>
  );
}

function Stat({
  label, value, sub, accent = false, last = false,
}: {
  label: string; value: string; sub?: string; accent?: boolean; last?: boolean;
}) {
  return (
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{
        fontSize: 28,
        fontWeight: 400,
        color: accent ? 'var(--signal)' : 'var(--ink)',
        lineHeight: 1.05,
      }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EmptyBlock({ body, hint }: { body: string; hint?: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>{body}</p>
      {hint && <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  paddingRight: 28,
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};
