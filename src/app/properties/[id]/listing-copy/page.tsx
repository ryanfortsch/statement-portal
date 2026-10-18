import { redirect } from 'next/navigation';

/**
 * Draft listing is retired as a page (2026-10-18). It saved nothing: the
 * operator drafted here, copied, and pasted into the form that saves. The
 * same generator is now "Draft with AI" in the two forms that save it: the
 * Stay Cape Ann launcher's Step 1 (tagline, About, highlights) and the
 * property page's Listing section (the Guesty description fields). Old
 * links and bookmarks land on the launcher.
 */
export default async function ListingCopyRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/properties/${encodeURIComponent(id)}/stay-cape-ann`);
}
