'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { useConfirm, type AskOptions } from '@/components/ConfirmDialog';
import { scaDraftPreviewSignature, describeScaErrors, needsFavoritePins, type ScaFormDraft, type ScaLaunchRow, type PaymentVerifySignal } from '@/lib/sca-launch';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import {
  scaStripeEnvVarNames,
  scaStripeWebhookUrl,
  SCA_STRIPE_KEY_PERMISSIONS,
  HELM_STRIPE_KEY_PERMISSIONS,
  helmStripeKeyEnvName,
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
  draftScaCopyWithAi,
  openScaUpdatePr,
  publishScaUpdate,
  adoptLiveScaListing,
  fillScaFavoritePins,
} from './actions';
import { etStamp } from '@/lib/stable-time';
import { listingCopyNotes } from '@/lib/sca-copy-notes';
import { findRestaurant, restaurantChoices, restaurantKey, type ScaRestaurant } from '@/lib/sca-restaurants';

type Props = {
  propertyId: string;
  propertyName: string;
  initialRow: ScaLaunchRow | null;
  defaults: ScaFormDraft;
  githubConfigured: boolean;
  signedIn: boolean;
  /**
   * Owners see the whole launcher. Staff see the listing content and the
   * preview (Steps 1 and 2) and one line for payments: the Stripe wiring,
   * the payment probe, go-live, Force go-live and Unlist are owner acts,
   * and their server actions refuse a staff session.
   */
  isOwner: boolean;
  /**
   * The listing as it reads on staycapeann.com now, from the live registry
   * entry. A live listing opens on this rather than on its saved draft: the
   * retired fleet tools (Bedroom photos, Listing Copy Studio) wrote the
   * registry directly, so a saved draft can be older than the live page.
   */
  liveDraft?: ScaFormDraft | null;
  /** On staycapeann.com but with no launch record in Helm: offer to open it here. */
  adoptable?: boolean;
  /** Whether Helm's own key for this home (STRIPE_KEY_<ID>) is set on Helm. Owners only; undefined = unknown. */
  helmStripeKeySet?: boolean;
  /** The restaurant dropdown: verified picks plus every live listing's, each with its pin. */
  restaurants?: ScaRestaurant[];
};

const newRoomKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `room-${Math.random().toString(36).slice(2)}`;

/** Where the form starts: the live entry for a live listing with no update in flight, else the saved draft. */
function startingForm(props: Props): { form: ScaFormDraft; fromLive: boolean } {
  const row = props.initialRow;
  const pendingUpdate = row?.status === 'live' && (row.branch_name?.startsWith('sca-update/') ?? false);
  if (props.liveDraft && row?.status === 'live' && !pendingUpdate) {
    return { form: normalize(props.liveDraft, props.defaults), fromLive: true };
  }
  return { form: normalize(row?.registry_entry ?? {}, props.defaults), fromLive: false };
}

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
  const [start] = useState(() => startingForm(props));
  const [form, setForm] = useState<ScaFormDraft>(start.form);
  const [restaurants] = useState(() => props.restaurants ?? restaurantChoices(null));
  const [row, setRow] = useState<ScaLaunchRow | null>(props.initialRow);
  // A stable identity per bedroom, so removing an earlier room never hands a
  // later room's upload (or failed upload) to its neighbour. Editor-only:
  // never saved, never in the registry.
  const [roomKeys, setRoomKeys] = useState<string[]>(() => (start.form.sleepingArrangements ?? []).map(newRoomKey));
  const [failedSlots, setFailedSlots] = useState<Set<string>>(() => new Set());
  // The saved draft, when the form opened on the live listing and the two differ.
  const [savedDraftAside, setSavedDraftAside] = useState<ScaFormDraft | null>(() => {
    if (!start.fromLive || !props.initialRow?.registry_entry) return null;
    const saved = normalize(props.initialRow.registry_entry, props.defaults);
    return JSON.stringify(saved) === JSON.stringify(start.form) ? null : saved;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [savedForm, setSavedForm] = useState(() => JSON.stringify(form));
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(() => new Set());
  const [previewState, setPreviewState] = useState<PreviewState>('none');
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ signal: PaymentVerifySignal; target: string } | null>(null);
  const [aiBrief, setAiBrief] = useState('');
  const [guestyInfo, setGuestyInfo] = useState<{ bedrooms: number | null; bathrooms: number | null; accommodates: number | null; photos: number; amenities: number } | null>(null);
  const [, startTransition] = useTransition();
  const { ask, choose } = useConfirm();
  const noticeRef = useRef<HTMLDivElement | null>(null);

  // The notice banner renders at the top of a long form, but the buttons that
  // set it (Save draft / Open preview PR) sit at the bottom, so an error landed
  // silently above the fold and the flow just looked dead (84 Thatcher launch,
  // 2026-07-20). Whenever the notice changes, bring it into view.
  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [notice]);

  const status = row?.status ?? 'draft';
  const prOpen = status === 'pr_open' || status === 'live' || status === 'unlisted';
  const isLive = status === 'live';
  // A live listing with an open update PR (copy edited post-launch, awaiting publish).
  const hasPendingUpdate = isLive && (row?.branch_name?.startsWith('sca-update/') ?? false);
  const hasContentPreview = status === 'pr_open' || hasPendingUpdate;
  const dirty = JSON.stringify(form) !== savedForm;
  const blocked = busy !== null || uploadingSlots.size > 0;
  // A failed bedroom upload keeps the editor open (its Retry and Remove must
  // work) but nothing saves or publishes until it is retried or removed.
  const failedUploads = failedSlots.size > 0;
  // What the retired Listing Copy Studio flagged, live as the copy changes.
  const copyNotes = listingCopyNotes(form);
  const previewMatches = previewSignature !== null && scaDraftPreviewSignature(form) === previewSignature;
  useUnsavedWorkGuard(dirty || blocked || failedUploads);
  const env = scaStripeEnvVarNames(form.stripeAccountKey || 'ACCOUNT_KEY');
  const webhookUrl = scaStripeWebhookUrl(form.stripeAccountKey || 'ACCOUNT_KEY');
  const paymentsReady = !!(row?.payment_publishable_set && row?.payment_secret_set && row?.payment_webhook_set);
  // What staff are told about payments: wired once the three wiring boxes are
  // ticked, unless the last probe found the booking page in demo mode
  // (bookings that collect nothing, 84 Thatcher).
  // An adopted listing has no ticked boxes, so a passing probe counts too.
  const paymentsWired = (paymentsReady || row?.payment_verify_signal === 'wired') && row?.payment_verify_signal !== 'demo_mode';

  // Auto-poll the preview deploy while a PR is open and not yet resolved.
  useEffect(() => {
    if (!hasContentPreview || blocked) return;
    let cancelled = false;
    let polling = false;
    let complete = false;
    const tick = async () => {
      if (polling || complete) return;
      polling = true;
      try {
        const r = await refreshPreviewStatus(props.propertyId);
        if (cancelled) return;
        if (r.ok) {
          setPreviewState(r.state);
          setPreviewSignature(r.signature);
          setPreviewError(r.hint ?? null);
          setRow((prev) => (prev ? { ...prev, preview_url: r.url } : prev));
          complete = r.state === 'success' || r.state === 'failure';
        } else {
          setPreviewSignature(null);
          setPreviewError(r.error);
        }
      } catch {
        if (!cancelled) {
          setPreviewSignature(null);
          setPreviewError('Could not check the preview. Retrying automatically; you can also use Check now.');
        }
      } finally {
        polling = false;
      }
    };
    void tick();
    const iv = setInterval(tick, 12000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [hasContentPreview, blocked, row?.branch_name, props.propertyId]);

  function set<K extends keyof ScaFormDraft>(key: K, value: ScaFormDraft[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  /** Swap the whole form (the live listing, a saved draft); `saved` when it is what the database holds. */
  function replaceForm(next: ScaFormDraft, saved: boolean) {
    setForm(next);
    setRoomKeys((next.sleepingArrangements ?? []).map(newRoomKey));
    setUploadingSlots(new Set());
    setFailedSlots(new Set());
    if (saved) setSavedForm(JSON.stringify(next));
  }
  function addRoom() {
    set('sleepingArrangements', [...(form.sleepingArrangements ?? []), { name: '', beds: '', photo: [] }]);
    setRoomKeys((keys) => [...keys, newRoomKey()]);
  }
  async function removeRoom(i: number) {
    const key = roomKeys[i];
    if (key && uploadingSlots.has(key)) return;
    if (key && failedSlots.has(key) && !(await ask({
      title: 'Remove this bedroom and its failed uploads?',
      body: 'The photos that did not upload are dropped with it.',
      confirmLabel: 'Remove bedroom',
      tone: 'danger',
    }))) return;
    setFailedSlots((prev) => {
      if (!key || !prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    set('sleepingArrangements', (form.sleepingArrangements ?? []).filter((_, j) => j !== i));
    setRoomKeys((keys) => keys.filter((_, j) => j !== i));
  }
  function setRoomFlag(setter: typeof setUploadingSlots, key: string, on: boolean) {
    setter((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  function errOf(path: string): string | undefined {
    return errors[path];
  }

  function run(name: string, fn: () => Promise<void>) {
    if (busyRef.current || uploadingSlots.size > 0) return;
    busyRef.current = true;
    setBusy(name);
    setNotice(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setNotice({ kind: 'err', text: (e as Error).message });
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    });
  }

  /** Ask first, and only then mark the button busy and run. */
  function runAfterYes(name: string, question: AskOptions, fn: () => Promise<void>) {
    if (busyRef.current || uploadingSlots.size > 0) return;
    void ask(question).then((yes) => { if (yes) run(name, fn); });
  }

  const onSave = () =>
    run('save', async () => {
      const res = await saveScaDraft(props.propertyId, form);
      if (res.ok) {
        setRow(res.row);
        setSavedForm(JSON.stringify(form));
        // A successful save invalidates any field errors left from an earlier
        // failed PR attempt. Leaving them up made the form read as still-broken
        // ("Draft saved." banner + a red iCal error from ten minutes ago), and
        // the operator reasonably concluded the launch flow was busted.
        setErrors({});
        setNotice({ kind: 'ok', text: 'Draft saved.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Save failed' });
    });

  const onPullGuesty = () =>
    run('pull-guesty', async () => {
      if (!form.guestyListingId.trim()) {
        setNotice({ kind: 'err', text: 'Enter the Guesty listing ID first, then pull.' });
        return;
      }
      const res = await pullFromGuesty(props.propertyId, form.guestyListingId.trim());
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error });
        return;
      }
      const p = res.prefill;
      // If the form already holds copy, this is a re-pull (e.g. Guesty changed
      // and we want it reflected). Offer to overwrite; otherwise fill blanks
      // only so we never clobber typed copy by accident.
      const hasExistingCopy = !!(
        form.pitch?.trim() ||
        form.tagline?.trim() ||
        form.description?.trim() ||
        form.publicName?.trim() ||
        form.highlights.some((h) => h.trim())
      );
      const pick = hasExistingCopy
        ? await choose({
            title: 'Replace the listing copy with the Guesty copy?',
            body: 'Replace overwrites the tagline, About and highlights (and the dining pick) with what the OTA listing shows now. Fill blanks only keeps your copy.',
            choices: [
              { value: 'replace', label: 'Replace with Guesty copy' },
              { value: 'fill', label: 'Fill blanks only' },
            ],
          })
        : 'fill';
      if (pick === null) return;
      const overwrite = pick === 'replace';
      setForm((f) => {
        // overwrite: take the new value but keep the old if Guesty returned
        // empty. blanks-only: keep the old value, fill in only when empty.
        const merge = (cur: string, next: string) => (overwrite ? next || cur : cur || next);
        const operatorHasHighlights = f.highlights.some((h) => h.trim());
        const padded = [...p.highlights, '', '', ''].slice(0, Math.max(3, p.highlights.length));
        const nextHighlights = overwrite
          ? p.highlights.length
            ? padded
            : f.highlights
          : operatorHasHighlights || p.highlights.length === 0
            ? f.highlights
            : padded;
        const favBlank = !f.stayFavorite?.name?.trim();
        const nextFavorite = (overwrite || favBlank) && p.stayFavorite ? { ...p.stayFavorite } : f.stayFavorite;
        return {
          ...f,
          publicName: merge(f.publicName, p.publicName),
          pitch: merge(f.pitch, p.pitch),
          tagline: merge(f.tagline, p.tagline),
          description: merge(f.description ?? '', p.description),
          highlights: nextHighlights,
          stayFavorite: nextFavorite,
        };
      });
      setGuestyInfo({ bedrooms: p.bedrooms, bathrooms: p.bathrooms, accommodates: p.accommodates, photos: p.photos, amenities: p.amenities });
      setNotice({
        kind: 'ok',
        text: overwrite
          ? 'Re-pulled the Guesty copy verbatim (Stay Cape Ann breadcrumb lines stripped), replacing the previous copy. Review it, then preview the changes.'
          : 'Pulled the Guesty copy verbatim, minus the Stay Cape Ann breadcrumb lines. Type the short map pitch, check the restaurant, then add the iCal URL.',
      });
    });

  // Draft with AI: new copy in the Stay Cape Ann voice, where Pull from Guesty
  // copies the OTA listing as it reads. Same fill rule as the pull: replace
  // only on a yes, otherwise fill the blank fields and keep typed copy.
  const onDraftAi = async () => {
    if (busyRef.current || uploadingSlots.size > 0) return;
    const hasCopy = !!(form.tagline?.trim() || form.description?.trim() || form.highlights.some((h) => h.trim()));
    const allFilled = !!(form.pitch?.trim() && form.tagline?.trim() && form.description?.trim() && form.highlights.some((h) => h.trim()));
    const pick = hasCopy
      ? await choose({
          title: 'Replace the tagline, About and highlights with a new AI draft?',
          body: allFilled
            ? 'Every field already has copy, so Keep my copy changes nothing.'
            : 'Fill blanks only keeps your copy and drafts just the empty fields.',
          choices: [
            { value: 'replace', label: 'Replace with AI draft' },
            ...(allFilled ? [] : [{ value: 'fill' as const, label: 'Fill blanks only' }]),
          ],
          cancelLabel: allFilled ? 'Keep my copy' : 'Cancel',
        })
      : 'fill';
    if (pick === null) return;
    const overwrite = pick === 'replace';
    run('draft-ai', async () => {
      const res = await draftScaCopyWithAi(props.propertyId, aiBrief);
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error });
        return;
      }
      const d = res.draft;
      setForm((f) => {
        const merge = (cur: string, next: string) => (overwrite ? next || cur : cur || next);
        const operatorHasHighlights = f.highlights.some((h) => h.trim());
        const padded = [...d.highlights, '', '', ''].slice(0, Math.max(3, d.highlights.length));
        return {
          ...f,
          pitch: f.pitch?.trim() ? f.pitch : d.pitch,
          tagline: merge(f.tagline, d.tagline),
          description: merge(f.description ?? '', d.description),
          highlights: d.highlights.length && (overwrite || !operatorHasHighlights) ? padded : f.highlights,
        };
      });
      const source = d.photos ? `the property record and ${d.photos} Listing photo${d.photos === 1 ? '' : 's'}` : 'the property record';
      setNotice({ kind: 'ok', text: `Drafted from ${source}. Review it, then Save draft.` });
    });
  };

  const onAdopt = () =>
    run('adopt', async () => {
      const res = await adoptLiveScaListing(props.propertyId);
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error ?? 'Could not open the live listing' });
        return;
      }
      setRow(res.row);
      replaceForm(normalize(res.row.registry_entry ?? {}, props.defaults), true);
      setSavedDraftAside(null);
      setNotice({ kind: 'ok', text: 'This is the live listing. Edit it here, preview the changes, then Publish.' });
    });

  // A restaurant with a name and town but no pin is looked up first, and the
  // form takes the pins, so what the PR builds is what the page shows.
  const withFavoritePins = async (draft: ScaFormDraft): Promise<ScaFormDraft> => {
    if (!needsFavoritePins(draft)) return draft;
    const filled = await fillScaFavoritePins(draft);
    if (filled !== draft) setForm(filled);
    return filled;
  };

  const onOpenPr = () =>
    run('pr', async () => {
      setPreviewSignature(null);
      setPreviewError(null);
      setErrors({});
      const ready = await withFavoritePins(form);
      const res = await openScaPr(props.propertyId, ready);
      if (res.ok) {
        setRow(res.row);
        setSavedForm(JSON.stringify(ready));
        setPreviewSignature(scaDraftPreviewSignature(ready));
        setPreviewState('pending');
        setNotice({ kind: 'ok', text: 'Pull request opened. Building a preview…' });
      } else if (res.errors) {
        setErrors(res.errors);
        setNotice({ kind: 'err', text: `Can't open the PR yet: ${describeScaErrors(res.errors)}` });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setNotice({ kind: 'err', text: res.error ?? 'Could not open PR' });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

  const onUpdateLive = () =>
    run('update', async () => {
      setPreviewSignature(null);
      setPreviewError(null);
      setErrors({});
      const ready = await withFavoritePins(form);
      const res = await openScaUpdatePr(props.propertyId, ready);
      if (res.ok) {
        setRow(res.row);
        setSavedForm(JSON.stringify(ready));
        setPreviewSignature(scaDraftPreviewSignature(ready));
        setPreviewState('pending');
        setNotice({ kind: 'ok', text: 'Preview opened. The listing stays live until you publish. Review the preview, then Publish.' });
      } else if (res.errors) {
        setErrors(res.errors);
        setNotice({ kind: 'err', text: `Can't preview the changes yet: ${describeScaErrors(res.errors)}` });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setNotice({ kind: 'err', text: res.error ?? 'Could not open the preview' });
      }
    });

  const onPublishUpdate = () => {
    if (!previewMatches) return;
    runAfterYes('publish', {
      title: 'Publish these changes?',
      body: 'Guests see them on staycapeann.com within a couple minutes.',
      confirmLabel: 'Publish',
    }, async () => {
      const res = await publishScaUpdate(props.propertyId, form);
      if (res.ok) {
        setRow(res.row);
        setPreviewState('none');
        setNotice({ kind: 'ok', text: 'Published. The live page refreshes within a couple minutes.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Publish failed' });
    });
  };

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

  const onGoLive = (override: boolean) => {
    if (!previewMatches) return;
    const goLive = async () => {
      const res = await goLiveSca(props.propertyId, override, form);
      if (res.ok) {
        setRow(res.row);
        setNotice({ kind: 'ok', text: 'Live. The property is on staycapeann.com.' });
      } else setNotice({ kind: 'err', text: res.error ?? 'Go-live failed' });
    };
    if (!override) { run('golive', goLive); return; }
    runAfterYes('golive', {
      title: 'Go live now, skipping the readiness checks?',
      body: 'This merges the PR and the page goes public on staycapeann.com immediately, even with the payment checklist unticked.',
      confirmLabel: 'Go live now',
      tone: 'danger',
    }, goLive);
  };

  const onUnlist = () =>
    runAfterYes('unlist', {
      title: 'Remove this listing from staycapeann.com?',
      body: 'This opens a PR that takes the page off the site. The page stays up until that PR is merged.',
      confirmLabel: 'Open removal PR',
      tone: 'danger',
    }, async () => {
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

  // On staycapeann.com with no launch record in Helm (listed before Helm
  // tracked launches, or by hand): open the live listing here first, so an
  // edit starts from what guests see and never re-launches the home.
  if (props.adoptable && (!row || row.status === 'draft')) {
    return (
      <div style={{ marginTop: 8 }}>
        {notice && (
          <div ref={noticeRef}>
            <Banner kind={notice.kind}>{notice.text}</Banner>
          </div>
        )}
        <section style={card}>
          <div className="eyebrow">Live on staycapeann.com</div>
          <h2 className="font-serif" style={sectionTitle}>{props.propertyName} is already on the site</h2>
          <p style={hintStyle}>
            Helm has no launch record for it yet{row?.status === 'draft' ? ', only an unlaunched draft, which this replaces' : ''}. Open the live
            listing to edit its copy and bedroom photos here.
          </p>
          <div style={{ marginTop: 14 }}>
            <button type="button" style={btnPrimary} disabled={busy !== null} onClick={onAdopt}>
              {busy === 'adopt' ? 'Opening…' : 'Open the live listing'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <StatusBar status={status} previewState={previewState} paymentsReady={paymentsReady} />

      {!props.githubConfigured && (
        <Banner kind="err">
          <strong>GITHUB_TOKEN is not set.</strong> Add a fine-grained token scoped to ryanfortsch/stay-cape-ann
          (Contents, Pull requests, and Actions read/write; Checks and Deployments read for preview status) to
          Helm&rsquo;s environment before opening a PR. Saving a draft still works.
        </Banner>
      )}
      {notice && (
        <div ref={noticeRef}>
          <Banner kind={notice.kind}>{notice.text}</Banner>
        </div>
      )}

      {/* ── Stage 1: Content ─────────────────────────────────────────── */}
      <fieldset disabled={blocked} style={{ ...card, minWidth: 0 }}>
        <div className="eyebrow">Step 1</div>
        <h2 className="font-serif" style={sectionTitle}>Listing content</h2>
        <p style={hintStyle}>
          This becomes the entry in <code style={mono}>data/ical-urls.json</code>. Editorial voice: concrete and
          place-anchored, no exclamation marks, no em dashes. Only name a restaurant that&rsquo;s on the verified list.
        </p>
        <p role="status" style={hintStyle}>
          {dirty ? 'Unsaved changes. Save your draft before leaving.' : 'No unsaved changes.'}
          {uploadingSlots.size > 0 ? ' Wait for the photo upload to finish before saving.' : ''}
          {failedUploads ? ' Retry or remove the failed bedroom uploads before saving.' : ''}
        </p>
        {savedDraftAside && (
          <p role="status" style={{ ...hintStyle, color: 'var(--ink)' }}>
            This form shows the listing as it reads on staycapeann.com. A draft saved here earlier differs from it.{' '}
            <button
              type="button"
              style={{ ...btnBase, padding: '3px 9px', fontSize: 11 }}
              onClick={async () => {
                if (dirty && !(await ask({
                  title: 'Replace your edits with the saved draft?',
                  body: 'What you typed since opening this page is dropped.',
                  confirmLabel: 'Use the saved draft',
                }))) return;
                replaceForm(savedDraftAside, true);
                setSavedDraftAside(null);
              }}
            >
              Use the saved draft
            </button>
          </p>
        )}

        {/* One column on a phone, two from 640px. The Stripe account key used
            to sit here beside the Guesty id; it names payment keys, so it
            moved to the owners' Step 3. */}
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 16, marginTop: 18 }}>
          <Field label="Guesty listing ID" error={errOf('guestyListingId')} hint="The ID of the listing in Guesty. Becomes /stays/<id>.">
            <input style={inputStyle} value={form.guestyListingId} onChange={(e) => set('guestyListingId', e.target.value)} placeholder="67a1355216416a00122e976f" />
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
          <button type="button" style={btnBase} disabled={busy !== null} onClick={onPullGuesty}>
            {busy === 'pull-guesty' ? 'Pulling from Guesty…' : 'Pull from Guesty'}
          </button>
          <button type="button" style={btnBase} disabled={busy !== null} onClick={onDraftAi}>
            {busy === 'draft-ai' ? 'Drafting…' : 'Draft with AI'}
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
              Pull from Guesty copies the Airbnb listing as it reads, minus the Stay Cape Ann lines, and picks a nearby restaurant. Draft with AI writes new copy from the property record and its Listing photos.
            </span>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <input
            style={inputStyle}
            value={aiBrief}
            maxLength={2000}
            onChange={(e) => setAiBrief(e.target.value)}
            placeholder="For Draft with AI (optional): what makes it special, e.g. the view at low tide"
            aria-label="Note for Draft with AI"
          />
        </div>

 {copyNotes.length > 0 && (form.tagline?.trim() || form.description?.trim()) && (
          <p role="status" style={{ ...hintStyle, color: 'var(--signal)' }}>Copy to review: {copyNotes.join(', ')}.</p>
        )}
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
          <p style={hintStyle}>The &ldquo;we&rsquo;d eat here&rdquo; pick shown on the neighborhood map. The list is every restaurant already on Stay Cape Ann, pinned. Use &ldquo;Another restaurant&rdquo; only for a verified business; Helm puts it on the map.</p>
          <div style={{ marginTop: 8 }}>
            <RestaurantPicker value={form.stayFavorite} choices={restaurants} onChange={(f) => set('stayFavorite', f)} />
          </div>
          {(errOf('stayFavorite.name') || errOf('stayFavorite.town') || errOf('stayFavorite.blurb') || errOf('stayFavorite.lat') || errOf('stayFavorite.lng')) && (
            <FieldError>
              {errOf('stayFavorite.lat') || errOf('stayFavorite.lng')
                ? 'Helm could not find that restaurant on the map. Pick one from the list, or check the name and town.'
                : 'Pick a restaurant and write a one-sentence blurb.'}
            </FieldError>
          )}
          <input style={{ ...inputStyle, marginTop: 8 }} value={form.stayFavorite.blurb} onChange={(e) => set('stayFavorite', { ...form.stayFavorite, blurb: e.target.value })} placeholder={blurbPlaceholder(restaurants, form.stayFavorite)} />
        </div>

        {/* Optional repeatables */}
        <Repeatable
          title="Extra dining picks (optional)"
          items={form.extraFavorites ?? []}
          onAdd={() => set('extraFavorites', [...(form.extraFavorites ?? []), { name: '', town: '', blurb: '', lat: NaN, lng: NaN }])}
          onRemove={(i) => set('extraFavorites', (form.extraFavorites ?? []).filter((_, j) => j !== i))}
          render={(f, i) => (
            <>
              <RestaurantPicker value={f} choices={restaurants} onChange={(next) => updateAt('extraFavorites', i, next)} />
              <input style={{ ...inputStyle, marginTop: 8 }} value={f.blurb} onChange={(e) => updateAt('extraFavorites', i, { ...f, blurb: e.target.value })} placeholder={blurbPlaceholder(restaurants, f)} />
            </>
          )}
        />

        <Repeatable
          id="sleeping"
          title="Sleeping arrangements and bedroom photos (optional)"
          items={form.sleepingArrangements ?? []}
          keys={roomKeys}
          onAdd={addRoom}
          onRemove={removeRoom}
          render={(s, i) => (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8 }}>
                <input style={inputStyle} value={s.name ?? ''} onChange={(e) => updateAt('sleepingArrangements', i, { ...s, name: e.target.value })} placeholder="Room (e.g. Master suite)" />
                <input style={inputStyle} value={s.beds ?? ''} onChange={(e) => updateAt('sleepingArrangements', i, { ...s, beds: e.target.value })} placeholder="Beds (e.g. 2 Twins)" />
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ ...labelStyle, marginBottom: 4 }}>Bedroom photos: drop them in, no naming or files</span>
                <PhotoUploader
                  value={Array.isArray(s.photo) ? s.photo : []}
                  onChange={(next) => updateAt('sleepingArrangements', i, { ...s, photo: next })}
                  folder={`sca/${props.propertyId}/bedrooms`}
                  disabled={blocked}
                  onUploadingChange={(uploading) => { if (roomKeys[i]) setRoomFlag(setUploadingSlots, roomKeys[i], uploading); }}
                  onFailedUploadsChange={(count) => { if (roomKeys[i]) setRoomFlag(setFailedSlots, roomKeys[i], count > 0); }}
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
              <div className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr]" style={{ gap: 8 }}>
                <input className="col-span-2 sm:col-span-1" style={inputStyle} value={r.name} onChange={(e) => updateAt('reviews', i, { ...r, name: e.target.value })} placeholder="First name" />
                <input style={inputStyle} value={r.date} onChange={(e) => updateAt('reviews', i, { ...r, date: e.target.value })} placeholder="YYYY-MM" />
                <input style={inputStyle} type="number" min={1} max={5} value={r.rating} onChange={(e) => updateAt('reviews', i, { ...r, rating: Number(e.target.value) })} placeholder="Rating" />
              </div>
              <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 60, resize: 'vertical' }} value={r.text} onChange={(e) => updateAt('reviews', i, { ...r, text: e.target.value })} placeholder="Verbatim review text" />
            </>
          )}
        />

        {isLive ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
            <p style={hintStyle}>
              This listing is live. Edit it above (or <strong>Pull from Guesty</strong> to refresh it from the source of
              truth), then preview the changes. The live page keeps serving the current listing until you publish.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" style={btnBase} disabled={busy !== null || failedUploads} onClick={onSave}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
              <button type="button" style={btnPrimary} disabled={busy !== null || failedUploads || !props.githubConfigured} onClick={onUpdateLive}>
                {busy === 'update' ? 'Opening the preview…' : hasPendingUpdate ? 'Refresh the preview' : 'Preview changes →'}
              </button>
              {hasPendingUpdate && (
                <>
                  {row?.pr_url && <a href={row.pr_url} target="_blank" rel="noreferrer" style={linkStyle}>Pull request ↗</a>}
                  <button type="button" style={btnBase} disabled={blocked || failedUploads || !previewMatches} onClick={onPublishUpdate}>
                    {busy === 'publish' ? 'Publishing…' : 'Publish'}
                  </button>
                </>
              )}
            </div>
            {hasPendingUpdate && (
              <p style={hintStyle}>Review it in Step 2 (open the preview), then <strong>Publish</strong> to update the live page.</p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <button type="button" style={btnBase} disabled={busy !== null || failedUploads} onClick={onSave}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            <button type="button" style={btnPrimary} disabled={busy !== null || failedUploads || !props.githubConfigured} onClick={onOpenPr}>
              {busy === 'pr' ? 'Opening PR…' : prOpen ? 'Update preview PR' : 'Open preview PR →'}
            </button>
          </div>
        )}
      </fieldset>

      {/* ── Stage 2: Preview ─────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 2</div>
        <h2 className="font-serif" style={sectionTitle}>Review the preview</h2>
        {!prOpen ? (
          <p style={hintStyle}>Open the PR above to generate a live preview of the listing page.</p>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Row label="Pull request">
              {row?.pr_url ? <a href={row.pr_url} target="_blank" rel="noreferrer" style={linkStyle}>#{row.pr_number} ↗</a> : 'none yet'}
            </Row>
            <Row label="Preview deploy">
              <PreviewBadge state={previewState} />
              {row?.preview_url && (
                <a href={row.preview_url} target="_blank" rel="noreferrer" style={{ ...linkStyle, marginLeft: 10 }}>Open preview ↗</a>
              )}
              <button
                type="button"
                style={{ ...btnBase, padding: '4px 10px', marginLeft: 10 }}
                disabled={blocked}
                onClick={() =>
                  run('preview', async () => {
                    const r = await refreshPreviewStatus(props.propertyId);
                    if (!r.ok) {
                      setPreviewSignature(null);
                      setPreviewError(r.error);
                      setNotice({ kind: 'err', text: r.error });
                      return;
                    }
                    setPreviewState(r.state);
                    setPreviewSignature(r.signature);
                    setPreviewError(r.hint ?? null);
                    setRow((p) => (p ? { ...p, preview_url: r.url } : p));
                    if (r.state === 'success') {
                      setNotice({ kind: 'ok', text: 'Preview is ready. Open it to review the page.' });
                    } else if (r.state === 'pending') {
                      setNotice({ kind: 'ok', text: 'Vercel is still building the preview. Check again in a moment.' });
                    } else if (r.state === 'failure') {
                      setNotice({ kind: 'err', text: 'The preview build failed. Open the PR on GitHub to see why.' });
                    } else {
                      setNotice({
                        kind: 'err',
                        text:
                          r.hint ||
                          'No preview deploy reported yet. Vercel usually posts one within a minute of the PR. Check again shortly, or open the PR on GitHub to confirm the deploy started.',
                      });
                    }
                  })
                }
              >
                Check now
              </button>
            </Row>
            {hasContentPreview && !previewMatches && (
              <p role="status" style={hintStyle}>
                {previewSignature === null
                  ? 'Checking the preview content. Publishing is unavailable until it matches this form.'
                  : 'This form differs from the preview. Refresh the preview before publishing; Save draft alone does not update it.'}
              </p>
            )}
            {previewError && <p role="alert" style={{ ...hintStyle, color: 'var(--negative)' }}>{previewError}</p>}
            <p style={hintStyle}>Open the preview and confirm the page reads right before you go live. Edit content above and click &ldquo;Update preview PR&rdquo; to revise.</p>
          </div>
        )}
      </section>

      {/* ── Staff: one line for payments ─────────────────────────────── */}
      {!props.isOwner && (
        <section style={card}>
          <p role="status" style={{ fontSize: 14, color: 'var(--ink)', margin: 0 }}>
            <strong>Payments: {paymentsWired ? 'wired' : 'not wired'}</strong>
            {isLive ? '' : paymentsWired ? '. An owner takes the listing live.' : '. An owner wires the payments and takes the listing live.'}
          </p>
          {isLive && (
            <LiveSiteData
              liveUrl={row?.live_url ?? null}
              refreshError={row?.snapshot_refresh_error ?? null}
              refreshErrorAt={row?.snapshot_refresh_error_at ?? null}
              busy={busy}
              onRefresh={onRefreshSiteData}
            />
          )}
        </section>
      )}

      {props.isOwner && (<>
      {/* ── Stage 3: Payments ────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 3</div>
        <h2 className="font-serif" style={sectionTitle}>Wire up payments</h2>
        <p style={hintStyle}>
          This property charges through <strong>its own Stripe account</strong>. Helm never sees the secret key.
          Set these three values on the <strong>stay-cape-ann</strong> Vercel project (Production + Preview), then
          register the webhook in that Stripe account, and check each box.
        </p>

        <div style={{ marginTop: 14, maxWidth: 360 }}>
          <Field label="Stripe account key" error={errOf('stripeAccountKey')} hint="Identifies this property's own Stripe account and names its keys below. Saved with the listing.">
            <input style={{ ...inputStyle, ...mono }} value={form.stripeAccountKey} disabled={blocked} onChange={(e) => set('stripeAccountKey', e.target.value.toUpperCase())} placeholder="36_GRANITE" />
          </Field>
        </div>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Keys to set on the booking site (stay-cape-ann, Production and Preview)</span>
          <CopyLine text={env.publishable} suffix=" = pk_live_… (this property's publishable key)" />
          <CopyLine text={env.secret} suffix=" = sk_live_… or rk_live_… (secret or restricted key; Helm never sees this)" />
          <CopyLine text={env.webhookSecret} suffix=" = whsec_… (from the webhook below)" />
        </div>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Key 1 of 2: the booking site&rsquo;s key, and the permissions it needs</span>
          <p style={{ ...hintStyle, marginTop: 0, marginBottom: 12 }}>
            Only if you mint a <strong>restricted</strong> key: Developers &rsaquo; API keys &rsaquo; Create
            restricted key, start from zero permissions, then set exactly these four. Every other row stays{' '}
            <span style={mono}>None</span>. A plain <span style={mono}>sk_live_</span> secret key has no
            permissions to choose, so skip this block.
          </p>
          {SCA_STRIPE_KEY_PERMISSIONS.map((p) => (
            <div
              key={p.resource}
              style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--rule)' }}
            >
              <code style={{ ...mono, fontSize: 12.5, width: 124, flexShrink: 0 }}>{p.resource}</code>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', width: 42, flexShrink: 0 }}>{p.access}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{p.why}</span>
            </div>
          ))}
          <p style={{ ...hintStyle, marginTop: 12 }}>
            Write already covers Read, so there is nothing to pair these with. On <strong>this</strong> key, Disputes,
            Events, Balance, Products and Payouts stay on <span style={mono}>None</span>: the booking site never calls
            them. Helm&rsquo;s key below is a different key and does need some of them.
          </p>
          <p style={hintStyle}>
            <strong>One trade.</strong> Scoped this tightly the key cannot read the account object, so
            staycapeann&rsquo;s key diagnostic confirms it authenticates but cannot print the account name
            back for you to check against the owner. A plain <span style={mono}>sk_live_</span> key can.
            Either kind passes both diagnostics.
          </p>
        </div>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Stripe webhook (in this property&rsquo;s Stripe account)</span>
          <CopyLine text={webhookUrl} />
          <p style={{ ...hintStyle, marginTop: 8 }}>Subscribe to: <span style={mono}>{SCA_STRIPE_WEBHOOK_EVENTS.join(', ')}</span>. Copy its signing secret into <span style={mono}>{env.webhookSecret}</span>.</p>
        </div>

        <div style={{ marginTop: 14, border: '1px solid var(--rule)', padding: 16 }}>
          <span style={labelStyle}>Key 2 of 2: Helm&rsquo;s own key (a second restricted key, on Helm&rsquo;s Vercel project)</span>
          <p style={{ ...hintStyle, marginTop: 0, marginBottom: 10 }}>
            A separate key from Key 1, made in the same Stripe account; its permissions are its own and do not
            change Key 1&rsquo;s. Helm uses it to put direct bookings on the owner statement
            with Stripe&rsquo;s real fees and to make add-on payment links. In this property&rsquo;s Stripe account:
            Developers &rsaquo; API keys &rsaquo; Create restricted key, name it <strong>Helm</strong>, start from zero
            permissions and set exactly these seven. Every other row stays <span style={mono}>None</span>. Then in
            Vercel, <strong>rising-tide-statements</strong> &rsaquo; Environment Variables, add this name with the{' '}
            <span style={mono}>rk_live_</span> key as its value, and Redeploy. Never an <span style={mono}>sk_</span> key:
            Helm ignores one.
          </p>
          <CopyLine
            text={helmStripeKeyEnvName(props.propertyId)}
            suffix={
              props.helmStripeKeySet === true
                ? ' = rk_live_… (set on Helm)'
                : props.helmStripeKeySet === false
                  ? ' = rk_live_… (not set on Helm yet)'
                  : ' = rk_live_…'
            }
          />
          <div style={{ marginTop: 10 }}>
            {HELM_STRIPE_KEY_PERMISSIONS.map((p) => (
              <div
                key={p.resource}
                style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--rule)' }}
              >
                <code style={{ ...mono, fontSize: 12.5, width: 124, flexShrink: 0 }}>{p.resource}</code>
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', width: 42, flexShrink: 0 }}>{p.access}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{p.why}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Check label={`${env.publishable} set in Vercel`} checked={!!row?.payment_publishable_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('publishable', v)} />
          <Check label={`${env.secret} set in Vercel`} checked={!!row?.payment_secret_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('secret', v)} />
          <Check label={`Webhook created + ${env.webhookSecret} set`} checked={!!row?.payment_webhook_set} disabled={!prOpen || busy !== null} onChange={(v) => onTogglePayment('webhook', v)} />
        </div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={btnBase} disabled={busy !== null || !prOpen} onClick={onVerify}>{busy === 'verify' ? 'Checking…' : 'Verify wiring'}</button>
          {verifyResult && <VerifyBadge signal={verifyResult.signal} />}
          {!verifyResult && row?.payment_verify_signal && <VerifyBadge signal={row.payment_verify_signal} />}
        </div>
        <p style={hintStyle}>
          Verify reads the public booking page and checks whether a card field renders (no secret involved). Before
          go-live it probes the preview, so set the keys for <strong>Preview</strong> as well, or re-verify against
          production after go-live.
        </p>
      </section>

      {/* ── Stage 4: Go live ─────────────────────────────────────────── */}
      <section style={{ ...card, opacity: prOpen ? 1 : 0.55 }}>
        <div className="eyebrow">Step 4</div>
        <h2 className="font-serif" style={sectionTitle}>Go live</h2>
        {status === 'live' ? (
          <div style={{ marginTop: 8 }}>
            <LiveSiteData
              liveUrl={row?.live_url ?? null}
              refreshError={row?.snapshot_refresh_error ?? null}
              refreshErrorAt={row?.snapshot_refresh_error_at ?? null}
              busy={busy}
              onRefresh={onRefreshSiteData}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" style={btnBase} disabled={busy !== null} onClick={onVerify}>{busy === 'verify' ? 'Checking…' : 'Verify payments (production)'}</button>
              <button type="button" style={{ ...btnBase, borderColor: 'var(--negative)', color: 'var(--negative)' }} disabled={busy !== null} onClick={onUnlist}>{busy === 'unlist' ? 'Opening removal PR…' : 'Unlist…'}</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p style={hintStyle}>
              Going live squash-merges the PR; the build picks up the new listing and the page is public within a couple
              minutes. Enabled once the three payment boxes are checked. Open and review the preview above first.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...btnPrimary, opacity: paymentsReady ? 1 : 0.5 }}
                disabled={blocked || failedUploads || !prOpen || !paymentsReady || !previewMatches}
                onClick={() => onGoLive(false)}
              >
                {busy === 'golive' ? 'Merging…' : 'Approve & go live →'}
              </button>
              <button type="button" style={{ ...btnBase, fontSize: 11 }} disabled={blocked || failedUploads || !prOpen || !previewMatches} onClick={() => onGoLive(true)}>
                Force go-live…
              </button>
              {previewState === 'failure' && (
                <span style={{ fontSize: 12, color: 'var(--negative)' }}>
                  The preview build reported a failure. Open it above before going live.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
      </>)}
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

type Favorite = ScaFormDraft['stayFavorite'];

const OTHER_RESTAURANT = '__other';

/**
 * One restaurant: a dropdown of the listed ones (picking one sets its name,
 * town and map pin), or "Another restaurant" with a name and town that Helm
 * puts on the map when the PR opens. Nobody types coordinates.
 */
function RestaurantPicker({ value, choices, onChange }: { value: Favorite; choices: ScaRestaurant[]; onChange: (f: Favorite) => void }) {
  const match = value.name.trim() ? findRestaurant(choices, value.name, value.town) : null;
  const [other, setOther] = useState(!!value.name.trim() && !match);
  const selected = other ? OTHER_RESTAURANT : match ? restaurantKey(match.name, match.town) : '';
  const towns = [...new Set(choices.map((c) => c.town))];
  return (
    <>
      <select
        style={inputStyle}
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER_RESTAURANT) {
            setOther(true);
            onChange({ ...value, name: '', lat: NaN, lng: NaN });
            return;
          }
          setOther(false);
          const r = choices.find((c) => restaurantKey(c.name, c.town) === v);
          onChange(r ? { ...value, name: r.name, town: r.town, lat: r.lat, lng: r.lng } : { ...value, name: '', lat: NaN, lng: NaN });
        }}
      >
        <option value="">Pick a restaurant</option>
        {towns.map((t) => (
          <optgroup key={t} label={t}>
            {choices.filter((c) => c.town === t).map((c) => (
              <option key={restaurantKey(c.name, c.town)} value={restaurantKey(c.name, c.town)}>{c.name}</option>
            ))}
          </optgroup>
        ))}
        <option value={OTHER_RESTAURANT}>Another restaurant</option>
      </select>
      {other && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr]" style={{ gap: 8, marginTop: 8 }}>
            <input style={inputStyle} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value, lat: NaN, lng: NaN })} placeholder="Restaurant name" />
            <input style={inputStyle} value={value.town} onChange={(e) => onChange({ ...value, town: e.target.value, lat: NaN, lng: NaN })} placeholder="Town" />
          </div>
          <p style={hintStyle}>Helm finds it on the map when the PR opens.</p>
        </>
      )}
    </>
  );
}

function blurbPlaceholder(choices: ScaRestaurant[], f: Favorite): string {
  const sample = f.name.trim() ? findRestaurant(choices, f.name, f.town)?.sampleBlurb : undefined;
  return sample ? `One sentence, e.g. ${sample}` : 'One-sentence editorial blurb';
}

function FieldError({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 11.5, color: 'var(--negative)', marginTop: 4 }}>{children}</p>;
}

/**
 * A live listing's page and its Guesty snapshot: the link, a failed refresh
 * said out loud, and Refresh site data. Content upkeep, so staff get it too.
 */
function LiveSiteData({
  liveUrl,
  refreshError,
  refreshErrorAt,
  busy,
  onRefresh,
}: {
  liveUrl: string | null;
  refreshError: string | null;
  refreshErrorAt: string | null;
  busy: string | null;
  onRefresh: () => void;
}) {
  return (
    <>
      <Banner kind="ok">
        Live on staycapeann.com.{' '}
        {liveUrl && <a href={liveUrl} target="_blank" rel="noreferrer" style={linkStyle}>{liveUrl} ↗</a>}
      </Banner>
      {refreshError && (
        <Banner kind="err">
          <strong>Snapshot refresh did not fire</strong>
          {refreshErrorAt ? ` (last tried ${etStamp(refreshErrorAt)})` : ''}
          : {refreshError} The listing page may be stale until the nightly refresh. Once fixed,
          click <strong>Refresh site data</strong> to clear this.
        </Banner>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" style={btnBase} disabled={busy !== null} onClick={onRefresh}>{busy === 'refresh-data' ? 'Triggering…' : 'Refresh site data'}</button>
      </div>
      <p style={hintStyle}>The listing page is built from Guesty&rsquo;s snapshot, which go-live refreshes automatically (takes a couple minutes after merge). If the page or its photos look stale, click <strong>Refresh site data</strong>; it also self-heals on the nightly refresh.</p>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)', flexWrap: 'wrap' }}>
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
    wired: { t: '✓ card field renders: payments wired', c: 'var(--positive)' },
    demo_mode: { t: '✗ still in demo mode: publishable key not picked up', c: 'var(--negative)' },
    unknown: { t: 'inconclusive: open the preview manually', c: 'var(--ink-3)' },
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
  id,
  title,
  items,
  keys,
  onAdd,
  onRemove,
  render,
}: {
  id?: string;
  title: string;
  items: T[];
  /** Stable React keys per item; index keys otherwise. */
  keys?: string[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  render: (item: T, i: number) => ReactNode;
}) {
  return (
    <div id={id} style={{ marginTop: 24, scrollMarginTop: 80 }}>
      <span style={labelStyle}>{title}</span>
      {items.map((item, i) => (
        <div key={keys?.[i] ?? i} style={{ border: '1px solid var(--rule)', padding: 12, marginBottom: 8, position: 'relative' }}>
          {render(item, i)}
          <button type="button" style={{ ...btnBase, padding: '3px 9px', fontSize: 11, marginTop: 8 }} onClick={() => onRemove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" style={{ ...btnBase, padding: '6px 12px' }} onClick={onAdd}>+ Add</button>
    </div>
  );
}
