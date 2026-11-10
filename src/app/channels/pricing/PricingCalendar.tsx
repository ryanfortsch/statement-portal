'use client';
import {useRef, useState} from 'react';
import {Button} from '@/components/Button';
import {EmptyState} from '@/components/EmptyState';
import {pricingCalendarMonth, pricingNightStatus, needsPricingAttention, type PricingNightStatus} from '@/lib/dynamic-pricing-view';
import type {PricingPolicy, PricingPreview, PricingSnapshot} from '@/lib/dynamic-pricing';

const money = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2}).format(n / 100);
const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});
const labels: Record<PricingNightStatus, string> = {ready: 'Ready', review: 'Needs review', manual: 'Manual rate', booked: 'Booked', blocked: 'Blocked', unknown: 'Missing data'};

export default function PricingCalendar({snapshot, preview, policy, onRules}: {
  snapshot: PricingSnapshot; preview: PricingPreview | null; policy: PricingPolicy; onRules: () => void;
}) {
  const months = [...new Set(snapshot.days.map(d => d.date.slice(0, 7)))];
  const [month, setMonth] = useState(months[0]), [layout, setLayout] = useState<'calendar' | 'table'>('calendar');
  const [filter, setFilter] = useState<'all' | 'attention'>('all'), [selectedDate, setSelectedDate] = useState('');
  const detail = useRef<HTMLElement>(null);
  function selectNight(date: string) {
    setSelectedDate(date);
    if (window.matchMedia('(max-width: 767px)').matches) {
      detail.current?.focus({preventScroll: true});
      detail.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  }
  const activeMonth = months.includes(month) ? month : months[0];
  const cells = pricingCalendarMonth(activeMonth, snapshot, preview);
  const visible = cells.filter(c => c?.day && (filter === 'all' || needsPricingAttention(c.status!)));
  const selected = visible.find(c => c!.date === selectedDate) ?? visible.find(c => c!.day!.state === 'open') ?? visible[0];
  const recommendation = selected?.recommendation;
  const attention = snapshot.days.filter(d => needsPricingAttention(pricingNightStatus(d, preview?.days.find(r => r.date === d.date))));
  const change = recommendation?.changePct;
  const steps = recommendation?.steps.filter((s, i, all) => !s.label.startsWith('Minimum stay:') && (i === 0 || s.resultCents !== all[i - 1].resultCents)) ?? [];
  const jumpToAttention = () => {
    setFilter('attention');
    if (attention[0]) {setMonth(attention[0].date.slice(0, 7)); setSelectedDate(attention[0].date);}
  };
  return <section aria-label="Nightly prices" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-sm">
      <p className="flex flex-wrap gap-x-3 gap-y-1"><span>Base <b>{money(policy.baseCents)}</b></span><span>Min <b>{money(policy.floorCents)}</b></span><span>Max <b>{money(policy.ceilingCents)}</b></span></p>
      {attention.length > 0 && <Button variant="quiet" size="sm" className="!normal-case !tracking-normal" onClick={jumpToAttention}>{attention.length} need review</Button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><Button size="sm" aria-label="Previous month" disabled={months.indexOf(activeMonth) === 0} onClick={() => setMonth(months[months.indexOf(activeMonth) - 1])}>←</Button>
        <label className="sr-only" htmlFor="pricing-month">Month</label><select id="pricing-month" className="min-w-0 border-0 bg-transparent py-2 text-base font-semibold" value={activeMonth} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <Button size="sm" aria-label="Next month" disabled={months.indexOf(activeMonth) === months.length - 1} onClick={() => setMonth(months[months.indexOf(activeMonth) + 1])}>→</Button></div>
      <div className="flex flex-wrap items-center gap-3"><label className="text-sm"><span className="sr-only">Show nights</span><select aria-label="Show nights" className="rounded border bg-white p-2" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="all">All nights</option><option value="attention">Needs attention</option></select></label>
        <div className="flex gap-1" role="group" aria-label="Price display">{(['calendar', 'table'] as const).map(v => <Button key={v} size="sm" variant={layout === v ? 'primary' : 'quiet'} className="!px-3 !normal-case !tracking-normal" aria-pressed={layout === v} onClick={() => setLayout(v)}>{v === 'calendar' ? 'Calendar' : 'Table'}</Button>)}</div></div>
    </div>
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_230px] xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        {layout === 'calendar' ? <div>
          <div className="grid grid-cols-7 border-b text-center text-xs text-slate-500">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="pb-2">{d}</div>)}</div>
          <div className="grid grid-cols-7" aria-label={`${monthLabel(activeMonth)} prices`}>
            {cells.map((cell, index) => {
              if (!cell) return <div key={`pad-${index}`} />;
              if (!cell.day) return <div key={cell.date} className="min-h-8 border-b p-1 text-xs text-slate-300 sm:p-3" aria-label={`${cell.date}, outside forecast`}>{cell.dayNumber}</div>;
              const matches = filter === 'all' || needsPricingAttention(cell.status!);
              const active = cell.date === selected?.date;
              return <Button key={cell.date} variant="quiet" className={`!block !min-h-20 !w-full !rounded-none !border-b !p-1 !text-left !no-underline !normal-case !tracking-normal sm:!p-3 ${active ? '!bg-slate-100 !ring-1 !ring-inset !ring-slate-500' : ''} ${matches ? '' : '!opacity-25'}`}
                disabled={!matches} aria-pressed={active} aria-label={`${dateLabel(cell.date)}, ${labels[cell.status!]}${cell.day.state === 'open' ? `, ${money(cell.recommendation?.recommendedCents)}` : ''}`} onClick={() => selectNight(cell.date)}>
                <span className="block text-xs font-normal text-slate-500">{cell.dayNumber}</span>
                <span className={`mt-2 block text-xs font-semibold tabular-nums sm:text-sm ${needsPricingAttention(cell.status!) ? 'text-amber-800' : 'text-slate-900'}`}>{cell.day.state === 'open' ? money(cell.recommendation?.recommendedCents) : labels[cell.status!]}</span>
                <span className="mt-1 block truncate text-[10px] font-normal text-slate-500">{cell.status === 'review' ? 'Review' : cell.status === 'manual' ? 'Manual' : cell.status === 'ready' ? `Min ${cell.recommendation?.minNights}` : ''}</span>
              </Button>;
            })}
          </div>
        </div> : <div className="overflow-auto"><table className="w-full text-left text-sm" aria-label="Monthly prices"><thead><tr>{['Night', 'Current', 'Proposed', 'Min stay', 'Status'].map(h => <th key={h} className="border-b px-2 py-3 text-xs font-medium">{h}</th>)}</tr></thead><tbody>{visible.map(cell => <tr key={cell!.date} className={selected?.date === cell!.date ? 'bg-slate-100' : ''}>
          <td className="border-b px-2 py-2"><Button variant="quiet" size="sm" onClick={() => selectNight(cell!.date)}>{dateLabel(cell!.date)}</Button></td><td className="border-b px-2 py-2 tabular-nums">{money(cell!.day!.currentCents)}</td><td className="border-b px-2 py-2 tabular-nums">{money(cell!.recommendation?.recommendedCents)}</td><td className="border-b px-2 py-2">{cell!.recommendation?.minNights ?? '—'}</td><td className="border-b px-2 py-2 text-xs">{labels[cell!.status!]}</td>
        </tr>)}</tbody></table></div>}
        {!visible.length && <EmptyState rule={false}>No nights need attention this month.</EmptyState>}
        <p className="mt-3 text-xs text-slate-500">Proposed nightly rates · taxes and fees excluded</p>
      </div>
      <aside ref={detail} tabIndex={-1} aria-label="Selected night" className="border-t pt-4 md:border-t-0 md:border-l md:pl-5 md:pt-0">
        {selected ? <>
          <h3 className="text-base font-semibold">{dateLabel(selected.date)}</h3><p className={`mt-1 text-xs ${needsPricingAttention(selected.status!) ? 'text-amber-800' : 'text-slate-500'}`}>{labels[selected.status!]}</p>
          <dl className="my-5 grid grid-cols-2 gap-4"><div><dt className="text-xs text-slate-500">Current</dt><dd className="mt-1 text-xl tabular-nums">{money(selected.day!.currentCents)}</dd></div><div><dt className="text-xs text-slate-500">Proposed</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(recommendation?.recommendedCents)}</dd></div></dl>
          {change != null && <p className="mb-3 text-sm">{change > 0 ? '+' : ''}{change.toFixed(1)}% from current</p>}
          {selected.day!.state === 'open' && <p className="mb-4 text-sm">Minimum stay: <b>{recommendation?.minNights ?? '—'} nights</b></p>}
          {!!recommendation?.reasons.length && <ul className="mb-4 space-y-2 text-sm text-slate-600">{recommendation.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
          {!!steps.length && <><h4 className="border-t pt-4 text-xs font-semibold">Price calculation</h4><ol className="mt-3 space-y-3 text-xs">{steps.map((s, i) => <li className="flex items-start justify-between gap-3" key={i}><span>{s.label}{s.adjustmentPct !== 0 && <span className="block text-slate-500">{s.adjustmentPct > 0 ? '+' : ''}{s.adjustmentPct.toFixed(1)}%</span>}</span><span className="tabular-nums">{money(s.resultCents)}</span></li>)}</ol></>}
          {selected.status === 'review' && <Button className="mt-5" size="sm" onClick={onRules}>Review rules</Button>}
        </> : <p className="text-sm text-slate-500">Select a night to see its price calculation.</p>}
      </aside>
    </div>
  </section>;
}
