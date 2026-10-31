'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { canLinkReport, relatedReportReason, type IssueReport, type WorkIssueLink } from '@/lib/work-issues';
import { linkWorkReports, separateWorkReports } from '../issue-actions';

export function LinkedWorkReports({ current, reports, links, available }: {
  current: IssueReport; reports: IssueReport[]; links: WorkIssueLink[]; available: boolean;
}) {
  const ask = useConfirm();
  const refresh = useSoftRefresh();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useUnsavedWorkGuard(pending || selected.length > 0);
  const issueId = links.find(l => l.report_id === current.id)?.issue_id ?? current.id;
  const members = links.filter(l => l.issue_id === issueId).map(l => l.report_id);
  const candidates = reports.filter(r => r.id !== current.id && canLinkReport(r) && (r.status === 'done') === (current.status === 'done') && !links.some(l => l.report_id === r.id));
  const suggestions = candidates.filter(r => relatedReportReason(current, r));
  const shown = showAll ? candidates : suggestions;
  async function save(separate: boolean) {
    if (pending) return;
    const picked = [...selected];
    const confirmed = await ask.ask({
      title: separate ? 'Separate these reports?' : 'Link reports as one issue?',
      body: separate ? 'Each report will appear separately again. Completion status and original notes stay as they are.'
        : `You are confirming that these ${picked.length + Math.max(members.length, 1)} reports describe the same repair. Completing or reopening any linked report will update the others. Original reports, notes, and receipts stay intact.`,
      confirmLabel: separate ? 'Separate reports' : 'Link reports',
    });
    if (!confirmed) return;
    setPending(true); setError(null);
    try {
      const result = separate ? await separateWorkReports({ issueId, reportIds: members }) : await linkWorkReports({ primaryId: issueId, reportIds: picked });
      if (!result.ok) { setError(result.error); return; }
      setSelected([]); refresh();
    } catch { setError('Could not confirm the change. Your selection is kept. Refresh to check the saved links before retrying.'); }
    finally { setPending(false); }
  }
  if (!available) return <p role="status" style={{ fontSize: 13 }}>Related reports could not be checked. Refresh to try again.</p>;
  if (!canLinkReport(current) && members.length < 2) return null;
  return <section aria-label="Related reports" className="rt-linked-reports" style={{ borderTop: '1px solid var(--rule)', padding: '18px 0' }}>
    <h2 className="font-serif" style={{ fontSize: 22, margin: '0 0 10px' }}>{members.length > 1 ? `One issue · ${members.length} reports` : 'Related reports'}</h2>
    {members.length > 1 && <>
      <p style={{ fontSize: 14 }}>Completing or reopening this issue updates every linked report. Separate them first if they need different outcomes.</p>
      {reports.filter(r => members.includes(r.id)).map(r => <details key={r.id} style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
        <summary style={{ cursor: 'pointer', minHeight: 44 }}>{r.title} <span style={{ color: 'var(--ink-3)' }}>· {r.status.replace('_', ' ')}</span></summary>
        <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.description || 'No additional description.'}</p>
        <Link href={`/work/${r.id}`} style={{ fontSize: 14 }}>Original report, notes and photos →</Link>
      </details>)}
      <Button size="sm" onClick={() => save(true)} pending={pending}>Separate reports</Button>
    </>}
    {candidates.length > 0 && <details>
      <summary style={{ minHeight: 44, cursor: 'pointer', paddingTop: 10 }}>{suggestions.length ? `${suggestions.length} possible related ${suggestions.length === 1 ? 'report' : 'reports'}` : 'Link another report at this property'}</summary>
      <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Select only reports about the same repair. Suggestions need your confirmation.</p>
      {shown.map(r => <div key={r.id} style={{ borderTop: '1px solid var(--rule)', padding: '12px 0' }}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'start', minHeight: 44 }}>
          <input type="checkbox" checked={selected.includes(r.id)} disabled={pending || (!selected.includes(r.id) && selected.length >= 24)} onChange={e => setSelected(s => e.target.checked ? [...s, r.id] : s.filter(id => id !== r.id))} />
          <span>{r.title}<small style={{ display: 'block', marginTop: 4, color: 'var(--ink-3)', fontSize: 13 }}>{relatedReportReason(current, r) || 'Same property; check the original report.'}</small></span>
        </label>
        <details><summary style={{ cursor: 'pointer', minHeight: 36 }}>Read report</summary><p style={{ whiteSpace: 'pre-wrap' }}>{r.description || 'No additional description.'}</p><Link href={`/work/${r.id}`}>Original report →</Link></details>
      </div>)}
      {!showAll && candidates.length > suggestions.length && <Button size="sm" onClick={() => setShowAll(true)}>Show other reports at this property</Button>}
      <Button variant="primary" onClick={() => save(false)} pending={pending} disabled={!selected.length}>Link {selected.length || ''} selected reports</Button>
    </details>}
    {!candidates.length && members.length < 2 && <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>No other repair reports to link.</p>}
    {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 14 }}>{error}</p>}
  </section>;
}
