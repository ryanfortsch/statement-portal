import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { Section } from '@/components/Section';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  buildCheckoutSchedule,
  ScheduleUnavailableError,
  todayET,
  addDays,
  formatTime12,
  adjustmentSourceLabel,
  type CheckoutAdjustment,
  type ScheduleDay,
  type ScheduleRow,
} from '@/lib/checkout-schedule';
import { isCapeAnnOps, regionLabel, CAPE_ANN_REGION } from '@/lib/property-scope';
import {
  listScheduleRecipients,
  portalLink,
  getOpenDigest,
  previewRecipientBodies,
  regionsForDigests,
  describeRecipientScope,
  tomorrowET,
  type DigestRow,
  type RecipientBody,
  type ScheduleRecipient,
} from '@/lib/cleaner-digest';
import {
  loadVendorAppointments,
  reconcileDay,
  verdictLabel,
  VENDOR_LABEL,
  type VendorDayReport,
} from '@/lib/vendor-schedule';
import {
  saveAdjustmentAction,
  removeAdjustmentAction,
  applyProposalAction,
  dismissProposalAction,
  toggleRecipientAction,
  saveRecipientAction,
  saveDefaultTimesAction,
  ensureTomorrowDraft,
  approveAndSendDigest,
  sendDigestUpdate,
  skipDigestAction,
} from './actions';

/**
 * The checkout-schedule workroom: the operator's view of the same merged
 * truth Rosa's page renders. Seven days out, every stay adjustable inline
 * (late checkout time, extension date, note), mined proposals to apply or
 * dismiss, digest history, recipients, and per-property default times.
 *
 * The moment a change lands here it is live on the cleaner page and in
 * the next digest (or the current one: an unedited approve re-composes).
 */

export const dynamic = 'force-dynamic';

const DAYS = 7;

function fmtDayHead(date: string, today: string): string {
  const base = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
  if (date === today) return `Today · ${base}`;
  return base;
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: 'var(--font-mono), monospace',
  padding: '6px 9px',
  border: '1px solid var(--rule)',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--ink)',
};

const VERDICT_TONE = {
  ok:   { color: 'var(--ink-3)', border: '1px solid var(--rule)' },
  warn: { color: '#8a6d1a', border: '1px solid #d6a51e' },
  bad:  { color: 'var(--signal)', border: '1px solid var(--signal)' },
} as const;

function StayRow({ row, today, verdict }: { row: ScheduleRow; today: string; verdict?: ReturnType<typeof verdictLabel> }) {
  const adj = row.adjustment;
  return (
    <details
      id={`stay-${row.propertyId}-${row.checkIn}`}
      style={{ borderTop: '1px solid var(--rule)', scrollMarginTop: 100 }}
    >
      <summary
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          padding: '11px 0',
          cursor: 'pointer',
          listStyle: 'none',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 16, fontWeight: 600, minWidth: 56 }}>
          {row.time}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{row.propertyName}</span>
        {row.guestName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{row.guestName}</span>}
        {row.sameDayTurnover && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--signal)', border: '1px solid var(--signal)', borderRadius: 3, padding: '2px 7px' }}>
            same-day · in {row.nextCheckinTime && formatTime12(row.nextCheckinTime)}
          </span>
        )}
        {adj?.adjustedTime && (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            was {formatTime12(row.defaultTime)} · {adjustmentSourceLabel(adj.source)}
          </span>
        )}
        {adj?.adjustedDate && adj.adjustedDate !== row.baseCheckOut && (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>extended (Guesty still says {row.baseCheckOut})</span>
        )}
        {adj?.drifted && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8a6d1a' }}>Guesty moved since - re-check</span>
        )}
        {row.conflictingCheckOut && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8a6d1a' }}>
            feeds disagree - another says {row.conflictingCheckOut}
          </span>
        )}
        {verdict && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              ...VERDICT_TONE[verdict.tone],
            }}
          >
            {verdict.text}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-4)' }}>adjust ▾</span>
      </summary>
      <div style={{ padding: '4px 0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {adj?.evidence && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>&ldquo;{adj.evidence}&rdquo;</div>
        )}
        {adj?.note && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{adj.note}</div>}
        <form action={saveAdjustmentAction} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input type="hidden" name="propertyId" value={row.propertyId} />
          <input type="hidden" name="stayCheckIn" value={row.checkIn} />
          <input type="hidden" name="originalCheckOut" value={row.baseCheckOut} />
          <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Checkout time
            <input name="newTime" defaultValue={adj?.adjustedTime ?? ''} placeholder={`${row.defaultTime} default`} style={{ ...inputStyle, width: 110 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Checkout date
            <input name="newDate" type="date" defaultValue={adj?.adjustedDate ?? row.effectiveCheckOut} min={row.checkIn} style={{ ...inputStyle, width: 150 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
            Note
            <input name="note" defaultValue={adj?.note ?? ''} placeholder="late checkout agreed with guest" style={{ ...inputStyle, fontFamily: 'inherit', width: '100%' }} />
          </label>
          <SubmitButton
            label="Save"
            busyLabel="Saving..."
            style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
          />
        </form>
        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          Date unchanged = a time-only adjustment. Guesty says {row.baseCheckOut} at {formatTime12(row.defaultTime)}; the schedule shows {row.effectiveCheckOut} at {formatTime12(row.time)}.
        </div>
        {adj && (
          <form action={removeAdjustmentAction}>
            <input type="hidden" name="id" value={adj.id} />
            <SubmitButton
              label="Remove adjustment (back to Guesty)"
              busyLabel="Removing..."
              spinnerTone="ink"
              style={{ fontSize: 11, padding: '5px 10px', background: 'transparent', color: 'var(--signal)', border: '1px solid var(--signal)', borderRadius: 4, cursor: 'pointer' }}
            />
          </form>
        )}
        {row.checkIn <= today && (
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>Guest is in-house (checked in {row.checkIn}).</div>
        )}
      </div>
    </details>
  );
}

/**
 * Add / edit form for one cleaner_schedule_recipients row. No homes
 * selected means every home in the region; a selection means exactly those
 * homes, whatever region they sit in. Phone is the primary key, so an edit
 * carries the original as a hidden field.
 */
function RecipientForm({
  recipient,
  regions,
  properties,
}: {
  recipient: ScheduleRecipient | null;
  regions: string[];
  properties: Array<{ id: string; name: string; region: string | null }>;
}) {
  const byRegion = new Map<string, Array<{ id: string; name: string }>>();
  for (const p of properties) {
    const key = p.region || CAPE_ANN_REGION;
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key)!.push({ id: p.id, name: p.name });
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
  return (
    <form action={saveRecipientAction} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {recipient && <input type="hidden" name="originalPhone" value={recipient.phone} />}
      <label style={labelStyle}>
        Phone
        <input name="phone" defaultValue={recipient?.phone ?? ''} placeholder="(978) 555-0100" required style={{ ...inputStyle, width: 150 }} />
      </label>
      <label style={labelStyle}>
        Name
        <input name="displayName" defaultValue={recipient?.display_name ?? ''} placeholder="First name" required style={{ ...inputStyle, fontFamily: 'inherit', width: 140 }} />
      </label>
      <label style={labelStyle}>
        Region
        <select name="region" defaultValue={recipient?.region ?? CAPE_ANN_REGION} style={{ ...inputStyle, fontFamily: 'inherit', width: 170 }}>
          {regions.map((r) => (
            <option key={r} value={r}>{regionLabel(r)}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Homes (none = every home in region)
        <select name="propertyIds" multiple defaultValue={recipient?.property_ids ?? []} size={5} style={{ ...inputStyle, fontFamily: 'inherit', minWidth: 220 }}>
          {[...byRegion.entries()].map(([region, homes]) => (
            <optgroup key={region} label={regionLabel(region)}>
              {homes.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Language
        <select name="language" defaultValue={recipient?.language ?? 'pt'} style={{ ...inputStyle, fontFamily: 'inherit', width: 130 }}>
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
      </label>
      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
        <input type="checkbox" name="enabled" value="true" defaultChecked={recipient?.enabled ?? false} />
        enabled
      </label>
      <SubmitButton
        label={recipient ? 'Save' : 'Add recipient'}
        busyLabel="Saving..."
        style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
      />
    </form>
  );
}

export default async function CheckoutSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const err = first(sp.err);
  const today = todayET();

  const [daysRes, recipients, digestsRes, proposalsRes, propsRes, vendorData] = await Promise.all([
    buildCheckoutSchedule(supabase, { startDate: today, days: DAYS })
      .then((d) => ({ ok: true as const, days: d, error: null as string | null }))
      .catch((err: unknown) => {
        if (err instanceof ScheduleUnavailableError) return { ok: false as const, days: [] as ScheduleDay[], error: err.message };
        throw err;
      }),
    listScheduleRecipients(supabase).catch(() => []),
    // The day sections below are the Cape Ann schedule, so their digest
    // chips read Cape Ann's rows only; other regions get their own cards.
    supabase
      .from('cleaner_schedule_digests')
      .select('*')
      .eq('region', CAPE_ANN_REGION)
      .gte('service_date', today)
      .order('service_date')
      .limit(DAYS),
    supabase
      .from('checkout_adjustments')
      .select('*')
      .eq('status', 'proposed')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('properties')
      .select('id, name, default_checkout_time, default_checkin_time, is_active, kind, region')
      .order('name'),
    loadVendorAppointments(supabase, today, addDays(today, DAYS - 1)).catch(() => ({
      rows: [],
      horizon: null,
    })),
  ]);

  const days = daysRes.days;
  const scheduleError = daysRes.ok ? null : daysRes.error;
  const digestByDate = new Map<string, DigestRow>();
  for (const d of (digestsRes.data ?? []) as DigestRow[]) digestByDate.set(d.service_date, d);
  const proposals = (proposalsRes.data ?? []) as CheckoutAdjustment[];
  // Every active managed home, all regions: the recipient form's picker and
  // the region options. The Cape Ann filter below is for the default-times
  // list, which is the Cape Ann crew's, and it stays.
  const allProps = ((propsRes.data ?? []) as Array<{ id: string; name: string; default_checkout_time: string | null; default_checkin_time: string | null; is_active: boolean | null; kind: string | null; region: string | null }>)
    .filter((p) => p.is_active !== false && p.kind !== 'hq');
  const timeProps = allProps.filter((p) => isCapeAnnOps(p));
  const propNames = new Map(timeProps.map((p) => [p.id, p.name]));
  const allPropNames = new Map(allProps.map((p) => [p.id, p.name]));
  const regionOptions = [...new Set([
    CAPE_ANN_REGION,
    ...allProps.map((p) => p.region || CAPE_ANN_REGION),
    ...recipients.map((r) => r.region),
  ])].sort((a, b) => (a === CAPE_ANN_REGION ? -1 : b === CAPE_ANN_REGION ? 1 : a.localeCompare(b)));

  // One digest card per region: Cape Ann always, then every region with an
  // enabled recipient. Each card previews exactly what each recipient will
  // be texted, composed live from their scope in their language.
  const digestRegions = await regionsForDigests(supabase).catch(() => [CAPE_ANN_REGION]);
  const regionCards = await Promise.all(
    digestRegions.map(async (region) => {
      const digest = await getOpenDigest(supabase, region).catch(() => null);
      const serviceDate = digest?.service_date ?? tomorrowET();
      let preview: { bodies: RecipientBody[]; error: string | null } = { bodies: [], error: null };
      try {
        preview = { bodies: (await previewRecipientBodies(supabase, serviceDate, region)).bodies, error: null };
      } catch (e) {
        preview = { bodies: [], error: e instanceof Error ? e.message : String(e) };
      }
      return { region, digest, serviceDate, preview };
    }),
  );
  // The vendor's own schedule, judged only on days it has actually
  // announced (reminders run ~2 days out; past that, silence is not a
  // discrepancy).
  const vendorByDate = new Map<string, VendorDayReport>();
  for (const day of days) {
    vendorByDate.set(day.date, reconcileDay(day, vendorData.rows, vendorData.horizon, propNames));
  }
  const enabledRecipient = recipients.find((r) => r.enabled) ?? recipients[0];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs />

      <Section
        title="Cleaner checkout schedule"
        eyebrow="One source of truth"
        right={
          enabledRecipient ? (
            <a
              href={portalLink(enabledRecipient.portal_token)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              {enabledRecipient.display_name}&rsquo;s live page →
            </a>
          ) : undefined
        }
        paddingBottom={8}
      >
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 680 }}>
          Guesty bookings merged with everything Helm knows on top: late checkouts agreed in guest messaging, extensions
          that have not landed in Guesty yet, and your own adjustments. What you see here is exactly what Rosa&rsquo;s
          page and the daily digest text show.
          {err && (
            <div style={{ marginTop: 8, color: 'var(--signal)', fontWeight: 600 }}>
              {err === 'bad_time' && 'That time did not parse - use HH:MM or "11am".'}
              {err === 'bad_date' && 'That date did not parse.'}
              {err === 'nothing_set' && 'Set a time or a date (or both) before saving.'}
              {err === 'date_before_checkin' && 'Checkout cannot land before check-in.'}
              {err === 'bad_phone' && 'That phone did not parse - ten digits, US.'}
              {err === 'bad_name' && 'A recipient needs a display name.'}
              {err === 'bad_property' && 'One of those property ids is not in the registry.'}
              {err === 'bad_region' && 'That region is not in the registry.'}
              {err === 'phone_taken' && 'A recipient with that phone already exists.'}
              {err === 'recipient_gone' && 'That recipient no longer exists.'}
              {err === 'save_failed' && 'The recipient did not save.'}
              {err === 'schedule_unavailable' && 'The schedule could not be read, so nothing was drafted or sent.'}
              {err === 'no_recipients' && 'That region has no enabled recipient.'}
              {err === 'raced' && 'That digest was already being sent.'}
              {!['bad_time', 'bad_date', 'nothing_set', 'date_before_checkin', 'bad_phone', 'bad_name', 'bad_property', 'bad_region', 'phone_taken', 'recipient_gone', 'save_failed', 'schedule_unavailable', 'no_recipients', 'raced'].includes(err) && `Error: ${err}`}
            </div>
          )}
        </div>
      </Section>

      {proposals.length > 0 && (
        <Section id="schedule-proposals" title="Detected but not applied" eyebrow={`${proposals.length} waiting`} paddingTop={8} paddingBottom={8}>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {proposals.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--rule)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13 }}>
                  <strong>{propNames.get(p.property_id) ?? p.property_id}</strong> (stay {p.stay_check_in}
                  {' to '}
                  {p.original_check_out}):{' '}
                  {p.adjusted_checkout_time ? `checkout ${formatTime12(p.adjusted_checkout_time)}` : ''}
                  {p.adjusted_checkout_time && p.adjusted_check_out ? ', ' : ''}
                  {p.adjusted_check_out ? `until ${p.adjusted_check_out}` : ''}
                  {p.evidence && <span style={{ color: 'var(--ink-3)' }}> &ldquo;{p.evidence.slice(0, 110)}&rdquo;</span>}
                </span>
                <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <form action={applyProposalAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton label="Apply" busyLabel="Applying..." style={{ fontSize: 11, padding: '4px 12px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 4, cursor: 'pointer' }} />
                  </form>
                  <form action={dismissProposalAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton label="Dismiss" busyLabel="..." spinnerTone="ink" style={{ fontSize: 11, padding: '4px 12px', background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer' }} />
                  </form>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {scheduleError && (
        <Section id="schedule-unavailable" title="Schedule unavailable" eyebrow="Read failure" paddingTop={8} paddingBottom={8}>
          <div style={{ borderTop: '2px solid var(--signal)', padding: '14px 0', fontSize: 13, color: 'var(--ink)' }}>
            <strong>The live schedule could not be loaded.</strong> The days below are hidden rather than shown empty,
            because an empty day here would read as a day off. Nothing can be sent until this clears.
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: 'var(--ink-3)' }}>
              {scheduleError}
            </div>
          </div>
        </Section>
      )}

      {days.map((day) => {
        const digest = digestByDate.get(day.date);
        return (
          <Section
            key={day.date}
            id={`day-${day.date}`}
            title={fmtDayHead(day.date, today)}
            eyebrow={
              digest
                ? digest.status === 'sent'
                  ? `Digest sent${digest.sent_at ? '' : ''}`
                  : digest.status === 'pending'
                    ? 'Digest waiting for approval'
                    : `Digest ${digest.status}`
                : undefined
            }
            right={
              digest && digest.status === 'pending' ? (
                <Link href="/cleaner-messaging#schedule-digest" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Approve on the cleaner inbox →
                </Link>
              ) : undefined
            }
            paddingTop={8}
            paddingBottom={12}
            empty={day.rows.length === 0}
            emptyMessage="No checkouts."
          >
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {day.rows.map((row) => (
                <StayRow
                  key={`${row.propertyId}|${row.checkIn}`}
                  row={row}
                  today={today}
                  verdict={verdictLabel(vendorByDate.get(day.date)?.byRow.get(`${row.propertyId}|${row.checkIn}`))}
                />
              ))}
              {(vendorByDate.get(day.date)?.orphans ?? []).map((o) => (
                <div
                  key={`orphan-${o.propertyId}`}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 0', borderTop: '1px solid var(--rule)', flexWrap: 'wrap' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 16, fontWeight: 600, minWidth: 56, color: 'var(--signal)' }}>
                    {o.time}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{o.propertyName}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--signal)' }}>
                    {VENDOR_LABEL} is booked to clean, but nobody checks out. They will arrive at an occupied house.
                  </span>
                </div>
              ))}
            </div>
          </Section>
        );
      })}

      {regionCards.map(({ region, digest, serviceDate, preview }) => {
        const status = digest?.status ?? null;
        const pending = status === 'pending';
        const sent = status === 'sent';
        const enabledHere = recipients.filter((r) => r.enabled && r.region === region);
        return (
          <Section
            key={region}
            id={`digest-${region}`}
            title={`${regionLabel(region)} digest`}
            eyebrow={
              digest
                ? `${fmtDayHead(digest.service_date, today)} · ${pending ? 'waiting for approval' : status === 'sending' ? 'sending' : status}`
                : 'No draft yet'
            }
            right={
              region === CAPE_ANN_REGION && pending ? (
                <Link href="/cleaner-messaging#schedule-digest" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Edit and approve on the cleaner inbox →
                </Link>
              ) : undefined
            }
            paddingTop={8}
            paddingBottom={12}
          >
            <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {enabledHere.length === 0 ? (
                  <span>No enabled recipient in {regionLabel(region)}. Nothing can be sent here until one is added below.</span>
                ) : (
                  <span>
                    Each recipient below gets their own text, composed live for {fmtDayHead(serviceDate, today)} from the homes in
                    their scope, in their language, with their own live-page link.
                  </span>
                )}
                {digest && digest.operator_note && (
                  <div style={{ marginTop: 4, fontStyle: 'italic' }}>Note riding with it: &ldquo;{digest.operator_note}&rdquo;</div>
                )}
                {digest && sent && digest.sent_at && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
                    Sent {new Date(digest.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} by {digest.sent_by}
                  </div>
                )}
              </div>

              {preview.error && (
                <div style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
                  Preview unavailable: the schedule could not be read. <span style={{ fontFamily: 'var(--font-mono), monospace', fontWeight: 400 }}>{preview.error}</span>
                </div>
              )}

              {preview.bodies.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {preview.bodies.map((b) => (
                    <details key={b.recipient.phone} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '10px 12px' }}>
                      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{b.recipient.display_name}</span>
                        <span className="eyebrow" style={{ fontSize: 10 }}>{b.recipient.language === 'en' ? 'English' : 'Português'}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>
                          {b.day.counts.checkouts} checkout{b.day.counts.checkouts === 1 ? '' : 's'} · preview ▾
                        </span>
                      </summary>
                      <pre style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        {b.body}
                      </pre>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                        + note and live link at send time · {describeRecipientScope(b.recipient, regionLabel, (id) => allPropNames.get(id) ?? id)}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {!digest && (
                  <form action={ensureTomorrowDraft}>
                    <input type="hidden" name="region" value={region} />
                    <input type="hidden" name="back" value="page" />
                    <SubmitButton
                      label="Draft tomorrow's digest now"
                      busyLabel="Drafting..."
                      spinnerTone="ink"
                      style={{ fontSize: 12, padding: '6px 12px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 5, cursor: 'pointer' }}
                    />
                  </form>
                )}
                {digest && pending && enabledHere.length > 0 && !preview.error && (
                  <form action={approveAndSendDigest}>
                    <input type="hidden" name="digestId" value={digest.id} />
                    <input type="hidden" name="body" value={digest.body} />
                    <input type="hidden" name="draftedBody" value={digest.body} />
                    <input type="hidden" name="note" value={digest.operator_note ?? ''} />
                    <input type="hidden" name="back" value="page" />
                    <SubmitButton
                      label={`Send to ${enabledHere.map((r) => r.display_name).join(', ')}`}
                      busyLabel="Sending..."
                      style={{ fontSize: 12, fontWeight: 600, padding: '7px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
                    />
                  </form>
                )}
                {digest && pending && (
                  <form action={skipDigestAction}>
                    <input type="hidden" name="digestId" value={digest.id} />
                    <input type="hidden" name="back" value="page" />
                    <SubmitButton
                      label="Skip this day"
                      busyLabel="..."
                      spinnerTone="ink"
                      style={{ fontSize: 12, padding: '6px 12px', background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 5, cursor: 'pointer' }}
                    />
                  </form>
                )}
                {digest && sent && enabledHere.length > 0 && !preview.error && (
                  <form action={sendDigestUpdate}>
                    <input type="hidden" name="digestId" value={digest.id} />
                    <input type="hidden" name="back" value="page" />
                    <SubmitButton
                      label="Send an update (schedule changed)"
                      busyLabel="Sending..."
                      spinnerTone="ink"
                      style={{ fontSize: 12, padding: '6px 12px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 5, cursor: 'pointer' }}
                    />
                  </form>
                )}
              </div>
            </div>
          </Section>
        );
      })}

      <Section id="schedule-recipients" title="Who gets the daily text" eyebrow="Via Quo, after your approval" paddingTop={8} paddingBottom={12}>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {recipients.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>
              No recipients yet. Add one below.
            </div>
          )}
          {recipients.map((r) => (
            <div key={r.phone} id={`recipient-${r.phone.replace(/\D/g, '')}`} style={{ borderTop: '1px solid var(--rule)', scrollMarginTop: 100 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', flexWrap: 'wrap' }}>
                <form action={toggleRecipientAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="phone" value={r.phone} />
                  <input type="hidden" name="enabled" value={r.enabled ? 'false' : 'true'} />
                  <SubmitButton
                    label={`${r.display_name} ${r.enabled ? '✓' : '· off'}`}
                    busyLabel="..."
                    spinnerTone="ink"
                    style={{
                      fontSize: 12,
                      padding: '5px 12px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: r.enabled ? '1px solid var(--ink)' : '1px solid var(--rule)',
                      background: r.enabled ? 'var(--ink)' : 'transparent',
                      color: r.enabled ? 'var(--paper)' : 'var(--ink-4)',
                    }}
                  />
                </form>
                <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--ink-3)' }}>{r.phone}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {regionLabel(r.region)} · {describeRecipientScope(r, regionLabel, (id) => allPropNames.get(id) ?? id)}
                </span>
                <span className="eyebrow" style={{ fontSize: 10 }}>{r.language === 'en' ? 'English' : 'Português'}</span>
                <a
                  href={portalLink(r.portal_token)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  live page
                </a>
              </div>
              <details style={{ marginTop: -6 }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 11, color: 'var(--ink-4)', padding: '0 0 8px' }}>
                  edit scope, language, phone ▾
                </summary>
                <div style={{ padding: '4px 0 16px' }}>
                  <RecipientForm recipient={r} regions={regionOptions} properties={allProps} />
                </div>
              </details>
            </div>
          ))}
          <details style={{ borderTop: '1px solid var(--rule)' }}>
            <summary style={{ padding: '10px 0', cursor: 'pointer', listStyle: 'none', fontSize: 13, fontWeight: 600 }}>
              + Add a recipient
            </summary>
            <div style={{ padding: '4px 0 16px' }}>
              <RecipientForm recipient={null} regions={regionOptions} properties={allProps} />
            </div>
          </details>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
          Each enabled cleaner gets a digest scoped to their homes (no homes listed = every home in their region) in
          their language, plus their own live-page link. Drafts land every afternoon for the next day; nothing texts
          without your approval, here or on the cleaner inbox.
        </div>
      </Section>

      <Section title="Default times per property" eyebrow="Fallback when no adjustment exists" paddingTop={8}>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {timeProps.map((p) => (
            <form
              key={p.id}
              id={`times-${p.id}`}
              action={saveDefaultTimesAction}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--rule)', flexWrap: 'wrap', scrollMarginTop: 100 }}
            >
              <input type="hidden" name="propertyId" value={p.id} />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{p.name}</span>
              <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                out
                <input name="checkoutTime" defaultValue={p.default_checkout_time ?? ''} placeholder="10:00" style={{ ...inputStyle, width: 84 }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                in
                <input name="checkinTime" defaultValue={p.default_checkin_time ?? ''} placeholder="16:00" style={{ ...inputStyle, width: 84 }} />
              </label>
              <SubmitButton
                label="Save"
                busyLabel="..."
                spinnerTone="ink"
                style={{ fontSize: 11, padding: '5px 12px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer' }}
              />
            </form>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
          Blank means never set: the nightly Guesty sync fills blanks from each listing&rsquo;s default checkout /
          check-in time, and readers fall back to 10:00 / 16:00. A value you type here sticks (the sync only fills
          blanks).
        </div>
      </Section>

      <div style={{ flex: 1 }} />
      <HelmFooter left="Turnovers · Checkout schedule" right="Source: bookings + Helm adjustments" />
    </div>
  );
}
