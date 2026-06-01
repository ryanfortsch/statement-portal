import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Markdown } from '@/components/Markdown';
import {
  getPlaybookEntryBySlug,
  getEntryRevisions,
  getPropertyOptions,
  categoryLabel,
  STATUS_LABELS,
} from '@/lib/playbook';
import { displayNameForEmail } from '@/lib/team';
import { DeleteEntryButton } from './DeleteEntryButton';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function PlaybookEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect(`/auth/signin?callbackUrl=/playbook/${slug}`);

  const entry = await getPlaybookEntryBySlug(slug);
  if (!entry) notFound();

  const [revisions, properties] = await Promise.all([getEntryRevisions(entry.id), getPropertyOptions()]);
  const propertyName = entry.property_id
    ? properties.find((p) => p.id === entry.property_id)?.name ?? null
    : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="playbook" />

      <article className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 36, paddingBottom: 64 }}>
        {/* Back + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26, gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/playbook"
            style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--ink-3)', textDecoration: 'none' }}
          >
            ← Playbook
          </Link>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              href={`/playbook/${entry.slug}/edit`}
              style={{
                fontSize: 13, fontWeight: 600, padding: '7px 15px', borderRadius: 4,
                border: '1px solid var(--ink)', color: 'var(--ink)', textDecoration: 'none',
              }}
            >
              Edit
            </Link>
            <DeleteEntryButton id={entry.id} title={entry.title} />
          </div>
        </div>

        {/* Reading column */}
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            {categoryLabel(entry.category)}
            {entry.status !== 'published' && <span style={{ color: 'var(--signal)' }}> · {STATUS_LABELS[entry.status]}</span>}
          </div>

          <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 38, fontWeight: 300, lineHeight: 1.12, color: 'var(--ink)', margin: '0 0 14px' }}>
            {entry.pinned && <span title="Pinned" style={{ color: 'var(--signal)' }}>★ </span>}
            {entry.title}
          </h1>

          {entry.summary && (
            <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 20px' }}>{entry.summary}</p>
          )}

          {/* Meta strip */}
          <div
            style={{
              display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
              borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
              padding: '12px 0', marginBottom: 30, fontSize: 12, color: 'var(--ink-4)',
            }}
          >
            <span>Updated {formatDate(entry.updated_at)}</span>
            <span>By {displayNameForEmail(entry.updated_by_email || entry.created_by_email)}</span>
            {propertyName && <span style={{ color: 'var(--tide-deep)' }}>Scope: {propertyName}</span>}
            {!propertyName && <span>Scope: All properties</span>}
            {entry.tags.length > 0 && (
              <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>
                {entry.tags.map((t) => `#${t}`).join('  ')}
              </span>
            )}
          </div>

          {/* Body */}
          <Markdown source={entry.body_md} />

          {/* Revision history */}
          {revisions.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>History</div>
              <div style={{ borderTop: '1px solid var(--rule)' }}>
                {revisions.map((r) => (
                  <div
                    key={r.id}
                    style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 12.5, color: 'var(--ink-3)' }}
                  >
                    <span>
                      {displayNameForEmail(r.by_email)}
                      {r.change_note && <span style={{ color: 'var(--ink-4)' }}> · {r.change_note}</span>}
                    </span>
                    <span style={{ color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{formatDate(r.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>

      <div className="flex-1" />
      <HelmFooter module="Playbook" />
    </div>
  );
}
