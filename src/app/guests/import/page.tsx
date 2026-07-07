import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { importContactsFromCsv } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

export default function GuestImportPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot;Guests&middot; Import</div>
        <h1 className="font-serif" style={{
          fontSize: 44,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          maxWidth: 720,
        }}>
          Bring the list <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>over.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Drop a Squarespace Profiles CSV here. Existing contacts are matched by email and updated; new ones are added. Mailing-list memberships become tags. Booking.com proxy emails are auto-tagged so default segments skip them.
        </p>
      </section>

      {/* FORM */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <form
          action={importContactsFromCsv}
          encType="multipart/form-data"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '32px 0',
            display: 'grid',
            gap: 16,
          }}
        >
          <div>
            <label htmlFor="csv" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
              Profiles CSV
            </label>
            <input
              id="csv"
              name="csv"
              type="file"
              accept=".csv,text/csv"
              required
              style={{
                fontSize: 13,
                color: 'var(--ink)',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <SubmitButton
              label="Import →"
              busyLabel="Importing…"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '14px 28px',
                border: 'none',
                cursor: 'pointer',
              }}
            />
            <Link href="/guests" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Cancel
            </Link>
          </div>
        </form>
      </section>

      {/* INFO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>What we read</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          <ColumnRow name="Email" map="email (primary key, lowercased)" />
          <ColumnRow name="First Name / Last Name" map="first_name / last_name" />
          <ColumnRow name="Subscriber Since" map="subscribed_at (falls back to Created On)" />
          <ColumnRow name="Subscriber Source" map="source_detail (raw text preserved)" />
          <ColumnRow name="Mailing Lists" map="tags (comma-split)" />
          <ColumnRow name="Accepts Marketing" map="status: true→subscribed, false→unsubscribed" />
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot;Guests&middot; Import</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Squarespace → Helm
          </span>
        </div>
      </footer>
    </div>
  );
}

function ColumnRow({ name, map }: { name: string; map: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: 24,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        fontSize: 13,
      }}
    >
      <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{name}</span>
      <span style={{ color: 'var(--ink)' }}>{map}</span>
    </div>
  );
}
