import { PilotFrame } from './PilotFrame';
import s from './loading.module.css';

export function PilotLoading({ inbox = false }: { inbox?: boolean }) {
  return <PilotFrame section={inbox ? 'inbox' : 'calendar'}>
    <div className={`${s.loading} ${inbox ? s.inboxLoading : ''}`} role="status" aria-live="polite" aria-busy="true">
      {inbox ? <div className={s.inbox}>
        <div className={s.list}>
          <div className={s.listHeading}><h1>Inbox</h1><span>Loading conversations…</span></div>
          <div aria-hidden="true"><div className={s.search}/><div className={s.filters}/>{Array.from({ length: 6 }, (_, i) => <div className={s.row} key={i}><b/><span/><small/></div>)}</div>
        </div>
        <div className={s.thread} aria-hidden="true"><div className={s.threadTop}><i/><b/></div><div className={s.timeline}><div className={s.bubble}/><div className={s.reply}/><div className={s.bubble}/></div></div>
        <div className={s.detail} aria-hidden="true"><div className={s.detailTop}/><b/><span/><span/><span/><span/></div>
      </div> : <>
        <div className={s.heading}><h1>Calendar</h1><span>Loading property records…</span></div>
        <div className={s.calendar} aria-hidden="true"><div className={s.metrics}><i/><i/><i/></div><div className={s.grid}><div/>{Array.from({ length: 14 }, (_, i) => <span key={i}/>)}</div></div>
      </>}
    </div>
  </PilotFrame>;
}
