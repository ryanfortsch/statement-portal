import { redirect } from 'next/navigation';

/**
 * The prospect funnel list lives at /properties/prospects (the same
 * <ProspectsPanel> renders there). This standalone index redirects so
 * there's a single home for the list. The workroom moved to /prospects
 * (/prospects/[id], /prospects/new); only the public deliverable pages
 * (/projections/[id]/render|guide|contract|onboarding-render) stay here
 * because external callers (proxy allowlist + Puppeteer) hit those URLs.
 */
export default function ProjectionsIndexRedirect() {
  redirect('/properties/prospects');
}
