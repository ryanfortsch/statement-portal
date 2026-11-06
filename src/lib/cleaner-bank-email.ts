/**
 * The bank-account email to Cape Ann Elite for a home coming online.
 *
 * Andrew at Cape Ann Elite charges each home's cleanings by ACH to that
 * home's own Chase account, so every new home needs its account and routing
 * number sent to him before the invoices can clear. Allie sent these by hand
 * (3 Windward and 225 Washington on 2026-08-24, 7 Sumac on 2026-11-02) and
 * 4 Middle's invoices sat waiting on it in September. The Launch step
 * `cleaner_bank_sent` (src/lib/launch-checklist.ts) composes it here.
 *
 * Helm stores only an account's last 4 (properties.bank_last4). The full
 * number is typed at draft time, checked against that last 4 so the wrong
 * home's account cannot go out, and lives only in the email itself.
 *
 * Pure: no imports beyond types, so node:test loads it directly.
 */

import type { CopiedEmail } from './copy-email.ts'; // relative: node:test loads this file

/** Andrew writes from Rosa's address; it is the one Cape Ann Elite billing reads. */
export const CAPE_ANN_ELITE_BILLING_TO: readonly string[] = ['rosa@capeannelite.com'];

/** Chase's ACH routing number for Massachusetts accounts. Every property
 *  account Rising Tide STR LLC holds is at Chase, so the field starts here. */
export const CHASE_ACH_ROUTING = '021000021';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Nine digits passing the ABA checksum (weights 3, 7, 1). */
export function validRoutingNumber(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(value[i]) * w[i % 3];
  return sum % 10 === 0;
}

export type CleanerBankEmailInput = {
  propertyName: string;
  /** properties.address; the internal name stands in when it is blank. */
  address: string | null;
  /** properties.bank_last4: the account Helm has on file for this home. */
  bankLast4: string | null;
  accountNumber: string;
  routingNumber: string;
  /** The sender's first name, for the sign-off. */
  senderShort: string;
  cc: string[];
};

export type CleanerBankEmailResult = { ok: true; email: CopiedEmail } | { ok: false; error: string };

export function buildCleanerBankEmail(input: CleanerBankEmailInput): CleanerBankEmailResult {
  const last4 = digitsOnly(input.bankLast4 ?? '');
  if (last4.length !== 4) {
    return { ok: false, error: "Enter the account's last 4 on the step above first, so Helm can check this is the right account." };
  }
  const account = digitsOnly(input.accountNumber);
  if (account.length < 6 || account.length > 17) {
    return { ok: false, error: 'An account number is 6 to 17 digits.' };
  }
  if (!account.endsWith(last4)) {
    return { ok: false, error: `That account ends in ${account.slice(-4)}; the account on file for ${input.propertyName} ends in ${last4}.` };
  }
  const routing = digitsOnly(input.routingNumber);
  if (!validRoutingNumber(routing)) {
    return { ok: false, error: 'That routing number is not valid. Chase in Massachusetts is 021000021.' };
  }

  const place = input.address?.trim() || input.propertyName;
  const body = [
    'Hi Andrew -',
    '',
    `${input.propertyName} is coming online with Rising Tide. Please charge Cape Ann Elite invoices for this home to its own account:`,
    '',
    place,
    `Routing #: ${routing}`,
    `Account #: ${account}`,
    '',
    `Can you confirm once it is set up on your end, and let us know if any invoices for ${input.propertyName} are already waiting?`,
    '',
    'Thanks,',
    input.senderShort,
  ].join('\n');

  return {
    ok: true,
    email: {
      to: [...CAPE_ANN_ELITE_BILLING_TO],
      cc: input.cc,
      subject: `Bank account for ${place}`,
      body,
    },
  };
}
