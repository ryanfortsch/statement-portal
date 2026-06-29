import { redirect } from 'next/navigation';

/**
 * The prospect funnel list now lives as the Prospects tab on the Properties
 * index (the same <ProspectsPanel> renders there). Consolidated 2026-06-29:
 * this standalone index redirects to that tab so there's a single home for
 * the list. The detail and create flows (/projections/[id], /projections/new)
 * are unchanged.
 */
export default function ProjectionsIndexRedirect() {
  redirect('/properties?view=prospects');
}
