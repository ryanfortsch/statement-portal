import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { auth } from '@/auth';
import * as gh from '@/lib/github';
import { listScaConformCandidates, type ConformCandidate } from '../[id]/stay-cape-ann/actions';
import { ConformScaClient } from './ConformScaClient';

export const dynamic = 'force-dynamic';

/**
 * Bulk tool to bring every live Stay Cape Ann listing's "About the home" into
 * the structured Airbnb format (the chosen house standard). For each listing it
 * pulls the home's Guesty copy, structures the About (verbatim when Guesty is
 * already structured, AI otherwise), and opens an update PR the operator reviews
 * and publishes — all from one screen.
 */
export default async function ConformScaPage() {
  const session = await auth();
  const signedIn = !!session?.user?.email;
  const githubConfigured = gh.isGithubConfigured();

  let candidates: ConformCandidate[] = [];
  let error: string | null = null;
  if (signedIn && githubConfigured) {
    const res = await listScaConformCandidates();
    if (res.ok) candidates = res.candidates;
    else error = res.error;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

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
        title="Conform listing copy to"
        emphasis="Stay Cape Ann"
        description="Bring every live listing's About into the structured Airbnb format. Helm pulls each home's Guesty copy, structures it, and opens an update PR you review and publish. Nothing goes live until you click Publish."
        paddingTop={28}
      />

      <main className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 80, flex: 1 }}>
        {!signedIn ? (
          <Notice>Sign in with your Rising Tide account to conform listings.</Notice>
        ) : !githubConfigured ? (
          <Notice>
            GITHUB_TOKEN is not configured on Helm, so it can&apos;t reach the Stay Cape Ann repo. Add it in
            Vercel, then reload.
          </Notice>
        ) : error ? (
          <Notice>{error}</Notice>
        ) : candidates.length === 0 ? (
          <Notice>No live Stay Cape Ann listings found yet.</Notice>
        ) : (
          <ConformScaClient initialCandidates={candidates} />
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
