/**
 * Whose name may go on a walk, and come off it (src/lib/walk-assignment.ts).
 * The dispatcher names anyone; everyone else names themselves. Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { changesSomeoneElse, isSomeoneElse } from '../walk-assignment.ts';

const ME = 'delaney@risingtidestr.com';
const DOTTI = 'dotti@risingtidestr.com';

describe('naming someone else on a walk is the dispatcher\'s', () => {
  test('anyone may put themselves on, leave a name as it is, or take themselves off', () => {
    assert.equal(changesSomeoneElse(ME, ME, null), false, 'naming yourself');
    assert.equal(changesSomeoneElse(ME, ' Delaney@RisingTideSTR.com ', null), false, 'however the address is cased');
    assert.equal(changesSomeoneElse(ME, DOTTI, DOTTI), false, 'leaving Dotti on it');
    assert.equal(changesSomeoneElse(ME, null, ME), false, 'taking yourself off');
    assert.equal(changesSomeoneElse(ME, null, null), false, 'nobody on, nobody named');
    assert.equal(changesSomeoneElse(ME, ME, DOTTI), false, 'taking it over is putting yourself on');
  });
  test('naming someone else, or taking someone else off, needs the duty', () => {
    assert.equal(changesSomeoneElse(ME, DOTTI, null), true, 'naming Dotti');
    assert.equal(changesSomeoneElse(ME, DOTTI, ME), true, 'handing your walk to Dotti');
    assert.equal(changesSomeoneElse(ME, null, DOTTI), true, 'taking Dotti off');
    assert.equal(changesSomeoneElse(ME, '', DOTTI), true, 'an empty name is taking off');
  });
  test('someone else is a named person who is not the caller', () => {
    assert.equal(isSomeoneElse(ME, DOTTI), true);
    assert.equal(isSomeoneElse(ME, ME.toUpperCase()), false);
    assert.equal(isSomeoneElse(ME, null), false);
    assert.equal(isSomeoneElse(ME, '  '), false);
  });
});
