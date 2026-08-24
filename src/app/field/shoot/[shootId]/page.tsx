import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadShootBrief, dayStatusLine, fmtShortDate } from '@/lib/creative-brief';
import { dollars } from '@/lib/field-types';

export const dynamic = 'force-dynamic';

/**
 * The contributor's SHOOT BRIEF — everything Cooper needs before he drives
 * over: the day, the home, whether it's actually empty, how to arrive and
 * park, how to get in, what the listing sells (so the reels sell the same
 * thing), and what to deliver. Cookie-auth like the packet page, with the
 * same ?office=1 read-only staff preview.
 */
export default async function ShootBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ shootId: string }>;
  searchParams: Promise<{ office?: string }>;
}) {
  const [{ shootId }, sp] = await Promise.all([params, searchParams]);
  // Preview is checked FIRST (same reasoning as /field home): a staffer who
  // also carries a test-contractor cookie still gets the preview they asked
  // for, instead of bouncing off the contractor-mismatch guard below.
  let preview = false;
  let contractor = null;
  if (sp.office === '1' && (await auth())?.user?.email) {
    preview = true;
  } else {
    contractor = await resolveContractorFromCookie();
    if (!contractor) redirect('/field');
  }

  const brief = await loadShootBrief(shootId);
  if (!brief) redirect('/field');
  const { detail, property, access, codesRevealed, dayStatus, scaUrl, heroPhotoUrl, mapsUrl } = brief;
  const { shoot, card } = detail;

  // The brief belongs to the shoot's contributor alone (or the office preview).
  if (!preview && contractor && shoot.contractor_id !== contractor.id) redirect('/field');

  const dayLine = dayStatusLine(brief, shoot.shoot_date);
  const accessRows: Array<[string, string]> = [];
  if (access) {
    if (access.smartLock) accessRows.push(['Door code', access.smartLock]);
    if (access.lockboxLocation) accessRows.push(['Lockbox', access.lockboxLocation]);
    if (access.gateCode) accessRows.push(['Gate', access.gateCode]);
    if (access.garageCode) accessRows.push(['Garage', access.garageCode]);
    if (access.alarm) accessRows.push(['Alarm', access.alarm]);
  }
  // "Entry details appear the day before" is only true when there IS a home
  // to enter — a b-roll / town day skips the section entirely.
  const showCodesLater = !!property && !codesRevealed && shoot.shoot_date >= new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '28px 20px 60px' }}>
        {preview && (
          <div style={{ fontSize: 12, color: 'var(--signal)', border: '1px solid var(--signal)', borderRadius: 8, padding: '6px 12px', marginBottom: 14 }}>
            Office preview — this is what {detail.contractorName.split(' ')[0]} sees.
          </div>
        )}
        <Link href="/field" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Your portal</Link>

        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--signal)', marginTop: 16 }}>
          {fmtLongDate(shoot.shoot_date)}
        </div>
        <h1 className="font-serif" style={{ fontSize: 27, fontWeight: 400, margin: '4px 0 2px' }}>{shoot.title}</h1>
        {property && (
          <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>
            {property.address}{property.city ? `, ${property.city}` : ''}
            {mapsUrl && (
              <>
                {' · '}
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>Map ↗</a>
              </>
            )}
          </div>
        )}
        {shoot.location_note && <div style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 4 }}>{shoot.location_note}</div>}

        {/* Is the day actually a go — same check the maintenance planner trusts. */}
        {dayLine && (
          <div
            style={{
              marginTop: 16,
              borderLeft: `3px solid ${dayStatus?.clear ? 'var(--positive)' : 'var(--signal)'}`,
              background: dayStatus?.clear ? 'rgba(46,125,80,0.07)' : 'rgba(200,90,58,0.07)',
              padding: '10px 14px',
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            {dayLine}
            {!dayStatus?.clear && ' The office will confirm before you head over.'}
          </div>
        )}

        {heroPhotoUrl && (
          // The listing's lead shot — so the house is recognizable from the street.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroPhotoUrl} alt={property?.name ?? shoot.title} style={{ width: '100%', borderRadius: 12, marginTop: 18, display: 'block' }} />
        )}

        <Section title="What we need">
          <p style={sectionText}>
            Up to {card.maxPerShoot} reel{card.maxPerShoot === 1 ? '' : 's'} ({card.minSeconds}s+) and {card.maxCarouselsPerShoot} carousel{card.maxCarouselsPerShoot === 1 ? '' : 's'} of photos.
            {' '}{dollars(card.baseCents)} per reel and {dollars(card.carouselCents)} for the carousel, paid on delivery to your Finals folder — reel view bonuses follow after we post.
          </p>
          {shoot.notes && <p style={{ ...sectionText, whiteSpace: 'pre-wrap' }}>{shoot.notes}</p>}
        </Section>

        {scaUrl && (
          <Section title="Know the home">
            <p style={sectionText}>
              The listing guests see — the angles, rooms, and views that sell this place. Worth a skim before you frame anything:
              {' '}
              <a href={scaUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)' }}>{scaUrl.replace('https://', '')}</a>
            </p>
          </Section>
        )}

        {(access?.arrival || access?.parking) && (
          <Section title="Arrival & parking">
            {access.arrival && <p style={sectionText}>{access.arrival}</p>}
            {access.parking && <p style={sectionText}>{access.parking}</p>}
          </Section>
        )}

        {property && (
        <Section title="Getting in">
          {accessRows.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {accessRows.map(([label, value]) => (
                <div key={label} style={{ fontSize: 14 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>{label}: </span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          ) : showCodesLater ? (
            <p style={sectionText}>
              Entry details appear here the day before the shoot. If anything is unclear, call the office: <a href="tel:+19788652500" style={{ color: 'var(--tide-deep)' }}>(978) 865-2500</a>.
            </p>
          ) : (
            <p style={sectionText}>
              Call the office for entry: <a href="tel:+19788652500" style={{ color: 'var(--tide-deep)' }}>(978) 865-2500</a>.
            </p>
          )}
          {access?.method && <p style={{ ...sectionText, color: 'var(--ink-4)', fontSize: 12.5, marginTop: 8 }}>Guests get in via: {access.method}</p>}
        </Section>
        )}

        <Section title="Delivering">
          <p style={sectionText}>
            Drop finals in your Drive folder{shoot.drive_finals_folder_id ? ' (the dated Finals folder inside it)' : ''} — the moment the full set lands, your delivery pay goes due on its own.
            {detail.pay.settlesOn ? ` Current posts settle ${fmtShortDate(detail.pay.settlesOn)}.` : ''}
          </p>
        </Section>

        <div style={{ marginTop: 30, borderTop: '1px solid var(--rule)', paddingTop: 14, fontSize: 12, color: 'var(--ink-4)' }}>
          Rising Tide · Field — questions about the day? Call or text the office.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const sectionText: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, margin: '0 0 6px', color: 'var(--ink)' };

function fmtLongDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}
