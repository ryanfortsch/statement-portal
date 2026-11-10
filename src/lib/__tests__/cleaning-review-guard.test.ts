/**
 * A cleaning rating never reaches the crew by itself (docs/cleaning-reviews.md).
 *
 * The walk's Complete stores the stars. The Friday cron drafts ONE email of
 * the week's ratings and files it PENDING. Only the operator's Approve on the
 * Team inbox reaches the crew, and only through the one sender in
 * cleaning-reviews.ts. Each link is one line that deletes cleanly, so these
 * read the source.
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
  const fn = (name: string): string => {
    const start = lib.indexOf(`export async function ${name}`);
    const end = lib.indexOf('export async function', start + 10);
    return lib.slice(start, end === -1 ? undefined : end);
  };

  test('the email is sent only inside approveCleaningReview', () => {
    const approve = fn('approveCleaningReview');
    const outside = lib.replace(approve, '');
    assert.ok(approve.includes('sendTransactionalViaResend('), 'approve sends');
    assert.ok(!outside.includes('sendTransactionalViaResend('), 'nothing else sends');
    assert.ok(!lib.includes('sendMessage'), 'no text to the crew from here any more');
  });

  test('approve claims the report before it sends, with one key per reader', () => {
    const approve = fn('approveCleaningReview');
    assert.ok(approve.indexOf('await claim(id)') < approve.indexOf('sendTransactionalViaResend('), 'claim first');
    assert.ok(approve.includes('idempotencyKey: `cleaning-report-${id}-'), 'a retried approve mails once');
    assert.ok(approve.includes('cc: cc.filter'), 'operations on copy');
  });

  test('saving a rating stores it and files nothing for the crew', () => {
    const save = fn('saveCleaningReview');
    assert.ok(!save.includes('notice_status'), 'no per-walk note');
    assert.ok(!save.includes('report_id'), 'a retried Complete leaves its report alone');
    assert.ok(!save.includes('sendTransactionalViaResend') && !save.includes('renderOperatorNote'));
  });

  test('the Friday draft files pending, never sends, and takes each rating once', () => {
    const draft = fn('draftWeeklyCleaningReport');
    assert.ok(draft.includes("status: 'pending'"));
    assert.ok(draft.includes(".is('report_id', null)"), 'only ratings no report carried');
    assert.ok(draft.includes('update({ report_id: id })'), 'and marks them');
    assert.ok(!draft.includes('sendTransactionalViaResend') && !draft.includes('approveCleaningReview'));
  });

  test('every recipient gets one language, their own', () => {
    const approve = fn('approveCleaningReview');
    assert.ok(approve.includes('(en ? row.body_en : row.body_pt)'));
  });

  test('the cron only drafts, behind authorizeCron, on Friday', () => {
    const route = code('src/app/api/cron/cleaning-review-email/route.ts');
    assert.ok(route.includes('await authorizeCron(request)'));
    assert.ok(route.includes('draftWeeklyCleaningReport()'));
    assert.ok(!route.includes('approveCleaningReview') && !route.includes('sendTransactionalViaResend'));
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };
    const cron = vercel.crons.find((c) => c.path === '/api/cron/cleaning-review-email');
    assert.equal(cron?.schedule, '0 12 * * 5', 'Friday morning in Gloucester');
  });

  test('the crew email column is read apart from the daily text', () => {
    assert.ok(!read('src/lib/cleaner-digest-core.ts').match(/RECIPIENT_COLS\s*=[^;]*email/), 'the digest never needs the column');
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
    assert.ok(!card.includes('sendMessage') && !card.includes('sendTransactionalViaResend'));
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
