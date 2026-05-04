// One-shot backfill: pull the last N days of marketing data into
// Supabase. Idempotent -- reruns overwrite the same (site_id, date)
// rows safely.
//
// Run from the project root:
//   npx tsx --env-file=.env.local scripts/marketing-backfill.ts        # last 90 days
//   npx tsx --env-file=.env.local scripts/marketing-backfill.ts 30     # last 30 days
//
// Required env (in .env.local):
//   GOOGLE_SERVICE_ACCOUNT_KEY    # raw JSON of the Google service-account key
//   VERCEL_API_TOKEN              # Vercel personal access token (for Speed Insights)
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY     # or NEXT_PUBLIC_SUPABASE_ANON_KEY

import { syncAllSitesForDate, type SyncResult } from '../src/lib/marketing/sync';

async function main() {
  const days = Number.parseInt(process.argv[2] || '90', 10);
  if (!Number.isFinite(days) || days < 1) {
    console.error(`Invalid days argument: ${process.argv[2]}`);
    process.exit(1);
  }
  console.log(`Backfilling marketing data for the last ${days} days...\n`);

  let totalErrors = 0;
  for (let i = days; i >= 1; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    process.stdout.write(`  ${d}  `);
    try {
      const res: SyncResult[] = await syncAllSitesForDate(d);
      const summary = res
        .map((r) => `${r.site_id}=${r.sessions ?? '?'}s/${r.conversions ?? '?'}c`)
        .join('  ');
      const errs = res.flatMap((r) => r.errors);
      totalErrors += errs.length;
      if (errs.length === 0) console.log(`✓ ${summary}`);
      else console.log(`⚠ ${summary}  errs=${errs.length}`);
    } catch (e) {
      console.log(`✗ ${e instanceof Error ? e.message : String(e)}`);
      totalErrors++;
    }
  }

  console.log(`\nDone. ${days} dates processed, ${totalErrors} per-fetcher errors total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
