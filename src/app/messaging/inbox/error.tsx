'use client';
import Link from 'next/link';
import { PilotFrame, PilotIcon } from '@/app/channels/pilot/PilotFrame';
import s from '@/app/channels/pilot/inbox/inbox.module.css';

export default function GuestInboxError({ reset }: { reset: () => void }) {
  return <PilotFrame section="inbox" portfolio><div className={s.workspace}>
    <div className={s.empty}><span><PilotIcon name="info" size={25}/></span><h3>The preview couldn’t load</h3><p>Try again, or continue in the current inbox. No messages have been changed.</p><button onClick={reset}>Try again</button><Link href="/messaging">Open current inbox</Link></div>
  </div></PilotFrame>;
}
