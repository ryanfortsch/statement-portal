/** Review-only schedule. No contacts, templates, persistence or delivery. */
import { addDays, relativeAutomationTime, zonedTimeToMs } from '../automations-core.ts';
export const CALDERWOOD_MESSAGE_KEYS = ['confirmation','pre_arrival','key_code','pre_checkout','cleaner_reminder','cleaner_arrival'] as const;
export type CalderwoodMessageKey = typeof CALDERWOOD_MESSAGE_KEYS[number];
export type ScheduleInput = {
 checkIn: string; checkOut: string; confirmationAt: string | null; now: Date;
 status: 'confirmed' | 'cancelled';
 localTimes?: Partial<Record<'pre_arrival' | 'pre_checkout' | 'cleaner_reminder', string>>;
 held?: readonly CalderwoodMessageKey[]; sent?: readonly CalderwoodMessageKey[];
};
export type ScheduleRow = {
 key: CalderwoodMessageKey; label: string; audience: 'guest' | 'cleaner';
 date: string; fireAt: string | null; status: 'planned' | 'needs-review' | 'held' | 'already-sent' | 'cancelled'; reason: string;
};
function validDate(value: string) {
 return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0,10) === value;
}
export function calderwoodMessageSchedule(input: ScheduleInput): ScheduleRow[] {
 if (!validDate(input.checkIn) || !validDate(input.checkOut) || input.checkOut <= input.checkIn
  || !Number.isFinite(input.now.getTime())) throw new Error('Valid stay dates and review time required');
 const events = { confirmationAt: input.confirmationAt ? new Date(input.confirmationAt) : null,
  checkinAt: new Date(zonedTimeToMs(input.checkIn,'16:00','America/New_York')) };
 const definitions = [
  {key:'confirmation',label:'Reservation confirmation',audience:'guest',date:'',anchor:'confirmation',offset:30},
  {key:'pre_arrival',label:'Check-in instructions',audience:'guest',date:addDays(input.checkIn,-1)},
  {key:'key_code',label:'Key code',audience:'guest',date:input.checkIn,anchor:'checkin',offset:-60},
  {key:'pre_checkout',label:'Checkout reminder',audience:'guest',date:addDays(input.checkOut,-1)},
  {key:'cleaner_reminder',label:'Cleaner advance reminder',audience:'cleaner',date:addDays(input.checkIn,-10)},
  {key:'cleaner_arrival',label:'Cleaner arrival-day reminder',audience:'cleaner',date:input.checkIn,anchor:'checkin',offset:-420},
 ] as const;
 return definitions.map(def => {
  let fireAt: string | null = null;
  let reason = '';
  if ('anchor' in def) {
   // Use a time before the event to retain an overdue timestamp for review.
   const result = relativeAutomationTime({anchor:def.anchor,offsetMinutes:def.offset},events,new Date(0));
   if (result.status === 'ready') fireAt = result.fireAt.toISOString();
   else reason = 'Confirmation time is missing or invalid.';
  } else {
   const clock = input.localTimes?.[def.key];
   if (!clock) reason = 'Existing Guesty send time still needs confirmation.';
   else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) reason = 'Invalid local send time.';
   else {
    const instant = new Date(zonedTimeToMs(def.date,clock,'America/New_York'));
    // Reject spring-forward missing times instead of silently moving the send.
    const formatted = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(instant);
    if (formatted !== clock) reason = 'Local send time falls in a daylight-saving gap. Review required.';
    else fireAt = instant.toISOString();
   }
  }
  let status: ScheduleRow['status'] = reason ? 'needs-review' : 'planned';
  if (fireAt && Date.parse(fireAt) < input.now.getTime()) {
   status = 'needs-review'; reason = 'Time has passed. Do not replay automatically.';
  }
  if (input.held?.includes(def.key)) { status='held'; reason='Operator hold. Releasing requires a current booking check.'; }
  if (input.status === 'cancelled') { status='cancelled'; reason='Stay cancelled. Do not send.'; }
  if (input.sent?.includes(def.key)) { status='already-sent'; reason='Already sent. Preserve history and do not replay.'; }
  return {key:def.key,label:def.label,audience:def.audience,date:def.date,fireAt,status,reason};
 });
}
