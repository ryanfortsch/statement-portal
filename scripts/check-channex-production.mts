// Run explicitly with Node >=24 and --conditions=react-server. Does not load .env files.
import { inspectCalderwoodProduction, ProductionPreflightError } from '../src/lib/channex-production-preflight.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || !args.includes('--read-only') || !args.includes('--property=65_calderwood')) {
  process.stderr.write('Usage: node --conditions=react-server scripts/check-channex-production.mts --property=65_calderwood --read-only\n');
  process.exitCode = 2;
} else {
  try {
    const receipt = await inspectCalderwoodProduction(process.env.CHANNEX_PRODUCTION_API_KEY ?? '');
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    // Never emit raw provider responses, tokens, nested errors or stack traces.
    const code = error instanceof ProductionPreflightError ? error.code : 'PREFLIGHT_FAILED';
    process.stderr.write(`Channex production preflight failed: ${code}\n`);
    process.exitCode = 1;
  }
}
