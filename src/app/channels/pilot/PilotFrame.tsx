import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './frame.module.css';

export type PilotSection = 'calendar' | 'reservations' | 'inbox' | 'baseline';

export function PilotIcon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    down: <path d="m6 9 6 6 6-6"/>,
    up: <path d="m6 15 6-6 6 6"/>,
    history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/><path d="M12 7v5l3 2"/></>,
    channel: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 0 0 18 17 17 0 0 0 0-18Z"/></>,
    helm: <><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></>,
    reservations: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/></>,
    inbox: <><path d="m5 4-3 9v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3-9H5Z"/><path d="M2 13h6l2 3h4l2-3h6M8 8h8"/></>,
    message: <><path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-7a8 8 0 0 1-1-4 9 9 0 0 1 19 0Z"/><path d="M7 10h10m-10 4h6"/></>,
    baseline: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    back: <path d="M19 12H5m5-5-5 5 5 5"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/></>,
    moon: <path d="M20.5 13a9 9 0 0 1-9.5-9.5A9 9 0 1 0 20.5 13Z"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
    automation: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
    block: <><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.home}</svg>;
}

const labels = { calendar: 'Calendar', reservations: 'Reservations', inbox: 'Inbox', baseline: 'Migration review' };

export function PilotFrame({ section, children, onSection, portfolio = false }: {
  section: PilotSection;
  portfolio?: boolean;
  children: ReactNode;
  onSection?: (section: Exclude<PilotSection, 'inbox'>) => void;
}) {
  if (section === 'inbox') return <div className={`${s.frame} ${s.inboxShell}`}>
    <header className={s.inboxBar}>
      <Link className={s.inboxBrand} href="/channels" aria-label="Helm channels"><PilotIcon name="helm" size={23}/><span>helm<span>.</span></span></Link>
      <div className={s.inboxProperty}><span aria-hidden="true">/</span><strong>{portfolio ? 'Guest messaging' : '65 Calderwood'}</strong></div>
      <nav aria-label={portfolio ? 'Guest messaging workspace' : 'Calderwood workspace'}>
        {portfolio ? [{ key: 'inbox', label: 'Inbox preview', href: '/messaging/inbox' }, { key: 'message', label: 'Current inbox', href: '/messaging' }, { key: 'calendar', label: 'Calderwood pilot', href: '/channels/pilot' }].map(item => <Link key={item.key} href={item.href} prefetch={false} aria-label={item.label} title={item.label} aria-current={item.key === 'inbox' ? 'page' : undefined}><PilotIcon name={item.key} size={16}/><span>{item.label}</span></Link>) : (['inbox','calendar','reservations','baseline'] as const).map(key => <Link key={key} aria-label={labels[key]} title={labels[key]} href={key === 'inbox' ? '/channels/pilot/inbox' : `/channels/pilot?view=${key}`} aria-current={key === 'inbox' ? 'page' : undefined}><PilotIcon name={key} size={16}/><span>{labels[key]}</span></Link>)}
      </nav>
      <span className={s.pilotTag}><PilotIcon name="lock" size={12}/>{portfolio ? 'Read-only preview' : 'Read-only pilot'}</span>
      <Link className={s.inboxExit} href="/" aria-label="Back to Helm" title="Back to Helm"><PilotIcon name="external" size={15}/></Link>
    </header>
    <div className={s.inboxContent}>{children}</div>
  </div>;
  return (
    <div className={s.frame}>
      <aside className={s.sidebar}>
        <Link href="/channels" className={s.brand} aria-label="Helm channels"><PilotIcon name="helm" size={25}/><span>Helm</span></Link>
        <nav aria-label="Calderwood workspace">
          {(['inbox', 'calendar', 'reservations', 'baseline'] as const).map(key => {
            const content = <><PilotIcon name={key} size={20}/><span>{labels[key]}</span></>;
            return onSection && key !== 'inbox'
              ? <button key={key} aria-label={labels[key]} aria-current={section === key ? 'page' : undefined} onClick={() => onSection(key)}>{content}</button>
              : <Link key={key} aria-label={labels[key]} aria-current={section === key ? 'page' : undefined} href={key === 'inbox' ? '/channels/pilot/inbox' : `/channels/pilot?view=${key}`}>{content}</Link>;
          })}
        </nav>
        <div className={s.bottom}>
          <Link href="/messaging" aria-label="Guest messaging"><PilotIcon name="message" size={20}/><span>Guest messaging</span></Link>
          <Link href="/" aria-label="Back to Helm"><PilotIcon name="home" size={20}/><span>Back to Helm</span></Link>
        </div>
      </aside>
      <header className={s.top}>
        <div className={s.product}><Link href="/">helm<span>.</span></Link><i/><span>Channels</span></div>
        <div className={s.topRight}>
          <span className={s.property}><PilotIcon name="home" size={15}/><strong>65 Calderwood</strong></span>
          <span className={s.mode}><PilotIcon name="lock" size={12}/>Read-only pilot</span>
        </div>
      </header>
      <div className={s.content}>{children}</div>
    </div>
  );
}
