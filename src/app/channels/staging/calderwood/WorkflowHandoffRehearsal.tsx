'use client';
import { useState } from 'react';
import { reviewCalderwoodWorkflowHandoff, type ReviewedSource, type WorkflowHandoffInput, type WorkflowDisposition } from '@/lib/calderwood-rehearsal/workflow-handoff';
const situations = ['Missing evidence', 'Guesty queue active', 'Future unsent after verified drain', 'SMS already sent', 'One recipient already sent', 'Operator hold', 'Changed booking', 'Cancellation with queued code', 'Uncertain code outcome', 'Missing staff and cleaner bindings', 'Missing agreement approval'] as const;
type Situation = typeof situations[number];
const names: Record<WorkflowDisposition, string> = { review: 'Needs review', 'not-applicable': 'Outside source scope', suppress: 'Do not replay', 'retain-guesty': 'Keep with Guesty', hold: 'Keep held', candidate: 'Activation review only' };
function demo(source: ReviewedSource, situation: Situation): WorkflowHandoffInput {
  const input: WorkflowHandoffInput = { propertyId: 'fictional-home', reservationId: 'fictional-stay', revision: 'r1', source, status: 'confirmed',
    now: new Date('2027-01-01T15:00:00Z'), maxEvidenceAgeMs: 300000, obligations: {}, evidence: null };
  // This selects synthetic rows only. It does not map reservation API source values.
  const applicable = reviewCalderwoodWorkflowHandoff(input).filter(row => row.disposition !== 'not-applicable').map(row => row.template);
  input.obligations = Object.fromEntries(applicable.map(t => [t.key, { occurrence: 'fictional-event', bindingRevision: 'fictional-binding',
    recipients: ['fictional-recipient-a'], fireAt: '2027-01-15T20:00:00Z', expiresAt: '2027-01-16T20:00:00Z', held: 'clear' }]));
  if (situation === 'Missing evidence') return input;
  input.evidence = { propertyId: input.propertyId, reservationId: input.reservationId, revision: input.revision, source,
    observedAt: input.now.toISOString(), complete: true, rows: applicable.map(t => ({ template: t.key, occurrence: 'fictional-event', bindingRevision: 'fictional-binding',
      recipient: 'fictional-recipient-a', sent: false, queued: false, uncertain: false, senderStoppedAt: '2027-01-01T14:59:00Z' })) };
  const sms = input.evidence.rows.find(row => row.template === 'direct.key_code.sms');
  if (situation === 'Guesty queue active') input.evidence.rows.forEach(row => { row.queued = true; row.senderStoppedAt = null; });
  if (situation === 'SMS already sent' && sms) sms.sent = true;
  if (situation === 'One recipient already sent' && sms) {
    input.obligations[sms.template]!.recipients = ['fictional-recipient-a', 'fictional-recipient-b'];
    input.evidence.rows = [...input.evidence.rows, { ...sms, recipient: 'fictional-recipient-b' }]; sms.sent = true;
  }
  if (situation === 'Operator hold') Object.entries(input.obligations).filter(([key]) => key.includes('key_code')).forEach(([, value]) => { value!.held = 'held'; });
  if (situation === 'Changed booking') input.revision = 'r2';
  if (situation === 'Cancellation with queued code') {
    input.status = 'cancelled'; input.evidence.rows.filter(row => row.template.includes('key_code')).forEach(row => { row.queued = true; });
  }
  if (situation === 'Uncertain code outcome') input.evidence.rows.filter(row => row.template.includes('key_code')).forEach(row => { row.uncertain = true; });
  if (situation === 'Missing staff and cleaner bindings') {
    const guestKeys = new Set(applicable.filter(t => t.audience === 'guest').map(t => t.key));
    input.obligations = Object.fromEntries(Object.entries(input.obligations).filter(([key]) => guestKeys.has(key)));
  }
  if (situation === 'Missing agreement approval' && input.obligations['agreement.email']) input.obligations['agreement.email']!.bindingRevision = '';
  return input;
}
export default function WorkflowHandoffRehearsal() {
  const [source, setSource] = useState<ReviewedSource>('unknown');
  const [situation, setSituation] = useState<Situation>('Missing evidence');
  const rows = reviewCalderwoodWorkflowHandoff(demo(source, situation));
  const applicableCount = rows.filter(row => row.disposition !== 'not-applicable').length;
  return <details className="rounded-lg border p-4">
    <summary className="cursor-pointer text-sm font-medium">Full workflow handoff rehearsal</summary>
    <section aria-labelledby="workflow-handoff-rehearsal" className="mt-4 space-y-4 text-sm">
      <h3 id="workflow-handoff-rehearsal" className="font-semibold">Review every message before the switch</h3>
      <p>Fictional evidence across all twenty audited templates. SMS and email are separate obligations, as are the two staff arrival notices. This does not load live history, calculate or change Guesty times, or create messages.</p>
      <div className="flex flex-wrap gap-4">
        <label>Reviewed source <select className="ml-2 rounded border p-2" value={source} onChange={e => setSource(e.target.value as ReviewedSource)}>
          <option value="unknown">Source unverified</option><option value="Website">Website</option><option value="Manual">Manual</option>
          <option value="Direct - stay cape ann">Direct - stay cape ann</option><option value="other-verified">Other verified source</option>
        </select></label>
        <label>Evidence situation <select className="ml-2 rounded border p-2" value={situation} onChange={e => setSituation(e.target.value as Situation)}>
          {situations.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>
      <p role="status" className="rounded bg-slate-50 p-3">{rows.length} templates reviewed · {applicableCount} remain in scope or unresolved · {rows.filter(row => row.disposition === 'review').length} need review · {rows.filter(row => row.disposition === 'candidate').length} activation-review candidates · 0 authorized sends</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr className="border-b"><th className="p-2">Workflow / message</th><th className="p-2">Delivery</th><th className="p-2">Decision</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.template.key} className="border-b align-top">
          <td className="p-2"><span className="block text-slate-500">{row.template.workflow}</span><strong>{row.template.label}</strong></td>
          <td className="p-2">{row.template.audience} · {row.template.delivery}</td>
          <td className="p-2"><strong>{names[row.disposition]}</strong><p className="mt-1 text-slate-600">{row.reason}</p>
            {row.recipients.length > 1 && <ul className="mt-1">{row.recipients.map((recipient, index) => <li key={recipient.recipient}>Sample recipient {index + 1}: {names[recipient.disposition]}</li>)}</ul>}
          </td>
        </tr>)}</tbody>
      </table></div>
      <p className="rounded bg-amber-50 p-3 text-amber-950">Actual source mappings, recipient bindings, agreement approval, sender drain and per-stay history remain unverified. The demo uses a five-minute freshness limit for illustration. A review candidate cannot send; production also needs current authorization, atomic ownership, code/portal checks and confirmed delivery.</p>
    </section>
  </details>;
}
