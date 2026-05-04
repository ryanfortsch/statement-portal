// Google service-account JWT-based access tokens.
//
// Reads the JSON key from process.env.GOOGLE_SERVICE_ACCOUNT_KEY (raw
// JSON string in Vercel env), signs a JWT with RS256 using Node's
// built-in crypto, and exchanges it at the Google token endpoint for a
// 1-hour access token. Tokens are cached in-process so a single cron
// invocation doesn't re-mint on every API call.

import { createSign } from 'node:crypto';

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

type CachedToken = { token: string; expiresAt: number };
const cache = new Map<string, CachedToken>();

function loadKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var not set');
  return JSON.parse(raw);
}

function signJwt(privateKey: string, payload: object): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  const signature = signer.sign(privateKey).toString('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const cacheKey = [...scopes].sort().join(' ');
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const sa = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(sa.private_key, {
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  });

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });
  return data.access_token;
}
