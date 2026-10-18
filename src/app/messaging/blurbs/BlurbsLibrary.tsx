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
 * the responder; drafts are review-only; retired ones are off, with a way
 * back. Grouped Fleet -> areas -> properties so the operator reads it the
 * way she thinks about it.
 *
 * 2026-10-17: a card reads as a saved reply, not a form. The title is text
 * with a pencil, the body is text with Edit; Save / Discard edits appear
 * only once something changed. Retire asks once and lands the reply on a
 * Retired tab with Restore. The concierge's list carries retired rows since
 * stay-concierge #91, so the tab survives a reload; a reply retired in this
 * session shows there at once, before the next list. Restore is unapprove,
 * which sets any row back to draft.
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

type Tab = 'review' | 'live' | 'retired';
const TAB_STATUS: Record<Tab, SavedBlurb['status']> = { review: 'draft', live: 'approved', retired: 'retired' };

/** The towns Helm serves (civic.ts); an area scope is `area:<town>`. Any
 *  area a saved reply already uses is offered too. */
const AREAS = ['gloucester', 'rockport', 'beverly'];

const CONFIRM_MS = 5000;

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

  // Replies retired in this session, shown on the Retired tab at once,
  // before the next list arrives (the list carries retired rows since
  // stay-concierge #91; a server row with the same id wins).
  const [retiredHere, setRetiredHere] = useState<SavedBlurb[]>([]);
  const rows = useMemo(() => {
    const fromServer = initial.filter((b) => b.status === 'draft' || b.status === 'approved' || b.status === 'retired');
    const ids = new Set(fromServer.map((b) => b.id));
    return [...fromServer, ...retiredHere.filter((r) => !ids.has(r.id))];
  }, [initial, retiredHere]);

  const drafts = rows.filter((b) => b.status === 'draft').length;
  const live = rows.filter((b) => b.status === 'approved').length;
  const retired = rows.filter((b) => b.status === 'retired').length;
  // Three tabs: the review pile (drafts), what is live, what was retired.
  // Default to review while anything is waiting; land on Live once done.
  const [tab, setTab] = useState<Tab>(drafts > 0 ? 'review' : 'live');
  const counts: Record<Tab, number> = { review: drafts, live, retired };

  const groups = useMemo(() => {
    const byScope = new Map<string, SavedBlurb[]>();
    for (const b of rows) {
      const list = byScope.get(b.scope) ?? [];
      list.push(b);
      byScope.set(b.scope, list);
    }
    return [...byScope.entries()].sort(
      (a, b) => scopeRank(a[0]) - scopeRank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [rows]);

  const areas = useMemo(() => {
    const seen = new Set(AREAS);
    for (const b of initial) if (b.scope.startsWith('area:')) seen.add(b.scope.slice(5));
    return [...seen];
  }, [initial]);

  const tabBtn = (id: Tab): React.CSSProperties => ({
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

  const status = TAB_STATUS[tab];

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
      <div style={{ display: 'flex', gap: 8, marginTop: 16, borderTop: '1px solid var(--rule)', paddingTop: 16 }} role="tablist">
        {(['review', 'live', 'retired'] as Tab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={tabBtn(id)}>
            {id === 'review' ? 'To review' : id === 'live' ? 'Live' : 'Retired'}
            {counts[id] > 0 ? ` (${counts[id]})` : ''}
          </button>
        ))}
      </div>
      <AddBlurbForm categories={categories} properties={properties} areas={areas} reportDraft={reportDraft} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 24 }}>
        {counts[tab] === 0 && (
          <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>
            {tab === 'review'
              ? 'Nothing left to review. Everything you approved is on the Live tab.'
              : tab === 'live'
                ? 'Nothing live yet. Approve replies on the To review tab to turn them on.'
                : 'Nothing retired. A retired reply lands here with Restore.'}
          </div>
        )}
        {groups.map(([scope, blurbs]) => (
          <div key={scope} hidden={!blurbs.some((b) => b.status === status)}>
            <div
              className="eyebrow"
              style={{ color: 'var(--tide-deep)', borderBottom: '1px solid var(--rule)', paddingBottom: 6, marginBottom: 12 }}
            >
              {scopeLabel(scope, properties)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {blurbs.map((b) => (
                <div key={b.id} hidden={b.status !== status}>
                  <BlurbCard
                    blurb={b}
                    reportDraft={reportDraft}
                    onRetired={(row) => setRetiredHere((prev) => [...prev.filter((r) => r.id !== row.id), { ...row, status: 'retired' }])}
                    onRestored={(id) => setRetiredHere((prev) => prev.filter((r) => r.id !== id))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BlurbCard({
  blurb,
  reportDraft,
  onRetired,
  onRestored,
}: {
  blurb: SavedBlurb;
  reportDraft: ReportDraft;
  onRetired: (row: SavedBlurb) => void;
  onRestored: (id: string) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(blurb.title);
  const [body, setBody] = useState(blurb.body);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
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
  // Retire asks once: the second tap within a few seconds does it.
  useEffect(() => {
    if (!confirmRetire) return;
    const t = setTimeout(() => setConfirmRetire(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmRetire]);
  const isLive = blurb.status === 'approved';
  const isRetired = blurb.status === 'retired';

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void, savedEdit = false) => {
    if (action.busy.current || (!savedEdit && dirty)) return;
    action.run(async () => {
      setNotice('');
      const res = await fn();
      if (!res.ok) { setError(res.error ?? 'Something went wrong.'); return; }
      if (savedEdit) { setSaved({ title, body }); setNotice('Saved.'); setEditingTitle(false); setEditingBody(false); }
      after?.();
      router.refresh();
    }, 'Could not confirm the change. Your edits are kept. Refresh to check the saved reply before trying again.');
  };

  const discard = () => {
    if (action.busy.current || !window.confirm('Discard these unsaved reply edits?')) return;
    setTitle(saved.title); setBody(saved.body); setError(null); setNotice('');
    setEditingTitle(false); setEditingBody(false);
  };

  const quiet: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--ink-3)',
    background: 'transparent',
    border: 0,
    padding: 0,
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 4,
  };

  return (
    <fieldset disabled={pending} style={{ minWidth: 0, margin: 0, border: '1px solid var(--rule)', padding: 14, background: 'var(--paper)', opacity: isRetired ? 0.75 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={chip(isLive ? 'var(--tide-deep)' : 'transparent', isLive ? 'var(--paper)' : isRetired ? 'var(--ink-4)' : 'var(--signal)')}>
          {isLive ? 'Live' : isRetired ? 'Retired' : 'Draft'}
        </span>
        <span style={{ ...chip('transparent', 'var(--tide-deep)'), border: '1px solid var(--tide-deep)' }}>
          {blurb.category.replace(/_/g, ' ')}
        </span>
        {editingTitle ? (
          <input
            value={title}
            autoFocus
            aria-label="Title"
            onChange={(e) => { setTitle(e.target.value); setNotice(''); }}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false); }}
            style={{ flex: 1, minWidth: 180, fontSize: 13, fontWeight: 600, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', padding: '4px 8px' }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 180, fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
            {title}
            {!isRetired && (
              <button type="button" onClick={() => setEditingTitle(true)} aria-label="Edit title" title="Edit title" style={{ ...quiet, textDecoration: 'none', fontSize: 12 }}>
                ✎
              </button>
            )}
          </span>
        )}
      </div>
      {editingBody ? (
        <textarea
          value={body}
          autoFocus
          aria-label="Reply"
          onChange={(e) => { setBody(e.target.value); setNotice(''); }}
          rows={Math.min(8, Math.max(3, Math.ceil(body.length / 90)))}
          style={{ width: '100%', marginTop: 10, fontSize: 13, lineHeight: 1.6, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--ink)', padding: 10, resize: 'vertical' }}
        />
      ) : (
        <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <p style={{ flex: 1, margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{body}</p>
          {!isRetired && (
            <button type="button" onClick={() => setEditingBody(true)} style={{ ...quiet, flexShrink: 0 }}>
              Edit
            </button>
          )}
        </div>
      )}
      {blurb.source_note && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          {blurb.source_note}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)' }}>{error}</div>
      )}
      {notice && !dirty && <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{notice}</p>}
      {dirty && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>Save or discard your edits before changing this reply&apos;s status.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {dirty && (
          <button
            disabled={pending}
            onClick={() => run(() => saveBlurbAction(blurb.id, { title, body }), undefined, true)}
            style={btn(true)}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
        {dirty && <button disabled={pending} style={btn()} onClick={discard}>Discard edits</button>}
        {isRetired ? (
          <button
            disabled={pending}
            title="Back to the To review tab as a draft. Approve it there to turn it on again."
            onClick={() => run(() => setBlurbStatusAction(blurb.id, 'unapprove'), () => onRestored(blurb.id))}
            style={btn(true)}
          >
            Restore
          </button>
        ) : (
          <>
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
              title="Stops the AI quoting it. It lands on the Retired tab, with Restore."
              onClick={() => (confirmRetire ? run(() => setBlurbStatusAction(blurb.id, 'retire'), () => onRetired(blurb)) : setConfirmRetire(true))}
              style={{
                ...btn(),
                border: `1px solid ${confirmRetire ? 'var(--signal)' : 'var(--rule)'}`,
                color: confirmRetire ? 'var(--paper)' : 'var(--ink-4)',
                background: confirmRetire ? 'var(--signal)' : 'transparent',
              }}
            >
              {confirmRetire ? 'Sure? Retire it' : 'Retire'}
            </button>
          </>
        )}
      </div>
    </fieldset>
  );
}

function AddBlurbForm({
  categories,
  properties,
  areas,
  reportDraft,
}: {
  categories: string[];
  properties: { id: string; name: string }[];
  areas: string[];
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
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={selectStyle} aria-label="Where it applies">
          <option value="fleet">Every property</option>
          <optgroup label="An area">
            {areas.map((town) => (
              <option key={town} value={`area:${town}`}>
                {scopeLabel(`area:${town}`, properties)}
              </option>
            ))}
          </optgroup>
          <optgroup label="One property">
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle} aria-label="Category">
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
