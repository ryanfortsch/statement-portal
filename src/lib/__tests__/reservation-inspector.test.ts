import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncReservationInspector } from '../../app/channels/pilot/inbox/reservation-inspector.ts';

function fixture() {
  const events: string[] = [];
  let mode = 'closed';
  const field = { focus: () => { events.push('focus:field'); } } as HTMLElement;
  const opener = { focus: () => { events.push('focus:opener'); } };
  const panel = {
    get open() { return mode !== 'closed'; },
    contains(node: Node | null) { return node === field; },
    close() { mode = 'closed'; events.push('close'); },
    show() { assert.equal(mode, 'closed'); mode = 'docked'; events.push('docked'); },
    showModal() { assert.equal(mode, 'closed'); mode = 'modal'; events.push('modal'); },
  };
  return { panel, field, opener, events, mode: () => mode };
}

describe('reservation inspector presentation', () => {
  it('does not steal focus when initially closed', () => {
    const f = fixture();
    syncReservationInspector(f.panel, 'closed', null, f.opener);
    assert.deepEqual(f.events, []);
  });

  it('keeps an open inspector and its focused field when resized in either direction', () => {
    const f = fixture();
    syncReservationInspector(f.panel, 'modal', null, f.opener);
    syncReservationInspector(f.panel, 'docked', f.field, f.opener);
    assert.equal(f.mode(), 'docked');
    assert.deepEqual(f.events, ['modal', 'close', 'docked', 'focus:field']);
    f.events.length = 0;
    syncReservationInspector(f.panel, 'modal', f.field, f.opener);
    assert.equal(f.mode(), 'modal');
    assert.deepEqual(f.events, ['close', 'modal', 'focus:field']);
  });

  it('returns focus to the initiating control after either presentation closes', () => {
    for (const mode of ['docked', 'modal'] as const) {
      const f = fixture();
      syncReservationInspector(f.panel, mode, null, f.opener);
      f.events.length = 0;
      syncReservationInspector(f.panel, 'closed', f.field, f.opener);
      assert.equal(f.mode(), 'closed');
      assert.deepEqual(f.events, ['close', 'focus:opener']);
    }
  });

  it('lets modal opening choose focus when the active element is outside the inspector', () => {
    const f = fixture();
    syncReservationInspector(f.panel, 'docked', null, f.opener);
    f.events.length = 0;
    syncReservationInspector(f.panel, 'modal', f.opener as HTMLElement, f.opener);
    assert.deepEqual(f.events, ['close', 'modal']);
  });
});
