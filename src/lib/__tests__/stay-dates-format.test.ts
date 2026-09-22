import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStayDates } from '../../app/messaging/format.ts';

const Y = new Date().getUTCFullYear();
const far = Y + 1;

test('a stay in the current year shows no year', () => {
  assert.equal(formatStayDates(`${Y}-06-18`, `${Y}-06-22`), 'Jun 18-22');
  assert.equal(formatStayDates(`${Y}-06-28`, `${Y}-07-05`), 'Jun 28 - Jul 5');
  assert.equal(formatStayDates(`${Y}-06-18`, ''), 'Jun 18');
});

test('a stay in a later year shows it, which is the whole point', () => {
  assert.equal(formatStayDates(`${far}-08-15`, `${far}-08-22`), `Aug 15-22, ${far}`);
  assert.equal(formatStayDates(`${far}-08-15`, `${far}-09-04`), `Aug 15 - Sep 4, ${far}`);
  assert.equal(formatStayDates(`${far}-08-15`, ''), `Aug 15, ${far}`);
});

test('a range straddling New Year names both years rather than implying one', () => {
  const out = formatStayDates(`${Y}-12-28`, `${far}-01-03`);
  assert.equal(out, `Dec 28 - Jan 3, ${far}`);
  const both = formatStayDates(`${far}-12-28`, `${far + 1}-01-03`);
  assert.equal(both, `Dec 28, ${far} - Jan 3, ${far + 1}`);
});

test('empty and malformed input still yield an empty string', () => {
  assert.equal(formatStayDates('', ''), '');
  assert.equal(formatStayDates('not-a-date', ''), '');
  assert.equal(formatStayDates('', 'nonsense'), '');
});

test('only a checkout still formats', () => {
  assert.equal(formatStayDates('', `${far}-03-09`), `Mar 9, ${far}`);
});

test('dates are read as UTC, so a day never slips either side of midnight', () => {
  assert.equal(formatStayDates(`${Y}-01-01`, `${Y}-01-02`), 'Jan 1-2');
  assert.equal(formatStayDates(`${Y}-12-31`, `${Y}-12-31`), 'Dec 31-31');
});
