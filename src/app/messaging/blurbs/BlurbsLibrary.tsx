'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import type { SavedBlurb } from '@/lib/stay-concierge';
import { saveBlurbAction, setBlurbStatusAction, createBlurbAction } from './blurbs-actions';

/**
 * The saved-reply library. Approved blurbs are quoted to guests verbatim by
 * the responder; drafts are review-only. Grouped Fleet -> areas -> properties
 * so the operator reads it the way she thinks about it.
 */

type DraftState = { dirty: boolean; pending: boolean };
type ReportDraft = (id: string, state: DraftState | null) => void;

function useReportDraft(id: string, dirty: boolean, pending: boolean, report: ReportDraft) {
  useEffect(() => {
    report(id, { dirty, pending });
    return () => report(id, null);
  }, [id, dirty, pending, report]);
}

type Props = {
  initial: SavedBlurb[];
  categories: string[];
  properties: { id: string; name: string }[];
};

const chip = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  padding: '2px 8px',
  whiteSpace: 'nowrap',
  background: bg,
  color: fg,
});

const btn = (solid = false): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  padding: '6px 12px',
  cursor: 'pointer',
  border: '1px solid var(--ink)',
  background: solid ? 'var(--ink)' : 'transparent',
  color: solid ? 'var(--paper)' : 'var(--ink)',
});

function scopeLabel(scope: string, properties: { id: string; name: string }[]): string {
  if (scope === 'fleet') return 'Every property';
  if (scope.startsWith('area:')) {
    const town = scope.slice(5);
    return `${town.charAt(0).toUpperCase()}${town.slice(1)} area`;
  }
  const match = properties.find((p) => p.id === scope);
  return match ? match.name : scope.replace(/_/g, ' ');
}

function scopeRank(scope: string): number {
  if (scope === 'fleet') return 0;
  if (scope.startsWith('area:')) return 1;
  return 2;
}

export function BlurbsLibrary({ initial, categories, properties }: Props) {
  const [draftStates, setDraftStates] = useState<Record<string, DraftState>>({});
  const reportDraft = useCallback<ReportDraft>((id, state) => {
    setDraftStates((previous) => {
      const next = { ...previous };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }, []);
  useDraftNavigationGuard(Object.values(draftStates).some((s) => s.dirty), Object.values(draftStates).some((s) => s.pending));
  const drafts = initial.filter((b) => b.status === 'draft').length;
  const live = initial.filter((b) => b.status === 'approved').length;
  // Two tabs: the review pile (drafts) and what's live. Approving moves a
  // blurb across, so the To-review tab burns down as she works through it.
  // Default to review while anything is waiting; land on Live once done.
  const [tab, setTab] = useState<'review' | 'live'>(drafts > 0 ? 'review' : 'live');

  const groups = useMemo(() => {
    const byScope = new Map<string, SavedBlurb[]>();
    for (const b of initial) {
      if (b.status !== 'draft' && b.status !== 'approved') continue;
      const list = byScope.get(b.scope) ?? [];
      list.push(b);
      byScope.set(b.scope, list);
    }
    return [...byScope.entries()].sort(
      (a, b) => scopeRank(a[0]) - scopeRank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [initial]);

  const tabBtn = (id: 'review' | 'live', label: string): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: 10,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: 'pointer',
    border: `1px solid ${tab === id ? 'var(--ink)' : 'var(--rule)'}`,
    background: tab === id ? 'var(--ink)' : 'transparent',
    color: tab === id ? 'var(--paper)' : 'var(--ink-3)',
  });

  return (
    <Section
      title="Saved replies"
      eyebrow="Your words, sent verbatim when a guest's question matches"
      right={
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {drafts > 0 ? `${drafts} awaiting approval · ` : ''}
          {live} live
        </span>
      }
    >
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
        Drafts never reach a guest. Approve a blurb and it moves to the Live tab,
        where the AI quotes it near-verbatim in drafts for that scope; edit any
        time and the next draft uses the new text. Retire what no longer applies.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => setTab('review')} style={tabBtn('review', 'review')}>
          To review{drafts > 0 ? ` (${drafts})` : ''}
        </button>
        <button type="button" onClick={() => setTab('live')} style={tabBtn('live', 'live')}>
          Live{live > 0 ? ` (${live})` : ''}
        </button>
      </div>
      <AddBlurbForm categories={categories} properties={properties} reportDraft={reportDraft} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 24 }}>
        {(tab === 'review' ? drafts === 0 : live === 0) && (
          <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>
            {tab === 'review'
              ? 'Nothing left to review. Everything you approved is on the Live tab.'
              : 'Nothing live yet. Approve blurbs on the To review tab to turn them on.'}
          </div>
        )}
        {groups.map(([scope, blurbs]) => (
          <div key={scope} hidden={!blurbs.some((b) => b.status === (tab === 'review' ? 'draft' : 'approved'))}>
            <div
              className="eyebrow"
              style={{ color: 'var(--tide-deep)', borderBottom: '1px solid var(--rule)', paddingBottom: 6, marginBottom: 12 }}
            >
              {scopeLabel(scope, properties)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {blurbs.map((b) => (
                <div key={b.id} hidden={b.status !== (tab === 'review' ? 'draft' : 'approved')}><BlurbCard blurb={b} reportDraft={reportDraft} /></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BlurbCard({ blurb, reportDraft }: { blurb: SavedBlurb; reportDraft: ReportDraft }) {
  const router = useRouter();
  const [title, setTitle] = useState(blurb.title);
  const [body, setBody] = useState(blurb.body);
  const action = useRecoverableAction();
  const { error, setError, pending } = action;
  const [saved, setSaved] = useState({ title: blurb.title, body: blurb.body });
  const [notice, setNotice] = useState('');
  const dirty = title !== saved.title || body !== saved.body;
  useReportDraft(blurb.id, dirty, pending, reportDraft);
  // Adopt refreshed server text only if this card has no local work to protect.
  useEffect(() => {
    if (!action.busy.current && !dirty) {
      setTitle(blurb.title); setBody(blurb.body);
      setSaved({ title: blurb.title, body: blurb.body });
    }
    // Only new server text should trigger this, never a local save baseline change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurb.title, blurb.body]);
  const isLive = blurb.status === 'approved';

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, savedEdit = false) => {
    if (action.busy.current || (!savedEdit && dirty)) return;
    action.run(async () => {
      setNotice('');
      const res = await fn();
      if (!res.ok) { setError(res.error ?? 'Something went wrong.'); return; }
      if (savedEdit) { setSaved({ title, body }); setNotice('Saved.'); }
      router.refresh();
    }, 'Could not confirm the change. Your edits are kept. Refresh to check the saved reply before trying again.');
  };

  return (
    <fieldset disabled={pending} style={{ minWidth: 0, margin: 0, border: '1px solid var(--rule)', padding: 14, background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={chip(isLive ? 'var(--tide-deep)' : 'transparent', isLive ? 'var(--paper)' : 'var(--signal)')}>
          {isLive ? 'Live' : 'Draft'}
        </span>
        <span style={{ ...chip('transparent', 'var(--tide-deep)'), border: '1px solid var(--tide-deep)' }}>
          {blurb.category.replace(/_/g, ' ')}
        </span>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setNotice(''); }}
          style={{
            flex: 1,
            minWidth: 180,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            borderBottom: '1px dashed transparent',
          }}
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setNotice(''); }}
        rows={Math.min(8, Math.max(2, Math.ceil(body.length / 90)))}
        style={{
          width: '100%',
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--ink)',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: 10,
          resize: 'vertical',
        }}
      />
      {blurb.source_note && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          {blurb.source_note}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)' }}>{error}</div>
      )}
      {notice && !dirty && <p role="status">{notice}</p>}
      {dirty && <p style={{ fontSize: 12 }}>Save or discard edits before changing this reply&apos;s status.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {dirty && (
          <button
            disabled={pending}
            onClick={() => run(() => saveBlurbAction(blurb.id, { title, body }), true)}
            style={btn(true)}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
        {dirty && <button disabled={pending} style={btn()} onClick={() => {
          if (action.busy.current || !window.confirm('Discard these unsaved reply edits?')) return;
          setTitle(saved.title); setBody(saved.body); setError(null); setNotice('');
        }}>Discard edits</button>}
        {!isLive ? (
          <button
            disabled={pending || dirty}
            title={dirty ? 'Save your edits first' : undefined}
            onClick={() => run(() => setBlurbStatusAction(blurb.id, 'approve'))}
            style={{ ...btn(!dirty), opacity: dirty ? 0.5 : 1 }}
          >
            Approve
          </button>
        ) : (
          <button
            disabled={pending || dirty}
            onClick={() => run(() => setBlurbStatusAction(blurb.id, 'unapprove'))}
            style={btn()}
          >
            Back to draft
          </button>
        )}
        <button
          disabled={pending || dirty}
          onClick={() => run(() => setBlurbStatusAction(blurb.id, 'retire'))}
          style={{ ...btn(), border: '1px solid var(--rule)', color: 'var(--ink-4)' }}
        >
          Retire
        </button>
      </div>
    </fieldset>
  );
}

function AddBlurbForm({
  categories,
  properties,
  reportDraft,
}: {
  categories: string[];
  properties: { id: string; name: string }[];
  reportDraft: ReportDraft;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('fleet');
  const [category, setCategory] = useState('other');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const action = useRecoverableAction();
  const { pending, error, setError } = action;
  const dirty = !!(title || body || scope !== 'fleet' || category !== 'other');
  useReportDraft('new-reply', open && dirty, pending, reportDraft);

  if (!open) {
    return (
      <div style={{ marginTop: 14 }}>
        <button onClick={() => setOpen(true)} style={btn()}>
          + Add a saved reply
        </button>
      </div>
    );
  }

  const submit = () =>
    action.run(async () => {
      const res = await createBlurbAction({ scope, category, title, body });
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.');
        return;
      }
      setTitle('');
      setBody('');
      setScope('fleet');
      setCategory('other');
      setOpen(false);
      router.refresh();
    }, 'Could not confirm the new reply. Your draft is kept. Check the library before trying again.');

  const selectStyle: React.CSSProperties = {
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid var(--rule)',
    background: 'var(--paper)',
    color: 'var(--ink)',
  };

  return (
    <fieldset disabled={pending} style={{ minWidth: 0, margin: '14px 0 0', border: '1px solid var(--ink)', padding: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={selectStyle}>
          <option value="fleet">Every property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Parking and the second car)"
          style={{ ...selectStyle, flex: 1, minWidth: 200 }}
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="The reply, in your words. It will be sent to guests nearly verbatim once approved."
        rows={4}
        style={{
          width: '100%',
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.6,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          padding: 10,
          resize: 'vertical',
        }}
      />
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button disabled={pending || !title.trim() || !body.trim()} onClick={submit} style={btn(true)}>
          {pending ? 'Adding…' : 'Add as draft'}
        </button>
        <button disabled={pending} onClick={() => {
          if (action.busy.current || (dirty && !window.confirm('Discard this new saved reply?'))) return;
          setTitle(''); setBody(''); setScope('fleet'); setCategory('other'); setError(null); setOpen(false);
        }} style={btn()}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
