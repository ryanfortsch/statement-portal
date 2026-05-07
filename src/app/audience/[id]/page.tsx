import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { getContact, listContactEvents } from '@/lib/audience';
import { displayName } from '@/lib/audience-types';
import { unsubscribeContact, resubscribeContact } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, events] = await Promise.all([
    getContact(id),
    listContactEvents(id, 50),
  ]);

  if (!contact) notFound();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="audience" />

      {/* HEADER */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/audience" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Audience</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          {displayName(contact)}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {contact.email}
        </p>
      </section>

      {/* META STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Field label="Status" value={contact.status} />
          <Field label="Subscribed" value={contact.subscribed_at ? formatDate(contact.subscribed_at) : '—'} />
          <Field label="Source" value={contact.source ?? '—'} />
          <Field label="Sent / Opened" value={`${contact.total_sent} / ${contact.total_opened}`} last />
        </div>
      </section>

      {/* TAGS */}
      {contact.tags.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 28, width: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Tags</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {contact.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  letterSpacing: '.04em',
                  padding: '4px 10px',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Actions</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {contact.status === 'subscribed' ? (
            <form action={unsubscribeContact}>
              <input type="hidden" name="id" value={contact.id} />
              <button type="submit" style={dangerButtonStyle}>
                Unsubscribe
              </button>
            </form>
          ) : (
            <form action={resubscribeContact}>
              <input type="hidden" name="id" value={contact.id} />
              <button type="submit" style={primaryButtonStyle}>
                Resubscribe
              </button>
            </form>
          )}
          <a href={`mailto:${contact.email}`} style={secondaryButtonStyle}>
            Send 1:1 email
          </a>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Timeline</div>
        {events.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            No events recorded yet. Engagement events arrive after the first send.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {events.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr',
                  gap: 20,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {formatDateTime(e.occurred_at)}
                </span>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 11, color: 'var(--ink-3)', marginRight: 10 }}>
                    {e.event_type}
                  </span>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <code className="font-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {Object.entries(e.metadata)
                        .filter(([k]) => k !== 'raw')
                        .slice(0, 3)
                        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
                        .join(' · ')}
                    </code>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
          <span>Rising Tide &middot; Audience</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            id: {contact.id.slice(0, 8)}
          </span>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: 'var(--signal)',
  color: 'var(--signal)',
};
