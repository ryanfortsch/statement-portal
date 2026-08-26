import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadShootBrief, dayStatusLine, fmtShortDate, type EntryPlan } from '@/lib/creative-brief';
import { dollars } from '@/lib/field-types';

const OFFICE_TEL = '+19788652500';

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
  const { detail, property, access, entry, dayStatus, scaUrl, heroPhotoUrl, mapsUrl, window: workWindow } = brief;
  const { shoot, card } = detail;

  // The brief belongs to the shoot's contributor alone (or the office preview).
  if (!preview && contractor && shoot.contractor_id !== contractor.id) redirect('/field');

  const dayLine = dayStatusLine(brief);
  // Extras BEYOND the way in — gate, garage, alarm. The door itself is the
  // resolved EntryPlan, so it never appears twice.
  const extraRows: Array<[string, string]> = [];
  if (access) {
    if (access.gateCode) extraRows.push(['Gate', access.gateCode]);
    if (access.garageCode) extraRows.push(['Garage', access.garageCode]);
    if (access.alarm) extraRows.push(['Alarm', access.alarm]);
  }

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
          </p>
          <p style={sectionText}>
            {dollars(card.baseCents)} per reel, {dollars(card.carouselCents)} for the carousel. View bonuses come after we post.
          </p>
          {shoot.notes && <p style={{ ...sectionText, whiteSpace: 'pre-wrap' }}>{shoot.notes}</p>}
        </Section>

        {workWindow && (
          <Section title="Your window">
            <p style={sectionText}>{workWindow}</p>
          </Section>
        )}

        {(access?.arrival || access?.parking) && (
          <Section title="Where to park">
            {access.parking && <p style={sectionText}>{access.parking}</p>}
            {access.arrival && <p style={sectionText}>{access.arrival}</p>}
          </Section>
        )}

        {property && entry && (
        <Section title="Getting in">
          <EntryLines entry={entry} />
          {extraRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {extraRows.map(([label, value]) => (
                <div key={label} style={{ fontSize: 14 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>{label}: </span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        )}

        {scaUrl && (
          <Section title="Know the home">
            <p style={sectionText}>
              The listing guests see:{' '}
              <a href={scaUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)' }}>{scaUrl.replace('https://', '')}</a>
            </p>
          </Section>
        )}

        <Section title="Delivering">
          <p style={sectionText}>
            Drop finals in your{shoot.drive_finals_folder_id ? ' dated Finals folder' : ' Drive folder'}. Pay goes due when the full set lands.
            {shoot.drive_drone_folder_id ? ' Raw drone footage goes in the DRONE folder.' : ''}
          </p>
          {detail.pay.settlesOn && (
            <p style={sectionText}>Current posts settle {fmtShortDate(detail.pay.settlesOn)}.</p>
          )}
        </Section>

        <div style={{ marginTop: 30, borderTop: '1px solid var(--rule)', paddingTop: 14, fontSize: 12, color: 'var(--ink-4)' }}>
          Rising Tide · Field — questions about the day? Call or text the office.
        </div>
      </div>
    </div>
  );
}

/**
 * The one way in, spoken plainly. The creative PIN is the same at every home
 * on Seam, so it says so — that is the whole point of a fleet code. A home
 * without a Seam lock falls back to its own code or its lockbox, and those are
 * property secrets, so before the reveal window they show as "the day before"
 * rather than as digits.
 */
function EntryLines({ entry }: { entry: EntryPlan }) {
  const office = (
    <a href={`tel:${OFFICE_TEL}`} style={{ color: 'var(--tide-deep)' }}>(978) 865-2500</a>
  );
  if (entry.kind === 'creative' && entry.code) {
    return (
      <>
        <div style={{ fontSize: 14 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>Door code: </span>
          <span className="font-mono" style={{ fontSize: 17 }}>{entry.code}</span>
        </div>
        <p style={{ ...sectionText, color: 'var(--ink-4)', fontSize: 12.5, marginTop: 6 }}>
          Your code. Same one at every home with a keypad. Punch it, then the lock button.
        </p>
      </>
    );
  }
  if (entry.kind === 'listing') {
    return entry.code ? (
      <>
        <div style={{ fontSize: 14 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>Door code: </span>
          <span className="font-mono" style={{ fontSize: 17 }}>{entry.code}</span>
        </div>
        <p style={{ ...sectionText, color: 'var(--ink-4)', fontSize: 12.5, marginTop: 6 }}>
          This home has no keypad on our system, so this is the listing&apos;s own code.
        </p>
      </>
    ) : (
      <p style={sectionText}>The code for this home shows here the day before. Stuck? Call {office}.</p>
    );
  }
  if (entry.kind === 'lockbox') {
    return entry.detail ? (
      <div style={{ fontSize: 14 }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>Lockbox: </span>
        <span>{entry.detail}</span>
      </div>
    ) : (
      <p style={sectionText}>There&apos;s a lockbox here. Details show the day before. Stuck? Call {office}.</p>
    );
  }
  return <p style={sectionText}>Call the office to get in: {office}.</p>;
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
