import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staffMaySeeInbound } from '../home-reply-triage.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('a staff feed shows vendor and other contacts only; owners, prospects and unknowns stay off', () => {
  assert.equal(staffMaySeeInbound('vendor'), true);
  assert.equal(staffMaySeeInbound('other'), true);
  assert.equal(staffMaySeeInbound('owner'), false);
  assert.equal(staffMaySeeInbound('lead'), false, 'a prospect is a lead');
  assert.equal(staffMaySeeInbound(null), false, 'a contact that could not be read fails closed');
  assert.equal(staffMaySeeInbound(undefined), false);
});

test('the feed filters waiting messages for staff, and the brief reads the type', () => {
  const feed = read('src/components/ForMeFeed.tsx');
  assert.ok(
    feed.includes('if (!owner) inboundWaiting = inboundWaiting.filter((t) => staffMaySeeInbound(t.contactType));'),
    'owner and prospect messages reach a staff feed again',
  );
  assert.ok(
    feed.indexOf('staffMaySeeInbound(t.contactType)') < feed.indexOf('const visibleInbound'),
    'the filter must run before the feed splits replies from updates',
  );
  const brief = read('src/lib/daily-brief.ts');
  assert.ok(brief.includes(".select('id, name, phone, emails, type')"), 'the brief no longer reads the contact type');
  assert.ok(brief.includes('contactType: contact?.type ?? null'), 'the touch no longer carries its contact type');
});
