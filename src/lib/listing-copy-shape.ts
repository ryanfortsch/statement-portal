/**
 * The two pure shapers that turn the listing record's text into what
 * staycapeann.com shows: the summary into a tagline and highlights, the
 * space into About blocks. toScaListing (listing-content.ts) builds the SCA
 * listing with them, and the property page's Listing section renders its
 * read view with the same two, so what an operator reads is what a guest
 * would see. No imports, so the client editor can load it.
 */

/** Mirror of stay-cape-ann lib/types.ts DescriptionBlock. */
export type ScaDescriptionBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] };

/** Guesty's "The space" text into SCA's About blocks: ☆ headings, → bullets, prose. */
export function descriptionBlocksFrom(space: string | null | undefined): ScaDescriptionBlock[] {
  const blocks: ScaDescriptionBlock[] = [];
  if (!space) return blocks;
  let bullets: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push({ kind: 'bullets', items: bullets });
      bullets = [];
    }
    if (prose.length) {
      blocks.push({ kind: 'prose', text: prose.join(' ') });
      prose = [];
    }
  };
  for (const raw of space.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^[☆★✦✧*]+\s*(.+?)\s*[☆★✦✧*]*$/.exec(line);
    if (heading && /^[☆★✦✧*]/.test(line)) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      continue;
    }
    const bullet = /^(?:→|-|•|✓|\*)\s+(.+)$/.exec(line);
    if (bullet) {
      if (prose.length) flush();
      bullets.push(bullet[1].trim());
      continue;
    }
    if (bullets.length) flush();
    prose.push(line);
  }
  flush();
  return blocks;
}

/** The ✓ lines of a Guesty summary become SCA highlights; the rest is the tagline. */
export function splitSummary(summary: string | null | undefined): { tagline: string; highlights: string[] } {
  const highlights: string[] = [];
  const rest: string[] = [];
  for (const raw of (summary ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:✓|✔|•|-|→)\s*(.+)$/.exec(line);
    if (m) highlights.push(m[1].trim());
    else rest.push(line);
  }
  return { tagline: rest.join(' ').trim(), highlights };
}

/** The listing record's fields that make it Helm's own copy of the listing. */
export type ListingCopyFields = {
  title?: string | null;
  summary?: string | null;
  space?: string | null;
  access?: string | null;
  interaction?: string | null;
  neighborhood?: string | null;
  notes?: string | null;
  amenities?: readonly string[] | null;
  amenities_not_included?: readonly string[] | null;
};

/**
 * Has Helm written any listing copy of its own: the copy, the amenities, or
 * a photo? The registry title (properties.title) does not count; every home
 * has one. On a Guesty-run home with none of these the Listing section is one
 * line, not a run of empty blocks.
 */
export function hasListingCopy(content: ListingCopyFields | null | undefined, photoCount: number): boolean {
  if (photoCount > 0) return true;
  if (!content) return false;
  const text = [content.title, content.summary, content.space, content.access, content.interaction, content.neighborhood, content.notes];
  return text.some((t) => !!t && t.trim() !== '') || (content.amenities?.length ?? 0) > 0 || (content.amenities_not_included?.length ?? 0) > 0;
}

/** The live staycapeann.com copy, read-only, for a home Helm has no copy of. */
export type ScaListingSnapshot = {
  title: string;
  tagline: string;
  highlights: string[];
  /** The About text as the site renders it, paragraphs split on blank lines. */
  about: string;
  rooms: Array<{ name: string; beds: string }>;
  heroPhoto: string | null;
};

/** A registry entry (the site's own listing record) as the snapshot reads it. */
export function scaSnapshotFrom(entry: Record<string, unknown> | null | undefined): ScaListingSnapshot | null {
  if (!entry) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const snapshot: ScaListingSnapshot = {
    title: str(entry.publicName),
    tagline: str(entry.tagline) || str(entry.pitch),
    highlights: list(entry.highlights).map(str).filter(Boolean),
    about: str(entry.description),
    rooms: list(entry.sleepingArrangements)
      .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
      .map((r) => ({ name: str(r.name), beds: str(r.beds) }))
      .filter((r) => r.name || r.beds),
    heroPhoto: str(entry.heroPhoto) || null,
  };
  const anything = snapshot.title || snapshot.tagline || snapshot.highlights.length || snapshot.about || snapshot.rooms.length;
  return anything ? snapshot : null;
}
