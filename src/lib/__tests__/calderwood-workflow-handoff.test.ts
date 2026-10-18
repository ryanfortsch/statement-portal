import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_WORKFLOW_TEMPLATES as templates, reviewCalderwoodWorkflowHandoff as review, type WorkflowHandoffInput, type ReviewedSource } from '../calderwood-rehearsal/workflow-handoff.ts';
function fixture(source: ReviewedSource = 'Website'): WorkflowHandoffInput {
  const direct = source !== 'other-verified';
  const applicable = templates.filter(t => t.scope === 'all' || (t.scope === 'website' ? source === 'Website' : t.scope === 'direct' ? direct : !direct));
  return { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1', source, status: 'confirmed', now: new Date('2027-01-01T15:00:00Z'), maxEvidenceAgeMs: 300000,
    obligations: Object.fromEntries(applicable.map(t => [t.key, { occurrence: 'event-a', bindingRevision: 'binding-a', recipients: ['fictional-recipient-a'], fireAt: '2027-01-15T20:00:00Z', expiresAt: '2027-01-16T20:00:00Z', held: 'clear' }])),
    evidence: { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1', source, observedAt: '2027-01-01T15:00:00Z', complete: true,
      rows: applicable.map(t => ({ template: t.key, occurrence: 'event-a', bindingRevision: 'binding-a', recipient: 'fictional-recipient-a', sent: false, queued: false, uncertain: false, senderStoppedAt: '2027-01-01T14:59:00Z' })) } };
}
const key = 'direct.key_code.sms';
const row = (input: WorkflowHandoffInput, template = key) => review(input).find(r => r.template.key === template)!;
const evidence = (input: WorkflowHandoffInput, template = key) => input.evidence!.rows.find(r => r.template === template)!;

test('inventory retains 20 distinct templates, separate SMS/email and both staff arrival notices', () => {
  assert.equal(templates.length, 20); assert.equal(new Set(templates.map(t => t.key)).size, 20);
  assert.equal(templates.filter(t => t.workflow === 'DIRECT BOOKING').length, 8);
  assert.ok(templates.some(t => t.key === 'staff.arrival_a')); assert.ok(templates.some(t => t.key === 'staff.arrival_b'));
});
test('verified source scopes keep Website agreement separate and do not infer API mappings', () => {
  for (const [source, expected] of [['Website',16], ['Manual',15], ['Direct - stay cape ann',15], ['other-verified',11]] as const) {
    const rows = review(fixture(source)); assert.equal(rows.filter(r => r.disposition === 'candidate').length, expected);
    assert.ok(rows.every(r => !r.canSend));
  }
  assert.ok(review(fixture('unknown')).every(r => r.disposition === 'review'));
});
test('missing, partial, mismatched, stale or future snapshot cannot create candidates', () => {
  for (const patch of [{ complete: false }, { propertyId: 'different' }, { reservationId: 'different' }, { revision: 'old' }, { source: 'Manual' },
    { observedAt: '2027-01-01T14:54:59Z' }, { observedAt: '2027-01-01T15:00:01Z' }, { observedAt: '2027-02-30T15:00:00Z' }, { observedAt: '2027-01-01T15:00:00' }]) {
    const input=fixture(); Object.assign(input.evidence!,patch); assert.equal(row(input).disposition,'review');
  }
  const input=fixture(); input.evidence=null; assert.equal(row(input).disposition,'review');
});
test('exact freshness boundary works; invalid time or freshness policy cannot approve', () => {
  const input=fixture(); input.evidence!.observedAt='2027-01-01T14:55:00Z'; input.evidence!.rows.forEach(r=>r.senderStoppedAt='2027-01-01T14:54:00Z');
  assert.equal(row(input).disposition,'candidate');
  for (const maxEvidenceAgeMs of [0,-1,NaN,Infinity]) assert.equal(row({...fixture(),maxEvidenceAgeMs}).disposition,'review');
  assert.equal(row({...fixture(),now:new Date(NaN)}).disposition,'review');
  assert.equal(row({...fixture(),propertyId:''}).disposition,'review');
});
test('sent SMS suppresses only that obligation, not the separate email', () => {
  const input=fixture(); evidence(input).sent=true;
  assert.equal(row(input).disposition,'suppress'); assert.equal(row(input,'direct.key_code.email').disposition,'candidate');
});
test('mixed recipient outcomes block whole-message replay while preserving each result', () => {
  const input=fixture(); input.obligations[key]!.recipients=['fictional-recipient-a','fictional-recipient-b'];
  input.evidence!.rows=[...input.evidence!.rows,{...evidence(input),recipient:'fictional-recipient-b'}]; evidence(input).sent=true;
  const result=row(input); assert.equal(result.disposition,'review'); assert.deepEqual(result.recipients.map(r=>r.disposition),['suppress','candidate']);
});
test('missing or duplicate recipients and changed occurrence/content bindings require review', () => {
  for (const patch of [{ recipient:'different' },{ occurrence:'event-b' },{ bindingRevision:'binding-b' }]) {
    const input=fixture(); Object.assign(evidence(input),patch); assert.equal(row(input).disposition,'review');
  }
  const input=fixture(); input.evidence!.rows=[...input.evidence!.rows,{...evidence(input)}]; assert.equal(row(input).disposition,'review');
  input.evidence!.rows=input.evidence!.rows.filter(r=>r.template!==key); assert.equal(row(input).disposition,'review');
  for (const recipients of [[],[''],['a','a']]) {
    const next=fixture(); next.obligations[key]!.recipients=recipients; assert.equal(row(next).disposition,'review');
  }
});
test('current snapshot preserves prior sent history after booking revision, stale snapshot cannot', () => {
  const input=fixture(); evidence(input).sent=true; input.revision='r2'; assert.equal(row(input).disposition,'review');
  input.evidence!.revision='r2'; assert.equal(row(input).disposition,'suppress');
});
test('queued copies stay with Guesty; sent, stopped, held or cancelled queue conflicts require review', () => {
  const input=fixture(); evidence(input).queued=true; evidence(input).senderStoppedAt=null;
  assert.equal(row(input).disposition,'retain-guesty');
  evidence(input).sent=true; assert.equal(row(input).disposition,'review'); evidence(input).sent=false;
  input.obligations[key]!.held='held'; assert.equal(row(input).disposition,'review'); input.obligations[key]!.held='clear';
  input.status='cancelled'; assert.equal(row(input).disposition,'review'); input.status='confirmed';
  evidence(input).senderStoppedAt='2027-01-01T14:59:00Z'; assert.equal(row(input).disposition,'review');
});
test('unsent holds survive moves; cancellations suppress and unknown stay/hold state blocks', () => {
  const input=fixture(); input.revision='r2'; input.evidence!.revision='r2'; input.obligations[key]!.fireAt='2027-01-16T19:00:00Z'; input.obligations[key]!.expiresAt='2027-01-17T20:00:00Z';
  input.obligations[key]!.held='held'; assert.equal(row(input).disposition,'hold');
  input.obligations[key]!.held='unknown'; assert.equal(row(input).disposition,'review');
  input.status='cancelled'; assert.equal(row(input).disposition,'suppress');
  input.status='unknown'; assert.equal(row(input).disposition,'review');
});
test('unknown outcomes and absent/invalid stop proof never create a candidate', () => {
  const input=fixture(); evidence(input).uncertain=true; assert.equal(row(input).disposition,'review'); evidence(input).uncertain=false;
  for (const senderStoppedAt of [null,'invalid','2027-02-30T10:00:00Z','2027-01-01T15:00:01Z','2027-01-01T14:59:00']) {
    evidence(input).senderStoppedAt=senderStoppedAt; assert.equal(row(input).disposition,'review');
  }
});
test('due, overdue and missing or invalid expiry never become catch-up candidates', () => {
  for (const fireAt of [null,'2027-01-01T15:00:00Z','2027-01-01T14:59:00Z','2027-01-15T20:00:00','2027-02-30T20:00:00Z']) {
    const input=fixture(); input.obligations[key]!.fireAt=fireAt; assert.equal(row(input).disposition,'review');
  }
  for (const expiresAt of [null,'2027-01-15T20:00:00Z','2027-01-15T19:00:00Z','invalid']) {
    const input=fixture(); input.obligations[key]!.expiresAt=expiresAt; assert.equal(row(input).disposition,'review');
  }
});
test('source changes cannot silently discard old-channel history or queue evidence', () => {
  const input=fixture(); input.source='Manual'; input.evidence!.source='Manual';
  assert.equal(row(input,'agreement.email').disposition,'review');
});
test('an unknown template invalidates claimed complete inventory coverage', () => {
  const input=fixture(); input.evidence!.rows=[...input.evidence!.rows,{...evidence(input),template:'unreviewed-workflow'}];
  assert.equal(row(input).disposition,'review');
});
