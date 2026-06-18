'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import {
  validateScaForm,
  buildRegistryEntry,
  applyEntryToRegistryJson,
  removeEntryFromRegistryJson,
  registryHasListing,
  interpretBookProbe,
  type ScaFormDraft,
  type ScaLaunchRow,
  type PaymentVerifySignal,
} from '@/lib/sca-launch';
import {
  SCA_REGISTRY_PATH,
  SCA_PROD_BRANCH,
  SCA_SITE_ORIGIN,
  SCA_SNAPSHOT_WORKFLOW,
  scaListingUrl,
  scaBookProbeUrl,
  SCA_DEMO_MODE_SENTINEL,
} from '@/lib/sca-config';
import * as gh from '@/lib/github';
import { getGuestyListing } from '@/lib/guesty';

/**
 * Server actions for the Stay Cape Ann launch flow (/properties/[id]/stay-cape-ann).
 *
 * Every mutation is auth-gated (Helm is @risingtidestr.com-only). GitHub calls
 * are wrapped so a failure returns a clean message and never leaks the token.
 * The sca_launches table holds no secrets; the Stripe wiring is manual and only
 * its non-secret checklist state is stored here.
 */

type ActionResult =
  | { ok: true; row: ScaLaunchRow }
  | { ok: false; error?: string; errors?: Record<string, string> };

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

async function loadRow(propertyId: string): Promise<ScaLaunchRow | null> {
  const { data, error } = await supabase
    .from('sca_launches')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) return null;
  return (data as ScaLaunchRow) ?? null;
}

function revalidate(propertyId: string): void {
  revalidatePath(`/properties/${propertyId}/stay-cape-ann`);
  revalidatePath(`/properties/${propertyId}`);
}

export type GuestyPrefill = {
  publicName: string;
  tagline: string;
  description: string;
  highlights: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  accommodates: number | null;
  photos: number;
  amenities: number;
};

/**
 * Parse a raw Guesty `publicDescription.summary` into a clean editorial
 * tagline + highlight bullets.
 *
 * Guesty owners author OTA brochure-speak: an optional headline followed
 * by a stack of "✓ Selling point" bullets, sometimes run together on a
 * single line with no newlines ("...Harbor✓ Beautiful 4-bedroom..."). The
 * live stay-cape-ann site never renders that wall — it reduces the summary
 * to one tagline line (see cleanTagline in the SCA repo). We mirror that
 * here AND route the bullets to the highlights field, since that is exactly
 * what they are. Without this, "Pull from Guesty" dumped the entire ✓ block
 * into the single-line tagline.
 */
function parseGuestySummary(raw: string): { tagline: string; highlights: string[] } {
  if (!raw) return { tagline: '', highlights: [] };
  // Check-mark / bullet glyphs Guesty owners lead lines with. A plain
  // hyphen is intentionally excluded ("4-Minute Walk" is not a bullet).
  const CHECK_LEADING = /^[✔✓✅☑•]\s*/;
  // Break on newlines AND inline glyphs, then keep only substantive lines
  // (>= 5 letters) so stray punctuation or "✓✓" runs drop out.
  const lines = raw
    .replace(/([✔✓✅☑•])/g, '\n$1')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^a-zA-Z]/g, '').length >= 5);
  if (lines.length === 0) return { tagline: '', highlights: [] };

  const isBullet = (s: string) => CHECK_LEADING.test(s);
  const stripGlyph = (s: string) => s.replace(CHECK_LEADING, '').trim();

  // Tagline = first substantive line. If it is a bullet, peel a short
  // "Label: detail" / "Label - detail" prefix so the readable detail wins.
  const first = lines[0];
  let tagline: string;
  if (!isBullet(first)) {
    tagline = first;
  } else {
    const stripped = stripGlyph(first);
    const sep = stripped.match(/\s[-–—]\s|:\s/);
    tagline =
      sep && sep.index !== undefined && sep.index > 0 && sep.index < 30
        ? stripped.slice(sep.index + sep[0].length).trim()
        : stripped;
  }

  // Highlights = the bullet lines, minus the first one if it became the
  // tagline (SCA authors tagline + highlights to NOT overlap). Deduped,
  // capped so we offer a sane set the operator can trim rather than a wall.
  const bullets = lines.filter(isBullet).map(stripGlyph);
  const rest = isBullet(first) ? bullets.slice(1) : bullets;
  const seen = new Set<string>();
  const highlights: string[] = [];
  for (const b of rest) {
    const key = b.toLowerCase();
    if (b && !seen.has(key)) {
      seen.add(key);
      highlights.push(b);
    }
  }
  return { tagline, highlights: highlights.slice(0, 6) };
}

/**
 * Pull what Guesty already has for a listing so the operator edits/fills gaps
 * instead of authoring from scratch. Maps Guesty title/summary/space to
 * publicName/tagline/description and reports the photo/amenity/spec counts.
 * Uses Helm's Guesty creds (server-only); returns a clean error if unavailable.
 */
export async function pullFromGuesty(
  guestyListingId: string,
): Promise<{ ok: true; prefill: GuestyPrefill } | { ok: false; error: string }> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  const id = guestyListingId.trim();
  if (!id) return { ok: false, error: 'Enter the Guesty listing ID first' };
  try {
    const l = await getGuestyListing(id);
    const { tagline, highlights } = parseGuestySummary(l.publicDescription?.summary || '');
    return {
      ok: true,
      prefill: {
        publicName: (l.title || l.nickname || '').trim(),
        tagline,
        description: (l.publicDescription?.space || '').trim(),
        highlights,
        bedrooms: l.bedrooms ?? null,
        bathrooms: l.bathrooms ?? null,
        accommodates: l.accommodates ?? null,
        photos: (l.pictures || []).length,
        amenities: (l.amenities || []).length,
      },
    };
  } catch (e) {
    return { ok: false, error: `Could not pull from Guesty: ${(e as Error).message}` };
  }
}

/** Persist the editorial draft (no validation — lets the operator save progress). */
export async function saveScaDraft(propertyId: string, draft: ScaFormDraft): Promise<ActionResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };

  const existing = await loadRow(propertyId);
  const { error } = await supabase.from('sca_launches').upsert(
    {
      property_id: propertyId,
      guesty_listing_id: draft.guestyListingId || null,
      stripe_account_key: draft.stripeAccountKey || null,
      ical_url: draft.icalUrl || null,
      rank: Number.isFinite(draft.rank) ? draft.rank : null,
      registry_entry: draft,
      // keep an advanced status; only initialize to draft on first write
      status: existing?.status ?? 'draft',
      created_by: existing?.created_by ?? email,
    },
    { onConflict: 'property_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidate(propertyId);
  const row = await loadRow(propertyId);
  return row ? { ok: true, row } : { ok: false, error: 'Saved but could not reload' };
}

/**
 * Validate the draft, write the registry entry onto a branch (as a real user),
 * and open/refresh a PR. Surfaces the Vercel preview URL when available.
 */
export async function openScaPr(propertyId: string, draft: ScaFormDraft): Promise<ActionResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!gh.isGithubConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN is not configured on Helm. Add it before opening a PR.' };
  }

  // Once live, the registry entry already exists on production. Re-opening a PR
  // here would spawn a redundant PR and reset the status, so refuse.
  const current = await loadRow(propertyId);
  if (current?.status === 'live') {
    return { ok: false, error: 'This property is already live on Stay Cape Ann. Unlist it before relaunching.' };
  }

  const valid = validateScaForm(draft);
  if (!valid.ok) return { ok: false, errors: valid.errors };
  const form = valid.data;

  try {
    // Read the registry from production.
    const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
    if (!file) return { ok: false, error: `Could not read ${SCA_REGISTRY_PATH} on ${SCA_PROD_BRANCH}` };

    const existingRow = await loadRow(propertyId);
    // Duplicate guard: don't clobber a listing that's already on the site unless
    // this property is the one that owns it (re-opening its own PR is fine).
    if (
      registryHasListing(file.contentUtf8, form.guestyListingId) &&
      existingRow?.guesty_listing_id !== form.guestyListingId
    ) {
      return {
        ok: false,
        error:
          'That Guesty listing is already in the Stay Cape Ann registry. Unlist or edit it directly before launching it again.',
      };
    }

    const entry = buildRegistryEntry(form);
    const newContent = applyEntryToRegistryJson(file.contentUtf8, form.guestyListingId, entry);
    const branch = `sca-launch/${propertyId}`;
    const commitMessage = `Launch ${form.internalName} (${form.publicName}) on Stay Cape Ann`;

    // Create the branch off main if needed; resolve the file sha on the branch.
    let fileSha = file.sha;
    if (await gh.branchExists(branch)) {
      const onBranch = await gh.getFile(SCA_REGISTRY_PATH, branch);
      if (onBranch) fileSha = onBranch.sha;
    } else {
      const baseSha = await gh.getBranchHeadSha(SCA_PROD_BRANCH);
      await gh.createBranch(branch, baseSha);
    }

    await gh.putFile({
      path: SCA_REGISTRY_PATH,
      branch,
      contentUtf8: newContent,
      message: commitMessage,
      sha: fileSha,
    });

    // Open the PR if one isn't already open for this branch.
    let pr = await gh.findOpenPrForBranch(branch);
    if (!pr) {
      pr = await gh.openPullRequest({
        head: branch,
        base: SCA_PROD_BRANCH,
        title: commitMessage,
        body: prBody(form),
      });
    }

    const preview = await gh.getBranchPreviewStatus(branch).catch(() => ({ state: 'none' as const, url: null }));

    const { error } = await supabase.from('sca_launches').upsert(
      {
        property_id: propertyId,
        guesty_listing_id: form.guestyListingId,
        stripe_account_key: form.stripeAccountKey,
        ical_url: form.icalUrl,
        rank: form.rank,
        registry_entry: draft,
        status: 'pr_open',
        branch_name: branch,
        pr_number: pr.number,
        pr_url: pr.html_url,
        preview_url: preview.url,
        created_by: existingRow?.created_by ?? email,
      },
      { onConflict: 'property_id' },
    );
    if (error) return { ok: false, error: error.message };

    revalidate(propertyId);
    const row = await loadRow(propertyId);
    return row ? { ok: true, row } : { ok: false, error: 'PR opened but could not reload' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Poll the Vercel preview deployment status for the open PR's branch. */
export async function refreshPreviewStatus(
  propertyId: string,
): Promise<{ ok: true; state: gh.PreviewState; url: string | null } | { ok: false; error: string }> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  const row = await loadRow(propertyId);
  if (!row?.branch_name) return { ok: false, error: 'No open PR' };
  try {
    const status = await gh.getBranchPreviewStatus(row.branch_name);
    if (status.url && status.url !== row.preview_url) {
      await supabase.from('sca_launches').update({ preview_url: status.url }).eq('property_id', propertyId);
      revalidate(propertyId);
    }
    return { ok: true, state: status.state, url: status.url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Toggle one of the manual Stripe-wiring checklist items. */
export async function setPaymentStep(
  propertyId: string,
  step: 'publishable' | 'secret' | 'webhook',
  value: boolean,
): Promise<ActionResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  const column = {
    publishable: 'payment_publishable_set',
    secret: 'payment_secret_set',
    webhook: 'payment_webhook_set',
  }[step];
  const { error } = await supabase
    .from('sca_launches')
    .update({ [column]: value })
    .eq('property_id', propertyId);
  if (error) return { ok: false, error: error.message };
  revalidate(propertyId);
  const row = await loadRow(propertyId);
  return row ? { ok: true, row } : { ok: false, error: 'Updated but could not reload' };
}

/**
 * Secret-free payment-wiring check. Fetches the public /book page (production
 * once live, otherwise the preview deployment) and looks for the demo-mode
 * sentinel vs. a publishable-key marker. Never touches a secret.
 */
export async function verifyPaymentWiring(
  propertyId: string,
): Promise<{ ok: true; signal: PaymentVerifySignal; target: string } | { ok: false; error: string }> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  const row = await loadRow(propertyId);
  if (!row?.guesty_listing_id) return { ok: false, error: 'No listing to verify yet' };

  // Live -> production; otherwise probe the preview deployment if we have one.
  let origin = SCA_SITE_ORIGIN;
  if (row.status !== 'live' && row.preview_url) {
    try {
      origin = new URL(row.preview_url).origin;
    } catch {
      /* keep production */
    }
  }
  const path = scaBookProbeUrl(row.guesty_listing_id).replace(SCA_SITE_ORIGIN, '');
  const target = `${origin}${path}`;

  try {
    const res = await fetch(target, { cache: 'no-store', redirect: 'follow' });
    const html = await res.text();
    const signal = interpretBookProbe(html, SCA_DEMO_MODE_SENTINEL);
    await supabase
      .from('sca_launches')
      .update({ payment_verified_at: new Date().toISOString(), payment_verify_signal: signal })
      .eq('property_id', propertyId);
    revalidate(propertyId);
    return { ok: true, signal, target };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Merge the PR and go live. Gated on a green preview + the payment checklist,
 * unless `override` is passed (explicit operator confirm). Flips the
 * sca_page_live launch-checklist step to done.
 */
export async function goLiveSca(
  propertyId: string,
  override = false,
): Promise<ActionResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };

  const row = await loadRow(propertyId);
  if (!row?.pr_number) return { ok: false, error: 'No open PR to merge' };
  if (!row.guesty_listing_id) return { ok: false, error: 'Missing Guesty listing ID' };

  if (!override) {
    // Gate only on the payment checklist — the real, reliably-stored signal.
    // The preview is advisory (operator reviews it via the link); we never block
    // go-live on the preview-status probe, which is unreliable for this repo.
    const missing: string[] = [];
    if (!row.payment_publishable_set) missing.push('publishable key not marked set');
    if (!row.payment_secret_set) missing.push('secret key not marked set');
    if (!row.payment_webhook_set) missing.push('webhook not marked set');
    if (missing.length) {
      return { ok: false, error: `Not ready to go live: ${missing.join('; ')}.` };
    }
  }

  try {
    const merge = await gh.mergePullRequest(row.pr_number, 'squash');
    if (!merge.merged) return { ok: false, error: 'GitHub did not merge the PR' };

    const liveUrl = scaListingUrl(row.guesty_listing_id);
    await supabase
      .from('sca_launches')
      .update({
        status: 'live',
        published_at: new Date().toISOString(),
        live_url: liveUrl,
      })
      .eq('property_id', propertyId);

    await markLaunchStepDone(propertyId, email);

    // Clean up the merged branch so a stray re-click can't reuse it.
    if (row.branch_name) await gh.deleteBranch(row.branch_name).catch(() => {});

    // The /stays/[id] page is pre-rendered from the committed Guesty snapshot,
    // which won't have this listing until refreshed. Trigger that refresh now so
    // the page goes live in a couple minutes instead of waiting for the nightly
    // cron. Best-effort: needs Actions: write on the token; a failure is logged
    // but never fails the launch (the operator can refresh manually / cron runs).
    try {
      await gh.dispatchWorkflow(SCA_SNAPSHOT_WORKFLOW, SCA_PROD_BRANCH);
      await supabase
        .from('sca_launches')
        .update({ snapshot_refreshed_at: new Date().toISOString() })
        .eq('property_id', propertyId);
    } catch {
      /* snapshot refresh not triggered (token lacks Actions scope?); cron backstops */
    }

    revalidate(propertyId);
    revalidatePath('/properties');
    const updated = await loadRow(propertyId);
    return updated ? { ok: true, row: updated } : { ok: false, error: 'Merged but could not reload' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Manually (re)trigger the SCA Guesty snapshot refresh. Used by the post-launch
 * "Refresh site data" button when the auto-trigger on go-live didn't fire (e.g.
 * the token lacks Actions scope) or the page still needs repopulating.
 */
export async function refreshScaSiteData(
  propertyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!gh.isGithubConfigured()) return { ok: false, error: 'GITHUB_TOKEN is not configured' };
  try {
    await gh.dispatchWorkflow(SCA_SNAPSHOT_WORKFLOW, SCA_PROD_BRANCH);
    await supabase
      .from('sca_launches')
      .update({ snapshot_refreshed_at: new Date().toISOString() })
      .eq('property_id', propertyId);
    revalidate(propertyId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not trigger the snapshot refresh: ${(e as Error).message}` };
  }
}

/** Open a PR that removes the listing from the registry (the unlist path). */
export async function unlistSca(propertyId: string): Promise<ActionResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };
  if (!gh.isGithubConfigured()) return { ok: false, error: 'GITHUB_TOKEN is not configured' };
  const row = await loadRow(propertyId);
  if (!row?.guesty_listing_id) return { ok: false, error: 'Nothing to unlist' };

  try {
    const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
    if (!file) return { ok: false, error: `Could not read ${SCA_REGISTRY_PATH}` };
    if (!registryHasListing(file.contentUtf8, row.guesty_listing_id)) {
      await supabase.from('sca_launches').update({ status: 'unlisted' }).eq('property_id', propertyId);
      revalidate(propertyId);
      const updated = await loadRow(propertyId);
      return updated ? { ok: true, row: updated } : { ok: false, error: 'Reload failed' };
    }
    const newContent = removeEntryFromRegistryJson(file.contentUtf8, row.guesty_listing_id);
    const branch = `sca-unlist/${propertyId}`;
    let fileSha = file.sha;
    if (await gh.branchExists(branch)) {
      const onBranch = await gh.getFile(SCA_REGISTRY_PATH, branch);
      if (onBranch) fileSha = onBranch.sha;
    } else {
      await gh.createBranch(branch, await gh.getBranchHeadSha(SCA_PROD_BRANCH));
    }
    await gh.putFile({
      path: SCA_REGISTRY_PATH,
      branch,
      contentUtf8: newContent,
      message: `Unlist ${row.guesty_listing_id} from Stay Cape Ann`,
      sha: fileSha,
    });
    let pr = await gh.findOpenPrForBranch(branch);
    if (!pr) {
      pr = await gh.openPullRequest({
        head: branch,
        base: SCA_PROD_BRANCH,
        title: `Unlist ${row.guesty_listing_id} from Stay Cape Ann`,
        body: 'Opened from Helm. Removes the listing from data/ical-urls.json.',
      });
    }
    await supabase
      .from('sca_launches')
      .update({ status: 'unlisted', pr_number: pr.number, pr_url: pr.html_url, branch_name: branch })
      .eq('property_id', propertyId);
    revalidate(propertyId);
    const updated = await loadRow(propertyId);
    return updated ? { ok: true, row: updated } : { ok: false, error: 'Reload failed' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function markLaunchStepDone(propertyId: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('property_launch_steps')
    .select('id')
    .eq('property_id', propertyId)
    .eq('step_key', 'sca_page_live')
    .maybeSingle();
  if (existing) {
    await supabase
      .from('property_launch_steps')
      .update({ status: 'done', completed_at: now, completed_by: email })
      .eq('property_id', propertyId)
      .eq('step_key', 'sca_page_live');
  } else {
    await supabase.from('property_launch_steps').insert({
      property_id: propertyId,
      step_key: 'sca_page_live',
      status: 'done',
      completed_at: now,
      completed_by: email,
    });
  }
}

function prBody(form: { internalName: string; publicName: string; guestyListingId: string; stripeAccountKey: string }): string {
  return [
    `Launch **${form.internalName}** (${form.publicName}) on Stay Cape Ann.`,
    '',
    `Opened from Helm. Adds \`${form.guestyListingId}\` to \`data/ical-urls.json\`.`,
    '',
    `Stripe account key: \`${form.stripeAccountKey}\`. Payment env vars + webhook are configured separately in Vercel/Stripe.`,
    '',
    '_Review the Vercel preview, then merge from Helm to go live._',
  ].join('\n');
}
