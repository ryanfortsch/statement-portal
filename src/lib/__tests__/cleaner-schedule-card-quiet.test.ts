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
  for (const label of ['Re-scan messages', 'Skip this day']) {
    const at = src.indexOf(`label="${label}"`);
    assert.ok(at > 0 && src.slice(at, src.indexOf('/>', at)).includes('className="rt-quiet-btn"'), `${label} is quiet text`);
  }
  assert.ok(src.includes('<details open={!!digest.operator_note || noteStale}'), 'special instructions fold unless a note exists or needs translating');
  assert.ok(!src.includes('Automatic sending is off.</strong>'), 'the auto-send switch is one line');
  assert.ok(!src.includes('QUO_API_KEY'), 'no env var in a notice');
  assert.ok(/<textarea\s+key=\{shownBody\}\s+name="body"/.test(src), 'the body still remounts on new text');
});

// 2026-11-07 audit, finding 3: the card is the text, the approval-time calls
// and three verbs. Recipients and automatic sending are set on Cleaner
// settings, which must carry both switches through the same actions.
test('three verbs on a pending card; recipients and automatic sending live on Cleaner settings', () => {
  const settings = readFileSync(new URL('../../app/turnovers/settings/page.tsx', import.meta.url), 'utf8');
  for (const label of ['Approve &amp; send via Quo', 'Re-scan messages', 'Skip this day']) assert.ok(src.includes(`label="${label}"`), `the card keeps ${label}`);
  assert.ok(!src.includes('label="Refresh draft"'), 'Refresh draft goes: the card already shows the live text and Re-scan re-drafts');
  assert.ok(!src.includes('setNoCleanAction'), 'the card rows are read-only; No cleaning needed is set on the schedule');
  assert.ok(!src.includes('toggleRecipientAction') && !src.includes('toggleAutosendAction'), 'the card holds no settings switch');
  assert.ok(!src.includes('Schedule settings'), 'one name for the settings: Cleaner settings');
  assert.ok(src.includes('href="/turnovers/settings#schedule-recipients"'), 'the card links Cleaner settings');
  assert.ok(settings.includes('<RecipientToggle'), 'Cleaner settings switches each recipient (with its confirm)');
  assert.ok(settings.includes('<form action={toggleAutosendAction}>') && settings.includes('name="back" value="settings"'), 'Cleaner settings switches automatic sending');
  assert.ok(settings.includes("value={settings.autosend_enabled ? 'false' : 'true'}"), 'the switch flips the stored value, never sets one');
});
