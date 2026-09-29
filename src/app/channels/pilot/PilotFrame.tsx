import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './frame.module.css';
export type PilotSection = 'calendar' | 'reservations' | 'inbox' | 'baseline';
export function PilotIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></>,
    reservations: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/></>,
    inbox: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
    baseline: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    back: <path d="M19 12H5m5-5-5 5 5 5"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.home}</svg>;
}
export function PilotFrame({ section, children, onSection }: { section: PilotSection; children: ReactNode; onSection?: (section: Exclude<PilotSection, 'inbox'>) => void }) {
  return <div className={s.frame}>
    <header className={s.top}><Link href="/channels" className={s.brand}><span className={s.mark}><PilotIcon name="home" size={20}/></span>helm<span className={s.brandDivider}>/</span><span className={s.product}>Property workspace</span></Link><div className={s.topRight}><span className={s.mode}><i/>Read-only pilot</span><Link href="/">Back to Helm <PilotIcon name="arrow" size={15}/></Link></div></header>
    <div className={s.body}><aside className={s.sidebar}>
      <div className={s.property}><div className={s.propertyMark}><PilotIcon name="home" size={24}/><span>65</span></div><p>YOUR PROPERTY</p><h2>65 Calderwood</h2><span>Calderwood Court</span></div>
      <p className={s.navLabel}>WORKSPACE</p><nav aria-label="Calderwood workspace">{(['calendar','reservations','inbox','baseline'] as const).map(key => {
        const label = {calendar:'Calendar',reservations:'Reservations',inbox:'Inbox',baseline:'Migration review'}[key];
        const content = <><PilotIcon name={key}/><span className={key === 'baseline' ? s.longLabel : undefined}>{label}</span>{key === 'baseline' && <span className={s.shortLabel}>Review</span>}{section === key && <i/>}</>;
        return onSection && key !== 'inbox' ? <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => onSection(key)}>{content}</button> : <Link key={key} aria-current={section === key ? 'page' : undefined} href={key === 'inbox' ? '/channels/pilot/inbox' : `/channels/pilot?view=${key}`}>{content}</Link>;
      })}</nav>
      <div className={s.bottom}><Link href="/messaging"><PilotIcon name="inbox"/> Existing messaging <PilotIcon name="arrow" size={14}/></Link><div className={s.pilotNote}><PilotIcon name="baseline"/><div><strong>A gradual move to Helm</strong><p>Review your records here. Live bookings and messages stay in their existing workflows.</p></div></div></div>
    </aside><div className={s.content}>{children}</div></div>
  </div>;
}
