/**
 * The cleaner schedule-text card, decluttered (2026-10-18): one dark
 * Approve & send, the regenerate and skip verbs as quiet text, the auto-send
 * switch as one line, special instructions folded unless a note exists, and
 * no message that names an env var. Reads the source.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/cleaner-messaging/ScheduleDigestCard.tsx', import.meta.url), 'utf8');

test('one primary, quiet exits, a folded note, plain notices', () => {
  assert.ok(!src.includes("background: anyEnabled && day ? 'var(--signal)'"), 'the send is not the one red button in the cluster');
  for (const label of ['Refresh draft', 'Re-scan messages', 'Skip this day']) {
    const at = src.indexOf(`label="${label}"`);
    assert.ok(at > 0 && src.slice(at, src.indexOf('/>', at)).includes('className="rt-quiet-btn"'), `${label} is quiet text`);
  }
  assert.ok(src.includes('<details open={!!digest.operator_note || noteStale}'), 'special instructions fold unless a note exists or needs translating');
  assert.ok(!src.includes('Automatic sending is off.</strong>'), 'the auto-send switch is one line');
  assert.ok(!src.includes('QUO_API_KEY'), 'no env var in a notice');
  assert.ok(/<textarea\s+key=\{shownBody\}\s+name="body"/.test(src), 'the body still remounts on new text');
});
