import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The portal's last two merges (audit Phase 3, Field): the Schedule tab's one
// datum (the cleaner's booked time) moves onto the packet stop line and the
// tab goes; the welcome brochure on /field reads once, then folds into one
// "How it works" line.

const root = new URL('../../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('no Schedule tab, and the old route lands on the home page', () => {
  const nav = read('src/app/field/FieldNav.tsx');
  assert.doesNotMatch(nav, /\/field\/schedule|SCHEDULE_TAB/);
  assert.doesNotMatch(read('src/app/field/FieldShell.tsx'), /showSchedule/);
  assert.ok(read('src/app/field/schedule/page.tsx').includes("redirect('/field')"));
});

test("the cleaner's booked time rides the stop line while the trip is worked", () => {
  const page = read('src/app/field/packet/[packetId]/page.tsx');
  assert.ok(page.includes('const vendorTimes = working ? await loadVendorTimesForDay(fieldDb(), packet.visit_date)'), 'loaded for a worked trip only');
  const line = page.slice(page.indexOf('// A cleaner\'s door entry beats the booking.'));
  assert.ok(line.indexOf('if (status) return <CleanerStatus') < line.indexOf('<CleanerBooked time={booked} />'), 'a door entry wins over the booking');
  assert.ok(page.includes('Cleaning booked {formatTime12(time)}'));
});

test('the coordination footer removed in #1355 is nowhere in the portal', () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((f) => {
      const p = join(dir, f);
      return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
    });
  for (const file of walk('src/app/field')) {
    assert.doesNotMatch(read(file), /rather than working around them/, `${file} brings the footer back`);
  }
});

test('the brochure reads once in full, then folds under the work; the office preview always shows it', () => {
  const home = read('src/app/field/page.tsx');
  assert.ok(home.includes("const brochureSeen = !preview && (await cookies()).get(BROCHURE_SEEN_COOKIE)?.value === '1';"));
  const open = home.indexOf('{!brochureSeen && brochure}');
  const work = home.indexOf("title={teaser.length > 0 ? 'What’s waiting' : 'The work'}");
  const fold = home.indexOf('How it works <span');
  assert.ok(open > 0 && open < work && work < fold, 'open above the work on the first view, folded below it after');
  assert.ok(home.includes('!preview && <BrochureSeen />'), 'the preview never marks it seen');
  const marker = read('src/app/field/BrochureSeen.tsx');
  assert.ok(marker.includes('path=/field;'), 'the cookie is the portal’s own');
});
