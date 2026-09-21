import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadShootBoard, loadCreativeContractors, shootPaySummary, setShortLabel, isPreWork, type ShootSummary } from '@/lib/creative-shoots';
import { loadDriveFilesByShoots, finalsProgress, finalsProgressLabel, isCreativeDriveConfigured } from '@/lib/creative-drive';
import { loadShootCalendar, todayET, addDays, daysSinceIso } from '@/lib/creative-calendar';
import { loadFleetForecast } from '@/lib/weather';
import { loadFieldProperties } from '@/lib/field-packets';
import { dollars } from '@/lib/field-types';
import { createShoot, syncDriveNow } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { ShootPlanner } from './ShootPlanner';
import { ShootSentFlash } from './ShootSentFlash';

export const dynamic = 'force-dynamic';

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function fmtSettles(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** One money line per shoot, from the per-post rollup: paid → to-pay → counting. */
function payLine(s: ShootSummary): { text: string; tone: string; sub: string | null } {
  const sum = shootPaySummary(s.assets, s.pay, s.shoot, s.card);
  if (sum.fullySettled) return { text: `Paid ${dollars(sum.paidCents)}`, tone: 'var(--positive)', sub: null };
  // The delivery slug pays once, on the COMPLETE set. A partial package owes
  // nothing yet — show what it will be worth and what it's still waiting on,
  // never a to-pay figure someone might send.
  if (sum.awaitingSet) {
    return { text: `${dollars(sum.setBaseCents)} on delivery`, tone: 'var(--ink-3)', sub: setShortLabel(sum) };
  }
  if (sum.owedCents > 0) {
    // "delivery base", singular: the set pays once, however many posts carry it.
    const bits = [sum.baseDue ? 'delivery base' : null, sum.topupDue ? `${sum.topupDue} bonus` : null].filter(Boolean).join(' + ');
    return { text: `${dollars(sum.owedCents)} to pay`, tone: 'var(--signal)', sub: bits ? `${bits} ready` : 'ready to pay' };
  }
  if (sum.pendingCents > 0) {
    return { text: `${dollars(sum.pendingCents)} counting`, tone: 'var(--ink-3)', sub: s.pay.settlesOn ? `settles ${fmtSettles(s.pay.settlesOn)}` : 'bonus counting' };
  }
  // A posted reel mid-count whose views haven't beaten the base yet: the
  // climbing bonus is $0-so-far, so the pending branch stays quiet — but the
  // clock IS the story. Say so instead of a bare "in flight".
  const onClock = s.pay.assets.some((p) => p.counts && p.locksOn && !p.locked);
  if (onClock) {
    return {
      text: sum.paidCents > 0 ? `${dollars(sum.paidCents)} paid` : 'Posted',
      tone: 'var(--ink)',
      sub: s.pay.settlesOn ? `bonus counting · settles ${fmtSettles(s.pay.settlesOn)}` : 'bonus counting',
    };
  }
  // Delivered reels still waiting their turn to post (weeks or months on
  // RT's schedule) hold the shoot open — say how many are left.
  const toPost = s.pay.assets.filter((p) => p.counts && p.kind === 'reel' && p.stalled).length;
  if (toPost > 0) {
    return {
      text: sum.paidCents > 0 ? `${dollars(sum.paidCents)} paid` : 'Delivered',
      tone: 'var(--ink)',
      sub: `${toPost} reel${toPost === 1 ? '' : 's'} to post`,
    };
  }
  if (sum.paidCents > 0) return { text: `${dollars(sum.paidCents)} paid`, tone: 'var(--ink)', sub: 'in flight' };
  return { text: s.pay.state === 'empty' ? 'No posts yet' : 'Awaiting posts', tone: 'var(--ink-4)', sub: null };
}

export default async function CreativeBoard({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string; err?: string; sent?: string; shoot?: string; from?: string; to?: string }>;
}) {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 40 }}>
          <p style={{ color: 'var(--ink-3)' }}>Field isn&apos;t configured in this environment.</p>
        </section>
        <HelmFooter module="Field" right="Creative" />
      </div>
    );
  }

  const sp = await searchParams;
  // The planner window: two weeks from today, or the ?from/?to the pager
  // asked for (capped at a month so the grid stays readable).
  const today = todayET();
  const isIso = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isIso(sp.from) ? sp.from : today;
  let to = isIso(sp.to) ? sp.to : addDays(from, 13);
  if (to < from || to > addDays(from, 30)) to = addDays(from, 13);
  const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  // The forecast depends on nothing, so it rides along with the rest rather
  // than adding its own round trip. Advisory only, and never allowed to
  // break the board: loadFleetForecast returns an empty map rather than
  // throwing, and the grid renders a blank forecast row when it does.
  const [board, contributors, properties, forecast] = await Promise.all([
    loadShootBoard(),
    loadCreativeContractors(),
    loadFieldProperties(),
    loadFleetForecast(),
  ]);
  const calendar = await loadShootCalendar(from, to, properties);
  const weather = Object.fromEntries(forecast);
  const driveFiles = await loadDriveFilesByShoots(board.map((s) => s.shoot.id));
  // Per-shoot Drive chip: package progress while the finals gate is open
  // (nothing paid yet), plain file count once money has moved.
  const driveChips = new Map<string, string | null>();
  for (const s of board) {
    const files = driveFiles.get(s.shoot.id) ?? [];
    const liveFiles = files.filter((f) => !f.trashed_at).length;
    const anyPaid = s.assets.some((a) => a.base_paid_at || a.topup_paid_at);
    if (!anyPaid && s.shoot.drive_finals_folder_id) {
      const p = finalsProgress(s.card, files, s.shoot.drive_finals_folder_id);
      driveChips.set(s.shoot.id, p.complete ? `full set in Drive · ${liveFiles} files` : `finals: ${finalsProgressLabel(p)}`);
    } else if (liveFiles > 0) {
      driveChips.set(s.shoot.id, `${liveFiles} file${liveFiles === 1 ? '' : 's'} in Drive`);
    } else if (s.shoot.drive_folder_id) {
      driveChips.set(s.shoot.id, 'Drive linked · nothing yet');
    } else {
      driveChips.set(s.shoot.id, null);
    }
  }
  // "Drive checked 2:40 PM" trust stamp: the freshest scan across the board.
  const lastSynced = board
    .map((s) => s.shoot.drive_synced_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const driveNote = sp.drive ?? null;
  const errNote = sp.err ?? null;

  // Consent first, money second. An OFFERED day is a question nobody has
  // answered and a DECLINED one is a no: neither is work, so both stay out
  // of the pay groups entirely. Left in, an unanswered offer sat under "In
  // flight" and read as a shoot that had already happened.
  const offers = board.filter((s) => s.shoot.status === 'offered').sort((a, b) => a.shoot.shoot_date.localeCompare(b.shoot.shoot_date));
  const declined = board
    .filter((s) => s.shoot.status === 'declined')
    .sort((a, b) => (b.shoot.responded_at ?? b.shoot.shoot_date).localeCompare(a.shoot.responded_at ?? a.shoot.shoot_date));
  const work = board.filter((s) => !isPreWork(s.shoot.status));

  const sums = new Map(work.map((s) => [s.shoot.id, shootPaySummary(s.assets, s.pay, s.shoot, s.card)]));
  const attention = work.filter((s) => s.pay.needsAttention);
  const owed = work.filter((s) => !s.pay.needsAttention && sums.get(s.shoot.id)!.owedCents > 0);
  const done = work.filter((s) => !s.pay.needsAttention && sums.get(s.shoot.id)!.fullySettled);
  const live = work.filter((s) => {
    const su = sums.get(s.shoot.id)!;
    return !s.pay.needsAttention && su.owedCents === 0 && !su.fullySettled;
  });

  // "Owed now" = every base + view bonus ready to send, across real shoots.
  const owedTotal = work.reduce((t, s) => t + sums.get(s.shoot.id)!.owedCents, 0);
  const todayIso = today;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="shoots" trade="creative" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, borderBottom: '1px solid var(--ink)', paddingBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Creative</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              Offer days to contributors; pay follows delivery and views. {work.length} {work.length === 1 ? 'shoot' : 'shoots'}
              {offers.length > 0 ? `, ${offers.length} offer${offers.length === 1 ? '' : 's'} out` : ''}.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
            {owedTotal > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div className="font-mono" style={{ fontSize: 22, color: 'var(--signal)' }}>{dollars(owedTotal)}</div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>owed now</div>
              </div>
            )}
            {isCreativeDriveConfigured() && (
              <div style={{ textAlign: 'right' }}>
                <form action={syncDriveNow} style={{ margin: 0 }}>
                  <SubmitButton label="Sync Drive" busyLabel="Checking Drive…" style={btnGhost} spinnerTone="ink" />
                </form>
                <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 4 }}>
                  {lastSynced
                    ? `checked ${new Date(lastSynced).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} · auto every 2h`
                    : 'auto every 2h'}
                </div>
              </div>
            )}
          </div>
        </div>

        <ShootSentFlash note={sp.sent} shootId={sp.shoot} />

        {driveNote && (
          <div
            style={{
              marginTop: 14,
              border: `1px solid ${driveNote.startsWith('err:') ? 'var(--signal)' : 'var(--rule)'}`,
              borderRadius: 10,
              padding: '9px 14px',
              background: driveNote.startsWith('err:') ? 'rgba(200,90,58,0.06)' : 'var(--paper-2, #fff)',
              fontSize: 13,
              color: driveNote.startsWith('err:') ? 'var(--signal)' : 'var(--ink-3)',
            }}
          >
            {driveNote.startsWith('err:') ? `Drive sync: ${driveNote.slice(4)}` : `Drive checked — ${driveNote.replace(/^ok:/, '')}.`}
          </div>
        )}

        {errNote && (
          <div
            style={{
              marginTop: 14,
              border: '1px solid var(--signal)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              lineHeight: 1.5,
              color: 'var(--signal)',
              background: 'rgba(200,90,58,0.06)',
            }}
          >
            {errNote}
          </div>
        )}

        {/* The planner: which homes are empty on which day, and one click to
            send a contributor there with a brief. Sits first because sending
            people to homes is the board's daily job; the ledger follows. */}
        <div style={{ marginTop: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>Send a contributor to a home</span>
              <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 10 }}>
                Click an empty day. We log the shoot and text + email the brief: address, arrival, and the door code on the day. The forecast row is advisory, never a block.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, whiteSpace: 'nowrap' }}>
              <Link href={`/fieldwork/shoots?from=${addDays(from, -span)}&to=${addDays(from, -1)}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                ‹ earlier
              </Link>
              {from !== today && (
                <Link href="/fieldwork/shoots" style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>today</Link>
              )}
              <Link href={`/fieldwork/shoots?from=${addDays(to, 1)}&to=${addDays(to, span)}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                later ›
              </Link>
            </div>
          </div>
          <ShootPlanner
            days={calendar.days}
            rows={calendar.rows}
            contributors={contributors.map((c) => ({ id: c.id, name: c.full_name }))}
            today={today}
            weather={weather}
          />
        </div>

        {/* Log a shoot by hand: a past date (the after-the-fact ledger flow) or
            a b-roll / town day with no home. Folded, since the grid above is
            the usual door. Opens itself when the last log was refused. */}
        <details style={{ marginTop: 18 }} open={!!errNote}>
          <summary style={{ ...quietSummary, fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600 }}>+ Log a past shoot or a b-roll day ▾</summary>
          <form action={createShoot} autoComplete="off" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 620, border: '1px solid var(--rule)', borderRadius: 10, padding: 16, background: 'var(--paper-2, #fff)' }}>
            <label style={fieldLabel}>
              Contributor
              <select name="contractor_id" required defaultValue="" style={input}>
                <option value="" disabled>Choose…</option>
                {contributors.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Shoot date
              <input type="date" name="shoot_date" required style={input} />
            </label>
            <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>
              Title
              <input name="title" required maxLength={200} placeholder="e.g. Rocky Neck summer reel day" style={input} />
            </label>
            <label style={fieldLabel}>
              Property <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <select name="property_id" defaultValue="" style={input}>
                <option value="">None / b-roll</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Location note <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <input name="location_note" maxLength={300} placeholder="e.g. downtown Gloucester" style={input} />
            </label>
            <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>
              Notes <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <textarea name="notes" maxLength={4000} rows={2} placeholder="Brief, deliverables agreed, anything to remember" style={{ ...input, resize: 'vertical' }} />
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              {contributors.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--signal)' }}>
                  No active contributors yet. <Link href="/fieldwork/roster" style={{ color: 'var(--signal)' }}>Invite one from the roster</Link> first.
                </div>
              ) : (
                <SubmitButton label="Log shoot" busyLabel="Logging…" style={btnDark} />
              )}
            </div>
          </form>
        </details>

        {work.length === 0 && offers.length === 0 && declined.length === 0 ? (
          <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--ink-4)', fontSize: 14 }}>
            No shoots yet. Log one above once a contributor has filmed.
          </div>
        ) : (
          <>
            <OfferGroup offers={offers} today={todayIso} />
            <DeclinedGroup declined={declined} />
            <ShootGroup title="Needs attention" hint="Views overdue to read, or nothing posted yet" shoots={attention} driveChips={driveChips} accent />
            <ShootGroup title="Ready to pay" hint="Payout locked, awaiting send" shoots={owed} driveChips={driveChips} />
            <ShootGroup title="In flight" hint="Shot, posted, or counting views" shoots={live} driveChips={driveChips} />
            <ShootGroup title="Paid" hint="Settled" shoots={done} driveChips={driveChips} muted />
          </>
        )}
      </section>
      <HelmFooter module="Field" right="Creative" />
    </div>
  );
}

/**
 * Offers out and unanswered. The top of the board on purpose: a day nobody
 * has answered is the office's open loop, and it expires quietly when the
 * date passes. A shoot only leaves here when the contributor answers.
 */
function OfferGroup({ offers, today }: { offers: ShootSummary[]; today: string }) {
  if (offers.length === 0) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600 }}>
          Offered, waiting on an answer
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Nothing is booked until they accept</span>
      </div>
      <div style={{ border: '1px dashed var(--tide-deep)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
        {offers.map((s, i) => {
          const past = s.shoot.shoot_date < today;
          const waitingDays = daysSinceIso(s.shoot.offered_at);
          return (
            <Link
              key={s.shoot.id}
              href={`/fieldwork/shoots/${s.shoot.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '13px 16px', borderTop: i ? '1px solid var(--rule)' : 'none', textDecoration: 'none', color: 'var(--ink)', alignItems: 'center' }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="font-serif" style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.propertyName ?? s.shoot.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                  {s.contractorName} &middot; {fmtDate(s.shoot.shoot_date)}
                  {waitingDays != null && waitingDays > 0 ? ` \u00b7 asked ${waitingDays}d ago` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 13, color: past ? 'var(--signal)' : 'var(--tide-deep)', fontWeight: 600 }}>
                  {past ? 'Never answered' : 'Awaiting answer'}
                </div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>
                  {past ? 'the day has passed' : 'nudge or withdraw'}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Days a contributor turned down. Folded: it is a log, not a to-do, but the
 *  reason is worth keeping where the office can read it. */
function DeclinedGroup({ declined }: { declined: ShootSummary[] }) {
  if (declined.length === 0) return null;
  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', cursor: 'pointer', listStyle: 'none', padding: '4px 0' }}>
        Passed on &middot; {declined.length} &#9662;
      </summary>
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)', marginTop: 8, opacity: 0.8 }}>
        {declined.slice(0, 15).map((s, i) => (
          <div key={s.shoot.id} style={{ padding: '11px 16px', borderTop: i ? '1px solid var(--rule)' : 'none', fontSize: 13 }}>
            <span style={{ color: 'var(--ink)' }}>{s.contractorName}</span>
            <span style={{ color: 'var(--ink-4)' }}> passed on {s.propertyName ?? s.shoot.title}, {fmtDate(s.shoot.shoot_date)}</span>
            {s.shoot.decline_reason && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3, fontStyle: 'italic' }}>&ldquo;{s.shoot.decline_reason}&rdquo;</div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function ShootGroup({ title, hint, shoots, driveChips, accent, muted }: { title: string; hint: string; shoots: ShootSummary[]; driveChips: Map<string, string | null>; accent?: boolean; muted?: boolean }) {
  if (shoots.length === 0) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent ? 'var(--signal)' : 'var(--ink-4)', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{hint}</span>
      </div>
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)', opacity: muted ? 0.72 : 1 }}>
        {shoots.map((s, i) => {
          const pay = payLine(s);
          const assetLine = s.assets.length
            ? `${s.assets.filter((a) => a.kind === 'reel').length} reel${s.assets.filter((a) => a.kind === 'reel').length === 1 ? '' : 's'}${s.assets.some((a) => a.kind === 'carousel') ? ` · ${s.assets.filter((a) => a.kind === 'carousel').length} carousel` : ''}`
            : 'no posts yet';
          const driveChip = driveChips.get(s.shoot.id) ?? null;
          return (
            <Link
              key={s.shoot.id}
              href={`/fieldwork/shoots/${s.shoot.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '13px 16px', borderTop: i ? '1px solid var(--rule)' : 'none', textDecoration: 'none', color: 'var(--ink)', alignItems: 'center' }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="font-serif" style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.shoot.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                  {s.contractorName} · {fmtDate(s.shoot.shoot_date)}{s.propertyName ? ` · ${s.propertyName}` : ''} · {assetLine}
                  {driveChip && <span style={{ color: 'var(--tide-deep)' }}> · {driveChip}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div className="font-mono" style={{ fontSize: 15, color: pay.tone }}>{pay.text}</div>
                {pay.sub && <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>{pay.sub}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 18px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '9px 16px',
};
const quietCtl: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  fontSize: 12,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  padding: 0,
};
const quietSummary: React.CSSProperties = { ...quietCtl, display: 'flex', listStyle: 'none', userSelect: 'none' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' };
const input: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '7px 9px',
  borderRadius: 6,
};
