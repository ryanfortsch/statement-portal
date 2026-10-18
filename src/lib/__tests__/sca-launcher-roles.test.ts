/**
 * The Stay Cape Ann launcher has a staff half and an owner half (UI/UX audit
 * 2026-10-17, appendix 05: "The SCA launcher shows staff the Stripe wiring and
 * a Force go-live button").
 *
 * Staff write the listing and review the preview (Steps 1 and 2). Payments and
 * go-live (Step 3's Stripe wiring checklist and payment probe, Step 4's
 * go-live, Force go-live and Unlist) are owner acts. Hiding them is not
 * enough: a server action posts to whatever page rendered it, so each owner
 * action must refuse a staff session itself.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const ACTIONS = 'src/app/properties/[id]/stay-cape-ann/actions.ts';
const CLIENT = 'src/app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx';
const PAGE = 'src/app/properties/[id]/stay-cape-ann/page.tsx';

function body(src: string, name: string): string {
  const m = src.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |\\nasync function |$)`));
  assert.ok(m, `${name} not found`);
  return m[0];
}

test('payments and go-live actions refuse a staff session', () => {
  const src = read(ACTIONS);
  assert.match(src, /async function ownerOrRefusal\(\)[\s\S]*?return \{ email: await requireOwnerEmail\(\) \};/);
  for (const name of ['setPaymentStep', 'verifyPaymentWiring', 'goLiveSca', 'unlistSca']) {
    const b = body(src, name);
    assert.ok(b.includes('const owner = await ownerOrRefusal();'), `${name} must require an owner`);
    assert.ok(b.includes("if (!('email' in owner)) return owner;"), `${name} must return the refusal`);
  }
});

test('listing content stays open to staff', () => {
  const src = read(ACTIONS);
  for (const name of ['pullFromGuesty', 'saveScaDraft', 'openScaPr', 'openScaUpdatePr', 'publishScaUpdate', 'refreshPreviewStatus', 'refreshScaSiteData']) {
    assert.ok(!body(src, name).includes('ownerOrRefusal'), `${name} is listing content and stays open to staff`);
  }
});

test('the page passes the role and the client renders Steps 3 and 4 for owners only', () => {
  const page = read(PAGE);
  assert.ok(page.includes("const isOwner = roleForEmail(session?.user?.email) === 'owner';"));
  assert.ok(page.includes('isOwner={isOwner}'));

  const client = read(CLIENT);
  const ownerHalf = client.indexOf('{props.isOwner && (<>');
  const step3 = client.indexOf('<div className="eyebrow">Step 3</div>');
  const step4 = client.indexOf('<div className="eyebrow">Step 4</div>');
  const close = client.indexOf('</>)}', step4);
  assert.ok(ownerHalf > 0 && ownerHalf < step3 && step3 < step4 && step4 < close, 'Steps 3 and 4 sit inside the owner half');
  for (const owned of ['Force go-live…', 'Approve & go live →', 'Unlist…', 'Verify wiring', 'label="Stripe account key"', '<CopyLine text={webhookUrl} />']) {
    const at = client.indexOf(owned, client.indexOf('export function ScaLaunchClient'));
    assert.ok(at > ownerHalf && at < close, `${owned} must render inside the owner half`);
  }
  // Staff get one line for payments instead.
  assert.ok(client.includes("{!props.isOwner && ("));
  assert.ok(client.includes("<strong>Payments: {paymentsWired ? 'wired' : 'not wired'}</strong>"));
  // A demo-mode probe is never reported to staff as wired.
  assert.ok(client.includes("const paymentsWired = paymentsReady && row?.payment_verify_signal !== 'demo_mode';"));
});

test('Step 1 collapses to one column on a phone', () => {
  const client = read(CLIENT);
  assert.ok(client.includes('<div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 16, marginTop: 18 }}>'));
  assert.ok(!client.includes("gridTemplateColumns: '2fr 1fr 1fr 1fr'"), 'the restaurant rows collapse on a phone');
  assert.ok(!client.includes("gridTemplateColumns: '1fr 1fr'"), 'no fixed two-column grid in the launcher');
});
