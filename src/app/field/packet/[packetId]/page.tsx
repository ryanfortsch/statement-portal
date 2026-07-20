import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { fieldDb } from '@/lib/field-db';
import { loadPacketDetail, loadPacketSupplyRun, loadCleaningStatusForStops, loadLockEquippedPropertyIds, staleStopIds, SUPPLY_CLOSET, SUPPLY_CLOSET_COORDS, SUPPLY_CLOSET_CODE, type SupplyRun, type CleaningStatus } from '@/lib/field-packets';
import { canClaim, cityShort, fmtVisitTime, onboardingComplete, dollars, packetHeadline, effectiveBaseCents, isPayoutFinal, totalPayoutCents, type AccessBundle, type ContractorRow, type PacketStopDetail } from '@/lib/field-types';
import { isWorkingStatus } from '@/lib/field-packet-status';
import { claimPacket, submitPacket, undoStartStop, reopenStop } from '../../actions';
import { PendingButton } from './PendingButton';
import { MaintenanceComplete } from './MaintenanceComplete';
import { StopWorkList } from './StopWorkList';
import { StartStop } from './StartStop';
import { OnSite } from './OnSite';
import { FieldShell } from '../../FieldShell';
import { PacketRouteMap } from '../../PacketRouteMap';
import { CopyCode } from '../../CopyCode';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { AutoRefresh } from '@/components/AutoRefresh';

// Office phone for the door-side "stuck? call us" fallbacks.
// The stop's uniform access affordance: link, fact, or tap-open detail all
// share this one chip so the access row reads as a single system.
const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--tide-deep)',
  textDecoration: 'none',
  border: '1px solid var(--rule)',
  borderRadius: 999,
  padding: '8px 14px',
  minHeight: 38,
  background: 'var(--paper-2, #fff)',
  cursor: 'pointer',
};

// Derived pills: same geometry as chip, different voice. signalPill = urgent
// contact affordances; quietBtn = secondary controls (Reopen / Reset / Details).
const signalPill: React.CSSProperties = { ...chip, color: 'var(--signal)' };
const quietBtn: React.CSSProperties = { ...chip, fontSize: 12, color: 'var(--ink-3)' };

const OFFICE_TEL = '+19788652387';

/** A geocodable maps target for a stop, or null when we have neither coords nor
 *  a real street address (so we hide the link instead of sending them to a
 *  search for an internal name like "21 Horton"). */
function mapsUrl(s: PacketStopDetail): string | null {
  if (s.property.latitude != null && s.property.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${s.property.latitude},${s.property.longitude}`;
  }
  const addr = (s.property.address || '').trim();
  if (!addr) return null;
  const q = `${addr}${s.property.city ? `, ${s.property.city}` : ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Packet · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}

function fmtShortDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

/** Per-stop timing truth, driven by the bookings — not a fixed window. The day
 *  opens at the 11 AM checkout; the ONLY hard deadline is a guest checking in
 *  THAT day (4 PM); and a same-day checkout means the cleaner owns midday, so
 *  the inspector goes after. Vacant homes are open from 11. */
function stopTiming(s: PacketStopDetail, visitDate: string): { label: string; first: string; urgent: boolean } {
  // Two facts, no coaching: did a guest check out today, and when's the next
  // check-in. Per Dotti, the per-stop line stays this simple (the old DayPlan
  // banner that coached sequencing was removed at her request). `first` rides
  // separately so the urgent same-day deadline can take its own line.
  const first = s.window_basis === 'checkout_day' ? 'Checkout today' : 'Vacant';
  if (!s.next_checkin) return { label: `${first} · no next check-in scheduled`, first, urgent: false };
  const today = s.next_checkin === visitDate;
  const when = today ? 'today, 4 PM' : `${fmtShortDate(s.next_checkin)}, 4 PM`;
  return { label: `${first} · next check-in: ${when}`, first, urgent: today };
}

/** An ISO instant as a wall clock pinned to Eastern (e.g. "10:08 AM"), so the
 *  server's UTC clock never shifts what the inspector reads. */
function fmtClockET(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  } catch {
    return '';
  }
}

/** An ISO instant as a short ET date (e.g. "Sun, Jul 12"). */
function fmtDateET(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch {
    return '';
  }
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000);
}

// A checkout within this many days of the visit is a live turnover worth
// verifying the cleaning on. Older than that, the home has sat idle and we
// don't nag about a missing signal.
const CLEAN_LOOKBACK_DAYS = 4;

/** Cleaner status for a turnover stop, distinct from the inspector's own
 *  progress. "Keyed in" is a confirmed door event; the finish time is usually a
 *  system estimate, so it's labeled as such. Null status = nobody's keyed in. */
function CleanerStatus({ status, sameDay, checkoutDate }: { status: CleaningStatus | undefined; sameDay: boolean; checkoutDate: string | null }) {
  // No record. Same-day: the cleaner may still be coming. Prior checkout: a
  // turnover we have NO evidence happened — the important warning (this is the
  // "36 Granite looked already-cleaned but wasn't" case).
  if (!status) {
    return (
      <div style={{ fontSize: 13, marginTop: 4 }}>
        <span aria-hidden>🧹</span>{' '}
        <span style={{ color: sameDay ? 'var(--ink-4)' : 'var(--signal)', fontWeight: sameDay ? 400 : 600 }}>
          {sameDay
            ? 'No cleaning signal yet today'
            : `No cleaning signal since the ${checkoutDate ? fmtShortDate(checkoutDate) : 'last'} checkout`}
        </span>
      </div>
    );
  }
  // A prior-checkout turnover that WAS serviced: just say when.
  if (!sameDay) {
    return (
      <div style={{ fontSize: 13, marginTop: 4 }}>
        <span aria-hidden>🧹</span>{' '}
        <span style={{ color: 'var(--positive)' }}>Cleaned {fmtDateET(status.enteredAt)}</span>
      </div>
    );
  }
  // Today's turnover: live entry, with the estimated-finish caveat.
  return (
    <div style={{ fontSize: 13, marginTop: 4 }}>
      <span aria-hidden>🧹</span>{' '}
      <span style={{ color: 'var(--ink)' }}>Cleaner keyed in {fmtClockET(status.enteredAt)}</span>
      {status.finishedAt ? (
        <span style={{ color: 'var(--ink-4)' }}>
          {status.finishEstimated
            ? ` · finished ~${fmtClockET(status.finishedAt)} (estimated)`
            : ` · finished ${fmtClockET(status.finishedAt)}`}
        </span>
      ) : (
        <span style={{ color: 'var(--tide-deep)' }}> · on site now</span>
      )}
    </div>
  );
}

const INSPECTION_PILLARS: Array<{ n: number; title: string; desc: string }> = [
  {
    n: 1,
    title: 'Perfection',
    desc: "The home should look flawless: staged, spotless, guest-ready. You're the last set of eyes before anyone checks in.",
  },
  {
    n: 2,
    title: 'Maintenance',
    desc: 'Get ahead of problems. Flag anything worn, leaking, or drifting toward a repair so we fix it before a guest ever notices.',
  },
  {
    n: 3,
    title: 'Supplies & inventory',
    desc: "Check the essentials are stocked, and note whatever's running low so we can restock fast.",
  },
];

/** What an inspection visit actually is, in three plain passes — replaces the
 *  vague "guest-readiness walk / Helm Core 12" jargon. */
function InspectionScope() {
  return (
    <div style={{ marginBottom: 28, maxWidth: 560 }}>
      {INSPECTION_PILLARS.map((p) => (
        <div key={p.n} style={{ display: 'flex', gap: 16, alignItems: 'baseline', padding: '14px 0', borderTop: '1px solid var(--rule)' }}>
          <span className="font-serif" style={{ fontSize: 26, lineHeight: 1, color: 'var(--signal)', minWidth: 26 }}>{p.n}</span>
          <div>
            <div className="font-serif" style={{ fontSize: 18 }}>{p.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.55 }}>{p.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


/** Property setup time expectation. Rendered in place of the inspection
 *  pillars and the check-in day plan (a setup day has neither); the packet's
 *  own instructions carry the specifics. */
function SetupScope() {
  return (
    <div style={{ borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '12px 14px', marginBottom: 22, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
      <strong style={{ color: 'var(--ink)' }}>Property setup: plan 2 to 4 hours on site.</strong>
    </div>
  );
}

/** A standalone one-off job: not a full inspection, just the task on the job
 *  card below. Frames it so the inspector doesn't run the guest-readiness deck. */
function AdhocScope() {
  return (
    <div style={{ borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '12px 14px', marginBottom: 22, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
      <strong style={{ color: 'var(--ink)' }}>One-off job.</strong> Not a full inspection — just the task below.
      Do it, mark it done with a photo if it helps, and you&apos;re set. Anything unclear, call the office.
    </div>
  );
}

/** An extra work slip the office attached to a stop: title, details, the
 *  per-attachment office note, and (for the assigned inspector, until done) a
 *  completion form keyed to the attachment, not the stop. */

/** The supply-closet entry code, tap-to-copy. Renders only when the code is
 *  configured (env var). Lives inside the supply cards, which only show to the
 *  assigned inspector who's on the job. */
function SupplyClosetCode() {
  if (!SUPPLY_CLOSET_CODE) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14, marginBottom: 14 }}>
      <span style={{ color: 'var(--ink-4)' }}>Door code</span>
      <CopyCode value={SUPPLY_CLOSET_CODE} />
    </div>
  );
}

/** Stop 1 of every route: the supply closet at 85 Eastern Ave. The inspector
 *  grabs ONE bag, packed for the whole trip — the routine refills for every home
 *  on the route plus the parts each work slip needs. Helm names the trip the bag
 *  is packed for and lists the job-specific parts so nothing's left behind. */
function SupplyRunCard({ run, pickedUp }: { run: SupplyRun; pickedUp: boolean }) {
  // Restock stays grouped BY HOME (Delaney's ask) — see SupplyRunContents.
  // No early return: the kit pickup is stop 1 of EVERY route, even when
  // nothing specific is flagged — the bag itself always gets grabbed.
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${SUPPLY_CLOSET_COORDS.lat},${SUPPLY_CLOSET_COORDS.lng}`;
  // Once the route has started, the packing list is history: fold the whole
  // card to one line + a tap-open "What was in the bag", so mid-route the live
  // stops own the screen.
  if (pickedUp) {
    return (
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 18px', marginBottom: 24, background: 'rgba(0,0,0,0.015)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>
            Stop 1 · 85 Eastern
          </span>
          <span style={{ fontSize: 13, color: 'var(--positive)', fontWeight: 600 }}>✓ Kit picked up</span>
          <details className="rt-chip-details" style={{ marginLeft: 'auto' }}>
            <summary style={{ ...quietBtn, listStyle: 'none' }}>What was in the bag</summary>
            <div style={{ marginTop: 10 }}>
              <SupplyClosetCode />
              <SupplyRunContents run={run} />
              <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ ...chip, whiteSpace: 'nowrap', marginTop: 10 }}>
                Directions →
              </a>
            </div>
          </details>
        </div>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginBottom: 24, background: 'rgba(0,0,0,0.015)' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 4 }}>
        Stop 1 · 85 Eastern
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Pick up supplies.
        </div>
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ ...chip, whiteSpace: 'nowrap' }}>
          Directions →
        </a>
      </div>

      <SupplyClosetCode />
      <SupplyRunContents run={run} />
    </div>
  );
}

/** The packing list itself (restock by home + job parts), shared by the full
 *  pickup card and the folded "What was in the bag" disclosure. */
function SupplyRunContents({ run }: { run: SupplyRun }) {
  const restockBins = run.bins
    .map((b) => ({ name: b.propertyName, items: [...new Set(b.lowItems)] }))
    .filter((b) => b.items.length > 0);
  return (
    <>


      {restockBins.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 12, marginBottom: run.jobs.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>Restocking, by home</div>
          <div style={{ display: 'grid', gap: 5 }}>
            {restockBins.map((b) => (
              <div key={b.name}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{b.name}</span>
                <span style={{ color: 'var(--ink-4)' }}> · </span>
                <span style={{ color: 'var(--ink-3)' }}>{b.items.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {run.jobs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>Job parts in the bag</div>
          <div style={{ display: 'grid', gap: 9 }}>
            {run.jobs.map((j, i) => (
              <div key={`${j.title}-${i}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{j.bring}</span>
                <span style={{ color: 'var(--ink-4)' }}> · {j.title} ({j.propertyName})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** The last leg of every route: back to 85 Eastern to drop the kit off. Renders
 *  after the homes so the day reads closet → homes → closet. */
function KitReturnCard({ active }: { active: boolean }) {
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${SUPPLY_CLOSET_COORDS.lat},${SUPPLY_CLOSET_COORDS.lng}`;
  // Until the homes are done this is a fact, not a move: one quiet line. The
  // full card (code + directions) activates when it's genuinely the next step.
  if (!active) {
    return (
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 18px', marginTop: 18, background: 'rgba(0,0,0,0.015)' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>Last stop · drop your kit back at {SUPPLY_CLOSET}.</span>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginTop: 18, background: 'rgba(0,0,0,0.015)' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 4 }}>
        Last stop · Supply closet
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Drop your kit back at <strong style={{ color: 'var(--ink)' }}>{SUPPLY_CLOSET}</strong>: the bag and anything
          you pulled from a home, so it&apos;s packed and ready for the next trip.
        </div>
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ ...chip, whiteSpace: 'nowrap' }}>
          Directions →
        </a>
      </div>
      <div style={{ marginTop: 12 }}>
        <SupplyClosetCode />
      </div>
    </div>
  );
}

// Values like "No" / "None" carry no instruction — drop them so the inspector
// only sees fields that actually tell them something (no more "Alarm: No").
const ACCESS_NOISE = new Set(['no', 'none', 'n/a', 'na', '-', '--', 'false', '0', 'n']);
const ACCESS_CODE_LABELS = new Set(['Door code', 'Gate code', 'Garage code', 'Alarm code']);

function AccessLines({ a, hasTripCode }: { a: AccessBundle; hasTripCode: boolean }) {
  const rows: Array<[string, string | null]> = [
    ['Getting in', a.method],
    ['Door code', a.smartLock],
    ['Lockbox / key', a.lockboxLocation],
    ['Gate code', a.gateCode],
    ['Garage code', a.garageCode],
    ['Alarm code', a.alarm],
    ['Where to park', a.parking],
  ];
  const present = rows.filter(
    ([, v]) => v && String(v).trim() && !ACCESS_NOISE.has(String(v).trim().toLowerCase()),
  );
  if (present.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        {hasTripCode
          ? <>No smart lock here. Use your trip code above, then let the office know you&apos;re in.</>
          : <>No smart lock here. Text or call the office and we&apos;ll get you in.</>}
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <a href={`sms:${OFFICE_TEL}`} style={signalPill}>Text the office</a>
          <a href={`tel:${OFFICE_TEL}`} style={signalPill}>Call the office</a>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 7 }}>
        How to get in
      </div>
      {/* Roomier rows: each value is a tap-to-copy chip, and 6px between
          38px+ chips made mis-taps easy with winter gloves at a keypad. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 14px', fontSize: 13, alignItems: 'center' }}>
        {present.map(([k, v]) => {
          const sv = String(v);
          const isCode = ACCESS_CODE_LABELS.has(k);
          // A door code stored as "Schlage: 4417" should copy just "4417" so it
          // pastes cleanly into a keypad.
          const copyValue = isCode && sv.includes(':') ? sv.split(':').pop()!.trim() : undefined;
          return (
            <div key={k} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--ink-4)' }}>{k}</span>
              <CopyCode value={sv} copyValue={copyValue} mono={isCode} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One alert slot with a real severity, so several messages don't all shout in
 *  the same red. blocker = you can't proceed (only the account-paused case);
 *  warn = attention needed but recoverable; info = FYI; office = a note from the
 *  team. */
type AlertTone = 'blocker' | 'warn' | 'info' | 'office';
const ALERT_TONE: Record<AlertTone, React.CSSProperties> = {
  blocker: { border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.07)', color: 'var(--signal)', borderRadius: 8 },
  warn: { border: '1px solid #b5791f', background: 'rgba(181,121,31,0.09)', color: '#875a17', borderRadius: 8 },
  info: { border: '1px solid var(--rule)', background: 'rgba(0,0,0,0.03)', color: 'var(--ink-2)', borderRadius: 8 },
  office: { borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', color: 'var(--ink)' },
};
function Alert({ tone, children }: { tone: AlertTone; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', fontSize: 14, lineHeight: 1.5, marginBottom: 22, ...ALERT_TONE[tone] }}>
      {children}
    </div>
  );
}

export default async function PacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ packetId: string }>;
  searchParams: Promise<{ taken?: string; incomplete?: string; stale?: string; blocked?: string; office?: string; resetblocked?: string }>;
}) {
  const { packetId } = await params;
  const sp = await searchParams;

  // Office preview (?office=1): a Helm-signed-in staffer renders this exact
  // page read-only, as the inspector sees it. Explicit param (not just cookie
  // absence) so a staffer who also carries a test-contractor cookie still gets
  // the preview they asked for. Actions are disabled via a <fieldset disabled>
  // around the whole page; the server actions independently re-check the
  // contractor cookie anyway.
  const wantsPreview = sp.office === '1';
  const cookieContractor = wantsPreview ? null : await resolveContractorFromCookie();
  let preview = false;
  if (!cookieContractor) {
    const session = wantsPreview ? await auth() : null;
    if (!session?.user?.email) redirect('/field');
    preview = true;
  }

  // Load masked first (no addresses) to determine ownership safely.
  let packet = await loadPacketDetail(packetId, { revealIdentity: false });
  if (!packet) redirect(preview ? '/operations/packets' : '/field');

  // Whose eyes: the awarded inspector's when someone holds the packet, else a
  // synthetic vetted-and-eligible inspector (what any claimable browser sees).
  let contractor = cookieContractor;
  if (!contractor && packet.awarded_contractor_id) {
    const { data } = await fieldDb().from('contractors').select('*').eq('id', packet.awarded_contractor_id).maybeSingle();
    contractor = (data as ContractorRow | null) ?? null;
  }
  contractor ??= {
    id: '__office_preview__',
    full_name: 'Inspector preview',
    trade: packet.trade,
    status: 'active',
    w9_on_file: true,
    agreement_signed_at: new Date().toISOString(),
    background_check_status: 'cleared',
  } as unknown as ContractorRow;

  const isMine = packet.awarded_contractor_id === contractor.id;
  const isMaint = packet.trade === 'maintenance';
  const isSetup = packet.kind === 'setup';
  const isAdhoc = packet.kind === 'adhoc';
  // Cleaner status for this packet's turnover stops (Seam lock-entry signal),
  // so the inspector knows if a home's been cleaned yet. Loaded only for the
  // assigned inspector, only when there's a turnover in the packet.
  // Cleaner status per stop, keyed on the stop's OWN turnover date: a same-day
  // checkout uses the visit day, a recently-vacated home its prior checkout.
  const visitDate = packet.visit_date; // const so it narrows inside the map closure
  const cleaning = isMine
    ? await loadCleaningStatusForStops(
        packet.stops.map((s) => ({
          property_id: s.property_id,
          checkoutDate: s.window_basis === 'checkout_day' ? visitDate : s.prior_checkout,
        })),
      )
    : new Map<string, CleaningStatus>();
  // Homes that CAN report a cleaner (active Seam lock). A lockbox home can't, so
  // its blank cleaning signal is expected — we suppress the warning there.
  const locked = isMine
    ? await loadLockEquippedPropertyIds(packet.stops.map((s) => s.property_id))
    : new Set<string>();
  // One consistent label per stop — never the guest-facing listing title.
  // Full address once it's theirs; otherwise the real property name if they're
  // vetted (background-cleared), else an anonymized "Home N" so an un-cleared
  // browser can't read off which specific homes sit empty on which days.
  const vetted = canClaim(contractor);
  const stopLabel = (s: PacketStopDetail, i: number): string =>
    isMine ? s.property.address : vetted ? s.property.name : `Home ${i + 1}`;
  // Lost-claim landing: the ?taken=1 bounce used to fall into the redirect
  // below before its alert could ever render. Show the one line that matters
  // (packet was loaded masked, so nothing sensitive is on this page).
  if (!preview && !isMine && sp.taken) {
    return (
      <FieldShell contractorName={contractor.full_name}>
        <Alert tone="info">
          This packet was just claimed by another inspector. Here are others near you on the{' '}
          <Link href="/field" style={{ color: 'var(--signal)' }}>home page</Link>.
        </Alert>
      </FieldShell>
    );
  }
  // A contractor only sees another's packet if it's published AND their trade.
  // The office preview skips the gate — it can look at any state (a draft
  // previews as it will appear once published).
  if (!preview && !isMine && (packet.status !== 'published' || packet.trade !== contractor.trade)) redirect('/field');
  // Reveal door/access codes only while the contractor is actively engaged
  // (claimed or in progress) — never after they submit/approve/cancel, so a
  // departed or cancelled inspector can't keep live codes for an owner's home.
  const canSeeAccess = isMine && (isWorkingStatus(packet.status));
  // Addresses reveal the moment the job is theirs (any awarded status); codes are
  // the tighter gate above. Non-mine (browsing) packets stay masked.
  if (isMine) {
    packet = (await loadPacketDetail(packetId, { revealAccess: canSeeAccess, revealIdentity: true }))!;
  }

  // Which stops have a LIVE programmed smart-lock code, so we can say "your code
  // opens this door" (verified entry) instead of the static-code / call-office
  // fallback. Reads packet_access_codes -- the record that the trip PIN was
  // actually written into that property's Seam lock for this packet.
  let codedProps = new Set<string>();
  if (canSeeAccess) {
    const { data: codes } = await fieldDb()
      .from('packet_access_codes')
      .select('property_id')
      .eq('packet_id', packetId)
      .is('removed_at', null);
    codedProps = new Set(
      ((codes ?? []) as { property_id: string | null }[]).map((c) => c.property_id).filter((p): p is string => !!p),
    );
  }

  const doneCount = packet.stops.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const allComplete = packet.stops.length > 0 && doneCount === packet.stops.length;
  // Office bounced the packet back: the verdict every signal must agree with.
  const changesRequested = isMine && packet.status === 'in_progress' && !!packet.notes;
  const claimable = !isMine && packet.status === 'published' && canClaim(contractor);
  // While actively working a claimed packet, show it as a job to finish, not an
  // open-ended errand: a progress bar + live per-stop status.
  const working = isMine && (isWorkingStatus(packet.status)) && packet.stops.length > 0;
  const pct = packet.stops.length ? Math.round((doneCount / packet.stops.length) * 100) : 0;
  // Every route starts at the supply closet: home bins + flagged-low consumables
  // for inspections, plus the parts each work slip needs for maintenance.
  // Gated per packet: setups skip the closet unless the office opted in.
  const showSupplyStop = working && packet.supply_run;
  const supplyRun = showSupplyStop ? await loadPacketSupplyRun(packetId) : { bins: [], jobs: [] };
  // The supply closet bookends EVERY route: stop 1 to grab the kit, and the
  // last leg to drop it back off. It owns pin 1 on the map (order below every
  // home) and the homes renumber to 2..N+1 behind it.
  // Live route coloring: done stops (tide), the current stop (signal), upcoming
  // (hollow), plus a per-stop "verified at the door" flag from the Seam lock.
  // Only colored while actively working; browsing keeps the plain signal pins.
  const anyStarted = packet.stops.some(
    (s) => s.started_at || s.status === 'in_progress' || s.status === 'complete' || s.status === 'skipped',
  );
  // The list twin of the map's orange pin: first open stop, only once the
  // route is genuinely underway (before kit pickup the closet is "current").
  const currentStopIdx =
    working && anyStarted ? packet.stops.findIndex((x) => x.status !== 'complete' && x.status !== 'skipped') : -1;
  const rawRoute = [
    ...(showSupplyStop
      ? [{ label: `Supply closet · ${SUPPLY_CLOSET}`, lat: SUPPLY_CLOSET_COORDS.lat, lng: SUPPLY_CLOSET_COORDS.lng, order: -1, num: 1, done: anyStarted, verified: false }]
      : []),
    ...packet.stops.map((s, i) => ({
      label: stopLabel(s, i),
      lat: s.property.latitude ?? NaN,
      lng: s.property.longitude ?? NaN,
      order: s.walk_order,
      // The pin carries the stop's LIST number so map and list always agree,
      // even when a coordinate-less stop gets filtered off the map.
      num: i + 1 + (showSupplyStop ? 1 : 0),
      done: s.status === 'complete' || s.status === 'skipped',
      verified: !!s.arrived_verified_at,
    })),
    // The return leg: drop the kit back at the closet. Path-only (pin: false) —
    // it ends where pin 1 already sits, so the dashed line closes the loop
    // without stacking a second marker on the same spot.
    ...(showSupplyStop
      ? [{
          label: `Drop your kit · ${SUPPLY_CLOSET}`,
          lat: SUPPLY_CLOSET_COORDS.lat,
          lng: SUPPLY_CLOSET_COORDS.lng,
          order: Math.max(0, ...packet.stops.map((s) => s.walk_order)) + 1,
          num: undefined as number | undefined,
          done: false,
          verified: false,
          pin: false,
        }]
      : []),
  ].sort((a, b) => a.order - b.order);
  const firstOpenIdx = rawRoute.findIndex((r) => !r.done);
  const routeStops = rawRoute.map((r, idx) => {
    const state: 'done' | 'current' | 'next' = r.done ? 'done' : idx === firstOpenIdx ? 'current' : 'next';
    return { label: r.label, lat: r.lat, lng: r.lng, order: r.order, num: r.num, state: isMine ? state : undefined, verified: r.verified, pin: 'pin' in r ? r.pin : undefined };
  });

  // Safety cue: a guest mid-stay (or a calendar block) on the visit date. The
  // claim-time revalidation only guards inspection packets while still
  // published; maintenance runs with guests in-house by design, and a booking
  // can land after a claim. Read-only — warn the contractor, never drop a stop.
  const occupiedStops = working ? await staleStopIds(packet.visit_date, packet.stops) : new Set<string>();

  return (
    <FieldShell contractorName={preview ? null : contractor.full_name} showSignOut={!preview}>
      {preview && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', border: '1px solid var(--tide-deep)', background: 'rgba(58,107,138,0.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
          <span style={{ fontSize: 13, color: 'var(--tide-deep)', lineHeight: 1.5 }}>
            <strong>Office preview</strong>: exactly what{' '}
            {packet.awarded_contractor_id ? contractor.full_name : 'an eligible inspector'} sees. Buttons are disabled.
          </span>
          <Link href={`/operations/packets/${packetId}`} style={{ fontSize: 12, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            ← Back to the office view
          </Link>
        </div>
      )}
      {/* In preview every button/input inside goes inert (fieldset semantics);
          links (Maps, Directions, tel:) stay live. display:contents keeps the
          wrapper out of layout. */}
      <fieldset disabled={preview} style={{ display: 'contents', border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, textTransform: 'uppercase' }}>
        {fmtDate(packet.visit_date)}{fmtVisitTime(packet.visit_time) ? ` · start ${fmtVisitTime(packet.visit_time)}` : ''}{packet.complete_by && !(working && packet.entry_code) ? ` · target ${fmtVisitTime(packet.complete_by)}` : ''}
      </div>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: '6px 0 8px' }}>
        {packetHeadline(packet)}
      </h1>
      {/* The big price sells the claim; once the packet is theirs the pay is a
          fact, not a pitch — one quiet mono line, bonus beside it. */}
      {isMine ? (
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="font-mono" style={{ fontSize: 15, color: 'var(--ink-3)' }}>{dollars(effectiveBaseCents(packet))}</span>
          {!isPayoutFinal(packet) && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>estimated</span>}
          {packet.bonus_cents > 0 && (
            <span style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600 }} title={packet.bonus_reason ?? undefined}>
              + {dollars(packet.bonus_cents)} bonus
            </span>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className="font-mono" style={{ fontSize: 30 }}>{dollars(effectiveBaseCents(packet))}</span>
            {!isPayoutFinal(packet) && (
              <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', border: '1px solid var(--rule)', borderRadius: 999, padding: '2px 9px' }}>
                Estimated
              </span>
            )}
            <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
              for {packet.stops.length} {packet.stops.length === 1 ? 'stop' : 'stops'}
              {' · '}{dollars(Math.round(packet.posted_price_cents / Math.max(1, packet.stops.length)))} each
            </span>
          </div>
        </div>
      )}

      {working && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: 'var(--ink-3)' }}>{doneCount} of {packet.stops.length} done</span>
            {allComplete &&
              (changesRequested ? (
                <span style={{ color: 'var(--signal)' }}>Fix, then resubmit</span>
              ) : (
                <span style={{ color: 'var(--positive)' }}>Ready to submit</span>
              ))}
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--positive)', transition: 'width .3s ease' }} />
          </div>
        </div>
      )}

      {/* While the trip is live, keep this view current without a manual
          reload — arrivals stamped by the door show up within ~20s. */}
      {working && !preview && <AutoRefresh />}
      {/* One slim line, sticky: the code rides along without billboarding over
          the page (the old full-height card + shadow hovered over everything
          while she scrolled). Tap-to-copy stays — it's the code she punches at
          every keypad. */}
      {working && packet.entry_code && (
        <div style={{ border: '1px solid var(--tide-deep)', borderRadius: 999, background: 'var(--paper)', padding: '7px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 8, zIndex: 20, boxShadow: '0 2px 8px rgba(11,37,69,0.08)' }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', flexShrink: 0 }}>
            Entry code
          </span>
          <span style={{ fontSize: 18, letterSpacing: '0.14em', color: 'var(--tide-deep)' }}>
            <CopyCode value={packet.entry_code} />
          </span>
          {packet.complete_by && (
            <span style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600, marginLeft: 'auto' }}>
              finish by {fmtVisitTime(packet.complete_by)}
            </span>
          )}
        </div>
      )}


      {/* One prioritized alert region. Only the hard account block is red; the
          recoverable "do something" messages are amber; an FYI is grey; a team
          note has its own calm blue style. In practice one of these shows at a
          time (they're mostly mutually exclusive redirect params). */}
      {sp.blocked && (
        <Alert tone="blocker">
          Claiming is paused on your account while we sort out a few recent jobs. Please reach out to the Rising Tide office.
        </Alert>
      )}
      {sp.stale && (
        <Alert tone="warn">
          A guest moved into one of these homes since this packet posted, so it was updated. Review the new details and pay before claiming.
        </Alert>
      )}
      {isMine && packet.status === 'in_progress' && packet.notes && (
        <Alert tone="warn">
          <strong>Changes requested:</strong> <span style={{ color: 'var(--ink)' }}>{packet.notes}</span> Please re-do the stops and submit again.
        </Alert>
      )}
      {sp.resetblocked && (
        <Alert tone="warn">
          That inspection already has work in it, so it can&apos;t be reset. Finish it, or call the office and we&apos;ll sort it.
        </Alert>
      )}
      {sp.incomplete && (
        <Alert tone="warn">
          Finish every stop before submitting the packet.
        </Alert>
      )}
      {isMine && (isWorkingStatus(packet.status)) && packet.instructions && (
        <Alert tone="office">
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 4 }}>From the office</div>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{packet.instructions}</div>
        </Alert>
      )}

      {showSupplyStop && <SupplyRunCard run={supplyRun} pickedUp={anyStarted} />}


      {isMaint && !isMine && (
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 24, maxWidth: 520 }}>
          Each stop is a specific maintenance job at a home. Addresses, the work details, and entry details unlock
          as soon as you claim.
        </p>
      )}
      {/* The three-pillar scope sells the standard BEFORE claiming. Once the
          packet is theirs (working, submitted, approved) it's ~300px of
          scrolling between the inspector and their stops — drop it. */}
      {!isMaint && !isSetup && !isAdhoc && !isMine && <InspectionScope />}
      {isSetup && (!isMine || working) && <SetupScope />}
      {isAdhoc && !isMine && <AdhocScope />}
      {!isMine && packet.supply_run && (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6, maxWidth: 520, margin: '0 0 24px' }}>
          Every route starts and ends at our supply closet ({SUPPLY_CLOSET}): grab your kit on the way out, drop it
          back when you&apos;re done.
        </p>
      )}

      {isMine ? (
        <PacketRouteMap stops={routeStops} />
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6, margin: '4px 0 20px' }}>
          The route and exact addresses are shared the moment you claim.
        </p>
      )}

      <section>
        {/* An open chip-detail panel takes its own full-width row instead of
            inflating mid-row and wedging its sibling chips. */}
        <style>{`.rt-chip-details[open]{flex-basis:100%}`}</style>
        {packet.stops.map((s, i) => {
          const terminal = s.status === 'complete' || s.status === 'skipped';
          // A finished stop collapses to a one-line receipt with everything a
          // tap away. Never collapse over an open attached task.
          const isReceipt = isMine && terminal && s.attachedSlips.every((a) => !!a.completedAt);
          const isCurrent = i === currentStopIdx;
          const startIso = s.arrived_verified_at ?? s.started_at;

          const noteBlock =
            isMine && s.instructions ? (
              <div style={{ marginTop: 8, borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '8px 12px' }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 3 }}>From the office</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{s.instructions}</div>
              </div>
            ) : null;

          const slipBlock = s.workSlip ? (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.workSlip.title}</div>
              {(s.workSlip.action_summary || s.workSlip.description) && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                  {s.workSlip.action_summary || s.workSlip.description}
                </div>
              )}
              {/* Location only — priority is office triage detail, not
                  door-side instruction (same manners as the stop work list). */}
              {s.workSlip.location && (
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>{s.workSlip.location}</div>
              )}
              {s.workSlip.bring_list && (
                <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 6 }}>
                  <span style={{ color: 'var(--ink-4)' }}>Bring: </span>{s.workSlip.bring_list}
                </div>
              )}
              {s.workSlip.photo_urls && s.workSlip.photo_urls.length > 0 && (
                <PhotoThumbs urls={s.workSlip.photo_urls} size={56} />
              )}
            </div>
          ) : null;

          {/* One access row, one visual language: every affordance is the same
              quiet chip. Door-side extras: the raw code billboards as its own
              tap-to-copy chip; a home with no access info at all gets a
              call-for-entry escape hatch instead of silence. */}
          const chipsRow = isMine ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
              {(() => {
                const href = mapsUrl(s);
                return href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" style={chip}>
                    Maps ↗
                  </a>
                ) : null;
              })()}
              {codedProps.has(s.property_id) && (
                <span style={{ ...chip, color: 'var(--positive)', cursor: 'default' }}>🔒 Trip code opens door</span>
              )}
              {!codedProps.has(s.property_id) && s.access && (() => {
                const raw = String(s.access.smartLock ?? '').trim();
                const code = raw.includes(':') ? raw.split(':').pop()!.trim() : raw;
                return /^[0-9#*]{3,8}$/.test(code) ? (
                  <span style={{ ...chip, cursor: 'default' }}>🔑 <CopyCode value={code} mono /></span>
                ) : null;
              })()}
              {!codedProps.has(s.property_id) && s.access && (
                <details className="rt-chip-details" style={{ display: 'inline-block', maxWidth: '100%' }}>
                  <summary style={{ ...chip, listStyle: 'none' }}>🔑 How to get in</summary>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)', borderRadius: 10, padding: '10px 12px', marginTop: 6, maxWidth: 560 }}>
                    <AccessLines a={s.access} hasTripCode={!!packet.entry_code} />
                  </div>
                </details>
              )}
              {working && !codedProps.has(s.property_id) && !s.access && (
                <a href={`tel:${OFFICE_TEL}`} style={signalPill}>Call for entry</a>
              )}
              {s.access?.arrival && (
                <details className="rt-chip-details" style={{ display: 'inline-block', maxWidth: '100%' }}>
                  <summary style={{ ...chip, listStyle: 'none' }}>ⓘ Arrival &amp; parking</summary>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)', borderRadius: 10, padding: '10px 12px', marginTop: 6, maxWidth: 560, whiteSpace: 'pre-wrap' }}>
                    {s.access.arrival}
                  </div>
                </details>
              )}
              {s.property.supply_closet_location && (
                <details className="rt-chip-details" style={{ display: 'inline-block', maxWidth: '100%' }}>
                  <summary style={{ ...chip, listStyle: 'none' }}>📦 Supply closet</summary>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)', borderRadius: 10, padding: '10px 12px', marginTop: 6, maxWidth: 560, whiteSpace: 'pre-wrap' }}>
                    {s.property.supply_closet_location}
                  </div>
                </details>
              )}
            </div>
          ) : null;

          const workList =
            isMine && s.attachedSlips.length > 0 ? (
              <StopWorkList
                packetId={packet.id}
                readOnly={!working}
                items={s.attachedSlips.map((a) => ({
                  attachmentId: a.attachmentId,
                  title: a.category === 'inventory' ? a.title.replace(/^restock:\s*/i, '') : a.title,
                  sub: a.location,
                  bring: a.bring_list,
                  note: a.officeNote,
                  thumbs: a.photo_urls ?? [],
                  done: !!a.completedAt,
                  kind: a.category === 'inventory' ? ('restock' as const) : ('task' as const),
                }))}
              />
            ) : null;

          const reopenForm =
            working && s.status === 'complete' ? (
              <form action={reopenStop} style={{ margin: '10px 0 0' }}>
                <input type="hidden" name="packet_id" value={packet.id} />
                <input type="hidden" name="stop_id" value={s.id} />
                <button type="submit" style={quietBtn}>Reopen</button>
              </form>
            ) : null;

          return (
            <div
              key={s.id}
              className="rt-stop-row"
              style={{ borderTop: '1px solid var(--rule)', padding: isReceipt ? '12px 0' : '16px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: isCurrent ? '1px solid var(--signal)' : '1px solid var(--rule)',
                  background: isCurrent ? 'var(--signal)' : 'transparent',
                  boxShadow: isCurrent ? '0 0 0 4px rgba(200,90,58,0.18)' : undefined,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  flexShrink: 0,
                  color: isCurrent ? '#fff' : s.status === 'complete' ? 'var(--positive)' : s.status === 'skipped' ? 'var(--ink-4)' : 'var(--ink-3)',
                }}
              >
                {s.status === 'complete' ? '✓' : s.status === 'skipped' ? '-' : i + 1 + (showSupplyStop ? 1 : 0)}
              </div>

              {isReceipt ? (
                /* The receipt: address, one meta line, everything else a tap away. */
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-serif" style={{ fontSize: 17, color: 'var(--ink-3)' }}>{stopLabel(s, i)}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 2 }}>
                    {s.status === 'skipped' ? (
                      'Skipped by the office'
                    ) : (
                      <>
                        Done
                        {startIso && (
                          <> · <OnSite startIso={startIso} endIso={s.departed_at ?? s.completed_at} live={false} /></>
                        )}
                        {s.arrived_verified_at && <span style={{ color: 'var(--positive)' }}> · ✓ entered</span>}
                      </>
                    )}
                  </div>
                  {(noteBlock || slipBlock || chipsRow || workList || reopenForm) && (
                    <details className="rt-chip-details" style={{ marginTop: 8, display: 'inline-block', maxWidth: '100%' }}>
                      <summary style={{ ...quietBtn, listStyle: 'none' }}>Details</summary>
                      <div style={{ marginTop: 4 }}>
                        {noteBlock}
                        {slipBlock}
                        {chipsRow}
                        {workList}
                        {reopenForm}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="font-serif" style={{ fontSize: 17 }}>
                      {stopLabel(s, i)}
                    </div>
                    {noteBlock}
                    {slipBlock}
                    {!s.workSlip && isMine ? (
                      <div
                        style={{
                          fontSize: 13,
                          marginTop: 2,
                          color:
                            s.status === 'complete'
                              ? 'var(--positive)'
                              : s.status === 'in_progress'
                                ? 'var(--tide-deep)'
                                : 'var(--ink-4)',
                        }}
                      >
                        {s.status === 'complete' ? 'Done' : s.status === 'in_progress' ? 'In progress' : null}
                        {/* Time at property, driven by the door: live-ticking while
                            they're inside, fixed once they've left. */}
                        {(() => {
                          if (!startIso) return null;
                          if (s.status === 'in_progress') {
                            return <span style={{ color: 'var(--ink-4)' }}> · <OnSite startIso={startIso} endIso={s.departed_at} live /></span>;
                          }
                          if (s.status === 'complete') {
                            return <span style={{ color: 'var(--ink-4)' }}> · <OnSite startIso={startIso} endIso={s.departed_at ?? s.completed_at} live={false} /></span>;
                          }
                          return null;
                        })()}
                        {s.arrived_verified_at && (
                          <span style={{ color: 'var(--positive)' }}> · ✓ entered</span>
                        )}
                        {/* Timing stays visible while working; the one HARD deadline
                            of the day (a guest arriving at this home at 4 PM) gets
                            its own line instead of hiding at the end of a chain. */}
                        {!terminal && (() => {
                          const t = stopTiming(s, packet.visit_date);
                          if (!t.urgent) {
                            return (
                              <span style={{ color: 'var(--ink-4)' }}>
                                {s.status === 'in_progress' ? ' · ' : ''}{t.label}
                              </span>
                            );
                          }
                          return (
                            <>
                              <span style={{ color: 'var(--ink-4)' }}>{s.status === 'in_progress' ? ' · ' : ''}{t.first}</span>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--signal)', marginTop: 4 }}>
                                Guest checks in today, 4 PM
                              </div>
                            </>
                          );
                        })()}
                        {/* Cleaner status (🧹), distinct from the inspector's own
                            progress. Turnover stops only; silent once finished. */}
                        {!terminal && (() => {
                          const sameDay = s.window_basis === 'checkout_day';
                          const checkoutDate = sameDay ? packet.visit_date : s.prior_checkout;
                          const recent = !!checkoutDate && dayGap(checkoutDate, packet.visit_date) >= 0 && dayGap(checkoutDate, packet.visit_date) <= CLEAN_LOOKBACK_DAYS;
                          if (!sameDay && !recent) return null;
                          const status = cleaning.get(`${s.property_id}|${checkoutDate}`);
                          if (!status && !locked.has(s.property_id)) return null;
                          return <CleanerStatus status={status} sameDay={sameDay} checkoutDate={checkoutDate} />;
                        })()}
                      </div>
                    ) : !s.workSlip ? (
                      (() => {
                        const t = stopTiming(s, packet.visit_date);
                        return (
                          <div style={{ fontSize: 13, marginTop: 2, color: t.urgent ? 'var(--signal)' : 'var(--ink-3)', fontWeight: t.urgent ? 600 : 400 }}>
                            {/* The town is the drive-time signal a browser needs before
                                claiming — even masked stops say where they are. */}
                            {cityShort(s.property.city) ? `${cityShort(s.property.city)} · ` : ''}{t.label}
                          </div>
                        );
                      })()
                    ) : null}

                    {isMine && occupiedStops.has(s.id) && !terminal && (
                      <div style={{ marginTop: 10, padding: '10px 12px', borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', fontSize: 13, color: 'var(--signal)', lineHeight: 1.5 }}>
                        A guest may be in this home today. Call the office to confirm it&apos;s safe to enter.
                        {/* The safety tap gets a real pill, not 13px inline text. */}
                        <div style={{ marginTop: 8 }}>
                          <a href={`tel:${OFFICE_TEL}`} style={{ ...signalPill, border: '1px solid var(--signal)', fontWeight: 700 }}>
                            Call the office
                          </a>
                        </div>
                      </div>
                    )}
                    {chipsRow}
                    {isMine && s.workSlip && !terminal && (
                      <MaintenanceComplete packetId={packet.id} stopId={s.id} photoNudge />
                    )}
                    {workList}
                  </div>
                  {isMine && !s.workSlip && !terminal && (
                    <div className="rt-stop-action" style={{ flexShrink: 0 }}>
                      <StartStop packetId={packet.id} stopId={s.id} resume={s.status === 'in_progress'} />
                      {s.status === 'in_progress' && (
                        <form action={undoStartStop} style={{ margin: '8px 0 0', textAlign: 'center' }}>
                          <input type="hidden" name="packet_id" value={packet.id} />
                          <input type="hidden" name="stop_id" value={s.id} />
                          {/* A real touch target, not a stray 12px link next to the
                              48px Start button — a gloved thumb shouldn't mis-tap. */}
                          <button type="submit" style={quietBtn}>Reset this stop</button>
                        </form>
                      )}
                    </div>
                  )}
                  {isMine && s.status === 'complete' && (
                    <div className="rt-stop-action" style={{ flexShrink: 0, textAlign: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--positive)' }}>Done</span>
                      {reopenForm && <div style={{ marginTop: 6 }}>{reopenForm}</div>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </section>

      {showSupplyStop && <KitReturnCard active={allComplete} />}

      {/* Sticky bar renders ONLY when it carries a real action or verdict:
          claim, submit (all stops done), the eligibility nudge, or the
          submitted/approved receipt. Mid-job it used to pin a disabled
          "Finish all stops to submit" button to the bottom of every scroll —
          the progress bar up top already tells that story. */}
      {(claimable ||
        (!isMine && packet.status === 'published' && !canClaim(contractor)) ||
        (isMine && (packet.status === 'submitted' || packet.status === 'approved')) ||
        (isMine && packet.status !== 'submitted' && packet.status !== 'approved' && allComplete)) && (
        <div
          className="rt-cta-bar"
          style={{
            borderTop: '1px solid var(--ink)',
            marginTop: 8,
            padding: '18px 0 calc(14px + env(safe-area-inset-bottom, 0px))',
            position: 'sticky',
            bottom: 0,
            zIndex: 20,
            background: 'var(--paper)',
          }}
        >
          {claimable && (
            <form action={claimPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <PendingButton
                label={`Claim this packet · est. ${dollars(packet.posted_price_cents)}`}
                busyLabel="Claiming…"
                style={{
                  width: '100%',
                  maxWidth: 480,
                  background: 'var(--signal)',
                  color: 'var(--paper)',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '16px 24px',
                  minHeight: 48,
                }}
              />
            </form>
          )}
          {!isMine && packet.status === 'published' && !canClaim(contractor) && (
            onboardingComplete(contractor) ? (
              <p style={{ color: 'var(--signal)', fontSize: 14, margin: 0 }}>
                Your background check hasn&apos;t started yet. You&apos;ll be able to claim as soon as the office kicks it off.
              </p>
            ) : (
              <Link href="/field/onboarding" style={{ color: 'var(--signal)', fontSize: 14 }}>
                Finish your account setup to claim this packet →
              </Link>
            )
          )}
          {isMine && packet.status !== 'submitted' && packet.status !== 'approved' && allComplete && (
            <form action={submitPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <PendingButton
                label={changesRequested ? 'Resubmit packet' : 'Submit completed packet'}
                busyLabel="Submitting…"
                style={{
                  width: '100%',
                  maxWidth: 480,
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '16px 24px',
                  minHeight: 48,
                }}
              />
            </form>
          )}
          {isMine && (packet.status === 'submitted' || packet.status === 'approved') && (
            <div style={{ fontSize: 14, color: 'var(--positive)' }}>
              {packet.status === 'approved'
                ? `Approved. ${dollars(totalPayoutCents(packet))} is on its way. You'll get a receipt the moment it's sent.`
                : "Submitted for review. We'll message you as soon as it's approved."}
              {packet.status === 'approved' && packet.bonus_cents > 0 && (
                <div style={{ marginTop: 8, borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '10px 14px', color: 'var(--ink)', fontSize: 14, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--signal)' }}>+ {dollars(packet.bonus_cents)} bonus</strong>
                  {packet.bonus_reason ? <> for {packet.bonus_reason}</> : null}. Thank you for going the extra mile.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </fieldset>
    </FieldShell>
  );
}
