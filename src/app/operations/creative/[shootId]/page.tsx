import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { loadShootDetail, shootPaySummary } from '@/lib/creative-shoots';
import { loadShootDriveFiles, finalsProgress, finalsProgressLabel, isCreativeDriveConfigured, type DriveFileRow } from '@/lib/creative-drive';
import { dollars } from '@/lib/field-types';
import type { RateCard } from '@/lib/creative-rates';
import { addAsset, updateAsset, deleteAsset, readAssetViews, setAssetQualifies, payAssetBase, payAllDeliveredBases, markAssetPosted, payAssetTopup, setAssetTopupOverride, setShootPaidAdjustment, cancelShoot, syncDriveNow, setShootDriveFolder } from '../actions';
import { PendingButton } from '@/app/field/packet/[packetId]/PendingButton';

export const dynamic = 'force-dynamic';

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}
function fmtShort(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
function tierLabel(card: RateCard): string {
  return card.tiers.map((t) => `${t.views.toLocaleString()}+ → ${dollars(t.cents)}`).join(' · ');
}
function firstRung(card: RateCard): number {
  return card.tiers.length ? Math.min(...card.tiers.map((t) => t.views)) : 0;
}

export default async function ShootDetail({
  params,
  searchParams,
}: {
  params: Promise<{ shootId: string }>;
  searchParams: Promise<{ drive?: string }>;
}) {
  const { shootId } = await params;
  const [detail, sp] = await Promise.all([loadShootDetail(shootId), searchParams]);
  if (!detail) notFound();
  const driveFiles = await loadShootDriveFiles(shootId);
  const driveNote = sp.drive ?? null;
  const { shoot, pay, card } = detail;
  const payByAsset = new Map(pay.assets.map((p) => [p.assetId, p]));
  const sum = shootPaySummary(detail.assets, pay, shoot);
  const active = shoot.status !== 'cancelled';
  const paidAdjusted = (shoot.paid_adjustment_cents ?? 0) !== 0;

  // A posted reel mid-count keeps the shoot "In flight" even while its
  // climbing bonus is still $0 — the delivery already happened, so this
  // state must never read "Awaiting delivery".
  const onClock = pay.assets.some((p) => p.counts && p.locksOn && !p.locked);
  const statusTag = shoot.status === 'cancelled' ? 'Cancelled' : sum.fullySettled ? 'Settled' : sum.owedCents > 0 ? 'To pay' : sum.pendingCents > 0 || onClock ? 'In flight' : 'Awaiting delivery';

  const reels = detail.assets.filter((a) => a.kind === 'reel');
  const carousels = detail.assets.filter((a) => a.kind === 'carousel');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <section className="max-w-[860px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/creative" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Creative</Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>{shoot.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              {detail.contractorName} · {fmtDate(shoot.shoot_date)}
              {detail.propertyName ? ` · ${detail.propertyName}` : ''}
              {shoot.location_note ? ` · ${shoot.location_note}` : ''}
            </div>
            {shoot.notes && <div style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>{shoot.notes}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: sum.fullySettled ? 'var(--positive)' : 'var(--signal)' }}>{statusTag}</div>
            <div className="font-mono" style={{ fontSize: 24, marginTop: 4 }} title={paidAdjusted ? `Set by office${shoot.paid_adjustment_note ? ` — ${shoot.paid_adjustment_note}` : ''} · receipts ${dollars(sum.receiptsPaidCents)}` : undefined}>
              {dollars(sum.paidCents)}
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>paid to date</div>
            {/* The office's hand on the paid figure — for when the receipts
                don't match what actually went out. Same override pattern as
                the reel bonus edit: audited, and felt on every surface. */}
            {active && (
              <details style={{ position: 'relative', marginTop: 3 }}>
                <summary style={{ ...quietSummary, justifyContent: 'flex-end', fontSize: 11.5 }}>{paidAdjusted ? 'set by office · edit ▾' : 'edit ▾'}</summary>
                <div style={{ ...menuCard, left: 'auto', right: 0, textAlign: 'left' }}>
                  <form action={setShootPaidAdjustment} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 250 }}>
                    <input type="hidden" name="shoot_id" value={shoot.id} />
                    <label style={miniLabel}>
                      Paid to date ($)
                      <input type="number" name="dollars" min={0} step={0.01} defaultValue={sum.paidCents / 100} style={{ ...input, width: 120 }} />
                    </label>
                    <label style={miniLabel}>
                      Why <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
                      <input name="note" defaultValue={shoot.paid_adjustment_note ?? ''} placeholder="e.g. Venmo'd on shoot day" maxLength={300} style={input} />
                    </label>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 250 }}>
                      Corrects what this shoot has actually paid. Receipts total {dollars(sum.receiptsPaidCents)}; any later payment still adds on top. {detail.contractorName.split(' ')[0]} sees the same figure.
                    </div>
                    <PendingButton label="Save" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                  </form>
                  {paidAdjusted && (
                    <form action={setShootPaidAdjustment} style={{ marginTop: 8 }}>
                      <input type="hidden" name="shoot_id" value={shoot.id} />
                      <input type="hidden" name="clear" value="1" />
                      <PendingButton label={`Back to receipts · ${dollars(sum.receiptsPaidCents)}`} busyLabel="Saving…" style={{ ...btnGhost, fontSize: 11.5 }} spinnerTone="ink" />
                    </form>
                  )}
                </div>
              </details>
            )}
            {sum.owedCents > 0 && <div style={{ fontSize: 12.5, color: 'var(--signal)', fontWeight: 600, marginTop: 4 }}>{dollars(sum.owedCents)} to pay now</div>}
            {sum.pendingCents > 0 && <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{dollars(sum.pendingCents)} bonus counting</div>}
          </div>
        </div>

        {/* What this contributor is paid on — frozen once the first base is paid. */}
        <div style={{ marginTop: 16, border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>
            Rate card{shoot.card_snapshot_at ? ' · frozen' : ''}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Reel {dollars(card.baseCents)} base on delivery, then {tierLabel(card)} measured {card.countDays} days after it&apos;s posted.
            Carousel flat {dollars(card.carouselCents)} on delivery. Reels must run {card.minSeconds}s+.
            Counts up to {card.maxPerShoot} reel{card.maxPerShoot === 1 ? '' : 's'} and {card.maxCarouselsPerShoot} carousel{card.maxCarouselsPerShoot === 1 ? '' : 's'} per shoot.
          </div>
        </div>

        {pay.needsAttention && (
          <div style={{ marginTop: 14, border: '1px solid var(--signal)', borderRadius: 10, padding: '10px 16px', background: 'rgba(200,90,58,0.06)', fontSize: 13.5, color: 'var(--signal)' }}>
            A reel we posted is past its {card.countDays}-day count and its views were never read — read them below to release the bonus.
          </div>
        )}

        {/* Drive delivery — the watched folder. Uploads here auto-log assets,
            which is what puts the delivery base due on the board. */}
        {isCreativeDriveConfigured() && active && (
          <div style={{ marginTop: 14, border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                Drive delivery
                {shoot.drive_finals_folder_id && (
                  <a
                    href={`https://drive.google.com/drive/folders/${shoot.drive_finals_folder_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--tide-deep)', textDecoration: 'none', marginLeft: 10, letterSpacing: 0, textTransform: 'none', fontWeight: 600 }}
                  >
                    Finals folder ↗
                  </a>
                )}
                {shoot.drive_folder_id && (
                  <a
                    href={`https://drive.google.com/drive/folders/${shoot.drive_folder_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--ink-4)', textDecoration: 'none', marginLeft: 10, letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}
                  >
                    whole folder ↗
                  </a>
                )}
              </div>
              <form action={syncDriveNow} style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <input type="hidden" name="return_to" value={`/operations/creative/${shoot.id}`} />
                {shoot.drive_synced_at && (
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    checked {fmtShort(shoot.drive_synced_at)} · auto every 2h
                  </span>
                )}
                <PendingButton label="Check now" busyLabel="Checking…" style={{ ...quietCtl, color: 'var(--tide-deep)', fontWeight: 600 }} spinnerTone="ink" />
              </form>
            </div>

            {driveNote && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: driveNote.startsWith('err:') ? 'var(--signal)' : 'var(--ink-3)' }}>
                {driveNote.startsWith('err:') ? driveNote.slice(4) : driveNote.replace(/^ok:/, '')}
              </div>
            )}

            {/* The package gate, in plain words: nothing is owed until the full
                rate-card set sits in the Finals folder. */}
            {shoot.drive_finals_folder_id && !detail.assets.some((a) => a.base_paid_at || a.topup_paid_at) && (() => {
              const p = finalsProgress(card, driveFiles, shoot.drive_finals_folder_id);
              return (
                <div style={{ marginTop: 10, borderLeft: `3px solid ${p.complete ? 'var(--positive)' : 'var(--tide)'}`, background: p.complete ? 'rgba(46,125,80,0.06)' : 'rgba(78,124,158,0.06)', padding: '8px 12px', fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, maxWidth: 560 }}>
                  {p.complete ? (
                    <>Full set delivered — the package is logged below and the delivery base is due.</>
                  ) : (
                    <>
                      <strong>{finalsProgressLabel(p)}.</strong> Pay stays $0 until all{' '}
                      {p.reelsNeed + p.carouselsNeed} finals ({p.reelsNeed} reels {card.minSeconds}s+ and the carousel photos) are in the Finals
                      folder — the moment the set completes, the {dollars(card.baseCents * p.reelsNeed + card.carouselCents * p.carouselsNeed)} base goes due here on its own.
                    </>
                  )}
                </div>
              );
            })()}

            {!shoot.drive_folder_id ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
                  No folder linked yet. Sync auto-matches a subfolder named like the property inside
                  &ldquo;Creative Assets - {detail.contractorName.split(' ')[0]}&rdquo; — or paste the folder link:
                </div>
                <form action={setShootDriveFolder} style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input type="hidden" name="shoot_id" value={shoot.id} />
                  <input name="folder" placeholder="https://drive.google.com/drive/folders/…" style={{ ...input, width: 320 }} />
                  <PendingButton label="Link folder" busyLabel="Linking…" style={btnGhost} spinnerTone="ink" />
                </form>
              </div>
            ) : driveFiles.length === 0 ? (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-4)' }}>
                Folder linked — nothing uploaded yet. Files show here as they land; pay triggers when the full set is in the Finals folder.
              </div>
            ) : (() => {
              // The list stays about DELIVERY: finals files + anything linked
              // to an asset. Raw takes dumped in the shoot folder (drone
              // masters, sidecars) are evidence, not deliverables — folded
              // away so they can't bury the package.
              const deliverables = driveFiles.filter((f) => f.in_finals || f.asset_id);
              const raws = driveFiles.filter((f) => !f.in_finals && !f.asset_id);
              return (
                <div style={{ marginTop: 10 }}>
                  {deliverables.map((f) => (
                    <DriveFileLine key={f.id} f={f} assetLabel={assetLabelFor(f, detail.assets)} />
                  ))}
                  {deliverables.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '2px 0 6px' }}>
                      Nothing in the Finals folder yet — pay triggers when the full set lands there.
                    </div>
                  )}
                  {raws.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ ...quietSummary, fontSize: 11.5 }}>
                        {raws.length} raw file{raws.length === 1 ? '' : 's'} outside finals ▾
                      </summary>
                      <div style={{ marginTop: 4 }}>
                        {raws.map((f) => (
                          <DriveFileLine key={f.id} f={f} assetLabel={assetLabelFor(f, detail.assets)} />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}

            {shoot.drive_folder_id && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ ...quietSummary, fontSize: 11.5 }}>Change folder ▾</summary>
                <form action={setShootDriveFolder} style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input type="hidden" name="shoot_id" value={shoot.id} />
                  <input name="folder" placeholder="Paste a folder link, or leave empty to unlink" style={{ ...input, width: 320 }} />
                  <PendingButton label="Save" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                </form>
              </details>
            )}
          </div>
        )}

        {/* Delivery base: $100/asset the moment it's handed over — one click for
            everything delivered-but-unpaid. Bonuses come later, per posted reel. */}
        {active && sum.baseDue > 0 && (
          <form action={payAllDeliveredBases} style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
            <input type="hidden" name="shoot_id" value={shoot.id} />
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{sum.baseDue} delivered {sum.baseDue === 1 ? 'asset' : 'assets'} — base owed on delivery.</span>
            <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 130 }} />
            <PendingButton label={`Pay all bases · ${dollars(sum.owedBaseCents ?? 0)}`} busyLabel="Recording + receipt…" style={btnDark} />
          </form>
        )}

        {/* Posts — each pays on its own clock: base the day it posts, a reel's
            view bonus ~2 weeks later once its count locks. */}
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>Posts</div>
          {detail.assets.length === 0 && (
            <div style={{ fontSize: 13.5, color: 'var(--ink-4)', marginBottom: 12 }}>No assets logged yet. Log each reel or carousel as Cooper delivers it — the base is owed on delivery, the reel bonus follows once we post it.</div>
          )}
          {[...reels, ...carousels].map((a) => {
            const ap = payByAsset.get(a.id);
            const paidBase = !!a.base_paid_at;
            const paidTopup = !!a.topup_paid_at;
            // Computed lock: views locked OR the office pinned the bonus by
            // hand. Either way the number is decided — payable, not climbing.
            const locked = ap?.locked ?? !!a.views_locked_at;
            return (
              <div key={a.id} style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '13px 16px', marginBottom: 10, background: 'var(--paper-2, #fff)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                      {a.kind}{a.duration_seconds ? ` · ${a.duration_seconds}s` : ''}{a.submitted_by_contractor_at ? ' · submitted by contributor' : ''}
                    </div>
                    <div className="font-serif" style={{ fontSize: 16, marginTop: 2 }}>{a.title || (a.kind === 'reel' ? 'Reel' : 'Carousel')}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      {a.post_url ? (
                        <a href={a.post_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>view post ↗</a>
                      ) : null}
                      {a.posted_at ? <span>posted {fmtShort(a.posted_at)}</span> : <span style={{ color: 'var(--ink-4)' }}>delivered · not posted yet</span>}
                      {a.views_read_at && a.views != null && <span>{a.views.toLocaleString()} views{locked ? ' · locked' : ''}</span>}
                    </div>
                  </div>
                  {/* Per-post pay state: base (on delivery) line, then bonus (on posting) line for reels. */}
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {!ap || !ap.counts ? (
                      <div style={{ color: 'var(--ink-4)' }}>$0 · {ap?.excludedReason ?? 'not counted'}</div>
                    ) : (
                      <>
                        <div style={{ color: paidBase ? 'var(--positive)' : 'var(--signal)', fontWeight: 600 }}>
                          {paidBase ? `✓ base ${dollars(a.base_cents ?? ap.baseCents)}` : `base ${dollars(ap.baseCents)} due`}
                        </div>
                        {a.kind === 'reel' && (
                          <div style={{ color: paidTopup ? 'var(--positive)' : a.posted_at && paidBase && locked && ap.topupCents > 0 ? 'var(--signal)' : 'var(--ink-4)', marginTop: 2 }}>
                            {paidTopup
                              ? `✓ bonus ${dollars(a.topup_cents ?? 0)}`
                              : !a.posted_at
                                ? 'bonus after posting'
                                : !paidBase
                                  ? 'bonus after base'
                                  : ap.overridden
                                    ? ap.topupCents > 0 ? `bonus ${dollars(ap.topupCents)} · set by office` : 'bonus zeroed by office'
                                    : locked
                                      ? ap.topupCents > 0 ? `bonus ${dollars(ap.topupCents)} due` : `no bonus · under ${firstRung(card).toLocaleString()}`
                                      : `bonus counting${ap.locksOn ? ` · settles ${fmtShort(ap.locksOn)}` : ''}`}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {active && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
                    {/* Pay base — owed on delivery, whether or not it's posted. */}
                    {ap && ap.counts && !paidBase && (
                      <form action={payAssetBase} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 130 }} />
                        <PendingButton label={`Pay base · ${dollars(ap.baseCents)}`} busyLabel="Recording + receipt…" style={btnDark} />
                      </form>
                    )}
                    {/* Mark posted — records the go-live date, which starts a reel's
                        view-bonus clock. Posting can be weeks after delivery. */}
                    {!a.posted_at && !locked && (
                      <form action={markAssetPosted} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <label style={miniLabel}>Posted date<input type="date" name="posted_at" required style={{ ...input, width: 150 }} /></label>
                        <label style={miniLabel}>Post URL<input name="post_url" placeholder="optional" style={{ ...input, width: 170 }} /></label>
                        <PendingButton label={a.kind === 'reel' ? 'Mark posted · start bonus clock' : 'Mark posted'} busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                      </form>
                    )}
                    {/* Read views — a posted reel, after its base, until locked. */}
                    {a.kind === 'reel' && a.posted_at && paidBase && !locked && (
                      <form action={readAssetViews} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <label style={miniLabel}>
                          Views
                          <input name="views" inputMode="numeric" defaultValue={a.views != null ? a.views.toLocaleString('en-US') : undefined} placeholder="e.g. 2,400" style={{ ...input, width: 120 }} />
                        </label>
                        <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, paddingBottom: 7 }}>
                          <input type="checkbox" name="lock" /> lock final
                        </label>
                        <PendingButton label={a.views_read_at ? 'Update' : 'Record'} busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                      </form>
                    )}
                    {/* Pay bonus — posted reel, base paid, views locked, bonus earned. */}
                    {a.kind === 'reel' && a.posted_at && paidBase && locked && ap && ap.topupCents > 0 && !paidTopup && (
                      <form action={payAssetTopup} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 130 }} />
                        <PendingButton label={`Pay view bonus · ${dollars(ap.topupCents)}`} busyLabel="Recording + receipt…" style={btnDark} />
                      </form>
                    )}
                    {/* Edit bonus — the office's hand on the number. Pins the
                        view bonus at a decided amount (Cooper's portal shows
                        the same figure), or sends it back to live counting.
                        Gone once the bonus is paid: receipts are immutable. */}
                    {a.kind === 'reel' && a.posted_at && ap && ap.counts && !paidTopup && (
                      <details style={{ position: 'relative' }}>
                        <summary style={quietSummary}>{ap.overridden ? `Bonus set by office · edit ▾` : 'Edit bonus ▾'}</summary>
                        <div style={menuCard}>
                          <form action={setAssetTopupOverride} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
                            <input type="hidden" name="shoot_id" value={shoot.id} />
                            <input type="hidden" name="asset_id" value={a.id} />
                            <label style={miniLabel}>
                              View bonus ($)
                              <input type="number" name="dollars" min={0} step={1} defaultValue={ap.topupCents / 100} style={{ ...input, width: 110 }} />
                            </label>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 240 }}>
                              Sets this reel&apos;s bonus and stops the view count — it becomes payable at this number, and Cooper sees the same figure.
                            </div>
                            <PendingButton label="Set bonus" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                          </form>
                          {ap.overridden && (
                            <form action={setAssetTopupOverride} style={{ marginTop: 8 }}>
                              <input type="hidden" name="shoot_id" value={shoot.id} />
                              <input type="hidden" name="asset_id" value={a.id} />
                              <input type="hidden" name="clear" value="1" />
                              <PendingButton label="Back to live counting" busyLabel="Saving…" style={{ ...btnGhost, fontSize: 11.5 }} spinnerTone="ink" />
                            </form>
                          )}
                        </div>
                      </details>
                    )}

                    {/* Quiet utilities. Editing is locked once views lock; a paid
                        post can't be removed (it's a financial record). */}
                    {!locked && (
                      <details style={{ position: 'relative' }}>
                        <summary style={quietSummary}>Edit ▾</summary>
                        <div style={menuCard}>
                          <form action={updateAsset} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
                            <input type="hidden" name="asset_id" value={a.id} />
                            <input type="hidden" name="shoot_id" value={shoot.id} />
                            <input name="title" defaultValue={a.title ?? ''} placeholder="Title" maxLength={200} style={input} />
                            <input name="post_url" defaultValue={a.post_url ?? ''} placeholder="Post URL" style={input} />
                            <label style={miniLabel}>Posted date<input type="date" name="posted_at" defaultValue={a.posted_at?.slice(0, 10) ?? ''} style={input} /></label>
                            {a.kind === 'reel' && (
                              <label style={miniLabel}>Duration (s)<input type="number" name="duration_seconds" min={1} step={1} defaultValue={a.duration_seconds ?? undefined} style={input} /></label>
                            )}
                            <PendingButton label="Save changes" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                          </form>
                        </div>
                      </details>
                    )}
                    {!locked && ap && (
                      <form action={setAssetQualifies} style={{ margin: 0 }}>
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="qualifies" value={a.qualifies ? '' : 'on'} />
                        {!a.qualifies && <input type="hidden" name="reason" value="Restored by office" />}
                        <PendingButton label={a.qualifies ? "Don't count this" : 'Count it anyway'} busyLabel="…" style={quietCtl} spinnerTone="ink" />
                      </form>
                    )}
                    {!paidBase && (
                      <form action={deleteAsset} style={{ margin: 0 }}>
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <PendingButton label="remove" busyLabel="…" style={{ ...quietCtl, color: 'var(--ink-4)' }} spinnerTone="ink" />
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {active && (
            <details>
              <summary style={{ ...quietSummary, fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600 }}>+ Log a delivered asset ▾</summary>
              <form action={addAsset} style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 520, border: '1px solid var(--rule)', borderRadius: 10, padding: 14, background: 'var(--paper-2, #fff)' }}>
                <input type="hidden" name="shoot_id" value={shoot.id} />
                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
                  Log each reel or carousel when Cooper delivers it — the {dollars(card.baseCents)} base is owed then. Leave the posted date blank until it actually goes live; that&apos;s what starts a reel&apos;s bonus clock.
                </div>
                <label style={miniLabel}>Type<select name="kind" defaultValue="reel" style={input}><option value="reel">Reel</option><option value="carousel">Carousel</option></select></label>
                <label style={miniLabel}>Duration (s)<input type="number" name="duration_seconds" min={1} step={1} placeholder="reels only" style={input} /></label>
                <label style={{ ...miniLabel, gridColumn: '1 / -1' }}>Title<input name="title" maxLength={200} placeholder="Optional label" style={input} /></label>
                <label style={miniLabel}>Post URL <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(if live)</span><input name="post_url" placeholder="https://instagram.com/…" style={input} /></label>
                <label style={miniLabel}>Posted date <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(if live)</span><input type="date" name="posted_at" style={input} /></label>
                <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
                  <PendingButton label="Log asset" busyLabel="Adding…" style={btnGhost} spinnerTone="ink" />
                </div>
              </form>
            </details>
          )}
        </div>

        {/* Cancel — only while nothing on the shoot has been paid, by receipt
            OR by an office paid-to-date edit (which is itself a money record). */}
        {active && sum.paidCents === 0 && sum.receiptsPaidCents === 0 && (
          <div style={{ marginTop: 28, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
            <form action={cancelShoot} style={{ margin: 0 }}>
              <input type="hidden" name="shoot_id" value={shoot.id} />
              <PendingButton label="Cancel shoot" busyLabel="Cancelling…" style={{ ...quietCtl, color: 'var(--signal)' }} spinnerTone="ink" />
            </form>
          </div>
        )}
      </section>
      <HelmFooter module="Field" right={shoot.title} />
    </div>
  );
}

/** One row per delivered Drive file: what it is, when it landed, what it pays. */
function DriveFileLine({ f, assetLabel }: { f: DriveFileRow; assetLabel: string | null }) {
  const kind = f.mime_type?.startsWith('video/') ? 'reel' : f.mime_type?.startsWith('image/') ? 'photo' : 'file';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12.5, padding: '5px 0', borderTop: '1px solid var(--rule)', opacity: f.trashed_at ? 0.55 : 1 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: kind === 'reel' ? 'var(--tide-deep)' : 'var(--ink-4)', width: 38, flexShrink: 0 }}>{kind}</span>
      <a
        href={f.web_view_link ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--ink)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300, textDecorationLine: f.trashed_at ? 'line-through' : 'none' }}
      >
        {f.name}
      </a>
      <span style={{ color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
        {f.trashed_at ? 'removed from Drive' : f.drive_created_at ? `up ${fmtShort(f.drive_created_at)}` : ''}
        {f.duration_seconds ? ` · ${f.duration_seconds}s` : ''}
        {f.in_finals && !f.trashed_at ? ' · finals' : ''}
      </span>
      <span style={{ marginLeft: 'auto', color: assetLabel ? 'var(--ink-3)' : 'var(--ink-4)', whiteSpace: 'nowrap' }}>
        {assetLabel ? `→ ${assetLabel}` : f.in_finals ? 'not counted' : 'outside finals'}
      </span>
    </div>
  );
}

function assetLabelFor(f: DriveFileRow, assets: Array<{ id: string; kind: string; title: string | null }>): string | null {
  if (!f.asset_id) return null;
  const a = assets.find((x) => x.id === f.asset_id);
  if (!a) return null;
  return a.title || (a.kind === 'reel' ? 'Reel' : 'Carousel');
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
const menuCard: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 30,
  minWidth: 260,
  background: 'var(--paper-2, #fff)',
  border: '1px solid var(--rule)',
  borderRadius: 10,
  boxShadow: '0 10px 28px rgba(11,37,69,0.14)',
  padding: '12px 16px',
};
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
const miniLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' };
