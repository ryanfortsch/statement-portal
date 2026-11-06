import { JWT } from 'google-auth-library';
import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';

/** Dedicated identity, no ADC discovery, user impersonation, or existing archive credentials. */
export function createRecoveryTokenProvider(credentialJson: string, expectedEmail: string) {
  try {
    const credentials = z.object({ type: z.literal('service_account'),
      client_email: z.string().regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/),
      private_key: z.string().min(1),
    }).parse(JSON.parse(credentialJson));
    if (credentials.client_email !== expectedEmail || createPrivateKey(credentials.private_key).asymmetricKeyType !== 'rsa') throw new Error();
    // Only these fields reach Google's library. Ignore JSON-supplied token URLs and delegation.
    const client = new JWT({ email: credentials.client_email, key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'], transporterOptions: { timeout: 30_000, retry: false } });
    return async () => {
      try {
        const result = await client.getAccessToken();
        if (!result.token) throw new Error();
        return result.token;
      } catch { throw new Error('Recovery identity authentication failed'); }
    };
  } catch { throw new Error('Invalid dedicated recovery identity'); }
}
