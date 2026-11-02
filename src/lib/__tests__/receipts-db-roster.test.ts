/**
 * /api/receipts accepts any home the `properties` table knows, not only the
 * hardcoded PROPERTIES roster in src/lib/properties.ts.
 *
 * Found 2026-11-02 going into the October close: 7 Sumac's first statement,
 * and 16 Waterman, 36 Granite, 4 Middle, 79 Main and 65 Calderwood, all have
 * rows in `properties` and none in PROPERTIES, so the route answered
 * "Unknown property_id" for every one of them. The Field close handoff files
 * through the same route. This test reads the source so the code roster
 * cannot quietly come back as the gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../app/api/receipts/route.ts', import.meta.url),
  'utf8',
);

test('the receipts route does not import the code roster', () => {
  assert.doesNotMatch(source, /import \{[^}]*\bPROPERTIES\b[^}]*\} from '@\/lib\/properties'/);
  assert.doesNotMatch(source, /\bPROPERTIES\[/);
});

test('the receipts route gates property_id on the database roster', () => {
  assert.match(source, /import \{ getActivePropertyForStatements \} from '@\/lib\/properties-server'/);
  assert.match(
    source,
    /if \(!propertyId \|\| !\(await getActivePropertyForStatements\(propertyId\)\)\) \{\s*\n\s*return NextResponse\.json\(\{ error: `Unknown property_id: \$\{propertyId\}` \}, \{ status: 400 \}\);/,
  );
});
