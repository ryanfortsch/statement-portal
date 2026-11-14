/**
 * A prospect carries the home's bathrooms, how many it sleeps and the
 * office's note (src/lib/prospect-facts.ts, 2026-11-14). The form parses
 * them, the workroom and the prospects list print one facts line, the
 * readiness checklist sizes from them, and promote carries them onto the
 * property. The note is the office's: it never reaches a deliverable.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bathsLabel, parseBathrooms, parseSleeps, prospectFactsLine } from '../prospect-facts.ts';
import { deriveReadinessContext } from '../projections-readiness.ts';
import type { ProjectionRow } from '../projections-types.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const row = (over: Partial<ProjectionRow>): ProjectionRow => ({ bedrooms: 3, onboarding_data: null, ...over }) as ProjectionRow;

describe('the form parses what the office heard', () => {
  test('bathrooms take halves and blank is null', () => {
    assert.equal(parseBathrooms('1.5'), 1.5);
    assert.equal(parseBathrooms('2'), 2);
    assert.equal(parseBathrooms('  '), null);
  });
  test('bathrooms refuse a quarter, zero and nonsense', () => {
    assert.throws(() => parseBathrooms('1.25'));
    assert.throws(() => parseBathrooms('0'));
    assert.throws(() => parseBathrooms('two'));
    assert.throws(() => parseBathrooms('21'));
  });
  test('sleeps is a whole number of guests', () => {
    assert.equal(parseSleeps('7'), 7);
    assert.equal(parseSleeps(''), null);
    assert.throws(() => parseSleeps('6.5'));
    assert.throws(() => parseSleeps('0'));
    assert.throws(() => parseSleeps('41'));
  });
});

describe('one facts line', () => {
  test('the workroom leads with the type', () => {
    assert.equal(
      prospectFactsLine({ property_type: 'Cottage', bedrooms: 3, bathrooms: 1.5, sleeps: 7 }, { withType: true }),
      'Cottage · 3 BR · 1.5 BA · Sleeps 7',
    );
  });
  test('the list leaves the type off and skips what is unknown', () => {
    assert.equal(prospectFactsLine({ property_type: 'House', bedrooms: 2 }), '2 BR');
    assert.equal(prospectFactsLine({ bedrooms: 4, sleeps: 8 }), '4 BR · Sleeps 8');
  });
  test('a numeric that comes back as a string still prints', () => {
    assert.equal(bathsLabel('2.5'), '2.5 BA');
    assert.equal(bathsLabel(null), null);
    assert.equal(bathsLabel(''), null);
  });
});

describe('the readiness checklist sizes from them', () => {
  test('nothing typed: the old estimates', () => {
    const ctx = deriveReadinessContext(row({}));
    assert.equal(ctx.maxGuests, 6);
    assert.equal(ctx.guestsSource, 'estimate');
    assert.equal(ctx.bathrooms, 2);
    assert.equal(ctx.bathroomsSource, 'estimate');
    assert.equal(ctx.bathroomsFromIntake, false);
  });
  test('the prospect\'s numbers, half-baths rounded up', () => {
    const ctx = deriveReadinessContext(row({ bathrooms: 1.5, sleeps: 7 }));
    assert.equal(ctx.maxGuests, 7);
    assert.equal(ctx.guestsSource, 'prospect');
    assert.equal(ctx.bathrooms, 2);
    assert.equal(ctx.bathroomsSource, 'prospect');
    assert.equal(ctx.bathroomsFromIntake, true);
  });
  test('the owner\'s onboarding answer wins over what the office typed', () => {
    const ctx = deriveReadinessContext(
      row({ bathrooms: 1.5, onboarding_data: { bathrooms: '2.5' } as ProjectionRow['onboarding_data'] }),
    );
    assert.equal(ctx.bathrooms, 3);
    assert.equal(ctx.bathroomsSource, 'intake');
  });
});

describe('the save and promote paths', () => {
  const actions = read('src/app/projections/actions.ts');
  test('a form without the fields never clears them', () => {
    for (const field of ['bathrooms', 'sleeps', 'prospect_notes']) {
      assert.ok(
        actions.includes(`formData.has('${field}')`),
        `buildPayload writes ${field} only when the form carries it`,
      );
    }
  });
  test('promote carries bathrooms (owner first) and sleeps as max occupancy', () => {
    assert.match(actions, /bathrooms: numOr\(ob\.bathrooms, \(projRow\.bathrooms/);
    assert.match(actions, /max_occupancy: Number\(projRow\.sleeps\)/);
  });
  test('the edit form carries all three', () => {
    const form = read('src/components/projections/ProjectionForm.tsx');
    for (const field of ['bathrooms', 'sleeps', 'prospect_notes']) {
      assert.ok(form.includes(`name="${field}"`), `ProjectionForm has a ${field} input`);
    }
  });
});

describe('the office note never reaches a deliverable', () => {
  // The deck, guide, contract, checklist and onboarding renders all live
  // under these trees; only the workroom page and the form may read it.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  const root = new URL('../../../', import.meta.url).pathname;
  test('no render under /projections/<id>/, /contract or the readiness pages names it', () => {
    const files = [
      ...walk(join(root, 'src/app/projections/[id]')),
      ...walk(join(root, 'src/app/contract')),
      ...walk(join(root, 'src/app/prospects/[id]/readiness')),
      ...walk(join(root, 'src/components/projections')).filter((f) => !f.endsWith('ProjectionForm.tsx')),
    ];
    assert.ok(files.length > 5, 'the walk found the render trees');
    const leaks = files.filter((f) => readFileSync(f, 'utf8').includes('prospect_notes'));
    assert.deepEqual(leaks, []);
  });
});
