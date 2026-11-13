import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { PartnerSetup } from '@/lib/partner-listing-db';
import { channelWord, shortName, type SetupItem } from '@/lib/partner-listing';
import { maskFeedUrl } from '@/lib/partner-calendar';
import { exportUrlFor } from '@/lib/ical-export';
import { CopyableUrl } from '@/app/channels/listings/CopyableUrl';
import { AddFeed, CheckForm, FeedVerbs, ListingSwitch, ReadNow, SiteRankForm } from './PartnerHomeControls';

/**
 * A partner home's setup, at the top of its property page: whether it is on
 * staycapeann.com, every line of the listing bar with where it is fixed, the
 * host's calendars and the line they paste back, and the four checks a
 * person makes. An owner lists it once every line is green
 * (src/lib/partner-listing.ts).
 */

const meta: CSSProperties = { fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' };

function fixHref(propertyId: string, fix: SetupItem['fix']): { href: string; label: string } {
  switch (fix) {
    case 'facts':
      return { href: `/properties/${propertyId}/edit`, label: 'Edit facts' };
    case 'listing':
      return { href: `/properties/${propertyId}?tab=guest`, label: 'Listing' };
    case 'rates':
      return { href: `/properties/${propertyId}?tab=guest`, label: 'Rates' };
    case 'calendars':
      return { href: '#partner-calendars', label: 'Calendars' };
    case 'checks':
      return { href: '#partner-checks', label: 'Checks' };
    case 'payments':
      return { href: '/guests/requests#partner-homes', label: 'Payments' };
  }
}

function fmtDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

export function PartnerHomePanel({ setup, owner }: { setup: PartnerSetup; owner: boolean }) {
  const { propertyId, row, items, ready, state } = setup;
  const done = items.filter((i) => i.ok).length;
  const listed = state === 'listed';

  return (
    <section id="partner-setup" className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', marginTop: 28 }}>
      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 className="eyebrow">Partner home</h2>
            <div style={{ fontSize: 15, marginTop: 6, color: listed ? '#1d6b46' : 'var(--ink-2)' }}>
              {listed
                ? `On staycapeann.com since ${fmtDay(row?.listed_at ?? null)}`
                : state === 'taken_off'
                  ? `Taken off staycapeann.com ${fmtDay(row?.unlisted_at ?? null)}${row?.unlisted_reason ? `: ${row.unlisted_reason}` : ''}`
                  : 'Not on staycapeann.com yet'}
            </div>
            <div className="tabular-nums" style={{ ...meta, marginTop: 4 }}>
              {done} OF {items.length} READY
            </div>
          </div>
          {owner && <ListingSwitch propertyId={propertyId} home={setup.name} listed={listed} ready={ready} />}
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid var(--rule)' }}>
          {items.map((i) => {
            const fix = fixHref(propertyId, i.fix);
            return (
              <div key={i.key} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '8px 2px', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
                <span aria-hidden style={{ width: 14, color: i.ok ? '#1d6b46' : 'var(--ink-4)' }}>{i.ok ? '✓' : '○'}</span>
                <span style={{ flex: '0 0 230px', fontWeight: 500 }}>{i.label}</span>
                <span style={{ flex: 1, color: i.ok ? 'var(--ink-3)' : 'var(--ink-2)', minWidth: 0 }}>{i.detail}</span>
                {!i.ok && (
                  <Link href={fix.href} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {fix.label}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        <Calendars setup={setup} />
        <Checks setup={setup} />
        <Place setup={setup} owner={owner} />
      </div>
    </section>
  );
}

function Calendars({ setup }: { setup: PartnerSetup }) {
  const { propertyId, feeds, exportBase } = setup;
  return (
    <div id="partner-calendars" style={{ marginTop: 32 }}>
      <h3 className="eyebrow" style={{ marginBottom: 6 }}>Calendars</h3>
      <p style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 680, lineHeight: 1.5, marginBottom: 12 }}>
        Add each calendar the host sells on: the export link from Airbnb, Vrbo or their software. Helm reads them every 30
        minutes, and again before a request is accepted. Their guests stay theirs: Helm keeps only which nights are taken.
      </p>

      {feeds == null ? (
        <p style={{ fontSize: 13, color: 'var(--ink-4)' }}>The calendars could not be read just now.</p>
      ) : (
        feeds.length > 0 && (
          <div style={{ borderTop: '1px solid var(--rule)', marginBottom: 12 }}>
            {feeds.map((f) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', padding: '8px 2px', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
                <span style={{ flex: '0 0 120px', fontWeight: 500 }}>{channelWord(f.channel)}</span>
                <span style={{ flex: 1, color: 'var(--ink-3)', minWidth: 0 }}>
                  {maskFeedUrl(f.url)} · read {fmtWhen(f.last_synced_at)}
                  {f.hold_count != null && f.last_synced_at ? ` · ${f.hold_count} on it` : ''}
                  {f.last_error && <span style={{ color: 'var(--signal)' }}> · {f.last_error}</span>}
                </span>
                <FeedVerbs propertyId={propertyId} feedId={f.id} label={channelWord(f.channel)} />
              </div>
            ))}
          </div>
        )
      )}
      <AddFeed propertyId={propertyId} />
      {feeds && feeds.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <ReadNow propertyId={propertyId} />
        </div>
      )}

      {exportBase && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Our calendar, for the host to import</div>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 680, lineHeight: 1.5, marginBottom: 8 }}>
            The host pastes each line into that channel&apos;s calendar import, so a stay booked on staycapeann.com closes the
            nights there too. It carries only our stays, never theirs.
          </p>
          {(['airbnb', 'vrbo', 'booking_com'] as const).map((ch) => (
            <div key={ch} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: '0 0 120px', fontSize: 12.5, color: 'var(--ink-3)' }}>{channelWord(ch)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CopyableUrl value={exportUrlFor(exportBase, ch)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Checks({ setup }: { setup: PartnerSetup }) {
  const { propertyId, row } = setup;
  const lines: Array<{ check: 'walk' | 'insurance' | 'agreement' | 'photos'; label: string; verb: string; on: string | null; by: string | null; extra?: string }> = [
    { check: 'walk', label: 'We walked it and it passed', verb: 'Record the walk', on: row?.walked_on ?? null, by: row?.walked_by ?? null },
    {
      check: 'insurance',
      label: 'Proof of short-term rental insurance seen',
      verb: 'Record the proof',
      on: row?.insurance_checked_on ?? null,
      by: row?.insurance_checked_by ?? null,
      extra: row?.insurance_expires_on ? `good until ${fmtDay(row.insurance_expires_on)}` : undefined,
    },
    { check: 'agreement', label: 'The host signed the listing agreement', verb: 'Record the signing', on: row?.agreement_signed_on ?? null, by: row?.agreement_recorded_by ?? null },
    { check: 'photos', label: 'The photos meet our standard', verb: 'Record the check', on: row?.photos_ok_on ?? null, by: row?.photos_ok_by ?? null },
  ];
  return (
    <div id="partner-checks" style={{ marginTop: 32 }}>
      <h3 className="eyebrow" style={{ marginBottom: 10 }}>Checks</h3>
      <div style={{ borderTop: '1px solid var(--rule)' }}>
        {lines.map((l) => (
          <div key={l.check} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 2px', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
            <span style={{ flex: '0 0 300px' }}>{l.label}</span>
            <span style={{ flex: 1, color: 'var(--ink-3)', minWidth: 0 }}>
              {l.on ? `${fmtDay(l.on)}${l.by ? ` · ${shortName(l.by)}` : ''}${l.extra ? ` · ${l.extra}` : ''}` : 'Not yet'}
            </span>
            <CheckForm propertyId={propertyId} check={l.check} on={l.on} expires={l.check === 'insurance' ? (row?.insurance_expires_on ?? null) : undefined} verb={l.verb} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Where the home sits among the site's homes. The site orders every home by
 * one number, lower first; ours carry theirs in the site's registry.
 */
function Place({ setup, owner }: { setup: PartnerSetup; owner: boolean }) {
  const rank = setup.row?.site_rank ?? null;
  return (
    <div id="partner-place" style={{ marginTop: 32 }}>
      <h3 className="eyebrow" style={{ marginBottom: 10 }}>Place on staycapeann.com</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 2px', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
        <span style={{ flex: '0 0 300px', color: 'var(--ink-2)' }}>
          Lower comes first. Our homes run from 1 to 100, the water and the beaches first and the in-town homes last.
        </span>
        <span className="tabular-nums" style={{ flex: 1, color: 'var(--ink-3)', minWidth: 0 }}>
          {rank == null ? 'No place yet: it shows after every home that has one' : rank}
        </span>
        {owner && <SiteRankForm propertyId={setup.propertyId} rank={rank} />}
      </div>
    </div>
  );
}
