import { SubmitButton } from '@/components/SubmitButton';
import Link from 'next/link';
import type { FleetProperty } from '@/lib/fleet';
import type { ChannelListingEx } from '@/lib/channels';
import { holdsAreReservations } from '@/lib/ical-cancel-policy';
import { feedStopConfirm } from '@/lib/irreversible-confirms';
import { FeedUrlForm } from './FeedUrlForm';
import type { ExportPull } from '@/lib/ical-export-pulls';
import { CHANNEL_LABELS, ICAL_HINTS, PRIMARY_CHANNELS, type BookingChannel } from '@/lib/channels-types';
import { importFreshness, pullFreshness, relativeAge, type Freshness } from '@/lib/calendar-model';
import { saveListing, syncOneListing, tickExportSubscribed, toggleListingActive } from './actions';

/**
 * One home's channel wiring: per channel, the OTA's iCal URL Helm imports,
 * its sync state, whether the OTA imports Helm's export and pulls it, who
 * owns the price, the listing ids, retire / reactivate, and the Guesty
 * aggregate row. It was the fleet page /channels/listings, one card per
 * home; since 2026-10-18 it is the Edit wiring fold on each home's hub,
 * which already shows the feed rows and the export links.
 *
 * Retiring a feed and saving its URL blank both cancel its imported
 * closures, so both ask first, naming the count (irreversible-confirms).
 */
const RATES_MANAGED_BY: Array<{ value: ChannelListingEx['rates_managed_by']; label: string }> = [
  { value: 'guesty', label: 'Guesty' },
  { value: 'pricelabs', label: 'PriceLabs (direct to the OTA)' },
  { value: 'ota_ui', label: 'Typed in the OTA' },
  { value: 'helm', label: 'Helm rate plan' },
];

export function WiringCard({ property, listings, pulls, now, closures }: { property: FleetProperty; listings: ChannelListingEx[]; pulls: ExportPull[]; now: Date; closures: Map<string, number> }) {
  const byChannel = new Map(listings.map((l) => [l.channel, l]));
  const helmRun = property.calendar_authority === 'helm';
  const guestyRow = byChannel.get('guesty');
  const extraRows = listings.filter((l) => !(PRIMARY_CHANNELS as string[]).includes(l.channel) && l.channel !== 'guesty');
  const connected = listings.filter((l) => l.is_active && l.ical_import_url && l.channel !== 'guesty' && l.channel !== 'direct').length;

  return (
    <div>
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

      <div className="eyebrow" style={{ color: 'var(--ink-3)', margin: '22px 0 10px' }}>
        {connected} / 3 OTA feeds importing
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {PRIMARY_CHANNELS.map((c) => (
          <ChannelRow key={c} property={property} channel={c} listing={byChannel.get(c)} pull={pulls.find((x) => x.channel_guess === c) ?? null} helmRun={helmRun} now={now} closures={closures} />
        ))}
        {extraRows.map((l) => (
          <ChannelRow key={l.id} property={property} channel={l.channel} listing={l} pull={null} helmRun={helmRun} now={now} closures={closures} />
        ))}
        {guestyRow && <GuestyRow listing={guestyRow} now={now} helmRun={helmRun} propertyId={property.id} liveClosures={closures.get(guestyRow.id) ?? 0} />}
      </div>
    </div>
  );
}

function dotColor(f: Freshness): string {
  return f === 'fresh' ? 'var(--positive)' : f === 'aging' ? 'var(--signal)' : f === 'stale' ? 'var(--negative)' : 'var(--rule)';
}

function ChannelRow({ property, channel, listing, pull, helmRun, now, closures }: { property: FleetProperty; channel: BookingChannel; listing: ChannelListingEx | undefined; pull: ExportPull | null; helmRun: boolean; now: Date; closures: Map<string, number> }) {
  const isDirect = channel === 'direct';
  const label = CHANNEL_LABELS[channel] ?? channel;
  // Retiring this feed or saving it blank cancels its imported closures
  // (Booking.com's are kept); both controls ask first, naming the count.
  const liveClosures = listing ? closures.get(listing.id) ?? 0 : 0;
  const keeps = holdsAreReservations(channel);

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
            <FeedUrlForm
              action={saveListing}
              hadUrl={!!listing?.ical_import_url}
              clearedConfirm={feedStopConfirm('clear_url', label, liveClosures, keeps)}
            >
              <input type="hidden" name="property_id" value={property.id} />
              <input type="hidden" name="channel" value={channel} />
              <input type="url" name="ical_import_url" placeholder={`Paste the ${label} iCal export URL, https://...`} defaultValue={listing?.ical_import_url ?? ''} style={inputStyle} />
              <SyncStatus listing={listing} now={now} />
              <SubmitButton label="Save" busyLabel="Saving…" style={smallPrimary} />
            </FeedUrlForm>
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
            <SubmitButton
              label={listing.is_active ? 'retire' : 'reactivate'}
              busyLabel="…"
              spinnerTone="ink"
              style={linkButton}
              confirm={listing.is_active ? feedStopConfirm('retire', label, liveClosures, keeps) : undefined}
            />
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

function GuestyRow({ listing, now, helmRun, propertyId, liveClosures }: { listing: ChannelListingEx; now: Date; helmRun: boolean; propertyId: string; liveClosures: number }) {
  const active = listing.is_active;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 14, alignItems: 'center', padding: '10px 12px', background: 'var(--paper)', border: `1px ${active ? 'solid' : 'dashed'} var(--rule)`, opacity: active ? 1 : 0.65 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        Guesty
        <span style={{ display: 'block', fontSize: 9, color: 'var(--ink-4)', letterSpacing: '.1em' }}>{active ? 'aggregate feed' : 'retired'}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {active
          ? `One feed carrying every channel; Helm parses each event into its real channel. Direct-feed closures are dropped as Guesty's echoes while Guesty runs this home and no OTA imports Helm's export. ${listing.last_imported_at ? `Imported ${relativeAge(listing.last_imported_at, now)}, ${listing.last_import_event_count ?? 0} events.` : 'Never imported.'}`
          : helmRun
            ? `Retired${listing.updated_at ? ` ${relativeAge(listing.updated_at, now)}` : ''}. Not read any more: Helm runs this home, and direct-feed blocks import as OTA holds; only Booking.com's are passed on to the other channels.`
            : `Retired${listing.updated_at ? ` ${relativeAge(listing.updated_at, now)}` : ''}. Not read any more, and Guesty still runs this home: its blocks here are frozen until the flip cancels them. Reactivate it.`}
        {listing.last_import_status === 'error' && <span style={{ color: 'var(--negative)' }}> Last import errored: {listing.last_import_error ?? 'unknown'}.</span>}
      </span>
      <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline' }}>
        {active && listing.ical_import_url && (
          <form action={syncOneListing}>
            <input type="hidden" name="id" value={listing.id} />
            <SubmitButton label="sync" busyLabel="syncing…" spinnerTone="ink" style={linkButton} />
          </form>
        )}
        {active && !helmRun ? (
          // Guesty runs this home: the flip retires this row. Retired by
          // hand, its blocks froze live with nothing left to lift them.
          <Link href={`/channels/${propertyId}?prepare=1#cutover`} style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            retires at the flip
          </Link>
        ) : active ? (
          <form action={toggleListingActive}>
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="is_active" value="false" />
            <SubmitButton
              label="Retire"
              busyLabel="Retiring…"
              style={{ ...smallPrimary, background: 'var(--negative)' }}
              confirm={feedStopConfirm('retire', 'Guesty', liveClosures, false)}
            />
          </form>
        ) : (
          // No delete: a retired Guesty row is kept for good. Its id is what
          // marks its rows as Guesty's (their disappearance is not a cancel,
          // and after the flip they are Guesty-era for the dedupe); deleted,
          // every one of those rows became an ordinary feed row.
          <form action={toggleListingActive}>
            <input type="hidden" name="id" value={listing.id} />
            <input type="hidden" name="is_active" value="true" />
            <SubmitButton label="reactivate" busyLabel="…" spinnerTone="ink" style={linkButton} />
          </form>
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
