import type { GuestyHistorySnapshot } from '@/lib/calderwood-readonly/message-history-reader';

const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
export default function MessageHistoryReview({ history, failed }: { history: GuestyHistorySnapshot | null; failed: boolean }) {
  if (failed) return <p role="alert" className="rounded border border-amber-300 p-4 text-sm">Message records could not be fully read. No handoff decision was made; Guesty remains the sender.</p>;
  if (!history) return null;
  return <section aria-labelledby="source-message-records" className="space-y-3 rounded-lg border bg-white p-5">
    <h2 id="source-message-records" className="text-lg font-semibold">Guesty message records</h2>
    <p className="text-sm">{history.stays.length} confirmed stays reviewed · {history.stays.reduce((n, stay) => n + stay.posts.length, 0)} records · Read completed {time.format(new Date(history.finishedAt))} New York time.</p>
    <p className="text-sm text-slate-600">These records help locate prior conversations. Their timestamps show when records were created, not verified delivery. Guesty’s pending automations, send holds and cleaner SMS history still need verification before switching senders.</p>
    {history.stays.map(stay => <details key={stay.reservationId} className="rounded border p-3">
      <summary className="cursor-pointer text-sm"><span className="font-mono">{stay.reservationId}</span> · {stay.issue === 'shared_conversation' ? 'Thread covers multiple stays; records withheld' : stay.issue === 'no_conversation' ? 'No conversation returned; history unverified' : `${stay.posts.length} records read`}</summary>
      {stay.conversationIds.map(conversationId => <p key={conversationId} className="mt-2 text-sm"><a className="underline" href={`https://app.guesty.com/inbox/${conversationId}?reservationId=${stay.reservationId}`} target="_blank" rel="noopener noreferrer">Open source conversation</a></p>)}
      {!!stay.posts.length && <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Record created (New York)</th><th className="p-2">Channel / record type</th><th className="p-2">Author type</th><th className="p-2">Source record ID</th></tr></thead>
        <tbody>{stay.posts.map(post => <tr key={post.id} className="border-t"><td className="p-2">{time.format(new Date(post.recordedAt))}</td><td className="p-2">{post.module}{post.imported === true ? ' · imported' : ''}</td><td className="p-2">{post.author}</td><td className="p-2 font-mono text-xs">{post.id}</td></tr>)}</tbody></table></div>}
    </details>)}
    <p className="text-xs text-slate-500">Read-only snapshot. Message text and contact details are omitted. Nothing is imported, scheduled or sent.</p>
  </section>;
}
