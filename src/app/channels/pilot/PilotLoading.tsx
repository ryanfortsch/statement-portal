import { PilotFrame } from './PilotFrame';
import s from './loading.module.css';

export function PilotLoading({ inbox = false }: { inbox?: boolean }) {
  return <PilotFrame section={inbox ? 'inbox' : 'calendar'}>
    <div className={`${s.loading} ${inbox ? s.inboxLoading : ''}`} role="status" aria-live="polite" aria-busy="true">
      <div className={s.heading}><h1>{inbox ? 'Inbox' : 'Calendar'}</h1><span>{inbox ? 'Loading conversations…' : 'Loading property records…'}</span></div>
      <div className={inbox ? s.inbox : s.calendar} aria-hidden="true">
        {inbox ? <>
          <div className={s.list}><div className={s.search}/>{Array.from({ length: 5 }, (_, i) => <div className={s.row} key={i}><i/><div><b/><span/><small/></div></div>)}</div>
          <div className={s.thread}><div className={s.threadTop}><i/><b/></div><div className={s.bubble}/><div className={s.reply}/><div className={s.bubble}/></div>
          <div className={s.detail}><b/><span/><span/><span/><span/></div>
        </> : <><div className={s.metrics}><i/><i/><i/></div><div className={s.grid}><div/>{Array.from({ length: 14 }, (_, i) => <span key={i}/>)}</div></>}
      </div>
    </div>
  </PilotFrame>;
}
