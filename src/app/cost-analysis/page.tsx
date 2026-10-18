import { redirect } from 'next/navigation';

/**
 * Cost Analysis retired as a route on 2026-10-18 without moving any
 * ingestion. Its three parts have homes: the card and operating upload and
 * the "Where it goes" ledger are the Actuals section of /forecast (whose
 * measured months already read those rows), the 1099 candidates are on the
 * Rising Tide ledger in LLC Accounting, and each home's cost to turn is on
 * its property page (Owner & money). Old links land on Actuals.
 */
export default function CostAnalysisRetired() {
  redirect('/forecast#actuals');
}
