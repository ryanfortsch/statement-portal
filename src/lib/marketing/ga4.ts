// GA4 Data API client. Uses runReport for daily-grain pulls of the
// metrics + dimensions the marketing dashboard needs (traffic totals,
// top pages, top sources, conversions). All calls authenticate via the
// shared service-account access token from auth.ts.

import { getGoogleAccessToken } from './auth';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

type StringFilter = { fieldName: string; stringFilter: { value: string; matchType?: string } };
type AndGroup = { andGroup: { expressions: Array<{ filter: StringFilter }> } };
type RunReportRequest = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics?: { name: string }[];
  limit?: string;
  orderBys?: Array<{ metric?: { metricName: string }; desc?: boolean }>;
  dimensionFilter?: { filter: StringFilter } | AndGroup;
};

type RunReportRow = {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
};

type RunReportResponse = {
  rows?: RunReportRow[];
  rowCount?: number;
};

async function runReport(propertyId: string, body: RunReportRequest): Promise<RunReportResponse> {
  const token = await getGoogleAccessToken([GA4_SCOPE]);
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`GA4 runReport failed for property ${propertyId}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const num = (s: string | undefined) => (s ? Number(s) : 0);
const numOrNull = (s: string | undefined) => (s ? Number(s) : null);

export type TrafficRow = {
  sessions: number;
  users: number;
  new_users: number;
  page_views: number;
  engagement_rate: number | null;
  avg_session_duration_seconds: number | null;
  bounce_rate: number | null;
};

export async function fetchTraffic(propertyId: string, date: string): Promise<TrafficRow> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: date, endDate: date }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'screenPageViews' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
    ],
  });
  const m = data.rows?.[0]?.metricValues ?? [];
  return {
    sessions: num(m[0]?.value),
    users: num(m[1]?.value),
    new_users: num(m[2]?.value),
    page_views: num(m[3]?.value),
    engagement_rate: numOrNull(m[4]?.value),
    avg_session_duration_seconds: numOrNull(m[5]?.value),
    bounce_rate: numOrNull(m[6]?.value),
  };
}

export type TopPageRow = { page_path: string; page_views: number; sessions: number; users: number };

export async function fetchTopPages(propertyId: string, date: string, limit = 25): Promise<TopPageRow[]> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'totalUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: String(limit),
  });
  return (data.rows ?? []).map((r) => ({
    page_path: r.dimensionValues[0].value,
    page_views: num(r.metricValues[0].value),
    sessions: num(r.metricValues[1].value),
    users: num(r.metricValues[2].value),
  }));
}

export type TopSourceRow = { source: string; medium: string; sessions: number; users: number };

export async function fetchTopSources(propertyId: string, date: string, limit = 25): Promise<TopSourceRow[]> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: String(limit),
  });
  return (data.rows ?? []).map((r) => ({
    source: r.dimensionValues[0].value,
    medium: r.dimensionValues[1].value,
    sessions: num(r.metricValues[0].value),
    users: num(r.metricValues[1].value),
  }));
}

export type UnknownLandingRow = { landing_page: string; sessions: number; users: number };

// Landing pages for sessions GA couldn't attribute (sessionSource = "(not set)").
// Useful for figuring out where the un-attributed traffic is actually going --
// if it concentrates on one page, that page's outbound links likely need UTM
// tags. If it's spread evenly, it's probably in-app browser noise (IG / FB
// strip referrers on their in-app webview).
export async function fetchUnknownSourceLandings(
  propertyId: string,
  date: string,
  limit = 25,
): Promise<UnknownLandingRow[]> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'sessionSource', stringFilter: { value: '(not set)' } } },
          { filter: { fieldName: 'sessionMedium', stringFilter: { value: '(not set)' } } },
        ],
      },
    },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: String(limit),
  });
  return (data.rows ?? []).map((r) => ({
    landing_page: r.dimensionValues[0].value,
    sessions: num(r.metricValues[0].value),
    users: num(r.metricValues[1].value),
  }));
}

export type ConversionRow = { event_name: string; count: number };

// Pull only events flagged as "key events" in GA4 admin (the GA4 successor
// to "conversions"). Filter on the isKeyEvent dimension.
export async function fetchConversions(propertyId: string, date: string): Promise<ConversionRow[]> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions: [{ name: 'eventName' }, { name: 'isKeyEvent' }],
    metrics: [{ name: 'eventCount' }],
  });
  return (data.rows ?? [])
    .filter((r) => r.dimensionValues[1].value === 'true')
    .map((r) => ({
      event_name: r.dimensionValues[0].value,
      count: num(r.metricValues[0].value),
    }));
}
