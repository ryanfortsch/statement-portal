import Link from 'next/link';
import { headers } from 'next/headers';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { SubmitButton } from '@/components/SubmitButton';
import { CopyableUrl } from './CopyableUrl';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { regionLabel } from '@/lib/property-scope';
import { listChannelListingsByProperty, type ChannelListingEx } from '@/lib/channels';
import { lastPullsByProperty, type ExportPull } from '@/lib/ical-export-pulls';
import { CHANNEL_LABELS, ICAL_HINTS, PRIMARY_CHANNELS, type BookingChannel } from '@/lib/channels-types';
import { authorityBadge, importFreshness, pullFreshness, relativeAge, type Freshness } from '@/lib/calendar-model';
import { deleteListing, saveListing, syncOneListing, tickExportSubscribed, toggleListingActive } from './actions';

export const dynamic = 'force-dynamic';

const RATES_MANAGED_BY: Array<{ value: ChannelListingEx['rates_managed_by']; label: string }> = [
  { value: 'guesty', label: 'Guesty' },
  { value: 'pricelabs', label: 'PriceLabs (direct to the OTA)' },
  { value: 'ota_ui', label: 'Typed in the OTA' },
  { value: 'helm', label: 'Helm rate plan' },
];

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export default async function ChannelsListingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const regionFilter = one(sp.region).trim();
  const now = new Date();

  let byProperty: Record<string, ChannelListingEx[]> = {};
  let fleet: FleetProperty[] = [];
  let pulls = new Map<string, ExportPull[]>();
  let dbError: string | null = null;
  try {
    [byProperty, fleet] = await Promise.all([listChannelListingsByProperty(), listFleetProperties()]);
    pulls = await lastPullsByProperty(fleet.map((p) => p.id));
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'helm.risingtidestr.com';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const origin = `${proto}://${host}`;

  const regions = [...new Set(fleet.map((p) => p.region))].sort();
  const shown = regionFilter ? fleet.filter((p) => p.region === regionFilter) : fleet;
  const wired = shown.filter((p) => (byProperty[p.id] ?? []).some((l) => l.is_active && l.ical_import_url && l.channel !== 'guesty')).length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Channels · Wiring"
        title="Both directions"
        emphasis="of every iCal link."
        description="Per home and per channel: the OTA's export URL Helm imports, the listing ids and links, who owns the price, and whether the OTA has been given Helm's export and actually pulls it. The Guesty aggregate row retires here when a home leaves Guesty."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/channels" style={ghostButtonStyle}>← Channels</Link>
          <Link href="/channels/calendar" style={ghostButtonStyle}>Multi-calendar →</Link>
          {regions.length > 1 && (
            <>
              <span style={{ width: 12 }} />
              <Chip href="/channels/listings" active={!regionFilter} label="All regions" />
              {regions.map((r) => (
                <Chip key={r} href={`/channels/listings?region=${encodeURIComponent(r)}`} active={regionFilter === r} label={regionLabel(r)} />
              ))}
            </>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{wired} of {shown.length} homes import at least one OTA feed</span>
        </div>
      </section>

      {dbError && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
          <div style={{ borderLeft: '3px solid var(--negative)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--negative)' }}>{dbError}</div>
        </section>
      )}

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Where each OTA keeps its export URL</div>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, fontSize: 12, color: 'var(--ink-3)' }}>
          {PRIMARY_CHANNELS.filter((c) => c !== 'direct').map((c) => (
            <div key={c}>
              <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{CHANNEL_LABELS[c]}</div>
              <div style={{ lineHeight: 1.45 }}>{ICAL_HINTS[c]}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.55, maxWidth: 760 }}>
          While Guesty holds a listing, Airbnb&apos;s &quot;Sync everything&quot; and Vrbo&apos;s single-software rule block a second calendar source: Helm can import the OTA feed (shadow mode) but the OTA cannot import Helm&apos;s export until Guesty is disconnected. Tick &quot;imports Helm&quot; only once you have pasted the export URL into the OTA; the pull log proves it.
        </p>

        <div style={{ marginTop: 36 }}>
          {shown.map((p) => (
            <PropertyCard key={p.id} property={p} listings={byProperty[p.id] ?? []} pulls={pulls.get(p.id) ?? []} origin={origin} now={now} />
          ))}
          {shown.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>No homes in this region.</p>}
        </div>
      </section>

      <HelmFooter module="Channels · Wiring" right={`${shown.length} homes`} />
    </div>
  );
}

function PropertyCard({ property, listings, pulls, origin, now }: { property: FleetProperty; listings: ChannelListingEx[]; pulls: ExportPull[]; origin: string; now: Date }) {
  const byChannel = new Map(listings.map((l) => [l.channel, l]));
  const exportUrl = property.ical_export_token ? `${origin}/api/channels/ical/${property.ical_export_token}` : null;
  const helmRun = property.calendar_authority === 'helm';
  const badge = authorityBadge(property, listings.some((l) => l.is_active && !!l.ical_import_url && l.channel !== 'guesty'));
  const guestyRow = byChannel.get('guesty');
  const extraRows = listings.filter((l) => !(PRIMARY_CHANNELS as string[]).includes(l.channel) && l.channel !== 'guesty');
  const connected = listings.filter((l) => l.is_active && l.ical_import_url && l.channel !== 'guesty' && l.channel !== 'direct').length;

  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Link href={`/channels/${property.id}`} className="font-serif" style={{ fontSize: 26, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', textDecoration: 'none' }}>
            {property.name}
          </Link>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
            {property.address} · {regionLabel(property.region)}
            <span style={{ marginLeft: 10, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color: badge.kind === 'helm' ? 'var(--positive)' : badge.kind === 'shadow' ? 'var(--signal)' : 'var(--ink-4)' }} title={badge.detail}>
              {badge.label}
            </span>
          </p>
        </div>
        <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>
          {connected} / 3 OTA feeds importing
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {PRIMARY_CHANNELS.map((c) => (
          <ChannelRow key={c} property={property} channel={c} listing={byChannel.get(c)} pull={pulls.find((x) => x.channel_guess === c) ?? null} helmRun={helmRun} now={now} />
        ))}
        {extraRows.map((l) => (
          <ChannelRow key={l.id} property={property} channel={l.channel} listing={l} pull={null} helmRun={helmRun} now={now} />
        ))}
        {guestyRow && <GuestyRow listing={guestyRow} now={now} />}
      </div>

      {exportUrl && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--paper-2)', border: '1px dashed var(--rule)' }}>
          <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Helm → channels · the export each OTA imports</div>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 8 }}>
            Canonical confirmed, completed and block rows only, no guest names.{' '}
            {pulls.length > 0 ? `Last pulled ${relativeAge(pulls[0].pulled_at, now)}${pulls[0].channel_guess ? ` by ${CHANNEL_LABELS[pulls[0].channel_guess as BookingChannel] ?? pulls[0].channel_guess}` : ''}.` : 'Never pulled yet.'}
          </p>
          <CopyableUrl value={exportUrl} />
        </div>
      )}
    </div>
  );
}

function dotColor(f: Freshness): string {
  return f === 'fresh' ? 'var(--positive)' : f === 'aging' ? 'var(--signal)' : f === 'stale' ? 'var(--negative)' : 'var(--rule)';
}

function ChannelRow({ property, channel, listing, pull, helmRun, now }: { property: FleetProperty; channel: BookingChannel; listing: ChannelListingEx | undefined; pull: ExportPull | null; helmRun: boolean; now: Date }) {
  const isDirect = channel === 'direct';
  const label = CHANNEL_LABELS[channel] ?? channel;

  return (
    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', opacity: listing && !listing.is_active ? 0.6 : 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 250px auto', gap: 14, alignItems: 'center', padding: '10px 12px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          {label}
          {listing && !listing.is_active && <span style={{ display: 'block', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '.1em' }}>retired</span>}
        </span>

        {isDirect ? (
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic', gridColumn: '2 / span 3' }}>
            Direct stays land in Helm from staycapeann.com, the quote composer and the booking form; no inbound feed.
          </span>
        ) : (
          <>
            <form action={saveListing} style={{ display: 'contents' }}>
              <input type="hidden" name="property_id" value={property.id} />
              <input type="hidden" name="channel" value={channel} />
              <input type="url" name="ical_import_url" placeholder={`Paste the ${label} iCal export URL, https://...`} defaultValue={listing?.ical_import_url ?? ''} style={inputStyle} />
              <SyncStatus listing={listing} now={now} />
              <SubmitButton label="Save" busyLabel="Saving…" style={smallPrimary} />
            </form>
          </>
        )}
      </div>

      {!isDirect && listing && (
        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', padding: '0 12px 10px', fontSize: 11, color: 'var(--ink-3)' }}>
          <form action={tickExportSubscribed} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="export_subscribed" value={listing.export_subscribed ? 'false' : 'true'} />
            <SubmitButton label={listing.export_subscribed ? '☑ OTA imports Helm export' : '☐ OTA imports Helm export'} busyLabel="Saving…" spinnerTone="ink" style={{ ...linkButton, color: listing.export_subscribed ? 'var(--positive)' : 'var(--ink-3)' }} />
            {listing.export_subscribed && listing.export_subscribed_at && <span style={{ color: 'var(--ink-4)' }}>since {listing.export_subscribed_at.slice(0, 10)}</span>}
          </form>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
            <span title="last OTA pull of Helm's export" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: pull ? dotColor(pullFreshness(pull.pulled_at, now)) : 'var(--rule)', border: pull ? 'none' : '1px solid var(--ink-4)', transform: 'translateY(1px)' }} />
            {pull ? `pulled Helm ${relativeAge(pull.pulled_at, now)}` : helmRun || listing.export_subscribed ? 'never pulled Helm' : 'reads Guesty, not Helm'}
          </span>
          <span>rates: <strong style={{ color: 'var(--ink-2)' }}>{RATES_MANAGED_BY.find((r) => r.value === listing.rates_managed_by)?.label ?? listing.rates_managed_by}</strong></span>
          {listing.external_listing_url && (
            <a href={listing.external_listing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}>open in {label} ↗</a>
          )}
          {listing.external_listing_id && <span className="font-mono">{listing.external_listing_id}</span>}
          <span style={{ flex: 1 }} />
          <form action={toggleListingActive}>
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="is_active" value={listing.is_active ? 'false' : 'true'} />
            <SubmitButton label={listing.is_active ? 'retire' : 'reactivate'} busyLabel="…" spinnerTone="ink" style={linkButton} />
          </form>
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--ink-3)', textDecoration: 'underline' }}>ids and ownership</summary>
            <form action={saveListing} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10, padding: '12px', background: 'var(--paper)', border: '1px solid var(--rule)', minWidth: 640 }}>
              <input type="hidden" name="property_id" value={property.id} />
              <input type="hidden" name="channel" value={channel} />
              <Field label="Display name">
                <input name="display_name" type="text" defaultValue={listing.display_name ?? ''} placeholder={property.title ?? property.name} style={inputStyle} />
              </Field>
              <Field label={`${label} listing id`}>
                <input name="external_listing_id" type="text" defaultValue={listing.external_listing_id ?? ''} style={inputStyle} />
              </Field>
              <Field label="Room / rate-plan id">
                <input name="external_room_id" type="text" defaultValue={listing.external_room_id ?? ''} placeholder="Booking.com room id" style={inputStyle} />
              </Field>
              <Field label="Listing URL">
                <input name="external_listing_url" type="url" defaultValue={listing.external_listing_url ?? ''} placeholder="https://" style={inputStyle} />
              </Field>
              <Field label="Rates managed by">
                <select name="rates_managed_by" defaultValue={listing.rates_managed_by} style={inputStyle}>
                  {RATES_MANAGED_BY.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Notes">
                <input name="notes" type="text" defaultValue={listing.notes ?? ''} style={inputStyle} />
              </Field>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
                <SubmitButton label="Save details" busyLabel="Saving…" style={smallPrimary} />
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Who owns the price is what the calendars print beside a mirrored rate.</span>
              </div>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}

function GuestyRow({ listing, now }: { listing: ChannelListingEx; now: Date }) {
  const active = listing.is_active;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 14, alignItems: 'center', padding: '10px 12px', background: 'var(--paper)', border: `1px ${active ? 'solid' : 'dashed'} var(--rule)`, opacity: active ? 1 : 0.65 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        Guesty
        <span style={{ display: 'block', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '.1em' }}>{active ? 'aggregate feed' : 'retired'}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {active
          ? `One feed carrying every channel; Helm parses each event into its real channel and drops direct-feed blocks as echoes while this row is active. ${listing.last_imported_at ? `Imported ${relativeAge(listing.last_imported_at, now)}, ${listing.last_import_event_count ?? 0} events.` : 'Never imported.'}`
          : `Retired${listing.updated_at ? ` ${relativeAge(listing.updated_at, now)}` : ''}. Direct-feed blocks now import as real holds and the dedupe decides which are echoes.`}
        {listing.last_import_status === 'error' && <span style={{ color: 'var(--negative)' }}> Last import errored: {listing.last_import_error ?? 'unknown'}.</span>}
      </span>
      <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline' }}>
        {active && listing.ical_import_url && (
          <form action={syncOneListing}>
            <input type="hidden" name="id" value={listing.id} />
            <SubmitButton label="sync" busyLabel="syncing…" spinnerTone="ink" style={linkButton} />
          </form>
        )}
        {active ? (
          <form action={toggleListingActive}>
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="is_active" value="false" />
            <SubmitButton label="Retire" busyLabel="Retiring…" style={{ ...smallPrimary, background: 'var(--negative)' }} />
          </form>
        ) : (
          <>
            <form action={toggleListingActive}>
              <input type="hidden" name="id" value={listing.id} />
              <input type="hidden" name="is_active" value="true" />
              <SubmitButton label="reactivate" busyLabel="…" spinnerTone="ink" style={linkButton} />
            </form>
            <form action={deleteListing}>
              <input type="hidden" name="id" value={listing.id} />
              <SubmitButton label="delete row" busyLabel="…" spinnerTone="ink" style={{ ...linkButton, color: 'var(--negative)' }} />
            </form>
          </>
        )}
      </span>
    </div>
  );
}

function SyncStatus({ listing, now }: { listing: ChannelListingEx | undefined; now: Date }) {
  if (!listing) return <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>not configured</span>;
  if (!listing.ical_import_url) return <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>no feed url</span>;
  const state: Freshness = listing.last_import_status === 'error' ? 'stale' : importFreshness(listing.last_imported_at, now);
  const isError = listing.last_import_status === 'error';
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
      <span title={`Helm import: ${state}`} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor(state), border: state === 'never' ? '1px solid var(--ink-4)' : 'none', transform: 'translateY(1px)' }} />
      <span title={listing.last_import_error ?? undefined} style={{ fontSize: 11, color: isError ? 'var(--negative)' : 'var(--ink-3)' }}>
        {!listing.last_imported_at ? 'awaiting first sync' : `${isError ? 'error' : 'ok'} · ${relativeAge(listing.last_imported_at, now)} · ${listing.last_import_event_count ?? 0} events`}
      </span>
      <SubmitButton label={listing.last_imported_at ? 'resync' : 'sync now'} busyLabel="syncing…" spinnerTone="ink" style={linkButton} formAction={syncOneListing} name="id" value={listing.id} />
    </span>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} style={{ padding: '4px 10px', border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`, background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--paper)' : 'var(--ink-2)', textDecoration: 'none', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 500 }}>
      {label}
    </Link>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  padding: '8px 10px',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  width: '100%',
};

const smallPrimary: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '7px 14px',
  border: 'none',
  cursor: 'pointer',
};

const linkButton: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  textDecoration: 'underline',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '6px 0',
  border: 'none',
  textDecoration: 'none',
};
