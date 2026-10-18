import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the occupancy calendar lives on Turnovers only', () => {
  const home = read('src/app/(home)/page.tsx');
  assert.ok(!home.includes('OccupancyCalendar'), 'the home page renders no calendar');
  assert.ok(read('src/app/turnovers/calendar/page.tsx').includes('<OccupancyCalendar calendar={calendar} />'));
  const pipeline = read('src/app/turnovers/page.tsx');
  assert.ok(pipeline.includes('href="/turnovers/calendar"'), 'the pipeline links to it');
  assert.ok(!pipeline.includes('/#occupancy-calendar'), 'nothing points at the home copy');
  assert.ok(read('src/lib/helm-modules.ts').includes("href: '/turnovers/calendar'"), 'search can find it');
});

test('Ask Helm is the input under the title, with no caption standing in for UI', () => {
  const home = read('src/app/(home)/page.tsx');
  const hero = home.indexOf('<HelmHero');
  const ask = home.indexOf('<AskHelm');
  const feed = home.indexOf('<HomeFeedTabs');
  assert.ok(hero < ask && ask < feed, 'title, then Ask Helm, then the day');
  assert.ok(!read('src/components/AskHelm.tsx').includes('Always verify the figures'));
});
