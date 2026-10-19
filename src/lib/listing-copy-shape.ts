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
