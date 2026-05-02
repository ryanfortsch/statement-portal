import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
import { createProjection } from '../actions';

export const dynamic = 'force-dynamic';

export default function NewProjectionPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="projections" />

      <section className="max-w-[860px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/projections" style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
            ← Prospects
          </Link>
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          A new <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>prospect.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Punch in the prospect&rsquo;s property and contact details. Save the record and you&rsquo;ll be able to render the projection deck, partnership guide, and management contract from the next screen.
        </p>
      </section>

      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <ProjectionForm action={createProjection} submitLabel="Create prospect" />
      </section>
    </div>
  );
}
