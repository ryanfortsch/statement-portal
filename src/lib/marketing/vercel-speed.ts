// Vercel Speed Insights API: trailing 7-day p75 of Core Web Vitals
// per project. Auth via VERCEL_API_TOKEN.
//
// NOTE: Vercel's Speed Insights REST surface has been moving. If the
// shape below mismatches what the API returns once we run this in
// production, adjust the response parsing and update this comment. The
// cron is wired to log + fall through (return null) on a 404 rather
// than fail the whole sync, so this is non-blocking for v1 ingestion.

const VERCEL_API_BASE = 'https://api.vercel.com';

export type SpeedInsightsP75 = {
  lcp_p75_ms: number | null;
  inp_p75_ms: number | null;
  cls_p75: number | null;
  fcp_p75_ms: number | null;
  ttfb_p75_ms: number | null;
  sample_count: number | null;
};

export async function fetchSpeedInsights(
  projectId: string,
  endDateISO: string,
): Promise<SpeedInsightsP75 | null> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error('VERCEL_API_TOKEN env var not set');

  const fromMs = new Date(endDateISO).getTime() - 7 * 24 * 3600 * 1000;
  const from = new Date(fromMs).toISOString().slice(0, 10);
  const url = `${VERCEL_API_BASE}/v1/speed-insights?projectId=${projectId}&from=${from}&to=${endDateISO}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) {
    console.warn(`[speed-insights] 404 for project ${projectId}; endpoint shape may need update`);
    return null;
  }
  if (!res.ok) {
    throw new Error(`Vercel Speed Insights failed for ${projectId}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const m = data?.metrics ?? data ?? {};
  return {
    lcp_p75_ms: m.lcp_p75 ?? m.LCP?.p75 ?? null,
    inp_p75_ms: m.inp_p75 ?? m.INP?.p75 ?? null,
    cls_p75: m.cls_p75 ?? m.CLS?.p75 ?? null,
    fcp_p75_ms: m.fcp_p75 ?? m.FCP?.p75 ?? null,
    ttfb_p75_ms: m.ttfb_p75 ?? m.TTFB?.p75 ?? null,
    sample_count: m.sample_count ?? m.samples ?? null,
  };
}
