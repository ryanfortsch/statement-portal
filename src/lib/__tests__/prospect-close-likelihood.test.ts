/**
 * Close likelihood is a plain percent in the prospect edit form, not a
 * coloured widget on the workroom or a chip on the funnel row. The column
 * stays because the forecast weights each open deal's fee by it, so the
 * form has to keep writing it, and a form without the field must never
 * clear it.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const path = (repoPath: string) => new URL(`../../../${repoPath}`, import.meta.url);
const read = (repoPath: string): string => readFileSync(path(repoPath), 'utf8');

test('the edit form carries it as a number field', () => {
  const form = read('src/components/projections/ProjectionForm.tsx');
  assert.match(form, /name="close_likelihood_pct"\s+type="number"\s+min=\{0\}\s+max=\{100\}/);
});

test('a save writes it only when the form sent the field', () => {
  const actions = read('src/app/projections/actions.ts');
  assert.match(actions, /formData\.has\('close_likelihood_pct'\) \? \{ close_likelihood_pct: likelihoodOrNull\(formData\) \} : \{\}/);
});

test('no widget, no chip, no colour bands', () => {
  assert.equal(existsSync(path('src/components/projections/CloseLikelihoodWidget.tsx')), false);
  assert.doesNotMatch(read('src/app/prospects/[id]/page.tsx'), /CloseLikelihood/);
  assert.doesNotMatch(read('src/components/projections/ProspectsPanel.tsx'), /LikelihoodChip|% likely/);
});

test('the forecast still reads it', () => {
  assert.match(read('src/lib/forecast-prospects.ts'), /p\.close_likelihood_pct/);
});
