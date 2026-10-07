/**
 * A listing picture's id is NOT the id the caption write takes.
 *
 * Guesty describes the same gallery twice. The listing object's `pictures`
 * array is what the caption tool, the statement render and
 * staycapeann.com read. The property-photos resource is what the caption
 * WRITE is keyed by. Same images, same Cloudinary URLs, and — verified
 * live on 19 Rackliffe, 2026-09-27 — completely disjoint `_id` sets:
 *
 *   pictures[0]._id         6ab53b19f6251b00118eb8e5
 *   property-photos[0]._id  6ab53b1b397e952e86a1f2c6   (same image)
 *
 * Helm sent the `pictures` id for months. Guesty answered 201 every time
 * and the caption landed nowhere, which is what the operator saw as 29
 * photos that would not save.
 *
 * The bridge between the two is the Cloudinary asset slug, and it is the
 * only thing both representations agree on. These tests pin that slug
 * extraction, because a "tidy-up" of it silently restores the old bug:
 * the write would still return 201 and still do nothing.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photoAssetKey } from '../guesty.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const REAL_URL =
  'https://assets.guesty.com/image/upload/v1790262039/production/666a36847fc6d5653142b08e/tsm2zzdy0gwh4hggdyor.jpg';

describe('the caption write is keyed by the property-photo id, not the picture id', () => {
  test('the asset slug is the identity both representations share', () => {
    assert.equal(photoAssetKey(REAL_URL), 'tsm2zzdy0gwh4hggdyor');
    // A transformation prefix and a different extension are the same upload.
    assert.equal(
      photoAssetKey(
        'https://assets.guesty.com/image/upload/c_fill,w_400/v1790262039/production/666a36847fc6d5653142b08e/tsm2zzdy0gwh4hggdyor.webp',
      ),
      'tsm2zzdy0gwh4hggdyor',
    );
    // A query string is not part of the identity.
    assert.equal(photoAssetKey(`${REAL_URL}?w=200`), 'tsm2zzdy0gwh4hggdyor');
  });

  test('a missing URL yields an empty key, and an empty key matches nothing', () => {
    for (const v of [undefined, null, '']) {
      assert.equal(photoAssetKey(v), '', `${String(v)} should not produce a key`);
    }
    // The resolver drops empty keys before comparing, so two captionless
    // photos can never be matched to each other by "both have no URL".
    const src = read('src/lib/guesty.ts');
    assert.ok(
      src.includes('.filter(Boolean)'),
      'resolvePropertyPhotoId no longer drops empty asset keys before matching',
    );
  });

  test('the save translates the id and refuses rather than falling back', () => {
    const src = read('src/app/properties/[id]/caption-photos/actions.ts');
    assert.ok(src.includes('resolvePropertyPhotoId(listingId, target)'), 'the id is no longer translated');
    assert.ok(
      src.includes('updatePhotoCaption(listingId, writeId, clean)'),
      'the write no longer uses the translated id',
    );
    // The old bug in one line: never send the pictures id to the write.
    assert.ok(
      !/updatePhotoCaption\([^)]*\bphotoId\b/.test(src),
      'the pictures-array photoId is being passed to the caption write again',
    );
    // No silent fallback to the untranslated id when the match fails.
    assert.ok(
      src.includes('if (!writeId || !isRealPhotoId(writeId))'),
      'an unmatched photo no longer refuses the write',
    );
  });

  test('a caption on the record but not the gallery is reported as its own case', () => {
    const src = read('src/app/properties/[id]/caption-photos/actions.ts');
    assert.ok(src.includes('captionOnPhotoRecord'), 'the two failure halves are no longer told apart');
    assert.ok(
      src.includes("if (onRecord === clean)"),
      'a propagation lag is being reported as a dead write again',
    );
  });
});
