import { redirect } from 'next/navigation';

/**
 * The Listing Copy Studio is retired (2026-10-18). It was a second editor
 * and a second publish path (Stage, then Publish all) for the tagline, About
 * and highlights each home's Stay Cape Ann launcher already edits. Its batch
 * review is the launcher index's Needs review filter: the same copy notes,
 * one link per listing, published from the listing's own launcher.
 */
export default function ListingCopyStudioRedirect() {
  redirect('/properties/stay-cape-ann?filter=review');
}
