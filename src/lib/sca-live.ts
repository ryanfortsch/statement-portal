/**
 * Is this home on staycapeann.com right now? The one check, read from the
 * site's own listing registry (data/ical-urls.json on the stay-cape-ann
 * repo's production branch), the file the site builds its listing pages
 * from. A launch record in Helm is not the answer: homes listed before Helm
 * tracked launches, or by hand, are live with no record (21 Horton, 10/19),
 * and the property page once told staff to launch a home guests could
 * already book.
 *
 * The launcher reads it fresh. The property page passes a max age, so one
 * registry read serves every property page for a minute or two instead of a
 * GitHub call per page view.
 *
 * `known: false` means the registry could not be read (no GITHUB_TOKEN, a
 * GitHub error). Absence is not a fact then: callers must not say "not on
 * the site".
 */
import * as gh from './github';
import { SCA_PROD_BRANCH, SCA_REGISTRY_PATH } from './sca-config';
import { registryEntryFor } from './sca-launch';

export type ScaLiveCheck = { known: true; entry: Record<string, unknown> | null } | { known: false; entry: null };

let cached: { at: number; raw: string } | null = null;

async function registryRaw(maxAgeMs: number): Promise<string | null> {
  if (maxAgeMs > 0 && cached && Date.now() - cached.at < maxAgeMs) return cached.raw;
  const file = await gh.getFile(SCA_REGISTRY_PATH, SCA_PROD_BRANCH);
  if (!file) return null;
  cached = { at: Date.now(), raw: file.contentUtf8 };
  return file.contentUtf8;
}

/** The listing's live registry entry (null when it is not on the site). */
export async function scaLiveEntry(listingId: string | null | undefined, opts: { maxAgeMs?: number } = {}): Promise<ScaLiveCheck> {
  const id = String(listingId ?? '').trim();
  // The site keys its listings by Guesty listing id: no id, no listing.
  if (!id) return { known: true, entry: null };
  if (!gh.isGithubConfigured()) return { known: false, entry: null };
  try {
    const raw = await registryRaw(opts.maxAgeMs ?? 0);
    if (raw == null) return { known: false, entry: null };
    return { known: true, entry: registryEntryFor(raw, id) };
  } catch {
    return { known: false, entry: null };
  }
}
