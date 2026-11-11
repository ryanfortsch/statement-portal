/**
 * A paid extension moves Rosa's schedule within half an hour, because the
 * concierge stopped filing a cleaner card for one two or more days out
 * (2026-11-11). That promise rests on detectExtensionHolds running on the
 * 30-minute channels-sync, right after the Guesty calendar mirror it reads
 * is refreshed. Before, it ran only at the afternoon digest cron and just
 * before the evening send.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../../app/api/cron/channels-sync/route.ts', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
  crons?: Array<{ path: string; schedule: string }>;
};

test('channels-sync runs the extension hold detector', () => {
  assert.match(route, /import \{ detectExtensionHolds \} from '@\/lib\/extension-holds';/);
  assert.match(route, /await detectExtensionHolds\(supabaseAdmin\)/);
});

test('it runs after the calendar mirror refresh, never before it', () => {
  const refresh = route.indexOf('const calendarDays = await syncCalendarWindow(');
  const detect = route.indexOf('await detectHoldsAfterRefresh(calendarDays)');
  assert.ok(refresh > 0 && detect > refresh, 'detection must follow the mirror refresh in run()');
});

test('channels-sync is still on the 30-minute beat', () => {
  const cron = (vercel.crons ?? []).find((c) => c.path === '/api/cron/channels-sync');
  assert.equal(cron?.schedule, '*/30 * * * *');
});
