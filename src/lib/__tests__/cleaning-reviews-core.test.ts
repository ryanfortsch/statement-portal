/**
 * Cleaning reviews, the rules (docs/cleaning-reviews.md).
 *
 * Every rating rides in Friday's one email. It leads with the week's grade,
 * lists every clean with its stars, home and day the crew's way, and under
 * each at four or fewer prints the reason and the photo links, in one
 * language per email, and never a person's name.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLEANING_FLAG_MAX,
  CLEANING_HANDLED_REASONS,
  composeWeeklyEmail,
  enDay,
  enShort,
  needsCleaningNotice,
  noticeWord,
  parseStars,
  ptDay,
  ptShort,
  reportWeekEnd,
  starsGlyphs,
  summarizeCleaningReviews,
  weeklyAverage,
  weeklyEmailHtml,
} from '../cleaning-reviews-core.ts';

describe('which ratings are flagged', () => {
  test('five stars prints as one line', () => {
    assert.equal(needsCleaningNotice(5), false);
  });
  test('four or fewer carries a reason and photos', () => {
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

describe("Friday's email", () => {
  const week = {
    firstWalk: '2026-11-06',
    weekEnd: '2026-11-12',
    cleans: [
      { home: '3 South', walkDate: '2026-11-10', stars: 5, reasonPt: '', reasonEn: '', photoUrls: [] },
      {
        home: '21 Horton',
        walkDate: '2026-11-06',
        stars: 3,
        reasonPt: 'ficou cabelo na banheira',
        reasonEn: 'hair was left in the tub',
        photoUrls: ['https://x.test/a.jpg', 'https://x.test/b.jpg'],
      },
      { home: '20 Enon', walkDate: '2026-11-08', stars: 5, reasonPt: '', reasonEn: '', photoUrls: ['https://x.test/never.jpg'] },
    ],
  };
  const email = composeWeeklyEmail(week);

  test('the grade leads, in each reader\'s numbers', () => {
    assert.match(email.pt, /Média 4,3 de 5 em 3 limpezas\./);
    assert.match(email.en, /Average 4\.3 of 5 across 3 cleans\./);
    assert.ok(email.pt.indexOf('Média') < email.pt.indexOf('★'), 'the grade before the list');
    assert.equal(weeklyAverage(week.cleans), 4.3);
    assert.equal(weeklyAverage([]), null);
  });

  test('every clean is listed in walk order, the crew\'s day', () => {
    const horton = email.pt.indexOf('21 Horton · sex, 6/11');
    const enon = email.pt.indexOf('20 Enon · dom, 8/11');
    const south = email.pt.indexOf('3 South · ter, 10/11');
    assert.ok(horton > 0 && enon > horton && south > enon, email.pt);
    assert.ok(email.pt.includes('★★★☆☆  21 Horton'));
    assert.ok(email.en.includes('21 Horton · Fri, Nov 6'));
  });

  test('a flagged clean carries its reason and photos; a five-star one does not', () => {
    assert.ok(email.pt.includes('Ficou cabelo na banheira.'));
    assert.ok(email.pt.includes('Fotos: https://x.test/a.jpg https://x.test/b.jpg'));
    assert.ok(email.en.includes('Photos: https://x.test/a.jpg'));
    assert.ok(!email.pt.includes('never.jpg'), 'five stars prints no photos');
  });

  test('one language per email, no person named, no sign-off name', () => {
    assert.ok(!email.pt.includes('hair was left'));
    assert.ok(!email.en.includes('cabelo'));
    assert.ok(email.pt.endsWith('Obrigada!'));
    assert.ok(email.en.endsWith('Thank you!'));
    for (const name of ['Dotti', 'Ryan', 'Allie', 'Delaney']) {
      assert.ok(!email.pt.includes(name) && !email.en.includes(name), name);
    }
  });

  test('the subject names the week; one day prints once', () => {
    assert.equal(email.subjectPt, 'Avaliação das limpezas · 6/11 a 12/11');
    assert.equal(email.subjectEn, 'Cleaning review · Nov 6 to Nov 12');
    const one = composeWeeklyEmail({ ...week, firstWalk: '2026-11-12', cleans: [week.cleans[0]] });
    assert.equal(one.subjectEn, 'Cleaning review · Nov 12');
    assert.match(one.pt, /em 1 limpeza\./);
    assert.equal(ptShort('2026-11-06'), '6/11');
    assert.equal(enShort('2026-11-06'), 'Nov 6');
  });

  test('Friday covers through Thursday', () => {
    assert.equal(reportWeekEnd('2026-11-13'), '2026-11-12');
    assert.equal(reportWeekEnd('2026-12-01'), '2026-11-30');
  });

  test('the HTML escapes the text and numbers the photo links', () => {
    const html = weeklyEmailHtml('★★★☆☆  1 <b>Main</b>\nFotos: https://x.test/a.jpg https://x.test/b.jpg');
    assert.ok(html.includes('&lt;b&gt;Main&lt;/b&gt;'), 'escaped');
    assert.ok(html.includes('<a href="https://x.test/a.jpg" style="color:#1f5e6b">1</a>'));
    assert.ok(html.includes('<a href="https://x.test/b.jpg" style="color:#1f5e6b">2</a>'));
    assert.ok(html.includes('<br>'));
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
    assert.equal(noticeWord('none'), "In Friday's email");
    assert.equal(noticeWord('none', 'Crew', 'pending'), 'Waiting on approval');
    assert.equal(noticeWord('none', 'Rosa', 'sent'), 'Rosa emailed');
    assert.equal(noticeWord('handled', 'Crew', 'handled'), 'Not sent');
    assert.equal(noticeWord('sent', 'Rosa'), 'Rosa texted', 'a per-walk text from before keeps its word');
    assert.deepEqual([...CLEANING_HANDLED_REASONS], ['Spoke with the crew', 'Skip this week']);
  });
});
