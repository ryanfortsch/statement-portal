import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import * as gh from '@/lib/github';
import { listScaListingCopy, type ListingCopyRow } from '../[id]/stay-cape-ann/actions';
import { ListingCopyStudio } from './ListingCopyStudio';

export const dynamic = 'force-dynamic';

/**
 * One screen to review and fix the editorial copy on every Stay Cape Ann
 * listing. Each listing's current tagline / About / highlights are shown inline
 * (from data/ical-urls.json, the source of what's on the site) and flagged when
 * the copy looks like OTA brochure-speak. The operator edits any of them by hand
 * (or redrafts from Guesty), and one Publish ships every edit in a single PR that
 * rebuilds the site once. The registry is the single source for this copy — the
 * nightly Guesty refresh never overwrites it.
 */
export default async function ListingCopyStudioPage() {
  const session = await auth();
  const signedIn = !!session?.user?.email;
  const githubConfigured = gh.isGithubConfigured();

  let rows: ListingCopyRow[] = [];
  let error: string | null = null;
  if (signedIn && githubConfigured) {
    const res = await listScaListingCopy();
    if (res.ok) rows = res.rows;
    else error = res.error;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      <div className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingTop: 20 }}>
        <Link
          href="/properties"
          style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '.04em' }}
        >
          ← Properties
        </Link>
      </div>

      <HelmHero
        eyebrow="Helm · Properties"
        title="Listing copy on"
        emphasis="Stay Cape Ann"
        description="Review every listing's editorial copy in one place. Flagged listings read like OTA brochure-speak. Edit the tagline, About, and highlights by hand or redraft from Guesty, then publish all your edits in one pass. Nothing goes live until you click Publish."
        paddingTop={28}
      />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80, flex: 1 }}>
        {!signedIn ? (
          <Notice>Sign in with your Rising Tide account to edit listing copy.</Notice>
        ) : !githubConfigured ? (
          <Notice>
            GITHUB_TOKEN is not configured on Helm, so it can&apos;t reach the Stay Cape Ann repo. Add it in
            Vercel, then reload.
          </Notice>
        ) : error ? (
          <Notice>{error}</Notice>
        ) : rows.length === 0 ? (
          <Notice>No live Stay Cape Ann listings found yet.</Notice>
        ) : (
          <ListingCopyStudio initialRows={rows} />
        )}
      </main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px dashed var(--rule)',
        padding: '24px 26px',
        fontSize: 14,
        color: 'var(--ink-3)',
        marginTop: 24,
      }}
    >
      {children}
    </div>
  );
}
