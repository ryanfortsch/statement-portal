/** Offline compilation only. Reads the private capture and writes private SQL.
 * node --import ./scripts/server-only-test-hook.mjs scripts/prepare-channex-templates.mts CAPTURE OUTSIDE_REPO.sql
 * Never loads .env, opens the network, writes the DB or prints template content.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCalderwoodTemplates } from '../src/lib/channex-messaging/template-migration.ts';
try {
  const [capture, output, extra] = process.argv.slice(2);
  if (!capture || !output || extra || !isAbsolute(capture) || !isAbsolute(output)) throw Error();
  const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  const parent = realpathSync(dirname(output));
  if (parent === root || parent.startsWith(root + sep)) throw Error();
  const raw = readFileSync(capture, 'utf8'); if (Buffer.byteLength(raw) > 110000) throw Error();
  const rows = compileCalderwoodTemplates(JSON.parse(raw), Date.now());
  const json = JSON.stringify(rows).replaceAll("'", "''");
  const sql = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\nset local standard_conforming_strings=on;\nselect public.helm_channex_prepare_templates('${json}'::jsonb);\ncommit;\n`;
  writeFileSync(resolve(parent, output.split(sep).at(-1)!), sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log('Prepared six disabled canonical rules. Private SQL written; no database action or messages.');
} catch { console.error('Could not prepare template migration. Check the complete source capture and a new output path outside the repository.'); process.exitCode = 1; }
