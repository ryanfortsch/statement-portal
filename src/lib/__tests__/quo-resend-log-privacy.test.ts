/**
 * The Quo and Resend paths never write a phone number, an email address or
 * what someone wrote into the Vercel log.
 *
 * Found in production logs the week of 2026-10-20: the Quo ingest threw
 * "cleaner phone <number> matched ... from body: <first 80 characters>" and
 * the webhook logged it; resend.ts logged every subscriber's address while
 * the audience id was unset. The log lines now carry ids. This reads every
 * console call (and every thrown message the webhook logs) in those files
 * and refuses an argument that names personal data, the way
 * shoot-offer-optin.test.ts guards its filters.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactEmails } from '../resend.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The argument text of every `<opener>(` call in `src`, parens matched. */
function calls(src: string, opener: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(opener.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    let quote: string | null = null;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** Code only: plain string literals emptied, template literals reduced to
 *  their ${} expressions, so a word inside a message ("household phone not
 *  filled") is not mistaken for a variable. */
function codeOf(args: string): string {
  return args
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, (t) => (t.match(/\$\{[^}]*\}/g) ?? []).join(' '));
}

/** Names that hold a phone, an address or a message body on these paths. */
const PERSONAL = /\b(?:fromPhone|toPhone|otherParty|phone|body|email|recipientEmail|rawBody|txt)\b|\bmsg\.(?:from|to|body|text)\b/;

/** A whole error object, whose fields (a Postgres error's `details`) can
 *  quote the failing row. */
const WHOLE_ERROR = /^(?:err|error|e|eventInsert\.error)$/;

function offenders(src: string, opener: RegExp): string[] {
  return calls(src, opener).filter((args) => {
    // Resend's response text is fine once its addresses are redacted.
    const code = codeOf(args).replace(/redactEmails\([^)]*\)/g, '');
    if (PERSONAL.test(code)) return true;
    return code.split(',').some((a) => WHOLE_ERROR.test(a.trim()));
  });
}

const CONSOLE = /console\.(?:log|info|warn|error|debug)\(/;
const THROW = /throw new Error\(/;

const FILES = [
  'src/lib/quo-ingest.ts',
  'src/lib/resend.ts',
  'src/app/api/webhooks/quo/route.ts',
  'src/app/api/guests/resend-webhook/route.ts',
];

describe('no personal data in the Quo and Resend logs', () => {
  for (const file of FILES) {
    test(`${file}: console lines carry ids, not a phone, an email or a body`, () => {
      const bad = offenders(read(file), CONSOLE);
      assert.deepEqual(bad, [], `${file} logs personal data: ${bad.join(' | ')}`);
    });
  }

  test('the ingest throws nothing a person said: the webhook logs every thrown message', () => {
    for (const file of ['src/lib/quo-ingest.ts', 'src/lib/cleaner-unplaced.ts']) {
      const bad = offenders(read(file), THROW);
      assert.deepEqual(bad, [], `${file} throws personal data: ${bad.join(' | ')}`);
    }
  });

  test('the guard sees the old lines', () => {
    // The two lines production logged, as they were. If the guard stops
    // catching these it catches nothing.
    const old = [
      "throw new Error(`cleaner phone ${fromPhone} matched but property could not be attributed from body: ${body.slice(0, 80)}`);",
      "console.warn('[resend] not configured; skipping pushContactToResend for', args.email);",
      "console.error('Quo webhook: dispatch failed', err);",
      "console.error('[resend] pushContact failed', res.status, txt);",
    ];
    assert.equal(offenders(old[0], THROW).length, 1);
    for (const line of old.slice(1)) assert.equal(offenders(line, CONSOLE).length, 1, line);
    // And leaves a safe line alone.
    assert.equal(offenders("console.warn('[quo-ingest] household phone not filled', err instanceof Error ? err.message : err);", CONSOLE).length, 0);
  });

  test("Resend's error text loses its addresses and keeps the rest", () => {
    assert.equal(
      redactEmails('{"name":"validation_error","message":"Invalid `to` field: guest.name+x@gmail.com"}'),
      '{"name":"validation_error","message":"Invalid `to` field: [email]"}',
    );
    assert.equal(redactEmails('The staycapeann.com domain is not verified'), 'The staycapeann.com domain is not verified');
    assert.equal(redactEmails('Stay Cape Ann <hello@staycapeann.com>'), 'Stay Cape Ann <[email]>');
  });
});
