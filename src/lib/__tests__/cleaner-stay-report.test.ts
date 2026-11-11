import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectCleanerStayReport, type CleanerReportBooking, type CleanerReportAdjustment } from '../cleaner-stay-report.ts';

const property = { id: '65_calderwood' as const, name: 'Synthetic home', default_checkin_time: '16:00', default_checkout_time: '11:00' };
const booking = (extra: Partial<CleanerReportBooking> = {}): CleanerReportBooking => ({
  id: 'fixture', property_id: '65_calderwood', check_in: '2026-11-24', check_out: '2026-11-28',
  status: 'confirmed', duplicate_of: null, num_guests: 3, guest_name: 'Private fixture name', source: 'guesty_legacy',
  first_seen_at: '2026-11-01T12:00:00Z', last_seen_at: '2026-11-07T12:00:00Z', external_confirmation_code: 'PRIVATE-CODE', ...extra,
});
const adjustment = (extra: Partial<CleanerReportAdjustment> = {}): CleanerReportAdjustment => ({
  property_id: '65_calderwood', stay_check_in: '2026-11-24', original_check_out: '2026-11-28',
  adjusted_check_out: '2026-11-30', adjusted_checkout_time: '12:30:00', status: 'active', ...extra,
});
const report = (extra: Partial<Parameters<typeof projectCleanerStayReport>[0]> = {}) => projectCleanerStayReport({
  property, bookings: [booking()], adjustments: [], skips: [], from:'2026-11-07', through:'2027-11-07', ...extra,
});

test('future arrival and departure remain paired; private identity and source IDs never leave the projection', () => {
  const r = report();
  assert.deepEqual(r.stays[0], { checkIn:'2026-11-24', checkOut:'2026-11-28', arrivalTime:'16:00', checkoutTime:'11:00',
    guests:3, staying:false, adjusted:false, noCleaning:false, needsReview:false });
  assert.doesNotMatch(JSON.stringify(r), /Private fixture|PRIVATE-CODE|guesty_legacy|fixture|guest_name|external_confirmation/);
});
test('includes a current long stay and a departure beyond the horizon; excludes ended and later stays', () => {
  const r = report({ bookings: [booking({ id:'ended', check_in:'2026-09-01', check_out:'2026-11-06' }),
    booking({ id:'current', check_in:'2026-06-01', check_out:'2026-11-08' }),
    booking({ id:'edge', check_in:'2027-11-07', check_out:'2027-12-07' }),
    booking({ id:'later', check_in:'2027-11-08', check_out:'2027-11-10' })] });
  assert.equal(r.stays.length, 2); assert.equal(r.stays[0].staying, true);
  assert.equal(r.stays[1].checkOut, '2027-12-07');
});
test('active extension moves departure and time; cleaning skip does not erase the guest stay', () => {
  const r = report({ adjustments:[adjustment()], skips:[{ property_id:'65_calderwood', stay_check_in:'2026-11-24' }] });
  assert.equal(r.stays[0].checkOut, '2026-11-30'); assert.equal(r.stays[0].checkoutTime, '12:30');
  assert.equal(r.stays[0].noCleaning, true); assert.equal(r.stays[0].needsReview, false);
});
test('proposed changes never replace dates; drift and conflicting copies are visible', () => {
  const proposed = report({ adjustments:[adjustment({status:'proposed'})] }).stays[0];
  assert.equal(proposed.checkOut,'2026-11-28'); assert.equal(proposed.needsReview,true);
  assert.equal(report({ adjustments:[adjustment({original_check_out:'2026-11-27'})] }).stays[0].needsReview,true);
  assert.equal(report({ bookings:[{...booking(), conflictingCheckOut:'2026-11-29'}] }).stays[0].needsReview,true);
});
test('extension can bring a formerly ended stay back into the window without inventing a stay', () => {
  const r = report({ bookings:[booking({check_in:'2026-10-01',check_out:'2026-11-05'})],
    adjustments:[adjustment({stay_check_in:'2026-10-01',original_check_out:'2026-11-05',adjusted_check_out:'2026-11-09'})] });
  assert.equal(r.stays.length,1); assert.equal(r.stays[0].checkOut,'2026-11-09');
  assert.equal(report({bookings:[],adjustments:[adjustment()]}).stays.length,0);
});
test('unknown times and guest count stay unknown, including across DST', () => {
  const r = report({ property:{...property,default_checkin_time:null,default_checkout_time:null},
    bookings:[booking({check_in:'2027-03-14',check_out:'2027-03-16',num_guests:null})] });
  assert.equal(r.stays[0].arrivalTime,null); assert.equal(r.stays[0].checkoutTime,null); assert.equal(r.stays[0].guests,null);
  assert.equal(report({bookings:[booking({check_in:'2027-03-14',check_out:'2027-03-16'})]}).stays[0].arrivalTime,'16:00');
});
test('refuses ambiguous adjustments, unresolved duplicates, invalid dates and broader property scope', () => {
  assert.throws(()=>report({adjustments:[adjustment(),adjustment()]}));
  assert.throws(()=>report({bookings:[booking(),booking({id:'duplicate'})]}));
  assert.throws(()=>report({bookings:[booking({check_in:'2026-02-30'})]}));
  assert.throws(()=>report({through:'2030-01-01'}));
  assert.throws(()=>report({adjustments:[adjustment({adjusted_check_out:'2026-11-23'})]}));
  assert.throws(()=>report({bookings:[booking({property_id:'other' as '65_calderwood'})]}));
  assert.throws(()=>report({bookings:[booking({status:'cancelled' as 'confirmed'})]}));
});
test('preview is owner gated before reads and cannot create access or send messages', () => {
  const page = readFileSync(new URL('../../app/channels/65_calderwood/cleaner-schedule/page.tsx',import.meta.url),'utf8');
  const reader = readFileSync(new URL('../cleaner-stay-report.server.ts',import.meta.url),'utf8');
  assert.ok(page.indexOf('if (!await isOwnerSession())') < page.indexOf('try { report ='));
  assert.match(page,/Schedule unavailable/); assert.match(page,/not shared with Luana/);
  assert.doesNotMatch(reader,/\.insert\(|\.update\(|\.delete\(|\.rpc\(|portal_token|cleaner_schedule_recipients|sendMessage/);
  assert.match(reader,/findGhostStays/); assert.match(reader,/collapseStays/);
  assert.match(reader,/if \(!Array\.isArray\(result\.data\)\)/);
  assert.equal((reader.match(/\.from\('bookings'\)/g)||[]).length,2);
  assert.equal((reader.match(/\.is\('duplicate_of', null\)/g)||[]).length,2);
  assert.equal((reader.match(/\.in\('status', \['confirmed', 'completed'\]\)/g)||[]).length,2);
});
