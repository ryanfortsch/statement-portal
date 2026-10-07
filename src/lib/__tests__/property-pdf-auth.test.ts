import { test } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer, { type Browser, type HTTPRequest } from 'puppeteer-core';
import { renderPropertyPdf } from '../property-pdf.ts';
import { PROPERTY_RENDER_HEADER, verifyPropertyDocumentToken } from '../property-document-token.ts';

const secret = 'synthetic-renderer-test-secret';

// Exercise the actual renderer with a controlled browser boundary. In particular,
// redirects/assets must never inherit the temporary authorization header.
function browserFixture({ ok = true, hasDocument = true } = {}) {
  const mainFrame = {};
  let intercept: ((request: HTTPRequest) => void) | undefined;
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let printed = false;
  let closed = false;
  const page = {
    setExtraHTTPHeaders: async () => {},
    setRequestInterception: async (enabled: boolean) => { assert.equal(enabled, true); },
    on: (_event: string, callback: (request: HTTPRequest) => void) => { intercept = callback; },
    mainFrame: () => mainFrame,
    goto: async (url: string) => {
      assert.ok(intercept, 'Protected navigation must install its request guard');
      for (const [requestUrl, navigation, frame] of [
        [url, true, mainFrame],
        [url, false, mainFrame],
        [url, true, {}],
        [`${url}/redirected`, true, mainFrame],
        ['https://external.example/image', false, mainFrame],
      ] as const) {
        intercept({
          url: () => requestUrl,
          isNavigationRequest: () => navigation,
          frame: () => frame,
          headers: () => ({ [PROPERTY_RENDER_HEADER]: 'inherited-token', 'x-vercel-protection-bypass': 'synthetic-bypass' }),
          continue: async ({ headers }: { headers: Record<string, string> }) => { requests.push({ url: requestUrl, headers }); },
        } as unknown as HTTPRequest);
      }
      return { ok: () => ok };
    },
    $: async (selector: string) => {
      assert.match(selector, /^\[data-property-document="(wifi-placard|home-guide)"\]$/);
      return hasDocument ? {} : null;
    },
    evaluate: async () => {},
    pdf: async () => { printed = true; return Buffer.from('synthetic-pdf'); },
  };
  return {
    browser: { newPage: async () => page, close: async () => { closed = true; } } as unknown as Browser,
    requests,
    get printed() { return printed; },
    get closed() { return closed; },
  };
}

for (const type of ['wifi-placard', 'home-guide'] as const) {
  test(`${type}: temporary authorization goes only to the exact main document`, async (t) => {
    const fixture = browserFixture();
    t.mock.method(puppeteer, 'launch', async () => fixture.browser);
    const oldSecret = process.env.AUTH_SECRET;
    const oldChrome = process.env.CHROME_EXECUTABLE_PATH;
    process.env.AUTH_SECRET = secret;
    process.env.CHROME_EXECUTABLE_PATH = 'synthetic-chrome';
    try {
      const pdf = await renderPropertyPdf({ propertyId: 'test-house', type, origin: 'https://helm.example' });
      assert.equal(pdf.toString(), 'synthetic-pdf');
      assert.equal(fixture.requests.length, 5);
      const token = fixture.requests[0].headers[PROPERTY_RENDER_HEADER];
      assert.equal(verifyPropertyDocumentToken(token, 'test-house', type, secret), true);
      for (const request of fixture.requests.slice(1)) assert.equal(request.headers[PROPERTY_RENDER_HEADER], undefined);
      for (const request of fixture.requests) {
        assert.ok(!request.url.includes(token));
        assert.equal(request.headers['x-vercel-protection-bypass'], 'synthetic-bypass');
      }
      assert.equal(fixture.printed, true);
      assert.equal(fixture.closed, true);
    } finally {
      if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
      if (oldChrome === undefined) delete process.env.CHROME_EXECUTABLE_PATH; else process.env.CHROME_EXECUTABLE_PATH = oldChrome;
    }
  });
}

for (const scenario of [{ ok: false, hasDocument: false }, { ok: true, hasDocument: false }]) {
  test(`denied document (HTTP ${scenario.ok ? '200 stream' : 'error'}) cannot be downloaded as a PDF`, async (t) => {
    const fixture = browserFixture(scenario);
    t.mock.method(puppeteer, 'launch', async () => fixture.browser);
    const oldSecret = process.env.AUTH_SECRET;
    const oldChrome = process.env.CHROME_EXECUTABLE_PATH;
    process.env.AUTH_SECRET = secret;
    process.env.CHROME_EXECUTABLE_PATH = 'synthetic-chrome';
    try {
      await assert.rejects(renderPropertyPdf({ propertyId: 'test-house', type: 'wifi-placard', origin: 'https://helm.example' }), /PDF download cancelled/);
      assert.equal(fixture.printed, false);
      assert.equal(fixture.closed, true);
    } finally {
      if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
      if (oldChrome === undefined) delete process.env.CHROME_EXECUTABLE_PATH; else process.env.CHROME_EXECUTABLE_PATH = oldChrome;
    }
  });
}
