import Link from 'next/link';
import {
  CONTACT_TYPE_LABELS,
  TOUCH_CHANNEL_LABELS,
  TOUCH_SOURCE_LABELS,
  touchSource,
  type ContactRow,
  type ContactTouchRow,
  type ContactType,
  type TouchChannel,
} from '@/lib/crm';

/**
 * "Contacts" section on the property detail page. Pulls every CRM contact
 * whose linked_property_ids array contains this property id, plus the
 * most recent touches across those contacts. Renders inline so the
 * operator doesn't have to bounce out to /crm/[id] just to see who has
 * been called, texted, or emailed about this house.
 *
 * Touches are grouped under their owning contact (rather than a flat
 * timeline across the whole property) because the natural triage on a
 * property is "what's going on with the OWNER" or "what's going on with
 * the CLEANER" - not "what touches happened, regardless of who."
 *
 * No client JS here. Native `<details>` per-contact handles the inline
 * expand so a property with 6 contacts can show titles + last-touch
 * summaries collapsed, and the operator drills into the one she cares
 * about.
 */

type Props = {
  contacts: ContactRow[];
  touchesByContact: Record<string, ContactTouchRow[]>;
};

const CONTACT_TYPE_ORDER: ContactType[] = ['owner', 'vendor', 'lead', 'other'];

export function PropertyCrmSection({ contacts, touchesByContact }: Props) {
  if (contacts.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
        No CRM contacts linked to this property yet.
        {' '}
        <Link
          href="/crm"
          style={{ color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Add one in CRM →
        </Link>
      </p>
    );
  }

  // Group by type, then alpha within each group. Owners first, vendors next.
  const grouped: Record<ContactType, ContactRow[]> = {
    owner: [],
    vendor: [],
    lead: [],
    other: [],
  };
  for (const c of contacts) grouped[c.type].push(c);
  for (const list of Object.values(grouped)) list.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {CONTACT_TYPE_ORDER.flatMap((type) =>
        grouped[type].map((c) => (
          <ContactCard
            key={c.id}
            contact={c}
            touches={touchesByContact[c.id] ?? []}
          />
        )),
      )}
    </div>
  );
}

function ContactCard({
  contact: c,
  touches,
}: {
  contact: ContactRow;
  touches: ContactTouchRow[];
}) {
  const lastTouch = touches[0] ?? null;
  const recent = touches.slice(0, 3);

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <h3
          className="font-serif"
          style={{
            fontSize: 18,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {c.name}
        </h3>
        <TypeChip type={c.type} />
        {c.organization && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {c.organization}
          </span>
        )}
        <Link
          href={`/crm/${c.id}`}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          Full record →
        </Link>
      </div>

      <ContactReachLine contact={c} />

      {recent.length > 0 ? (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px dotted var(--rule)',
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Recent touches
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map((t) => (
              <TouchRow key={t.id} touch={t} />
            ))}
          </ul>
          {touches.length > recent.length && (
            <Link
              href={`/crm/${c.id}`}
              style={{
                display: 'inline-block',
                marginTop: 10,
                fontSize: 11,
                letterSpacing: '.04em',
                color: 'var(--ink-3)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {touches.length - recent.length} more in CRM →
            </Link>
          )}
        </div>
      ) : lastTouch ? null : (
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          No touches logged yet.
        </p>
      )}
    </div>
  );
}

function ContactReachLine({ contact: c }: { contact: ContactRow }) {
  const hasAny = c.emails.length > 0 || c.phone;
  if (!hasAny) {
    return (
      <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: 0 }}>
        No email or phone on file.
      </p>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '4px 14px',
        fontSize: 12,
      }}
    >
      {c.emails.map((e) => (
        <a
          key={e}
          href={`mailto:${e}`}
          className="font-mono"
          style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 11 }}
        >
          {e}
        </a>
      ))}
      {c.phone && (
        <a
          href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}
          className="font-mono"
          style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3, fontSize: 11 }}
        >
          {c.phone}
        </a>
      )}
    </div>
  );
}

function TouchRow({ touch: t }: { touch: ContactTouchRow }) {
  const channel: TouchChannel = (t.channel ?? 'other') as TouchChannel;
  const channelLabel = TOUCH_CHANNEL_LABELS[channel];
  const source = touchSource(t);
  const isViaIntegration = source === 'gmail' || source === 'quo';
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 14,
        alignItems: 'baseline',
        fontSize: 12,
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          whiteSpace: 'nowrap',
          minWidth: 60,
        }}
      >
        {formatRelative(t.touched_at)}
      </span>
      <div>
        <span style={{ color: 'var(--ink)' }}>{t.summary || '(no summary)'}</span>
        <span style={{ marginLeft: 8, fontSize: 10, letterSpacing: '.08em', color: 'var(--ink-4)' }}>
          {t.direction === 'inbound' ? '← ' : '→ '}
          {channelLabel.toLowerCase()}
          {isViaIntegration && (
            <span style={{ color: 'var(--tide-deep)' }}> · via {TOUCH_SOURCE_LABELS[source]}</span>
          )}
        </span>
      </div>
    </li>
  );
}

function TypeChip({ type }: { type: ContactType }) {
  const color = type === 'owner' ? 'var(--ink)' : type === 'vendor' ? 'var(--tide-deep)' : 'var(--ink-3)';
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: 'var(--paper)',
        background: color,
        padding: '2px 7px',
      }}
    >
      {CONTACT_TYPE_LABELS[type]}
    </span>
  );
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
    const days = Math.round(diffMin / (60 * 24));
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
  } catch {
    return iso.slice(0, 10);
  }
}
