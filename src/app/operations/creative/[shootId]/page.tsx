import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { loadShootDetail } from '@/lib/creative-shoots';
import { dollars } from '@/lib/field-types';
import type { AssetRow } from '@/lib/creative-shoots';
import type { AssetPay } from '@/lib/creative-pay';
import type { RateCard } from '@/lib/creative-rates';
import {
  addAsset,
  updateAsset,
  deleteAsset,
  readAssetViews,
  setAssetQualifies,
  approveShoot,
  finalizeShootPayout,
  markShootPaid,
  cancelShoot,
} from '../actions';
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

/** The office-facing money + status caption for one asset. */
function assetCaption(a: AssetRow, pay: AssetPay | undefined): { pay: string; note: string; tone: string } {
  if (!pay) return { pay: '—', note: '', tone: 'var(--ink-4)' };
  if (!pay.counts) return { pay: '$0', note: pay.excludedReason ?? 'not counted', tone: 'var(--ink-4)' };
  if (pay.locked) return { pay: `${dollars(pay.currentCents)} locked`, note: pay.rungViews != null ? `${pay.rungViews.toLocaleString()}+ views` : 'base rate', tone: 'var(--positive)' };
  if (pay.stalled) return { pay: dollars(pay.currentCents), note: 'no post URL / date yet', tone: 'var(--signal)' };
  if (a.views_read_at) {
    return {
      pay: dollars(pay.currentCents),
      note: `${(a.views ?? 0).toLocaleString()} views${pay.ceilingCents > pay.currentCents ? ` · can still reach ${dollars(pay.ceilingCents)}` : ''}${pay.locksOn ? ` · locks ${fmtShort(pay.locksOn)}` : ''}`,
      tone: pay.overdue ? 'var(--signal)' : 'var(--ink-3)',
    };
  }
  // posted, not yet read
  return {
    pay: dollars(pay.currentCents),
    note: `${pay.overdue ? 'views OVERDUE — ' : ''}base until views read${pay.locksOn ? ` · locks ${fmtShort(pay.locksOn)}` : ''}`,
    tone: pay.overdue ? 'var(--signal)' : 'var(--ink-4)',
  };
}

export default async function ShootDetail({ params }: { params: Promise<{ shootId: string }> }) {
  const { shootId } = await params;
  const detail = await loadShootDetail(shootId);
  if (!detail) notFound();
  const { shoot, pay, card } = detail;
  const payByAsset = new Map(pay.assets.map((p) => [p.assetId, p]));

  const canApprove = shoot.status === 'shot' || shoot.status === 'delivered';
  const finalizing = shoot.status === 'approved' && !shoot.paid_at;
  const paid = !!shoot.paid_at;
  const editableAssets = !paid && shoot.status !== 'cancelled';
  const bonus = shoot.bonus_cents || 0;

  // Headline number tracks the same three states the board uses.
  const headline =
    paid || shoot.final_payout_cents != null
      ? dollars((shoot.final_payout_cents ?? 0) + bonus)
      : pay.state === 'locked'
        ? dollars(pay.totalCents + bonus)
        : pay.state === 'counting'
          ? `${dollars(pay.floorCents + bonus)}–${dollars(pay.ceilingCents + bonus)}`
          : '—';
  const headlineTag = paid ? 'Paid' : shoot.final_payout_cents != null ? 'Final' : pay.state === 'locked' ? 'Ready' : pay.state === 'counting' ? 'Range' : 'Floor';

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
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)' }}>{shoot.status}</div>
            <div className="font-mono" style={{ fontSize: 24, marginTop: 4 }}>{headline}</div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>{headlineTag}</div>
            {bonus > 0 && (
              <div style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600, marginTop: 2 }} title={shoot.bonus_reason ?? undefined}>
                incl. {dollars(bonus)} bonus
              </div>
            )}
          </div>
        </div>

        {/* What this contributor is paid on — the frozen card once approved,
            the live card before that. Keeps the math legible to the office. */}
        <div style={{ marginTop: 16, border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>
            Rate card{shoot.card_snapshot_at ? ' · frozen at approval' : ''}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Reel {dollars(card.baseCents)} base, then {tierLabel(card)} measured {card.countDays} days after posting.
            Carousel flat {dollars(card.carouselCents)}. Reels must run {card.minSeconds}s+.
            Counts up to {card.maxPerShoot} reel{card.maxPerShoot === 1 ? '' : 's'} and {card.maxCarouselsPerShoot} carousel{card.maxCarouselsPerShoot === 1 ? '' : 's'} per shoot.
          </div>
        </div>

        {pay.needsAttention && (
          <div style={{ marginTop: 14, border: '1px solid var(--signal)', borderRadius: 10, padding: '10px 16px', background: 'rgba(200,90,58,0.06)', fontSize: 13.5, color: 'var(--signal)' }}>
            Something here needs a hand: a post is past its count date and still unread, or an asset has no URL/date so the clock never started. Fix it below.
          </div>
        )}

        {/* Assets — reels then carousels. Each is where views get read + locked. */}
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>Posts</div>
          {detail.assets.length === 0 && (
            <div style={{ fontSize: 13.5, color: 'var(--ink-4)', marginBottom: 12 }}>No posts logged yet. Add each reel or carousel as it goes live.</div>
          )}
          {[...reels, ...carousels].map((a) => {
            const ap = payByAsset.get(a.id);
            const cap = assetCaption(a, ap);
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
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div className="font-mono" style={{ fontSize: 15, color: cap.tone }}>{cap.pay}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, maxWidth: 220, whiteSpace: 'normal' }}>{cap.note}</div>
                  </div>
                </div>

                {editableAssets && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
                    {/* Read views — the office enters the number; contributor never does. */}
                    {a.kind === 'reel' && !locked && (
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
                    {locked && <div style={{ fontSize: 12, color: 'var(--positive)', paddingBottom: 6 }}>✓ views locked {fmtShort(a.views_locked_at)}</div>}

                    {/* Quiet utilities: edit metadata, disqualify override, remove. */}
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
                    {!locked && (
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

          {editableAssets && (
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

        {/* Lifecycle: approve delivery → finalize payout → mark paid. One loud
            action per state, mirroring the packet detail page. */}
        <div style={{ marginTop: 28, borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
          {canApprove && (
            <form action={approveShoot} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <input type="hidden" name="shoot_id" value={shoot.id} />
              <PendingButton label="Approve delivery" busyLabel="Approving…" style={btnDark} />
              <div style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 460, lineHeight: 1.5 }}>
                Freezes {detail.contractorName}&apos;s rate card onto this shoot. Pay isn&apos;t locked yet — read the views over the next {card.countDays} days, then finalize.
              </div>
            </form>
          )}

          {finalizing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pay.state === 'counting' && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  Still counting — {dollars(pay.floorCents)}–{dollars(pay.ceilingCents)} so far{pay.settlesOn ? `, settles ${fmtShort(pay.settlesOn)}` : ''}. You can finalize now or wait for the views to lock.
                </div>
              )}
              <form action={finalizeShootPayout} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', border: '1px solid var(--rule)', borderRadius: 10, padding: 16, background: 'var(--paper-2, #fff)', width: '100%', maxWidth: 480 }}>
                <input type="hidden" name="shoot_id" value={shoot.id} />
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Finalize payout</div>
                <label style={{ ...miniLabel, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--ink-4)' }}>$</span>
                  <input type="number" name="final_dollars" min={0} step={1} defaultValue={Math.round(pay.totalCents / 100)} style={{ ...input, width: 120 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>computed {dollars(pay.totalCents)}{shoot.final_payout_cents != null ? ` · currently ${dollars(shoot.final_payout_cents)}` : ''}</span>
                </label>
                <details>
                  <summary style={quietSummary}>+ Above-and-beyond bonus ▾</summary>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <label style={{ ...miniLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--ink-4)' }}>$</span><input type="number" name="bonus_dollars" min={0} step={1} defaultValue={bonus > 0 ? Math.round(bonus / 100) : undefined} style={{ ...input, width: 90 }} /></label>
                    <input name="bonus_reason" defaultValue={shoot.bonus_reason ?? ''} placeholder="reason (optional)" maxLength={300} style={{ ...input, width: 200 }} />
                  </div>
                </details>
                <PendingButton label="Lock the payout" busyLabel="Saving…" style={btnDark} />
              </form>

              {shoot.final_payout_cents != null && (
                <form action={markShootPaid} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input type="hidden" name="shoot_id" value={shoot.id} />
                  <input name="reference" placeholder="ref # (optional)" style={{ ...input, width: 150 }} />
                  <PendingButton label={`Mark paid · ${dollars((shoot.final_payout_cents ?? 0) + bonus)}`} busyLabel="Recording + receipt…" style={btnDark} />
                </form>
              )}
            </div>
          )}

          {paid && (
            <div style={{ fontSize: 13, color: 'var(--positive)' }}>
              Paid {dollars((shoot.final_payout_cents ?? 0) + bonus)}
              {bonus > 0 ? ` (incl. ${dollars(bonus)} bonus)` : ''}
              {' '}on {fmtShort(shoot.paid_at)}
              {shoot.paid_method ? ` · via ${shoot.paid_method}` : ''}
              {shoot.paid_reference ? ` · ${shoot.paid_reference}` : ''}
            </div>
          )}

          {(shoot.status === 'scheduled' || shoot.status === 'shot' || shoot.status === 'delivered') && (
            <form action={cancelShoot} style={{ margin: '16px 0 0' }}>
              <input type="hidden" name="shoot_id" value={shoot.id} />
              <PendingButton label="Cancel shoot" busyLabel="Cancelling…" style={{ ...quietCtl, color: 'var(--signal)' }} spinnerTone="ink" />
            </form>
          )}
        </div>
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
