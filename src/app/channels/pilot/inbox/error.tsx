 'use client';
import { PilotFrame, PilotIcon } from '../PilotFrame';
import s from './inbox.module.css';
export default function InboxError({ reset }: { reset: () => void }) {
 return <PilotFrame section="inbox"><div className={s.workspace}><div className={s.heading}><div><p>GUEST COMMUNICATIONS</p><h1>Inbox</h1></div></div><div className={s.empty}><PilotIcon name="info" size={32}/><h3>Your inbox couldn’t load</h3><p>Try again in a moment. Your conversations and existing messaging are unchanged.</p><button onClick={reset}>Try again</button></div></div></PilotFrame>;
}
