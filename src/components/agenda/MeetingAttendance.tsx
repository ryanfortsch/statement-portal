'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { answerMeetingAttendance } from '@/app/appointments/actions';
import type { AgendaEntry, MeetingAnswer } from '@/lib/appointment-agenda';

/** Attendance on a CRM meeting row: one tap, saved to your own agenda only.
 *  The shared contact meeting and its reminder texts stay as they are. */
export function MeetingAttendance({ entry }: { entry: AgendaEntry }) {
  const router = useRouter();
  const [pending, setPending] = useState<MeetingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answered = entry.attendanceAnswer && (entry.attendance === 'attending' || entry.attendance === 'not_attending') ? entry.attendance : null;
  const [shown, setShown] = useState<MeetingAnswer | null>(answered);
  async function answer(attendance: MeetingAnswer) {
    if (pending || attendance === shown) return;
    setPending(attendance); setError(null);
    try {
      const result = await answerMeetingAttendance({ meetingId: entry.id.slice('meeting:'.length), attendance, answer: entry.attendanceAnswer });
      if (!result.ok) { setError(result.error); return; }
      setShown(attendance);
      router.refresh();
    } catch { setError('Your answer was not confirmed. Tap again.'); }
    finally { setPending(null); }
  }
  const choice = (value: MeetingAnswer, label: string) => <Button size="sm" variant={shown === value ? 'primary' : 'secondary'}
    aria-pressed={shown === value} pending={pending === value} disabled={!!pending} onClick={() => answer(value)}>{label}</Button>;
  return <span className="rt-agenda-attendance" role="group" aria-label="Are you going?">
    {!shown && <span className="rt-agenda-attention">Going?</span>}
    {choice('attending', 'Going')}{choice('not_attending', 'Not going')}
    {error && <span role="alert" style={{ color: 'var(--negative)' }}>{error}</span>}
  </span>;
}
