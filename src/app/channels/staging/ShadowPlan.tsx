'use client';
import { useEffect, useMemo, useState } from 'react';
import type { BoardReport } from '@/lib/channex-staging/board';
import { buildShadowPlan } from '@/lib/channex-staging/shadow';
import styles from './staging.module.css';
const labels = { keep: 'Keep unchanged', close: 'Propose closure', 'review-reopen': 'Review reopening', review: 'Blocked for review' };
export function ShadowPlan({ report }: { report: BoardReport }) {
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState('changes');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const plan = useMemo(() => buildShadowPlan(report, new Date(now)), [report, now]);
  const rows = plan.proposals.filter((row) => filter === 'all' || row.action !== 'keep');
  const current = rows.find((row) => row.id === selected) ?? rows[0];
  return <section className={styles.bookings} aria-label="Shadow synchronization plan">
    <div className={styles.sectionHeading}><h2>Shadow synchronization</h2><span>Review only · Publishing disabled</span></div>
    <p>Proposed changes from this snapshot. Existing closures are never automatically reopened. This is a current plan, not a saved execution history.</p>
    <div className={styles.months}><button type="button" aria-pressed={filter === 'changes'} onClick={() => setFilter('changes')}>Changes & review ({plan.proposals.filter((row) => row.action !== 'keep').length})</button><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All nights (360)</button></div>
    {rows.length ? <div className={styles.shadowLayout}>
      <div className={styles.shadowRows} role="group" aria-label="Proposed calendar changes">{rows.map((row) => <button type="button" key={row.id} aria-pressed={current?.id === row.id} onClick={() => setSelected(row.id)}><span>{row.date} · {row.member === 'whole' ? 'Whole house' : row.member === 'front' ? 'Front unit' : 'Back unit'}</span><small>{labels[row.action]}</small></button>)}</div>
      {current && <aside className={styles.scenarioResult} aria-live="polite"><p className={styles.eyebrow}>{current.destination.toUpperCase()} · {current.date}</p><h3>{labels[current.action]}</h3><p>Observed inventory: {current.observed ?? 'unknown'} · Calculated inventory: {current.desired}</p><ul>{current.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>Nothing will be sent. Stop-sell and minimum stays remain unchanged. Refresh the workspace to read new source data.</p></aside>}
    </div> : <p>No inventory changes proposed in this snapshot. This does not authorize opening either pilot for sale.</p>}
  </section>;
}
