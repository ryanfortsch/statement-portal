import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { loadShootDetail, shootPaySummary } from '@/lib/creative-shoots';
import { dollars } from '@/lib/field-types';
import type { RateCard } from '@/lib/creative-rates';
import { addAsset, updateAsset, deleteAsset, readAssetViews, setAssetQualifies, payAssetBase, payAssetTopup, cancelShoot } from '../actions';
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

export default async function ShootDetail({ params }: { params: Promise<{ shootId: string }> }) {
  const { shootId } = await params;
  const detail = await loadShootDetail(shootId);
  if (!detail) notFound();
  const { shoot, pay, card } = detail;
  const payByAsset = new Map(pay.assets.map((p) => [p.assetId, p]));
  const sum = shootPaySummary(detail.assets, pay);
  const active = shoot.status !== 'cancelled';

  const statusTag = shoot.status === 'cancelled' ? 'Cancelled' : sum.fullySettled ? 'Settled' : sum.owedCents > 0 ? 'To pay' : sum.pendingCents > 0 ? 'In flight' : 'Awaiting posts';

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
            <div className="font-mono" style={{ fontSize: 24, marginTop: 4 }}>{dollars(sum.paidCents)}</div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>paid to date</div>
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
            Reel {dollars(card.baseCents)} base the day it posts, then {tierLabel(card)} measured {card.countDays} days after posting.
            Carousel flat {dollars(card.carouselCents)}. Reels must run {card.minSeconds}s+.
            Counts up to {card.maxPerShoot} reel{card.maxPerShoot === 1 ? '' : 's'} and {card.maxCarouselsPerShoot} carousel{card.maxCarouselsPerShoot === 1 ? '' : 's'} per shoot.
          </div>
        </div>

        {pay.needsAttention && (
          <div style={{ marginTop: 14, border: '1px solid var(--signal)', borderRadius: 10, padding: '10px 16px', background: 'rgba(200,90,58,0.06)', fontSize: 13.5, color: 'var(--signal)' }}>
            A reel is past its count date and still unread, or a post has no URL/date so its clock never started. Fix it below, then read the views.
          </div>
        )}

        {/* Posts — each pays on its own clock: base the day it posts, a reel's
            view bonus ~2 weeks later once its count locks. */}
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>Posts</div>
          {detail.assets.length === 0 && (
            <div style={{ fontSize: 13.5, color: 'var(--ink-4)', marginBottom: 12 }}>No posts logged yet. Add each reel or carousel as it goes live — pay follows each one.</div>
          )}
          {[...reels, ...carousels].map((a) => {
            const ap = payByAsset.get(a.id);
            const paidBase = !!a.base_paid_at;
            const paidTopup = !!a.topup_paid_at;
            const locked = !!a.views_locked_at;
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
                      ) : (
                        <span style={{ color: 'var(--signal)' }}>no post URL</span>
                      )}
                      {a.posted_at ? <span>posted {fmtShort(a.posted_at)}</span> : <span style={{ color: 'var(--signal)' }}>no post date</span>}
                      {a.views_read_at && a.views != null && <span>{a.views.toLocaleString()} views{locked ? ' · locked' : ''}</span>}
                    </div>
                  </div>
                  {/* Per-post pay state: base line, then bonus line for reels. */}
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {!ap || !ap.counts ? (
                      <div style={{ color: 'var(--ink-4)' }}>$0 · {ap?.excludedReason ?? 'not counted'}</div>
                    ) : (
                      <>
                        <div style={{ color: paidBase ? 'var(--positive)' : a.posted_at ? 'var(--signal)' : 'var(--ink-4)', fontWeight: 600 }}>
                          {paidBase ? `✓ base ${dollars(a.base_cents ?? ap.baseCents)}` : a.posted_at ? `base ${dollars(ap.baseCents)} due` : `base ${dollars(ap.baseCents)} on post`}
                        </div>
                        {a.kind === 'reel' && (
                          <div style={{ color: paidTopup ? 'var(--positive)' : locked && ap.topupCents > 0 ? 'var(--signal)' : 'var(--ink-4)', marginTop: 2 }}>
                            {paidTopup
                              ? `✓ bonus ${dollars(a.topup_cents ?? 0)}`
                              : !paidBase
                                ? 'bonus after base'
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
                    {/* Pay base — the day it posts. */}
                    {ap && ap.counts && a.posted_at && !paidBase && (
                      <form action={payAssetBase} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 130 }} />
                        <PendingButton label={`Pay base · ${dollars(ap.baseCents)}`} busyLabel="Recording + receipt…" style={btnDark} />
                      </form>
                    )}
                    {/* Read views — reels, after the base is paid, until locked. */}
                    {a.kind === 'reel' && paidBase && !locked && (
                      <form action={readAssetViews} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <label style={miniLabel}>
                          Views
                          <input type="number" name="views" min={0} step={1} defaultValue={a.views ?? undefined} placeholder="e.g. 2400" style={{ ...input, width: 120 }} />
                        </label>
                        <label style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5, paddingBottom: 7 }}>
                          <input type="checkbox" name="lock" /> lock final
                        </label>
                        <PendingButton label={a.views_read_at ? 'Update' : 'Record'} busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                      </form>
                    )}
                    {/* Pay bonus — reel, views locked, bonus earned. */}
                    {a.kind === 'reel' && paidBase && locked && ap && ap.topupCents > 0 && !paidTopup && (
                      <form action={payAssetTopup} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input type="hidden" name="shoot_id" value={shoot.id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 130 }} />
                        <PendingButton label={`Pay view bonus · ${dollars(ap.topupCents)}`} busyLabel="Recording + receipt…" style={btnDark} />
                      </form>
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
              <summary style={{ ...quietSummary, fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600 }}>+ Add a post ▾</summary>
              <form action={addAsset} style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 520, border: '1px solid var(--rule)', borderRadius: 10, padding: 14, background: 'var(--paper-2, #fff)' }}>
                <input type="hidden" name="shoot_id" value={shoot.id} />
                <label style={miniLabel}>Type<select name="kind" defaultValue="reel" style={input}><option value="reel">Reel</option><option value="carousel">Carousel</option></select></label>
                <label style={miniLabel}>Duration (s)<input type="number" name="duration_seconds" min={1} step={1} placeholder="reels only" style={input} /></label>
                <label style={{ ...miniLabel, gridColumn: '1 / -1' }}>Title<input name="title" maxLength={200} placeholder="Optional label" style={input} /></label>
                <label style={{ ...miniLabel, gridColumn: '1 / -1' }}>Post URL<input name="post_url" placeholder="https://instagram.com/…" style={input} /></label>
                <label style={miniLabel}>Posted date<input type="date" name="posted_at" style={input} /></label>
                <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
                  <PendingButton label="Add post" busyLabel="Adding…" style={btnGhost} spinnerTone="ink" />
                </div>
              </form>
            </details>
          )}
        </div>

        {/* Cancel — only while nothing on the shoot has been paid. */}
        {active && sum.paidCents === 0 && (
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
