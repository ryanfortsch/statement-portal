'use client';

import { useState } from 'react';
import type {
  OwnerRequestCandidate,
  OwnerRequestSelections,
  PropertyRequestCandidates,
} from '@/lib/email-templates';
import type { WorkSlipOwnerActionType } from '@/lib/work-types';
import { addOwnerRequestSlipAction } from '@/app/statements/actions';

/**
 * The curation panel inside the statement email preview.
 *
 * The owner-request section is a deliberate list, never an automatic one:
 * every line here is something the operator chose to put in front of an
 * owner, in words they can rewrite. Ticks and edits save immediately,
 * because /api/draft-email reads the STORED picks -- the browser never
 * hands it the list -- so an unsaved edit would silently not ship.
 *
 * "Add a request" files a real work slip rather than a statement-only note,
 * so the ask lands on the Work board and its answer is recorded in the same
 * place as every other owner action.
 */

const KIND_CHIP: Record<WorkSlipOwnerActionType, string> = {
  approve: 'Approval',
  purchase: 'Purchase',
  schedule: 'Scheduling',
  decide: 'Decision',
  reimburse: 'Reimbursement',
};

const TYPE_OPTIONS: { value: WorkSlipOwnerActionType; label: string }[] = [
  { value: 'approve', label: 'Approval' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'schedule', label: 'Scheduling' },
  { value: 'decide', label: 'Decision' },
  { value: 'reimburse', label: 'Reimbursement' },
];

type Props = {
  houses: { propertyId: string; name: string }[];
  candidates: Record<string, PropertyRequestCandidates | undefined>;
  selections: Record<string, OwnerRequestSelections | null | undefined>;
  includeHandled: Record<string, boolean>;
  /** The statement's Repairs & Maint. line per property, 0 when there is none. */
  maintenanceCharge: Record<string, number>;
  loading: boolean;
  onSelectionsChange: (propertyId: string, next: OwnerRequestSelections) => void;
  onToggleHandled: (propertyId: string, next: boolean) => void;
  /** Re-pull one house's candidates after a new slip is filed. */
  onReloadHouse: (propertyId: string) => void;
};

function chipFor(c: OwnerRequestCandidate): string {
  // A "repair:" id is a row off the statement's own Repairs & Maint. line,
  // not a work slip -- worth saying, because those are the ones that tie to
  // the dollar figure the owner is reading.
  if (c.slipId.startsWith('repair:')) return 'Charge line';
  if (c.kind === 'handled') return 'Done';
  if (c.kind === 'flag') return 'Flag';
  return c.actionType ? KIND_CHIP[c.actionType] : 'Needs an answer';
}

export function OwnerRequestsPanel({
  houses,
  candidates,
  selections,
  includeHandled,
  maintenanceCharge,
  loading,
  onSelectionsChange,
  onToggleHandled,
  onReloadHouse,
}: Props) {
  const multi = houses.length > 1;
  return (
    <div style={{ marginTop: 14, border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
      {houses.map((h, i) => (
        <HouseBlock
          key={h.propertyId}
          house={h}
          showHeader={multi}
          first={i === 0}
          loaded={candidates[h.propertyId]}
          selections={selections[h.propertyId] || {}}
          includeHandled={!!includeHandled[h.propertyId]}
          maintenanceCharge={maintenanceCharge[h.propertyId] || 0}
          loading={loading}
          onSelectionsChange={onSelectionsChange}
          onToggleHandled={onToggleHandled}
          onReloadHouse={onReloadHouse}
        />
      ))}
    </div>
  );
}

function HouseBlock({
  house, showHeader, first, loaded, selections, includeHandled, maintenanceCharge, loading,
  onSelectionsChange, onToggleHandled, onReloadHouse,
}: {
  house: { propertyId: string; name: string };
  showHeader: boolean;
  first: boolean;
  loaded: PropertyRequestCandidates | undefined;
  selections: OwnerRequestSelections;
  includeHandled: boolean;
  maintenanceCharge: number;
  loading: boolean;
  onSelectionsChange: (propertyId: string, next: OwnerRequestSelections) => void;
  onToggleHandled: (propertyId: string, next: boolean) => void;
  onReloadHouse: (propertyId: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  const all = loaded?.candidates ?? [];
  const list = all.filter(c => c.kind !== 'handled');
  const handled = all.filter(c => c.kind === 'handled');
  const isIn = (c: OwnerRequestCandidate) => {
    const s = selections[c.slipId];
    return s ? s.include : c.suggested;
  };
  const included = list.filter(isIn);
  const handledIn = handled.filter(isIn);
  const charge = maintenanceCharge > 0
    ? '$' + Math.round(maintenanceCharge).toLocaleString('en-US')
    : null;

  function setInclude(c: OwnerRequestCandidate, include: boolean) {
    const prev = selections[c.slipId];
    onSelectionsChange(house.propertyId, {
      ...selections,
      [c.slipId]: { include, text: prev?.text ?? null },
    });
  }

  function setText(c: OwnerRequestCandidate, text: string) {
    const prev = selections[c.slipId];
    const include = prev ? prev.include : c.suggested;
    const trimmed = text.trim();
    onSelectionsChange(house.propertyId, {
      ...selections,
      [c.slipId]: { include, text: trimmed && trimmed !== c.defaultText ? trimmed : null },
    });
  }

  return (
    <div style={{ padding: '12px 14px', borderTop: first ? 'none' : '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="eyebrow">
          {showHeader ? house.name : 'Owner requests'}
          {loaded && (
            <span style={{ color: 'var(--ink-4)', marginLeft: 8 }}>
              {included.length} of {list.length} included
            </span>
          )}
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          style={{
            background: 'transparent', border: '1px solid var(--rule)', cursor: 'pointer',
            fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
            color: 'var(--ink-3)', padding: '4px 10px',
          }}
        >
          {adding ? 'Cancel' : '+ Add request'}
        </button>
      </div>

      {adding && (
        <AddRequestForm
          propertyId={house.propertyId}
          onDone={() => { setAdding(false); onReloadHouse(house.propertyId); }}
        />
      )}

      {!loaded && loading && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10 }}>Loading work slips&hellip;</div>
      )}

      {loaded && list.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.5 }}>
          Nothing open at {house.name} to ask about. Add a request above, or leave the section off and
          the email reads exactly as it always has.
        </div>
      )}

      {list.map(c => (
        <CandidateRow
          key={c.slipId}
          candidate={c}
          include={selections[c.slipId] ? selections[c.slipId]!.include : c.suggested}
          override={selections[c.slipId]?.text ?? null}
          onToggle={next => setInclude(c, next)}
          onText={text => setText(c, text)}
        />
      ))}

      {/* Finished work: a separate conversation from the asks. With a
          Repairs & Maint. charge on the statement, this list is what that
          charge bought and the owner needs it itemized; without one it is a
          courtesy recap that often stays off. */}
      {loaded && handled.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dotted var(--rule)' }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
            fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase',
            color: includeHandled ? 'var(--ink-2)' : 'var(--ink-4)',
          }}>
            <input
              type="checkbox"
              checked={includeHandled}
              onChange={e => onToggleHandled(house.propertyId, e.target.checked)}
              style={{ accentColor: 'var(--tide)' }}
            />
            {charge
              ? `Itemize the ${charge} maintenance charge`
              : `Also recap the ${handled.length} item${handled.length === 1 ? '' : 's'} we handled`}
            {includeHandled && (
              <span style={{ color: 'var(--ink-4)' }}>
                &nbsp;&middot; {handledIn.length} of {handled.length}
              </span>
            )}
          </label>

          {charge && !includeHandled && (
            <div style={{
              marginTop: 8, padding: '7px 9px', background: 'var(--paper)',
              borderLeft: '2px solid var(--signal)', fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>
              The statement bills {charge} under Repairs &amp; Maint. with no itemization behind it.
              Tick the box and the email says what it covers.
            </div>
          )}

          {includeHandled && handled.map(c => (
            <CandidateRow
              key={c.slipId}
              candidate={c}
              include={isIn(c)}
              override={selections[c.slipId]?.text ?? null}
              onToggle={next => setInclude(c, next)}
              onText={text => setText(c, text)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  candidate, include, override, onToggle, onText,
}: {
  candidate: OwnerRequestCandidate;
  include: boolean;
  override: string | null;
  onToggle: (next: boolean) => void;
  onText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(override ?? candidate.defaultText);
  const text = override ?? candidate.defaultText;

  return (
    <div style={{
      display: 'flex', gap: 9, marginTop: 10, paddingTop: 10,
      borderTop: '1px solid var(--rule)',
      opacity: include ? 1 : 0.45,
    }}>
      <input
        type="checkbox"
        checked={include}
        onChange={e => onToggle(e.target.checked)}
        style={{ marginTop: 3, accentColor: 'var(--tide)', flexShrink: 0 }}
        aria-label={`Include ${candidate.title}`}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{candidate.title}</span>
          <span style={{
            fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase',
            color: candidate.kind === 'ask' ? 'var(--signal)' : 'var(--ink-4)',
            border: `1px solid ${candidate.kind === 'ask' ? 'var(--signal)' : 'var(--rule)'}`,
            padding: '1px 5px',
          }}>{chipFor(candidate)}</span>
          {candidate.raisedOn && (
            <span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              asked before
            </span>
          )}
        </div>

        {editing ? (
          <div style={{ marginTop: 6 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={4}
              autoFocus
              style={{
                width: '100%', fontSize: 12, lineHeight: 1.5,
                fontFamily: 'inherit', color: 'var(--ink)',
                background: 'var(--paper)', border: '1px solid var(--ink-4)',
                padding: '8px 10px', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button
                onClick={() => { onText(draft); setEditing(false); }}
                style={{
                  background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer',
                  fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 12px',
                }}
              >Save wording</button>
              <button
                onClick={() => { setDraft(candidate.defaultText); onText(candidate.defaultText); setEditing(false); }}
                style={{
                  background: 'transparent', color: 'var(--ink-4)', border: 'none', cursor: 'pointer',
                  fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 0',
                }}
              >Reset to suggested</button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => { setDraft(text); setEditing(true); }}
            title="Click to edit the wording the owner reads"
            style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 4, cursor: 'text' }}
          >
            {text}
            {override && (
              <span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginLeft: 6 }}>
                edited
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AddRequestForm({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<WorkSlipOwnerActionType>('approve');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const field: React.CSSProperties = {
    width: '100%', fontSize: 12, fontFamily: 'inherit', color: 'var(--ink)',
    background: 'var(--paper)', border: '1px solid var(--rule)', padding: '7px 9px',
  };

  async function submit() {
    setErr(null);
    setSaving(true);
    const res = await addOwnerRequestSlipAction({ propertyId, title, notes, actionType: type });
    setSaving(false);
    if (!res.ok) { setErr(res.error); return; }
    onDone();
  }

  return (
    <div style={{ marginTop: 10, padding: 10, background: 'var(--paper)', border: '1px solid var(--rule)' }}>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What it is, e.g. Replace the dishwasher"
        style={field}
      />
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="What the owner needs to know: what is going on, what it costs, why now."
        style={{ ...field, marginTop: 7, resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          value={type}
          onChange={e => setType(e.target.value as WorkSlipOwnerActionType)}
          style={{ ...field, width: 'auto', cursor: 'pointer' }}
        >
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          onClick={submit}
          disabled={saving || !title.trim()}
          style={{
            background: 'var(--ink)', color: 'var(--paper)', border: 'none',
            cursor: saving || !title.trim() ? 'default' : 'pointer', opacity: saving || !title.trim() ? 0.4 : 1,
            fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', padding: '7px 14px',
          }}
        >{saving ? 'Filing…' : 'File request'}</button>
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>Also opens a work slip on the board</span>
      </div>
      {err && <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}
