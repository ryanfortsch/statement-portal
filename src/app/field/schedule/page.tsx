import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FieldShell } from '../FieldShell';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { fieldDb } from '@/lib/field-db';
import { loadPacketDetail } from '@/lib/field-packets';
import { loadVendorTimesForDay, VENDOR_LABEL } from '@/lib/vendor-schedule';
import { formatTime12 } from '@/lib/checkout-schedule';
import type { PacketDetail } from '@/lib/field-types';

/**
 * The inspector's own schedule, with the cleaner's booked time beside each
 * stop.
 *
 * Scoped strictly to packets awarded to THIS contractor. That is what makes
 * a tab safe here: the portal masks property identity until a packet is
 * claimed (loadPacketDetail's revealIdentity gate), so a fleet-wide
 * "everyone's cleanings" view would hand a 1099 contractor the addresses
 * and turnover rhythm of houses they were never awarded. Their own claimed
 * work already shows them those addresses, so adding the cleaning time to
 * it reveals nothing new about the fleet.
 *
 * Cape Ann Elite dispatches through Jobber, which announces about two days
 * ahead. Beyond that the honest answer is "not announced yet", and this
 * page says exactly that rather than implying nobody is coming. The vendor
 * time is never predicted: their arrival is a position in that day's route,
 * not a property attribute, and the per-property historical median misses
 * by an average of 56 minutes.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Schedule · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const WORKING_STATUSES = ['claimed', 'in_progress', 'submitted', 'approved'];

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function dayHeading(date: string, today: string): string {
  const base = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  if (date === today) return `Today · ${base}`;
  return base;
}

export default async function FieldSchedulePage() {
  const contractor = await resolveContractorFromCookie().catch(() => null);
  if (!contractor) redirect('/field');

  const today = todayET();
  const { data: rows } = await fieldDb()
    .from('inspection_packets')
    .select('id')
    .eq('awarded_contractor_id', contractor.id)
    .in('status', WORKING_STATUSES)
    .gte('visit_date', today)
    .order('visit_date', { ascending: true });

  const packets = (
    await Promise.all(((rows ?? []) as { id: string }[]).map((r) => loadPacketDetail(r.id)))
  ).filter(Boolean) as PacketDetail[];

  // One vendor lookup per distinct visit day, not per stop.
  const days = [...new Set(packets.map((p) => p.visit_date))].sort();
  const vendorByDay = new Map<string, Map<string, string>>();
  for (const d of days) {
    vendorByDay.set(d, await loadVendorTimesForDay(fieldDb(), d));
  }

  return (
    <FieldShell contractorName={contractor.full_name}>
      <h1 className="font-serif" style={{ fontSize: 26, fontWeight: 400, margin: '4px 0 6px' }}>
        Your schedule
      </h1>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, margin: '0 0 22px' }}>
        Your claimed work, with {VENDOR_LABEL}&rsquo;s booked cleaning time where they have
        confirmed it. They confirm about two days ahead.
      </p>

      {packets.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--rule)',
            borderRadius: 10,
            padding: '30px 20px',
            textAlign: 'center',
            fontSize: 14,
            color: 'var(--ink-3)',
          }}
        >
          No claimed work coming up.
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <Link href="/field" style={{ color: 'var(--signal)' }}>
              See what&rsquo;s available →
            </Link>
          </div>
        </div>
      )}

      {days.map((date) => {
        const dayPackets = packets.filter((p) => p.visit_date === date);
        const vendorTimes = vendorByDay.get(date) ?? new Map<string, string>();
        // Sort by the cleaner's time where known so the day reads in the
        // order the houses actually free up; unannounced stops keep their
        // walk order and fall to the end.
        const stops = dayPackets
          .flatMap((p) => p.stops.map((s) => ({ stop: s, packet: p })))
          .map((x) => ({ ...x, time: vendorTimes.get(x.stop.property_id) ?? null }))
          .sort((a, b) => {
            if (a.time && b.time) return a.time.localeCompare(b.time);
            if (a.time) return -1;
            if (b.time) return 1;
            return a.stop.walk_order - b.stop.walk_order;
          });

        return (
          <section key={date} style={{ marginBottom: 26 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--ink-4)',
                borderBottom: '1px solid var(--ink)',
                paddingBottom: 6,
              }}
            >
              {dayHeading(date, today)}
            </div>

            {stops.map(({ stop, packet, time }) => (
              <div
                key={stop.id}
                style={{
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                  padding: '13px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <div style={{ minWidth: 76 }}>
                  {time ? (
                    <>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono), monospace',
                          fontSize: 17,
                          fontWeight: 700,
                          color: '#875a17',
                        }}
                      >
                        {formatTime12(time)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>cleaning</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>
                      not
                      <br />
                      announced
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Property NAME, not address: 53 Rocky Neck and its
                      downstairs unit sit on one street, and sending an
                      inspector to the wrong half is the error the vendor
                      matcher already guards against on ingest. */}
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{stop.property.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                    {stop.property.address}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Link
                      href={`/field/packet/${packet.id}`}
                      style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                    >
                      {packet.title} →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {packets.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.6, marginTop: 4 }}>
          Times are {VENDOR_LABEL}&rsquo;s own booking and can move. If a home is still being
          cleaned when you arrive, call the office rather than working around them.
        </p>
      )}
    </FieldShell>
  );
}
