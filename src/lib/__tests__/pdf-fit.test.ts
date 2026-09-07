import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_FIT_SCALE,
  PAGE_HEIGHT_PX,
  nextFitScale,
  tooTallMessage,
} from '../pdf-fit.ts';

/** Walk the loop src/lib/pdf.ts runs, with a browser that reflows perfectly. */
function converge(naturalHeight: number, maxPasses = 4) {
  let scale = 1;
  // Reflowing at the wider canvas shortens the sheet slightly; 0.5% is the
  // conservative end of what was measured, so the test never flatters itself.
  let height = naturalHeight;
  let passes = 0;
  while (height > PAGE_HEIGHT_PX && passes < maxPasses) {
    const next = nextFitScale(scale, height);
    if (next < MIN_FIT_SCALE) return { scale, height, passes, hitFloor: true };
    scale = next;
    height = naturalHeight * scale * 0.995;
    passes += 1;
  }
  return { scale, height, passes, hitFloor: false };
}

test('a statement that already fits is never touched', () => {
  const { scale, passes } = converge(1040);
  assert.equal(scale, 1);
  assert.equal(passes, 0, 'no zoom is written, so the PDF is byte-identical to before');
});

test('a sheet exactly one page is left alone', () => {
  assert.equal(converge(PAGE_HEIGHT_PX).scale, 1);
});

test('a 1.4-page month fits in a single pass', () => {
  const { scale, height, passes, hitFloor } = converge(1457);
  assert.equal(hitFloor, false);
  assert.ok(height <= PAGE_HEIGHT_PX, `still ${height}px`);
  assert.equal(passes, 1, 'solving exactly took four round trips; the undershoot takes one');
  assert.ok(scale > 0.7 && scale < 0.73, `scale was ${scale}`);
});

test('the undershoot always lands under the page, never exactly on it', () => {
  for (const natural of [1100, 1200, 1350, 1457, 1600, 1670]) {
    const { height, hitFloor } = converge(natural);
    assert.equal(hitFloor, false, `${natural}px should fit`);
    assert.ok(height < PAGE_HEIGHT_PX, `${natural}px landed at ${height}px`);
  }
});

test('shrinking is monotonic: a heavier month never gets a bigger scale', () => {
  let prev = 1;
  for (const natural of [1057, 1200, 1400, 1600, 1670]) {
    const { scale, hitFloor } = converge(natural);
    assert.equal(hitFloor, false, `${natural}px should still fit`);
    assert.ok(scale <= prev, `${natural}px got ${scale}, up from ${prev}`);
    prev = scale;
  }
});

test('where the floor actually bites, to the pixel', () => {
  // The undershoot eats into the floor, so the real limit is MIN_FIT_SCALE
  // divided by 0.985, not MIN_FIT_SCALE itself: 1677px, a touch under the
  // 1.6 pages the docstring rounds to. Pinned because the two constants
  // interact, and moving either one silently moves this.
  assert.equal(converge(1676).hitFloor, false);
  assert.equal(converge(1678).hitFloor, true);
  assert.ok(Math.abs(1677 / PAGE_HEIGHT_PX - 1.588) < 0.001);
});

test('past the floor it refuses instead of shrinking to unreadable', () => {
  const { hitFloor } = converge(2375); // ~2.25 pages
  assert.equal(hitFloor, true);
});

test('the floor sits where the docstring says: about 1.6 pages', () => {
  assert.equal(converge(PAGE_HEIGHT_PX * 1.55).hitFloor, false);
  assert.equal(converge(PAGE_HEIGHT_PX * 1.75).hitFloor, true);
});

test('the refusal names the size of the problem and says nothing was sent', () => {
  const msg = tooTallMessage(2375);
  assert.match(msg, /225% of a page/);
  assert.match(msg, /Nothing was sent/);
  assert.match(msg, /62%/);
});

test('a zero or negative measurement cannot produce a nonsense scale', () => {
  assert.equal(nextFitScale(0.8, 0), 0.8);
  assert.equal(nextFitScale(0.8, -12), 0.8);
});
