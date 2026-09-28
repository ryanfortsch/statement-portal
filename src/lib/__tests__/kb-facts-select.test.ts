/**
 * /api/kb-facts reads every property column its payload sends.
 *
 * The rows are cast to a PropertyRow type, so a column the payload reads but
 * the select leaves out is not a type error: it arrives as undefined, and
 * clean() turns it into an empty string the guest AI takes as "no policy".
 * A merge that took one side's column list (the PMS branch against #1623)
 * would have sent every home's house policies blank with tsc green. So this
 * reads the source and checks the select against the payload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app/api/kb-facts/route.ts', import.meta.url), 'utf8');

test("the properties select carries every p.<column> the payload reads", () => {
  const m = /\.from\('properties'\)\s*\.select\(\s*'([^']+)'/.exec(src);
  assert.ok(m, 'no properties select found');
  const selected = new Set(m![1].split(',').map((c) => c.trim()));
  const read = new Set([...src.matchAll(/\bp\.([a-z_0-9]+)/g)].map((x) => x[1]));
  const missing = [...read].filter((c) => !selected.has(c));
  assert.deepEqual(missing, [], `read but never selected: ${missing.join(', ')}`);
});
