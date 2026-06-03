'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import type { ScaFormDraft, ScaLaunchRow, PaymentVerifySignal } from '@/lib/sca-launch';
import {
  scaStripeEnvVarNames,
  scaStripeWebhookUrl,
  SCA_STRIPE_WEBHOOK_EVENTS,
} from '@/lib/sca-config';
import {
  saveScaDraft,
  openScaPr,
  refreshPreviewStatus,
  setPaymentStep,
  verifyPaymentWiring,
  goLiveSca,
  unlistSca,
  refreshScaSiteData,
  pullFromGuesty,
} from './actions';

type Props = {
  propertyId: string;
  propertyName: string;
  initialRow: ScaLaunchRow | null;
  defaults: ScaFormDraft;
  githubConfigured: boolean;
  signedIn: boolean;
};

type PreviewState = 'none' | 'pending' | 'success' | 'failure';

// ── Styles ────────────────────────────────────────────────────────────────────
const card: CSSProperties = { border: '1px solid var(--rule)', padding: '22px 24px', marginTop: 18, background: 'var(--paper)' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 11, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit' };
const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const btnBase: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.04em', padding: '10px 16px', border: '1px solid var(--ink)', cursor: 'pointer', background: 'var(--paper)', color: 'var(--ink)' };
const btnPrimary: CSSProperties = { ...btnBase, background: 'var(--ink)', color: 'var(--paper)' };
const hintStyle: CSSProperties = { fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 };
const sectionTitle: CSSProperties = { fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 4px' };

function normalize(d: Partial<ScaFormDraft>, base: ScaFormDraft): ScaFormDraft {
  const merged = { ...base, ...d } as ScaFormDraft;
  if (!Array.isArray(merged.highlights) || merged.highlights.length < 3) {
    merged.highlights = [...(merged.highlights ?? []), '', '', ''].slice(0, Math.max(3, (merged.highlights ?? []).length));
  }
  merged.extraFavorites = merged.extraFavorites ?? [];
  merged.sleepingArrangements = merged.sleepingArrangements ?? [];
  merged.reviews = merged.reviews ?? [];
  merged.stayFavorite = merged.stayFavorite ?? { name: '', town: '', blurb: '', lat: NaN, lng: NaN };
  return merged;
}

export function ScaLaunchClient(props: Props) {
  const [form, setForm] = useState<ScaFormDraft>(() => normalize(props.initialRow?.registry_entry ?? {}, props.defaults));
  const [row, setRow] = useState<ScaLaunchRow | null>(props.initialRow);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('none');
  const [verifyResult, setVerifyResult] = useState<{ signal: PaymentVerifySignal; target: string } | null>(null);
  const [guestyInfo, setGuestyInfo] = useState<{ bedrooms: number | null; bathrooms: number | null; accommodates: number | null; photos: number; amenities: number } | null>(null);
  const [, startTransition] = useTransition();
  const polling = useRef(false);

  const status = row?.status ?? 'draft';
  const prOpen = status === 'pr_open' || status === 'live' || status === 'unlisted';
  const isLive = status === 'live';
  const env = scaStripeEnvVarNames(form.stripeAccountKey || 'ACCOUNT_KEY');
  const webhookUrl = scaStripeWebhookUrl(form.stripeAccountKey || 'ACCOUNT_KEY');
  const paymentsReady = !!(row?.payment_publishable_set && row?.payment_secret_set && row?.payment_webhook_set);

  // Auto-poll the preview deploy while a PR is open and not yet resolved.
  useEffect(() => {
    if (status !== 'pr_open') return;
    if (previewState === 'success' || previewState === 'failure') return;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await refreshPreviewStatus(props.propertyId);
        if (r.ok) {
          setPreviewState(r.state);
          if (r.url) setRow((prev) => (prev ? { ...prev, preview_url: r.url } : prev));
        }
      } finally {
        polling.current = false;
      }
    };
    void tick();
    const iv = setInterval(tick, 12000);
    return () => clearInterval(iv);
  }, [status, previewState, props.propertyId]);

  function set<K extends keyof ScaFormDraft>(key: K, value: ScaFormDraft[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function errOf(path: string): string | undefined {
    return errors[path];
  }

  function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setNotice(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setNotice({ kind: 'err', text: (e as Error).message });
      } finally {
        setBusy(null);
      }
    });
  }

  const onSave = () =>
    run('save', async () => {
      const res = await saveScaDraft(props.propertyId, form);
      if (res.ok) {
        setRow(res.row);
        setNotice({ kind: 'ok', text: 'Draft saved.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Save failed' });
    });

  const onPullGuesty = () =>
    run('pull-guesty', async () => {
      if (!form.guestyListingId.trim()) {
        setNotice({ kind: 'err', text: 'Enter the Guesty listing ID first, then pull.' });
        return;
      }
      const res = await pullFromGuesty(form.guestyListingId.trim());
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error });
        return;
      }
      const p = res.prefill;
      // Fill blanks only — never clobber what the operator already typed.
      setForm((f) => ({
        ...f,
        publicName: f.publicName || p.publicName,
        tagline: f.tagline || p.tagline,
        description: f.description || p.description,
      }));
      setGuestyInfo({ bedrooms: p.bedrooms, bathrooms: p.bathrooms, accommodates: p.accommodates, photos: p.photos, amenities: p.amenities });
      setNotice({ kind: 'ok', text: `Pulled from Guesty: filled name, tagline, and About where blank. Now fill the gaps (pitch, highlights, the restaurant pick, iCal URL).` });
    });

  const onOpenPr = () =>
    run('pr', async () => {
      setErrors({});
      const res = await openScaPr(props.propertyId, form);
      if (res.ok) {
        setRow(res.row);
        setPreviewState('pending');
        setNotice({ kind: 'ok', text: 'Pull request opened. Building a preview…' });
      } else if (res.errors) {
        setErrors(res.errors);
        setNotice({ kind: 'err', text: `Can't open the PR yet — ${Object.values(res.errors).join('; ')}` });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setNotice({ kind: 'err', text: res.error ?? 'Could not open PR' });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

  const onTogglePayment = (step: 'publishable' | 'secret' | 'webhook', value: boolean) =>
    run(`pay-${step}`, async () => {
      const res = await setPaymentStep(props.propertyId, step, value);
      if (res.ok) setRow(res.row);
      else setNotice({ kind: 'err', text: res.error ?? 'Update failed' });
    });

  const onVerify = () =>
    run('verify', async () => {
      const res = await verifyPaymentWiring(props.propertyId);
      if (res.ok) {
        setVerifyResult({ signal: res.signal, target: res.target });
        setRow((prev) =>
          prev ? { ...prev, payment_verify_signal: res.signal, payment_verified_at: new Date().toISOString() } : prev,
        );
      } else setNotice({ kind: 'err', text: res.error });
    });

  const onGoLive = (override: boolean) =>
    run('golive', async () => {
      if (override && !window.confirm('Go live now, skipping the readiness checks? This merges the PR and the page goes public immediately.')) return;
      const res = await goLiveSca(props.propertyId, override);
      if (res.ok) {
        setRow(res.row);
        setNotice({ kind: 'ok', text: 'Live. The property is on staycapeann.com.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Go-live failed' });
    });

  const onUnlist = () =>
    run('unlist', async () => {
      if (!window.confirm('Open a PR to remove this listing from staycapeann.com?')) return;
      const res = await unlistSca(props.propertyId);
      if (res.ok) {
        setRow(res.row);
        setNotice({ kind: 'ok', text: 'Removal PR opened.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Unlist failed' });
    });

  const onRefreshSiteData = () =>
    run('refresh-data', async () => {
      const res = await refreshScaSiteData(props.propertyId);
      if (res.ok) setNotice({ kind: 'ok', text: 'Site-data refresh triggered. The listing page updates within a couple minutes.' });
      else setNotice({ kind: 'err', text: res.error });
    });

  return (
    <div style={{ marginTop: 8 }}>
      <StatusBar status={status} previewState={previewState} paymentsReady={paymentsReady} />

      {!props.githubConfigured && (
        <Banner kind="err">
          <strong>GITHUB_TOKEN is not set.</strong> Add a fine-grained token scoped to ryanfortsch/stay-cape-ann
          (Contents + Pull requests, read/write) to Helm&rsquo;s environment before opening a PR. Saving a draft still works.
        </Banner>
      )}
      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      {/* ── Stage 1: Content ─────────────────────────────────────────── */}
      <section style={card}>
        <div className="eyebrow">Step 1</div>
        <h2 className="font-serif" style={sectionTitle}>Listing content</h2>
        <p style={hintStyle}>
          This becomes the entry in <code style={mono}>data/ical-urls.json</code>. Editorial voice: concrete and
          place-anchored, no exclamation marks, no em dashes. Only name a restaurant that&rsquo;s on the verified list.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18 }}>
          <Field label="Guesty listing ID" error={errOf('guestyListingId')} hint="The ID of the listing in Guesty. Becomes /stays/<id>.">
            <input style={inputStyle} value={form.guestyListingId} onChange={(e) => set('guestyListingId', e.target.value)} placeholder="67a1355216416a00122e976f" />
          </Field>
          <Field label="Stripe account key" error={errOf('stripeAccountKey')} hint="Identifies this property's own Stripe account. Used for the env var names below.">
            <input style={{ ...inputStyle, ...mono }} value={form.stripeAccountKey} onChange={(e) => set('stripeAccountKey', e.target.value.toUpperCase())} placeholder="36_GRANITE" />
          </Field>
          <Field label="Public listing name" error={errOf('publicName')} hint="Guest-facing title.">
            <input style={inputStyle} value={form.publicName} onChange={(e) => set('publicName', e.target.value)} placeholder="Stay at Granite Point" />
          </Field>
          <Field label="Internal name" error={errOf('internalName')} hint="Street-address short form.">
            <input style={inputStyle} value={form.internalName} onChange={(e) => set('internalName', e.target.value)} placeholder="36 Granite" />
          </Field>
          <Field label="iCal export URL" error={errOf('icalUrl')} hint="In Guesty: Calendar → Export. Pastes as https://app.guesty.com/...">
            <input style={inputStyle} value={form.icalUrl} onChange={(e) => set('icalUrl', e.target.value)} placeholder="https://app.guesty.com/api/public/icalendar-dashboard-api/export/…" />
          </Field>
          <Field label="Display rank" error={errOf('rank')} hint="Lower sorts earlier on the site. Waterfront/beach near the top.">
            <input style={inputStyle} type="number" value={Number.isFinite(form.rank) ? form.rank : ''} onChange={(e) => set('rank', e.target.value === '' ? NaN : Number(e.target.value))} />
          </Field>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={btnBase} disabled={busy !== null || isLive} onClick={onPullGuesty}>
            {busy === 'pull-guesty' ? 'Pulling…' : 'Pull from Guesty'}
          </button>
          {guestyInfo ? (
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              Guesty has: {[
                guestyInfo.bedrooms ? `${guestyInfo.bedrooms}BR` : null,
                guestyInfo.bathrooms ? `${guestyInfo.bathrooms}BA` : null,
                guestyInfo.accommodates ? `sleeps ${guestyInfo.accommodates}` : null,
                `${guestyInfo.photos} photos`,
                `${guestyInfo.amenities} amenities`,
              ].filter(Boolean).join(' · ')}
            </span>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              Enter the Guesty listing ID, then pull name, tagline, and About into the blanks below. Start here, then fill the gaps.
            </span>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <Field label="Map pitch" error={errOf('pitch')} hint="4–8 word hook for the home-page map.">
            <input style={inputStyle} value={form.pitch} onChange={(e) => set('pitch', e.target.value)} placeholder="Waterfront on Granite Point" />
          </Field>
        </div>
        <div style={{ marginTop: 16 }}>
          <Field label="Tagline" error={errOf('tagline')} hint="8–15 words, the italic subhead on the listing page.">
            <input style={inputStyle} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="On Granite Point, with a private beach and the harbor a short walk away." />
          </Field>
        </div>
        <div style={{ marginTop: 16 }}>
          <Field label="About the home (optional)" hint="One or two short paragraphs, editorial voice. Leave blank to use Guesty's description.">
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>

        {/* Highlights */}
        <div style={{ marginTop: 20 }}>
          <span style={labelStyle}>Highlights (3+ required)</span>
          {errOf('highlights') && <FieldError>{errOf('highlights')}</FieldError>}
          {form.highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input style={inputStyle} value={h} onChange={(e) => set('highlights', form.highlights.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Highlight ${i + 1}`} />
              {form.highlights.length > 3 && (
                <button type="button" style={{ ...btnBase, padding: '0 12px' }} onClick={() => set('highlights', form.highlights.filter((_, j) => j !== i))}>×</button>
              )}
            </div>
          ))}
          <button type="button" style={{ ...btnBase, padding: '6px 12px' }} onClick={() => set('highlights', [...form.highlights, ''])}>+ Highlight</button>
        </div>

        {/* Stay favorite */}
        <div style={{ marginTop: 24 }}>
          <span style={labelStyle}>Stay favorite (one verified restaurant)</span>
          <p style={hintStyle}>The &ldquo;we&rsquo;d eat here&rdquo; pick shown on the neighborhood map. Use only a verified business.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
            <input style={inputStyle} value={form.stayFavorite.name} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, name: e.target.value })} placeholder="Restaurant name" />
            <input style={inputStyle} value={form.stayFavorite.town} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, town: e.target.value })} placeholder="Town" />
            <input style={inputStyle} inputMode="decimal" value={Number.isFinite(form.stayFavorite.lat) ? String(form.stayFavorite.lat) : ''} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, lat: e.target.value === '' ? NaN : Number(e.target.value) })} placeholder="Lat" />
            <input style={inputStyle} inputMode="decimal" value={Number.isFinite(form.stayFavorite.lng) ? String(form.stayFavorite.lng) : ''} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, lng: e.target.value === '' ? NaN : Number(e.target.value) })} placeholder="Lng" />
          </div>
          {(errOf('stayFavorite.name') || errOf('stayFavorite.town') || errOf('stayFavorite.blurb') || errOf('stayFavorite.lat') || errOf('stayFavorite.lng')) && (
            <FieldError>Restaurant needs a name, town, lat, lng, and a one-sentence blurb.</FieldError>
          )}
          <input style={{ ...inputStyle, marginTop: 8 }} value={form.stayFavorite.blurb} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, blurb: e.target.value })} placeholder="One-sentence editorial blurb" />
        </div>

        {/* Optional repeatables */}
        <Repeatable
          title="Extra dining picks (optional)"
          items={form.extraFavorites ?? []}
          onAdd={() => set('extraFavorites', [...(form.extraFavorites ?? []), { name: '', town: '', blurb: '', lat: NaN, lng: NaN }])}
          onRemove={(i) => set('extraFavorites', (form.extraFavorites ?? []).filter((_, j) => j !== i))}
          render={(f, i) => (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8 }}>
                <input style={inputStyle} value={f.name} onChange={(e) => updateAt('extraFavorites', i, { ...f, name: e.target.value })} placeholder="Name" />
                <input style={inputStyle} value={f.town} onChange={(e) => updateAt('extraFavorites', i, { ...f, town: e.target.value })} placeholder="Town" />
                <input style={inputStyle} inputMode="decimal" value={Number.isFinite(f.lat) ? String(f.lat) : ''} onChange={(e) => updateAt('extraFavorites', i, { ...f, lat: e.target.value === '' ? NaN : Number(e.target.value) })} placeholder="Lat" />
                <input style={inputStyle} inputMode="decimal" value={Number.isFinite(f.lng) ? String(f.lng) : ''} onChange={(e) => updateAt('extraFavorites', i, { ...f, lng: e.target.value === '' ? NaN : Number(e.target.value) })} placeholder="Lng" />
              </div>
              <input style={{ ...inputStyle, marginTop: 8 }} value={f.blurb} onChange={(e) => updateAt('extraFavorites', i, { ...f, blurb: e.target.value })} placeholder="Blurb" />
            </>
          )}
        />

        <Repeatable
          title="Sleeping arrangements (optional)"
          items={form.sleepingArrangements ?? []}
          onAdd={() => set('sleepingArrangements', [...(form.sleepingArrangements ?? []), { name: '', beds: '', photo: [] }])}
          onRemove={(i) => set('sleepingArrangements', (form.sleepingArrangements ?? []).filter((_, j) => j !== i))}
          render={(s, i) => (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input style={inputStyle} value={s.name ?? ''} onChange={(e) => updateAt('sleepingArrangements', i, { ...s, name: e.target.value })} placeholder="Room (e.g. Master suite)" />
                <input style={inputStyle} value={s.beds ?? ''} onChange={(e) => updateAt('sleepingArrangements', i, { ...s, beds: e.target.value })} placeholder="Beds (e.g. 2 Twins)" />
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ ...labelStyle, marginBottom: 4 }}>Bedroom photo(s) — drop them in, no naming or files</span>
                <PhotoUploader
                  value={Array.isArray(s.photo) ? s.photo : []}
                  onChange={(next) => updateAt('sleepingArrangements', i, { ...s, photo: next })}
                  folder={`sca/${props.propertyId}/bedrooms`}
                  disabled={busy !== null}
                />
              </div>
            </>
          )}
        />

        <Repeatable
          title="Curated reviews (optional)"
          items={form.reviews ?? []}
          onAdd={() => set('reviews', [...(form.reviews ?? []), { name: '', date: '', rating: 5, text: '' }])}
          onRemove={(i) => set('reviews', (form.reviews ?? []).filter((_, j) => j !== i))}
          render={(r, i) => (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                <input style={inputStyle} value={r.name} onChange={(e) => updateAt('reviews', i, { ...r, name: e.target.value })} placeholder="First name" />
                <input style={inputStyle} value={r.date} onChange={(e) => updateAt('reviews', i, { ...r, date: e.target.value })} placeholder="YYYY-MM" />
                <input style={inputStyle} type="number" min={1} max={5} value={r.rating} onChange={(e) => updateAt('reviews', i, { ...r, rating: Number(e.target.value) })} placeholder="Rating" />
              </div>
              <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 60, resize: 'vertical' }} value={r.text} onChange={(e) => updateAt('reviews', i, { ...r, text: e.target.value })} placeholder="Verbatim review text" />
            </>
          )}
        />

        {isLive ? (
          <p style={{ ...hintStyle, marginTop: 24 }}>
            This listing is live on Stay Cape Ann, so content is locked here to prevent stray edits and
            duplicate PRs. Use <strong>Unlist</strong> in Step 4 to take it down before relaunching with changes.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="button" style={btnBase} disabled={busy !== null} onClick={onSave}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            <button type="button" style={btnPrimary} disabled={busy !== null || !props.githubConfigured} onClick={onOpenPr}>
              {busy === 'pr' ? 'Opening PR…' : prOpen ? 'Update preview PR' : 'Open preview PR →'}
            </button>
          </div>
        )}
      </section>

      {/* ── Stage 2: Preview ─────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 2</div>
        <h2 className="font-serif" style={sectionTitle}>Review the preview</h2>
        {!prOpen ? (
          <p style={hintStyle}>Open the PR above to generate a live preview of the listing page.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Row label="Pull request">
              {row?.pr_url ? <a href={row.pr_url} target="_blank" rel="noreferrer" style={linkStyle}>#{row.pr_number} ↗</a> : '—'}
            </Row>
            <Row label="Preview deploy">
              <PreviewBadge state={previewState} />
              {row?.preview_url && (
                <a href={row.preview_url} target="_blank" rel="noreferrer" style={{ ...linkStyle, marginLeft: 10 }}>Open preview ↗</a>
              )}
              <button type="button" style={{ ...btnBase, padding: '4px 10px', marginLeft: 10 }} disabled={busy !== null} onClick={() => run('preview', async () => { const r = await refreshPreviewStatus(props.propertyId); if (r.ok) { setPreviewState(r.state); if (r.url) setRow((p) => (p ? { ...p, preview_url: r.url } : p)); } })}>
                Check now
              </button>
            </Row>
            <p style={hintStyle}>Open the preview and confirm the page reads right before you go live. Edit content above and click &ldquo;Update preview PR&rdquo; to revise.</p>
          </div>
        )}
      </section>

      {/* ── Stage 3: Payments ────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 3</div>
        <h2 className="font-serif" style={sectionTitle}>Wire up payments</h2>
        <p style={hintStyle}>
          This property charges through <strong>its own Stripe account</strong>. Helm never sees the secret key.
          Set these three values on the <strong>stay-cape-ann</strong> Vercel project (Production + Preview), then
          register the webhook in that Stripe account, and check each box.
        </p>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Vercel env vars (stay-cape-ann project)</span>
          <CopyLine text={env.publishable} suffix=" = pk_live_… (this property's publishable key)" />
          <CopyLine text={env.secret} suffix=" = sk_live_… or rk_live_… (secret/restricted key — Helm never sees this)" />
          <CopyLine text={env.webhookSecret} suffix=" = whsec_… (from the webhook below)" />
        </div>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Stripe webhook (in this property&rsquo;s Stripe account)</span>
          <CopyLine text={webhookUrl} />
          <p style={{ ...hintStyle, marginTop: 8 }}>Subscribe to: <span style={mono}>{SCA_STRIPE_WEBHOOK_EVENTS.join(', ')}</span>. Copy its signing secret into <span style={mono}>{env.webhookSecret}</span>.</p>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Check label={`${env.publishable} set in Vercel`} checked={!!row?.payment_publishable_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('publishable', v)} />
          <Check label={`${env.secret} set in Vercel`} checked={!!row?.payment_secret_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('secret', v)} />
          <Check label={`Webhook created + ${env.webhookSecret} set`} checked={!!row?.payment_webhook_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('webhook', v)} />
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" style={btnBase} disabled={busy !== null || !prOpen} onClick={onVerify}>{busy === 'verify' ? 'Checking…' : 'Verify wiring'}</button>
          {verifyResult && <VerifyBadge signal={verifyResult.signal} />}
          {!verifyResult && row?.payment_verify_signal && <VerifyBadge signal={row.payment_verify_signal} />}
        </div>
        <p style={hintStyle}>
          Verify reads the public booking page and checks whether a card field renders (no secret involved). Before
          go-live it probes the preview, so include <strong>Preview</strong> scope on the env vars, or re-verify against
          production after go-live.
        </p>
      </section>

      {/* ── Stage 4: Go live ─────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 4</div>
        <h2 className="font-serif" style={sectionTitle}>Go live</h2>
        {status === 'live' ? (
          <div style={{ marginTop: 8 }}>
            <Banner kind="ok">
              Live on staycapeann.com.{' '}
              {row?.live_url && <a href={row.live_url} target="_blank" rel="noreferrer" style={linkStyle}>{row.live_url} ↗</a>}
            </Banner>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" style={btnBase} disabled={busy !== null} onClick={onVerify}>{busy === 'verify' ? 'Checking…' : 'Verify payments (production)'}</button>
              <button type="button" style={btnBase} disabled={busy !== null} onClick={onRefreshSiteData}>{busy === 'refresh-data' ? 'Triggering…' : 'Refresh site data'}</button>
              <button type="button" style={{ ...btnBase, borderColor: 'var(--negative)', color: 'var(--negative)' }} disabled={busy !== null} onClick={onUnlist}>Unlist…</button>
            </div>
            <p style={hintStyle}>The listing page is built from Guesty&rsquo;s snapshot, which go-live refreshes automatically (takes a couple minutes after merge). If the page or its photos look stale, click <strong>Refresh site data</strong>; it also self-heals on the nightly refresh.</p>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p style={hintStyle}>
              Going live squash-merges the PR; the build picks up the new listing and the page is public within a couple
              minutes. Enabled once the three payment boxes are checked — open and review the preview above first.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...btnPrimary, opacity: paymentsReady ? 1 : 0.5 }}
                disabled={busy !== null || !prOpen || !paymentsReady}
                onClick={() => onGoLive(false)}
              >
                {busy === 'golive' ? 'Merging…' : 'Approve & go live →'}
              </button>
              <button type="button" style={{ ...btnBase, fontSize: 11 }} disabled={busy !== null || !prOpen} onClick={() => onGoLive(true)}>
                Force go-live…
              </button>
              {previewState === 'failure' && (
                <span style={{ fontSize: 12, color: 'var(--negative)' }}>
                  The preview build reported a failure — open it above before going live.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );

  function updateAt<K extends 'extraFavorites' | 'sleepingArrangements' | 'reviews'>(
    key: K,
    index: number,
    value: NonNullable<ScaFormDraft[K]>[number],
  ) {
    setForm((f) => {
      const arr = [...((f[key] as unknown[]) ?? [])];
      arr[index] = value;
      return { ...f, [key]: arr } as ScaFormDraft;
    });
  }
}

// ── Small presentational helpers ──────────────────────────────────────────────
const linkStyle: CSSProperties = { color: 'var(--tide-deep)', textDecoration: 'underline', fontSize: 13 };

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <p style={hintStyle}>{hint}</p> : null}
    </div>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 11.5, color: 'var(--negative)', marginTop: 4 }}>{children}</p>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
      <span style={{ ...labelStyle, marginBottom: 0, width: 130, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Banner({ kind, children }: { kind: 'ok' | 'err'; children: ReactNode }) {
  const color = kind === 'ok' ? 'var(--positive)' : 'var(--negative)';
  return (
    <div style={{ marginTop: 14, padding: '11px 14px', border: `1px solid ${color}`, color, fontSize: 13, lineHeight: 1.5, background: 'var(--paper)' }}>
      {children}
    </div>
  );
}

function StatusBar({ status, previewState, paymentsReady }: { status: string; previewState: PreviewState; paymentsReady: boolean }) {
  const labels: Record<string, string> = { draft: 'Draft', pr_open: 'PR open', live: 'Live', unlisted: 'Unlisted' };
  const color = status === 'live' ? 'var(--positive)' : status === 'pr_open' ? 'var(--tide-deep)' : 'var(--ink-3)';
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
      <span style={{ fontWeight: 700, color, letterSpacing: '.06em', textTransform: 'uppercase' }}>{labels[status] ?? status}</span>
      {status === 'pr_open' && <span>Preview: <PreviewBadge state={previewState} inline /></span>}
      {status === 'pr_open' && <span>Payments: {paymentsReady ? 'ready' : 'incomplete'}</span>}
    </div>
  );
}

function PreviewBadge({ state, inline }: { state: PreviewState; inline?: boolean }) {
  const map: Record<PreviewState, { t: string; c: string }> = {
    none: { t: 'no deploy yet', c: 'var(--ink-3)' },
    pending: { t: 'building…', c: 'var(--tide-deep)' },
    success: { t: 'ready', c: 'var(--positive)' },
    failure: { t: 'failed', c: 'var(--negative)' },
  };
  const { t, c } = map[state];
  return <span style={{ color: c, fontWeight: 600, fontSize: inline ? 12 : 13 }}>{t}</span>;
}

function VerifyBadge({ signal }: { signal: PaymentVerifySignal }) {
  const map: Record<PaymentVerifySignal, { t: string; c: string }> = {
    wired: { t: '✓ card field renders — payments wired', c: 'var(--positive)' },
    demo_mode: { t: '✗ still in demo mode — publishable key not picked up', c: 'var(--negative)' },
    unknown: { t: 'inconclusive — open the preview manually', c: 'var(--ink-3)' },
  };
  const { t, c } = map[signal];
  return <span style={{ color: c, fontSize: 12.5, fontWeight: 600 }}>{t}</span>;
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink)', cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />
      <span style={mono}>{label}</span>
    </label>
  );
}

function CopyLine({ text, suffix }: { text: string; suffix?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <code style={{ ...mono, fontSize: 12.5, background: 'var(--paper-2, rgba(0,0,0,0.03))', padding: '4px 8px', border: '1px solid var(--rule)' }}>{text}</code>
      <button
        type="button"
        style={{ ...btnBase, padding: '3px 9px', fontSize: 11 }}
        onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      {suffix && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{suffix}</span>}
    </div>
  );
}

function Repeatable<T>({
  title,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  items: T[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (item: T, i: number) => ReactNode;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <span style={labelStyle}>{title}</span>
      {items.map((item, i) => (
        <div key={i} style={{ border: '1px solid var(--rule)', padding: 12, marginBottom: 8, position: 'relative' }}>
          {render(item, i)}
          <button type="button" style={{ ...btnBase, padding: '3px 9px', fontSize: 11, marginTop: 8 }} onClick={() => onRemove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" style={{ ...btnBase, padding: '6px 12px' }} onClick={onAdd}>+ Add</button>
    </div>
  );
}
