/**
 * A cleaning rating never texts by itself (docs/cleaning-reviews.md).
 *
 * The walk's Complete stores the stars and, at four or fewer, files the crew
 * note PENDING. Only the operator's Approve on the Team inbox reaches a
 * phone, and only through the one sender in cleaning-reviews.ts. Each link
 * is one line that deletes cleanly, so these read the source.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (repoPath: string): string => read(repoPath).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the one sender', () => {
  const lib = code('src/lib/cleaning-reviews.ts');

  test('sendMessage is called only inside approveCleaningReview', () => {
    const approveStart = lib.indexOf('export async function approveCleaningReview');
    const approveEnd = lib.indexOf('export async function', approveStart + 10);
    const inside = lib.slice(approveStart, approveEnd);
    const outside = lib.slice(0, approveStart) + lib.slice(approveEnd);
    assert.ok(inside.includes('sendMessage('), 'approve sends');
    assert.ok(!outside.includes('sendMessage('), 'nothing else sends');
  });

  test('approve claims the row before it sends, and sends from the Rising Tide line', () => {
    const approve = lib.slice(lib.indexOf('export async function approveCleaningReview'));
    assert.ok(approve.indexOf('await claim(id)') < approve.indexOf('sendMessage('), 'claim first');
    assert.ok(approve.includes("quoFromNumber('ops')"), 'the back-office line, never guests or owners');
    assert.ok(!approve.includes("quoFromNumber('guests')") && !approve.includes("quoFromNumber('owners')"));
  });

  test('saving a rating files pending and does not send', () => {
    const saveStart = lib.indexOf('export async function saveCleaningReview');
    const saveEnd = lib.indexOf('export async function', saveStart + 10);
    const save = lib.slice(saveStart, saveEnd);
    assert.ok(save.includes("status: 'pending'"), 'four or fewer files a pending note');
    assert.ok(!save.includes('sendMessage'), 'the save never texts');
    assert.ok(save.includes('needsCleaningNotice(stars)'), 'the threshold is the core rule, not a literal here');
  });

  test('every recipient gets one language, their own', () => {
    const approve = lib.slice(lib.indexOf('export async function approveCleaningReview'));
    assert.ok(approve.includes("r.language === 'en' ? row.notice_en : row.notice_pt"));
  });
});

describe('the walk and the card', () => {
  test('the Stepper asks and Complete carries the answer', () => {
    const stepper = read('src/app/inspections/[id]/Stepper.tsx');
    assert.ok(stepper.includes('<CleanRating'), 'the question is on the review screen');
    assert.ok(stepper.includes('cleaning: cleaningStars ?'), 'Complete carries the stars');
    assert.ok(stepper.includes('!cleaningAnswered'), 'Complete waits for an answer');
    assert.ok(!stepper.includes('sendMessage'), 'the Stepper never texts');
  });

  test('completeInspection stores the rating through the one writer', () => {
    const actions = code('src/app/inspections/actions.ts');
    assert.ok(actions.includes('saveCleaningReview({'));
    assert.ok(!actions.includes('approveCleaningReview'), 'Complete never approves');
    assert.ok(!actions.includes("from('cleaning_reviews')"), 'no direct write beside the writer');
  });

  test('the card wires approve, edit and handled; nothing in the card sends', () => {
    const card = code('src/app/messaging/team/CleaningReviewCard.tsx');
    for (const verb of ['approveCleaningReviewAction', 'editCleaningReviewAction', 'markCleaningReviewHandledAction']) {
      assert.ok(card.includes(verb), verb);
    }
    assert.ok(!card.includes('sendMessage'));
    const actions = code('src/app/messaging/team/cleaning-review-actions.ts');
    assert.ok(actions.includes('await auth()'), 'a signed-in operator');
    assert.ok(actions.includes('approveCleaningReview(id, who)'));
  });

  test('the Team inbox counts the card with the cleaners', () => {
    const count = code('src/app/api/messaging/pending-count/route.ts');
    assert.ok(count.includes('countPendingCleaningReviews'));
    assert.ok(/cleaners\s*=[\s\S]*cleaningReviews/.test(count), 'counts on the Cleaners badge');
    const queue = code('src/app/messaging/team/TeamInboxQueue.tsx');
    assert.ok(queue.includes("kind === 'cleaning_review'"));
  });
});

describe('the page', () => {
  test('My page is on the atlas, hidden, and the avatar menu links it', () => {
    const atlas = read('src/lib/helm-modules.ts');
    assert.match(atlas, /id: 'me',\s*href: '\/me'/);
    assert.ok(read('src/components/UserMenu.tsx').includes('href="/me"'));
  });
  test('an owner reads a teammate; staff only themselves', () => {
    const page = code('src/app/me/page.tsx');
    assert.ok(page.includes('owner && asked && getTeamMember(asked) ? asked : me'));
  });
});
