import type { CompetitorId } from './types';

/**
 * Scrape competitor inventory pages and return a flat list of listings.
 *
 * Both AVH and Shoreway publish a static index page under predictable URL
 * shapes (`/vrp/unit/<slug>-<id>-15` and `/property/<slug>`). We fetch the
 * page server-side and parse the listing links with regex — robust enough
 * for these specific sites and dependency-free.
 *
 * Each scraper returns ScrapedListing[] with at minimum slug + url. Name
 * is best-effort; downstream sync uses the prior listing_name when the
 * scrape can't extract one.
 */

export type ScrapedListing = {
  competitorId: CompetitorId;
  slug: string;
  /** Display name from the listing card; undefined when not extractable. */
  name?: string;
  url: string;
};

export type ScrapeResult = {
  competitorId: CompetitorId;
  listings: ScrapedListing[];
  /** True when the index page returned results — false on outright failure
   *  (network / 5xx / empty body). The sync logic uses this to abort
   *  before flagging every listing as dropped. */
  ok: boolean;
  error?: string;
};

const UA = 'Mozilla/5.0 (compatible; RisingTideHelm/1.0; +https://risingtidestr.com)';

export async function scrapeAvh(): Promise<ScrapeResult> {
  const url = 'https://www.atlanticvacationhomes.com/vacation-rentals';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) {
      return { competitorId: 'atlantic-vacation-homes', listings: [], ok: false, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    return { competitorId: 'atlantic-vacation-homes', ok: true, listings: parseAvh(html) };
  } catch (err) {
    return {
      competitorId: 'atlantic-vacation-homes',
      listings: [],
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseAvh(html: string): ScrapedListing[] {
  // /vrp/unit/<Underscored_Path>-<id>-15
  const linkRe = /\/vrp\/unit\/([A-Za-z0-9_]+)-(\d+)-15/g;
  const seen = new Map<string, ScrapedListing>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const path = `${m[1]}-${m[2]}-15`;
    const slug = avhPathToSlug(m[1]);
    if (seen.has(slug)) continue;
    const name = avhPathToName(m[1]);
    seen.set(slug, {
      competitorId: 'atlantic-vacation-homes',
      slug,
      name,
      url: `https://www.atlanticvacationhomes.com/vrp/unit/${path}`,
    });
  }
  return [...seen.values()];
}

/** "Two_Beaches_Cottage" → "two-beaches-cottage" — same slug shape we
 *  used in src/lib/competitors/avh-listings.ts so the existing static
 *  data stays compatible. */
function avhPathToSlug(path: string): string {
  return path.replace(/_/g, '-').toLowerCase();
}

/** "Two_Beaches_Cottage" → "Two Beaches Cottage". */
function avhPathToName(path: string): string {
  return path.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scrapeShoreway(): Promise<ScrapeResult> {
  const url = 'https://shorewaymanagement.hospitable.rentals/';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) {
      return { competitorId: 'shoreway-management', listings: [], ok: false, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    return { competitorId: 'shoreway-management', ok: true, listings: parseShoreway(html) };
  } catch (err) {
    return {
      competitorId: 'shoreway-management',
      listings: [],
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseShoreway(html: string): ScrapedListing[] {
  // /property/<slug> — slugs are kebab-case.
  const linkRe = /\/property\/([a-z0-9-]+)\b/gi;
  const seen = new Map<string, ScrapedListing>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.set(slug, {
      competitorId: 'shoreway-management',
      slug,
      name: shorewaySlugToName(slug),
      url: `https://shorewaymanagement.hospitable.rentals/property/${slug}`,
    });
  }
  return [...seen.values()];
}

/** "the-mariner3br25-bthwalk-to-beachbackyard" →
 *  "The Mariner 3BR 2.5 Bath Walk To Beach Backyard". Best-effort —
 *  Hospitable slugs are messy. The display name from a prior sync wins
 *  when one already exists in competitor_listings_current.
 */
function shorewaySlugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function scrapeAll(): Promise<ScrapeResult[]> {
  return Promise.all([scrapeAvh(), scrapeShoreway()]);
}
