import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  buildCheckoutSchedule,
  todayET,
  addDays,
  type ScheduleDay,
} from '@/lib/checkout-schedule';
import { loadVendorTimes } from '@/lib/cleaner-digest';

/**
 * The cleaner's live schedule page. Reached from the daily digest SMS
 * (each recipient's link carries their own token) and bookmarkable: it
 * renders the LIVE merged schedule (bookings + Helm adjustments +
 * per-property times) on every load, so a text sent yesterday at 4pm is
 * still true at 7am. Portuguese-first, phone-first, zero chrome.
 *
 * Auth = knowledge of the 32-hex token on an RLS-locked table read
 * through the service-role client (the /onboarding/<token> pattern).
 * Shows no guest names, no codes, no money - addresses and times only.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Agenda de limpezas · Rising Tide',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const DAYS_SHOWN = 7;

function etHourNow(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()),
  );
}

function ptDayShort(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
    .replace('.', '');
}

function ptDayLong(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function enDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export default async function CleanerSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { token } = await params;
  // 16 hex is the current issue; 32 is the original format, still honoured
  // so any older link keeps working.
  if (!/^[a-f0-9]{16}$|^[a-f0-9]{32}$/.test(token)) notFound();
  const { data: recipient } = await supabase
    .from('cleaner_schedule_recipients')
    .select('phone, display_name')
    .eq('portal_token', token)
    .maybeSingle();
  if (!recipient) notFound();

  const today = todayET();
  const days = await buildCheckoutSchedule(supabase, { startDate: today, days: DAYS_SHOWN });

  const { d } = await searchParams;
  const inRange = d && days.some((x) => x.date === d);
  // The SMS link carries no date any more (every character counts), so the
  // page has to work out which day the cleaner was texted about. The day of
  // the most recently SENT digest is exactly that, and it beats guessing by
  // clock: approving at 10am for tomorrow used to land the link on today.
  // Falls back to the old rule when nothing has been sent.
  let sentDay: string | null = null;
  try {
    const { data } = await supabase
      .from('cleaner_schedule_digests')
      .select('service_date')
      .eq('status', 'sent')
      .gte('service_date', today)
      .order('service_date', { ascending: true })
      .limit(1)
      .maybeSingle();
    const candidate = (data as { service_date: string } | null)?.service_date ?? null;
    if (candidate && days.some((x) => x.date === candidate)) sentDay = candidate;
  } catch {
    // Never let the default-day lookup keep the schedule from rendering.
  }
  const selectedDate = inRange
    ? d!
    : sentDay ?? (etHourNow() < 15 ? today : addDays(today, 1));
  const selected: ScheduleDay = days.find((x) => x.date === selectedDate) ?? days[0];

  // Order by the cleaning times the vendor committed to, matching the daily
  // text exactly. Checkout times are often identical across the fleet, so
  // they say nothing about the route; the vendor's own times do. Checkout
  // still shows as "saida" because that is when the house frees up.
  const vendorTimes = await loadVendorTimes(supabase, selected.date);
  const rows = [...selected.rows].sort((a, b) => {
    const ta = vendorTimes.get(a.propertyId) ?? a.time;
    const tb = vendorTimes.get(b.propertyId) ?? b.time;
    return ta.localeCompare(tb) || a.propertyName.localeCompare(b.propertyName);
  });

  return (
    <>
      <style>{css}</style>
      <div className="rt-cl-page">
        <header className="rt-cl-mast">
          <div className="rt-cl-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" />
            <div>
              <div className="rt-cl-brandname">Rising Tide</div>
              <div className="rt-cl-brandsub">Agenda de limpezas · cleaning schedule</div>
            </div>
          </div>
        </header>

        <nav className="rt-cl-days" aria-label="Dias">
          {days.map((day, i) => {
            const label = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : ptDayShort(day.date);
            const active = day.date === selected.date;
            return (
              <a key={day.date} href={`?d=${day.date}`} className={`rt-cl-day${active ? ' is-active' : ''}`}>
                <span className="rt-cl-dayname">{label}</span>
                <span className="rt-cl-daycount">{day.counts.checkouts}</span>
              </a>
            );
          })}
        </nav>

        <div className="rt-cl-datehead">
          <h1>{ptDayLong(selected.date)}</h1>
          <div className="rt-cl-dateen">{enDay(selected.date)} · sempre ao vivo / always live</div>
        </div>

        {selected.rows.length === 0 ? (
          <div className="rt-cl-empty">
            <div className="rt-cl-emptymark">☀</div>
            Nenhum check-out neste dia.
            <span>No checkouts this day.</span>
          </div>
        ) : (
          <ol className="rt-cl-list">
            {rows.map((r) => {
              const clean = vendorTimes.get(r.propertyId);
              return (
              <li key={`${r.propertyId}|${r.checkIn}`} className="rt-cl-row">
                <div className="rt-cl-time">
                  {clean ?? r.time}
                  {clean && <div className="rt-cl-sub">saída {r.time}</div>}
                  {!clean && r.adjustment?.adjustedTime && <div className="rt-cl-was">era {r.defaultTime}</div>}
                </div>
                <div className="rt-cl-body">
                  <div className="rt-cl-name">{r.propertyName}</div>
                  <div className="rt-cl-addr">
                    {r.address}
                    {r.city ? `, ${r.city}` : ''}
                  </div>
                  <div className="rt-cl-tags">
                    {r.sameDayTurnover && (
                      <span className="rt-cl-tag is-sameday">mesmo dia · próx. entrada {r.nextCheckinTime}</span>
                    )}
                    {r.adjustment?.adjustedTime && <span className="rt-cl-tag">horário ajustado</span>}
                    {r.adjustment?.adjustedDate && r.adjustment.adjustedDate !== r.baseCheckOut && (
                      <span className="rt-cl-tag">estadia estendida</span>
                    )}
                    {clean && clean < r.time && (
                      <span className="rt-cl-tag is-sameday">atenção: saída só às {r.time}</span>
                    )}
                    {!r.sameDayTurnover && <span className="rt-cl-tag is-quiet">sem entrada no mesmo dia</span>}
                  </div>
                </div>
              </li>
              );
            })}
          </ol>
        )}

        <footer className="rt-cl-foot">
          Rising Tide STR · Gloucester MA
          <span>Dúvidas? Fale com a equipe pelo número de sempre.</span>
        </footer>
      </div>
    </>
  );
}

const css = `
  html, body { margin: 0; background: var(--paper); color: var(--ink); }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .rt-cl-page {
    max-width: 560px;
    margin: 0 auto;
    padding: max(14px, env(safe-area-inset-top)) clamp(16px, 5vw, 24px) calc(40px + env(safe-area-inset-bottom, 0px));
  }
  .rt-cl-mast { padding: 10px 0 14px; border-bottom: 1px solid var(--ink); }
  .rt-cl-brand { display: flex; align-items: center; gap: 12px; }
  .rt-cl-brand img { width: 34px; height: 34px; }
  .rt-cl-brandname {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 19px; font-weight: 500; letter-spacing: -0.01em;
  }
  .rt-cl-brandsub { font-size: 11px; color: var(--ink-4); letter-spacing: 0.06em; margin-top: 1px; }

  .rt-cl-days {
    display: flex; gap: 8px; overflow-x: auto; padding: 14px 0 4px;
    -webkit-overflow-scrolling: touch; scrollbar-width: none;
  }
  .rt-cl-days::-webkit-scrollbar { display: none; }
  .rt-cl-day {
    flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 3px;
    min-width: 62px; padding: 9px 10px; border: 1px solid var(--rule); border-radius: 10px;
    text-decoration: none; color: var(--ink-3);
  }
  .rt-cl-day.is-active { border-color: var(--ink); background: var(--ink); color: var(--paper); }
  .rt-cl-dayname { font-size: 12px; font-weight: 600; text-transform: lowercase; letter-spacing: 0.02em; }
  .rt-cl-daycount { font-family: var(--font-mono), monospace; font-size: 15px; font-weight: 700; }

  .rt-cl-datehead { margin-top: 20px; }
  .rt-cl-datehead h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: clamp(26px, 7vw, 34px); font-weight: 300; letter-spacing: -0.02em;
    margin: 0; text-transform: capitalize;
  }
  .rt-cl-dateen { font-size: 11px; color: var(--ink-4); letter-spacing: 0.08em; margin-top: 4px; text-transform: uppercase; }

  .rt-cl-list { list-style: none; margin: 18px 0 0; padding: 0; }
  .rt-cl-row {
    display: flex; gap: 16px; padding: 18px 0;
    border-top: 1px solid var(--rule); align-items: flex-start;
  }
  .rt-cl-row:first-child { border-top: 1px solid var(--ink); }
  .rt-cl-time {
    font-family: var(--font-mono), monospace; font-size: 26px; font-weight: 700;
    min-width: 86px; line-height: 1; padding-top: 2px; letter-spacing: -0.02em;
  }
  .rt-cl-sub { font-size: 12px; font-weight: 500; color: var(--ink-4); margin-top: 6px; letter-spacing: 0.02em; }
  .rt-cl-was { font-size: 11px; font-weight: 500; color: var(--signal); margin-top: 6px; letter-spacing: 0.02em; text-decoration: line-through; text-decoration-color: var(--ink-4); text-decoration-thickness: 1px; }
  .rt-cl-body { flex: 1; min-width: 0; }
  .rt-cl-name {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 20px; font-weight: 500; letter-spacing: -0.01em;
  }
  .rt-cl-addr { font-size: 13px; color: var(--ink-3); margin-top: 2px; }
  .rt-cl-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .rt-cl-tag {
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    padding: 3px 9px; border-radius: 4px; border: 1px solid var(--rule); color: var(--ink-3);
  }
  .rt-cl-tag.is-sameday { border-color: var(--signal); color: #fff; background: var(--signal); }
  .rt-cl-tag.is-quiet { border-style: dashed; color: var(--ink-4); font-weight: 500; }

  .rt-cl-empty {
    margin-top: 34px; padding: 40px 20px; text-align: center;
    border: 1px dashed var(--rule); border-radius: 12px;
    font-size: 16px; color: var(--ink-3);
    display: flex; flex-direction: column; gap: 6px; align-items: center;
  }
  .rt-cl-emptymark { font-size: 28px; }
  .rt-cl-empty span { font-size: 12px; color: var(--ink-4); }

  .rt-cl-foot {
    margin-top: 44px; padding-top: 16px; border-top: 1px solid var(--rule);
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-4);
    display: flex; flex-direction: column; gap: 4px;
  }
  .rt-cl-foot span { letter-spacing: 0.04em; text-transform: none; font-size: 11px; }
`;
