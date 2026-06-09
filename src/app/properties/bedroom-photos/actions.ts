'use server';

import { auth } from '@/auth';
import * as gh from '@/lib/github';
import {
  applySleepingArrangementsToRegistryJson,
  buildSleepingArrangementsForRegistry,
  internalNameToSlug,
  type SleepingPhotoInput,
} from '@/lib/sca-launch';
import { SCA_REGISTRY_PATH, SCA_PROD_BRANCH, scaListingUrl } from '@/lib/sca-config';

/**
 * Server action for the Stay Cape Ann bedroom-photo tool
 * (/properties/bedroom-photos).
 *
 * Unlike the full launch flow, this edits a listing that is already in the
 * registry — it only touches `sleepingArrangements`, leaving every other field
 * intact. Photos are uploaded to Vercel Blob client-side (the same path the
 * launcher uses); this action just writes the resulting URLs into
 * data/ical-urls.json on stay-cape-ann via a PR and squash-merges it, so the
 * site rebuilds and "Where you'll sleep" fills in. No file naming, no CLI, no
 * git on anyone's machine. Auth-gated (@risingtidestr.com only).
 */

export type PublishBedroomResult =
  | { ok: true; published: boolean; prUrl: string; prNumber: number; liveUrl: string; noChange?: boolean }
  | { ok: false; error: string };

export async function publishBedroomPhotos(
  guestyListingId: string,
  internalName: string,
  arrangements: SleepingPhotoInput[],
): Promise<PublishBedroomResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!gh.isGithubConfigured()) {
    return { ok: false, error: 'GITHUB_TOKEN is not configured on Helm. Add it before publishing.' };
  }
  const listingId = guestyListingId.trim();
  if (!listingId) return { ok: false, error: 'Missing listing id' };

  try {
    // Always compute the change against current production content.
    const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
    if (!file) return { ok: false, error: `Could not read ${SCA_REGISTRY_PATH} on ${SCA_PROD_BRANCH}` };

    const built = buildSleepingArrangementsForRegistry(arrangements);
    const newContent = applySleepingArrangementsToRegistryJson(file.contentUtf8, listingId, built);

    // Nothing changed — don't open an empty PR.
    if (newContent === file.contentUtf8) {
      return { ok: true, published: true, noChange: true, prUrl: '', prNumber: 0, liveUrl: scaListingUrl(listingId) };
    }

    const slug = internalNameToSlug(internalName) || listingId;
    const branch = `sca-bedrooms/${slug}`;
    const message = `Update bedroom photos for ${internalName || listingId} on Stay Cape Ann`;

    // Branch off production; if a stale branch lingers from a prior failed
    // publish, reuse it (resolving the file sha on the branch for the update).
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
      message,
      sha: fileSha,
    });

    let pr = await gh.findOpenPrForBranch(branch);
    if (!pr) {
      pr = await gh.openPullRequest({
        head: branch,
        base: SCA_PROD_BRANCH,
        title: message,
        body: [
          `Updates bedroom photos for **${internalName || listingId}** on Stay Cape Ann.`,
          '',
          `Opened from Helm's bedroom-photo tool. Edits \`sleepingArrangements\` for \`${listingId}\` in \`${SCA_REGISTRY_PATH}\`; photos are served from Vercel Blob.`,
        ].join('\n'),
      });
    }

    // Auto-publish. Photos are low-risk, reversible content, and the legacy
    // flow this replaces pushed straight to production. If the merge can't go
    // through (branch protection / pending checks), keep the PR so it can be
    // merged manually — surface its link rather than failing the upload.
    try {
      const merged = await gh.mergePullRequest(pr.number, 'squash');
      if (merged.merged) {
        await gh.deleteBranch(branch).catch(() => {});
        return { ok: true, published: true, prUrl: pr.html_url, prNumber: pr.number, liveUrl: scaListingUrl(listingId) };
      }
    } catch {
      /* fall through to the un-merged result */
    }
    return { ok: true, published: false, prUrl: pr.html_url, prNumber: pr.number, liveUrl: scaListingUrl(listingId) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
