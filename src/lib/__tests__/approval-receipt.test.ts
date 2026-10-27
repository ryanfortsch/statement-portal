import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, sentReceipt } from '../approval-receipt.ts';
import { ownerApprovalPlan, ownerStayLabel } from '../owner-approval-plan.ts';

test('send confirmation requires the service approved status', () => {
  assert.equal(sentReceipt({ status: 'pending' }), undefined);
  assert.equal(sentReceipt({ status: 'scheduled' }), undefined);
  assert.equal(sentReceipt({ status: 'failed', receipt: {items:[{key:'x',state:'confirmed',label:'Sent'}]} }), undefined);
  assert.equal(sentReceipt({ status: 'approved' })?.items[0].label, 'Reply sent');
});
test('a verified block, sent reply and queued work retain independent states', () => {
  const items = [{ key: 'block', state: 'confirmed', label: 'Guesty block verified' }, { key: 'reply', state: 'confirmed', label: 'SMS sent' }, { key: 'work', state: 'pending', label: 'Work pending' }];
  assert.deepEqual(sentReceipt({status:'approved',receipt:{items}})?.items.map(i=>i.state), ['confirmed','confirmed','pending']);
  assert.equal(sentReceipt({status:'approved',slip:{id:'slip-1'}})?.items[1].href, '/work/slip-1');
});
test('partial failures preserve the block evidence without claiming delivery', () => {
  const receipt = parseReceipt({items:[{key:'block',state:'confirmed',label:'Verified'},{key:'reply',state:'attention',label:'Delivery unconfirmed'}]});
  assert.deepEqual(receipt?.items.map(i=>i.state), ['confirmed','attention']);
});
test('receipt links stay local and malformed result entries are ignored', () => {
  for (const href of ['javascript:alert(1)','//example.com','/\\example.com','/x\ny']) {
    assert.equal(parseReceipt({items:[{key:'x',label:'View',state:'confirmed',href}]})?.items[0].href, undefined);
  }
  assert.equal(parseReceipt({items:[{key:'x',label:'View',state:'confirmed',href:'/work/slip-1'}]})?.items[0].href, '/work/slip-1');
  assert.equal(parseReceipt({items:[{key:'x',label:'Unknown',state:'maybe'}]}), undefined);
});
test('approval wording uses enabled dates and inclusive nights rather than draft claims', () => {
  const action={kind:'owner_stay',start:'2027-10-01',end:'2027-10-03'};
  assert.equal(ownerApprovalPlan([action],'SMS')?.label, 'Block 3 nights & send');
  assert.equal(ownerApprovalPlan([],'SMS'), undefined);
  assert.match(ownerStayLabel(action), /Oct 1, 2027 through Oct 3, 2027 · 3 nights/);
  assert.equal(ownerApprovalPlan([{...action,end:'2027-10-01'}],'email')?.label, 'Block 1 night & send');
  assert.equal(ownerApprovalPlan([{...action,start:'2027-02-30'}],'SMS')?.label, 'Review dates & send');
  assert.match(ownerStayLabel({...action,start:'2027-12-31',end:'2028-01-01'}), /2027 through Jan 1, 2028 · 2 nights/);
});
