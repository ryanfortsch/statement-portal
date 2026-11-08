/**
 * Cleaning reviews, the rules (docs/cleaning-reviews.md).
 *
 * Five stars files nothing; four or fewer files a note. The note names the
 * home and the day the crew's way, carries the stars, the reason and the
 * photo links, in one language per text, and never a person's name.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEANING_FLAG_MAX,
  CLEANING_HANDLED_REASONS,
  composeCleaningNotice,
  enDay,
  needsCleaningNotice,
  noticeWord,
  parseStars,
  ptDay,
  starsGlyphs,
  summarizeCleaningReviews,
} from '../cleaning-reviews-core.ts';

describe('which ratings file a note', () => {
  test('five stars is stored and nothing more', () => {
    assert.equal(needsCleaningNotice(5), false);
  });
  test('four or fewer files the crew note', () => {
    for (const n of [1, 2, 3, 4]) assert.equal(needsCleaningNotice(n), true, `${n} stars`);
    assert.equal(CLEANING_FLAG_MAX, 4);
  });
  test('nothing outside 1 to 5 counts as a rating', () => {
    assert.equal(needsCleaningNotice(0), false);
    assert.equal(needsCleaningNotice(6), false);
    assert.equal(needsCleaningNotice(3.5), false);
    assert.equal(parseStars('3'), 3);
    assert.equal(parseStars(0), null);
    assert.equal(parseStars('seven'), null);
  });
});

describe('the note to the crew', () => {
  const input = {
    home: '21 Horton',
    walkDate: '2026-11-06',
    stars: 3,
    reasonPt: 'ficou cabelo na banheira e migalhas embaixo da torradeira',
    reasonEn: 'hair was left in the tub and crumbs under the toaster',
    photoUrls: ['https://x.test/a.jpg', 'https://x.test/b.jpg'],
  };

  test('the Portuguese carries the home, the day, the stars, the reason and the photos', () => {
    const { pt } = composeCleaningNotice(input);
    assert.match(pt, /21 Horton/);
    assert.match(pt, /sex, 6\/11/);
    assert.match(pt, /avaliamos 3 de 5/);
    assert.match(pt, /Ficou cabelo na banheira e migalhas embaixo da torradeira\./);
    assert.match(pt, /Fotos: https:\/\/x\.test\/a\.jpg https:\/\/x\.test\/b\.jpg/);
  });

  test('the English is the same note for the operator and an English recipient', () => {
    const { en } = composeCleaningNotice(input);
    assert.match(en, /21 Horton \(Fri, Nov 6\)/);
    assert.match(en, /rated it 3 of 5/);
    assert.match(en, /Hair was left in the tub and crumbs under the toaster\./);
    assert.match(en, /Photos: /);
  });

  test('one language per text: no English words in the Portuguese template', () => {
    const { pt } = composeCleaningNotice({ ...input, reasonPt: '', reasonEn: '', photoUrls: [] });
    for (const word of ['clean', 'rated', 'Photos', 'Thank']) assert.ok(!pt.includes(word), `${word} leaked into the Portuguese`);
  });

  test('no reason and no photos leaves a complete short note', () => {
    const { pt, en } = composeCleaningNotice({ ...input, reasonPt: '', reasonEn: '', photoUrls: [] });
    assert.equal(pt, 'Oi! Sobre a limpeza da 21 Horton (sex, 6/11): avaliamos 3 de 5. Obrigada!');
    assert.equal(en, 'Hi! About the clean at 21 Horton (Fri, Nov 6): we rated it 3 of 5. Thank you!');
  });

  test('the note never names the inspector', () => {
    const { pt, en } = composeCleaningNotice(input);
    for (const t of [pt, en]) assert.ok(!/Delaney|Dotti|Ryan|Allie/.test(t));
  });

  test('days print the way each reader writes them', () => {
    assert.equal(ptDay('2026-11-06'), 'sex, 6/11');
    assert.equal(enDay('2026-11-06'), 'Fri, Nov 6');
    assert.equal(ptDay('not a date'), 'not a date');
  });
});

describe('the stat strip', () => {
  const rows = [
    { stars: 5, walk_date: '2026-11-06' },
    { stars: 3, walk_date: '2026-11-05' },
    { stars: 4, walk_date: '2026-11-01' },
    { stars: 2, walk_date: '2026-09-01' },
  ];
  test('average, count and flagged over the window', () => {
    const s = summarizeCleaningReviews(rows, '2026-10-08');
    assert.deepEqual(s, { rated: 3, avg: 4, flagged: 2 });
  });
  test('no window counts everything; nothing gives null', () => {
    assert.equal(summarizeCleaningReviews(rows).rated, 4);
    assert.deepEqual(summarizeCleaningReviews([]), { rated: 0, avg: null, flagged: 0 });
  });
  test('glyphs and the one status word', () => {
    assert.equal(starsGlyphs(3), '★★★☆☆');
    assert.equal(noticeWord('none'), null);
    assert.equal(noticeWord('pending'), 'Waiting on approval');
    assert.equal(noticeWord('sent', 'Rosa'), 'Rosa texted');
    assert.equal(CLEANING_HANDLED_REASONS.length, 3);
  });
});
