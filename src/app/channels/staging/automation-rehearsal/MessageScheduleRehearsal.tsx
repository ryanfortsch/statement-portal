'use client';
import {useState} from 'react';
import {calderwoodMessageSchedule, type ScheduleInput} from '@/lib/calderwood-rehearsal/message-schedule';
const situations = ['Winter arrival','Summer arrival','Dates moved with code held','Cancelled stay','Late import','Confirmation already sent','Arrival/departure time changed'] as const;
export function MessageScheduleRehearsal() {
 const [situation,setSituation]=useState<typeof situations[number]>('Winter arrival');
 const input: ScheduleInput={checkIn:'2027-01-15',checkOut:'2027-01-18',confirmationAt:'2027-01-01T15:00:00Z',
  now:new Date('2027-01-01T15:00:00Z'),status:'confirmed'};
 if(situation==='Summer arrival') {input.checkIn='2027-07-15';input.checkOut='2027-07-18';}
 if(situation==='Dates moved with code held') {input.checkIn='2027-01-20';input.checkOut='2027-01-23';input.held=['key_code'];}
 if(situation==='Cancelled stay') input.status='cancelled';
 if(situation==='Late import') input.now=new Date('2027-01-16T00:00:00Z');
 if(situation==='Confirmation already sent') input.sent=['confirmation'];
 if(situation==='Arrival/departure time changed') {input.checkInTime='18:00';input.checkOutTime='12:00';}
 const rows=calderwoodMessageSchedule(input);
 const display=(iso:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
 return <section style={{border:'1px solid var(--rule)',padding:20,marginTop:24}}>
  <h2>Calderwood message schedule</h2>
  <p>Six known workflows, shown for a fictional stay. All times are Eastern. Standard check-in is 4 PM and checkout is 11 AM; reservation time changes shift the schedule. This is a review proposal and sends nothing.</p>
  <label htmlFor="schedule-situation">Schedule situation </label>
  <select id="schedule-situation" value={situation} onChange={e=>setSituation(e.target.value as typeof situation)}>{situations.map(value=><option key={value}>{value}</option>)}</select>
  <p>Sample stay: {input.checkIn} to {input.checkOut}.</p>
  <ol>{rows.map(row=><li key={row.key} style={{marginBottom:16}}>
   <strong>{row.label}</strong> ({row.audience})<br/>
   {row.fireAt ? display(row.fireAt) : `${row.date || 'Confirmation'}: time unconfirmed`}<br/>
   <strong>{row.status}</strong>{row.reason ? `: ${row.reason}` : ''}
  </li>)}</ol>
  <p>A held message stays held when dates move. The proposed new time does not update the saved hold or authorize release.</p>
  <p>Guesty settings verified October 13: guest workflow excludes Website, Manual, and Direct - stay cape ann. Cleaner reminders apply to all sources. Before activation: verify source mapping, other applicable workflows, and which messages Guesty has already sent or queued. Guest messages need booking-channel delivery; cleaner reminders need SMS delivery.</p>
 </section>;
}
