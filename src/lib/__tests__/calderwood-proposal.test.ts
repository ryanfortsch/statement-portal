import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeStoppedCalendar } from '../calderwood-readonly/proposal.ts';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
const window = { from: '2027-01-01', to: '2027-01-02' };
function fixture() {
 const source = { coverageComplete: true, inventoryAuthority: false as const, missingDates: [] as string[], days: [{ date: window.from, status: 'available' as const, price: 250, currency: 'USD', minNights: 20, cta: false, ctd: true, requestToBook: false, allotment: 1, reasons: [], unknownBlock: false, reservationIds: [], issues: [] as string[] }] };
 const staging = { mapping: CALDERWOOD_STAGING, currency: 'USD' as const, startedAt: '', finishedAt: '', executable: false as const, days: [{ date: window.from, inventory: 1, price: 100, minArrival: 1, minThrough: 2, maxStay: 30, cta: false, ctd: false, stopSell: true }] };
 return { source, staging };
}
test('candidate stays closed and preserves unverified stay restrictions without mutating snapshots', () => {
 const { source, staging } = fixture(), before = JSON.stringify({ source, staging });
 const result = proposeStoppedCalendar(window, source, staging), d = result.rows[0].candidate!;
 assert.equal(result.executable, false); assert.equal(result.status, 'awaiting-restriction-review');
 assert.deepEqual([d.price,d.inventory,d.stopSell,d.cta,d.ctd], [250,0,true,false,true]);
 assert.deepEqual([d.sourceMinimum,d.minArrival,d.minThrough,d.maxStay], [20,1,2,30]);
 assert.equal(JSON.stringify({ source, staging }), before);
});
test('missing, duplicate and extra dates prevent a complete proposal', () => {
 for (const kind of ['missing', 'duplicate', 'extra']) {
  const { source, staging } = fixture();
  if (kind === 'missing') source.days = [];
  if (kind === 'duplicate') staging.days.push({...staging.days[0]});
  if (kind === 'extra') staging.days[0].date = '2027-01-02';
  assert.equal(proposeStoppedCalendar(window,source,staging).status,'incomplete');
 }
});
test('invalid rates, unknown restrictions and source discrepancies withhold nightly candidates', () => {
 for (const kind of ['zero','precision','currency','minimum','issue','unknown','stop']) {
  const { source, staging } = fixture();
  if(kind === 'zero') source.days[0].price = 0;
  if(kind === 'precision') source.days[0].price = 1.234;
  if(kind === 'currency') source.days[0].currency = 'EUR';
  if(kind === 'minimum') source.days[0].minNights = 0;
  if(kind === 'issue') source.days[0].issues = ['Conflicting calendar'];
  if(kind === 'unknown') source.days[0].unknownBlock = true;
  if(kind === 'stop') staging.days[0].stopSell = false;
  const result = proposeStoppedCalendar(window,source,staging);
  assert.equal(result.status,'incomplete',kind); assert.equal(result.rows[0].candidate,null,kind);
 }
});
test('different target mapping blocks the proposal', () => {
 const {source,staging} = fixture();
 const result = proposeStoppedCalendar(window,source,{...staging,mapping:{...staging.mapping,propertyId:'other'}});
 assert.equal(result.status,'incomplete'); assert.ok(result.blockers.includes('Staging mapping changed'));
});
