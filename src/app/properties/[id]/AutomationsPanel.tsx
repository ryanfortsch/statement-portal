'use client';

import { useState, useTransition } from 'react';
import {
  approveSendAction,
  deleteRuleOverrideAction,
  saveRuleOverrideAction,
  sendTestAction,
  setAutomationsEnabledAction,
  setRuleConfiguredInOtaAction,
  setRuleEnabledAction,
  setRuleSendModeAction,
  skipSendAction,
  type AutomationActionResult,
  type RuleFormInput,
} from './automations-actions';
import type { AutomationsPanelView, PanelRule, PanelSend } from '@/lib/automations';
import {
  AUTOMATION_DELIVERIES,
  AUTOMATION_TRIGGERS,
  DELIVERY_LABELS,
  MERGE_FIELDS,
  MERGE_FIELD_HELP,
  SEND_STATUS_LABELS,
  TRIGGER_LABELS,
  type AutomationRule,
} from '@/lib/automations-core';

/**
 * The property Automations tab: Guesty Message Automation, Helm-native.
 *
 * The switch (automations_enabled, which only takes when Helm runs this
 * home's calendar), the effective rule list (fleet defaults with this home's
 * overrides) previewed against the next stay with secrets masked, add / edit
 * an override, approve-or-auto and "configured in Airbnb" per rule, the send
 * ledger with Approve / Skip, and a masked test text to the operator.
 *
 * Everything renders from the server-built view; each action revalidates
 * the page so the next render carries the new state.
 */
export function AutomationsPanel({ propertyId, view }: { propertyId: string; view: AutomationsPanelView | null }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<RuleFormInput | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [openSend, setOpenSend] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);

  const run = (id: string, fn: () => Promise<AutomationActionResult>) => {
    setBusy(id);
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      setBusy(null);
    });
  };

  if (!view) {
    return (
      <div style={noteStyle}>
        The automations tables are not reachable from this environment (service role unset, or the migration has not run here).
      </div>
    );
  }

  const { property, helmRun, lockMapped, hasRatePlan, recipients, nextStay, rules, sends, counts } = view;
  const on = property.automations_enabled;
  const awaiting = sends.filter((s) => s.status === 'awaiting_approval');
  const scheduled = sends.filter((s) => s.status === 'scheduled' || s.status === 'sending');
  const history = sends.filter((s) => s.status !== 'awaiting_approval' && s.status !== 'scheduled' && s.status !== 'sending');

  return (
    <div style={{ paddingBottom: 6 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
        Scheduled guest and cleaner messages for this home, sent by Helm: texts from the GUESTS line, email through Resend, cleaner
        notices on the 24/7 line. Fleet defaults apply unless this home overrides them. Door codes and wifi passwords stay masked
        everywhere but on the wire.
      </p>

      {msg && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderLeft: `3px solid ${msg.ok ? 'var(--positive)' : 'var(--negative)'}`,
            background: 'var(--paper-2)',
            fontSize: 13,
            color: msg.ok ? 'var(--ink)' : 'var(--negative)',
            lineHeight: 1.5,
          }}
        >
          {msg.text}
        </div>
      )}

      {/* The switch */}
      <div style={{ ...rowStyle, justifyContent: 'space-between', borderTop: '1px solid var(--rule)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            Automations {on ? 'on' : 'off'} for {property.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
            {helmRun ? (
              <>Helm runs this calendar, so Helm may message its guests. Turning this off cancels anything still scheduled.</>
            ) : (
              <>
                Requires Helm as the calendar authority. This home is still <span className="font-mono">{property.calendar_authority}</span>-run,
                so Guesty&apos;s own automations stay in charge and this switch is locked to avoid duplicates. Cut the home over on its
                Channels page first.
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={pending || (!on && !helmRun)}
          onClick={() => run('switch', () => setAutomationsEnabledAction(propertyId, !on))}
          style={on ? solidBtn(pending && busy === 'switch') : ghostBtn(pending && busy === 'switch', !helmRun)}
        >
          {pending && busy === 'switch' ? 'Saving' : on ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {/* Readiness */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '12px 0', borderBottom: '1px solid var(--rule)', fontSize: 12 }}>
        <Ready ok={hasRatePlan} label={hasRatePlan ? 'Rate plan sets check-in / checkout times' : 'No rate plan: check-in and checkout times will be missing'} />
        <Ready ok={lockMapped} label={lockMapped ? 'Lock mapped: door codes may auto-send' : 'No lock mapped: any door-code template is forced to approve'} />
        <Ready ok={recipients.length > 0} label={recipients.length > 0 ? `Cleaner notices reach ${recipients.join(', ')}` : 'No cleaner recipient covers this home (Turnovers, Schedule)'} />
        {nextStay ? (
          <Ready
            ok={nextStay.hasPhone || nextStay.hasEmail}
            label={`Next stay ${nextStay.guest_name}, ${fmtDate(nextStay.check_in)} to ${fmtDate(nextStay.check_out)} (${nextStay.channel})${
              nextStay.hasPhone ? ', phone on file' : nextStay.hasEmail ? ', email on file' : ', no contact on file'
            }`}
          />
        ) : (
          <Ready ok={false} label="No upcoming stay to preview against" />
        )}
      </div>

      {/* Test phone */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '14px 0 6px' }}>
        <label style={labelStyle}>Send a test to</label>
        <input
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          placeholder="your phone"
          inputMode="tel"
          style={{ ...inputStyle, width: 170 }}
        />
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Each rule below has a Test button. Tests go out from the GUESTS line with secrets masked.</span>
      </div>

      {/* Rules */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span className="eyebrow">Rules for this home</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(editing ? null : blankForm())}
            style={ghostBtn(false)}
          >
            {editing ? 'Close' : 'Add a rule for this home'}
          </button>
        </div>

        {editing && (
          <RuleForm
            form={editing}
            onChange={setEditing}
            pending={pending && busy === 'save'}
            onCancel={() => setEditing(null)}
            onSave={() =>
              run('save', async () => {
                const r = await saveRuleOverrideAction(propertyId, editing);
                if (r.ok) setEditing(null);
                return r;
              })
            }
          />
        )}

        {rules.length === 0 && <div style={noteStyle}>No rules exist yet. The fleet defaults ship with the migration; add one above if they are missing.</div>}

        {rules.map((pr) => (
          <RuleCard
            key={pr.rule.id}
            pr={pr}
            pending={pending}
            busy={busy}
            canTest={testPhone.trim().length >= 10}
            onToggle={() => run(`en:${pr.rule.key}`, () => setRuleEnabledAction(propertyId, pr.rule.key, !pr.active))}
            onMode={() => run(`mode:${pr.rule.key}`, () => setRuleSendModeAction(propertyId, pr.rule.key, pr.rule.send_mode === 'auto' ? 'approve' : 'auto'))}
            onOta={() => run(`ota:${pr.rule.key}`, () => setRuleConfiguredInOtaAction(propertyId, pr.rule.key, !pr.rule.configured_in_ota))}
            onEdit={() => setEditing(formFromRule(pr.rule))}
            onRemove={() => run(`rm:${pr.rule.key}`, () => deleteRuleOverrideAction(propertyId, pr.rule.key))}
            onTest={() => run(`test:${pr.rule.id}`, () => sendTestAction(propertyId, pr.rule.id, testPhone))}
          />
        ))}
      </div>

      {/* Ledger */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap' }}>
          <span className="eyebrow">Send log</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {counts.awaiting} awaiting approval, {counts.scheduled} scheduled, {counts.sent} sent
            {counts.noContact > 0 && (
              <>
                , <span style={{ color: 'var(--negative)' }}>{counts.noContact} with no contact on file</span>
              </>
            )}
          </span>
        </div>

        {awaiting.length === 0 && scheduled.length === 0 && history.length === 0 && (
          <div style={noteStyle}>Nothing planned yet. {on ? 'The planner runs every 15 minutes over the next 30 days of stays.' : 'Turn automations on to plan the next 30 days.'}</div>
        )}

        {awaiting.map((s) => (
          <SendRow
            key={s.id}
            s={s}
            open={openSend === s.id}
            onOpen={() => setOpenSend(openSend === s.id ? null : s.id)}
            draft={draft[s.id]}
            onDraft={(v) => setDraft({ ...draft, [s.id]: v })}
            pending={pending}
            busy={busy}
            onApprove={() =>
              run(`ap:${s.id}`, () => approveSendAction(propertyId, s.id, draft[s.id] && draft[s.id] !== s.body_rendered ? draft[s.id] : null))
            }
            onSkip={() => run(`sk:${s.id}`, () => skipSendAction(propertyId, s.id))}
          />
        ))}
        {scheduled.map((s) => (
          <SendRow
            key={s.id}
            s={s}
            open={openSend === s.id}
            onOpen={() => setOpenSend(openSend === s.id ? null : s.id)}
            pending={pending}
            busy={busy}
            onSkip={() => run(`sk:${s.id}`, () => skipSendAction(propertyId, s.id))}
          />
        ))}

        {history.length > 0 && (
          <button type="button" onClick={() => setShowHistory(!showHistory)} style={{ ...linkBtn, marginTop: 10 }}>
            {showHistory ? 'Hide' : 'Show'} {history.length} past row{history.length === 1 ? '' : 's'}
          </button>
        )}
        {showHistory &&
          history.map((s) => (
            <SendRow key={s.id} s={s} open={openSend === s.id} onOpen={() => setOpenSend(openSend === s.id ? null : s.id)} pending={pending} busy={busy} />
          ))}
      </div>

      <details style={{ marginTop: 24 }}>
        <summary style={{ fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>Merge fields</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px 18px', marginTop: 10 }}>
          {MERGE_FIELDS.map((f) => (
            <div key={f} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              <span className="font-mono" style={{ color: 'var(--ink)' }}>{`{{${f}}}`}</span> {MERGE_FIELD_HELP[f]}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Ready({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: ok ? 'var(--ink-2)' : 'var(--negative)' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--positive)' : 'var(--negative)', flex: 'none' }} />
      {label}
    </span>
  );
}

function RuleCard({
  pr,
  pending,
  busy,
  canTest,
  onToggle,
  onMode,
  onOta,
  onEdit,
  onRemove,
  onTest,
}: {
  pr: PanelRule;
  pending: boolean;
  busy: string | null;
  canTest: boolean;
  onToggle: () => void;
  onMode: () => void;
  onOta: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const r = pr.rule;
  const is = (id: string) => pending && busy === id;
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--rule)', opacity: pr.active ? 1 : 0.72 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="font-mono" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
          {r.key}
        </span>
        <Badge tone={pr.source === 'property' ? 'signal' : 'muted'}>{pr.source === 'property' ? 'This home' : 'Fleet default'}</Badge>
        {pr.silenced && <Badge tone="neg">Silenced here</Badge>}
        {!pr.active && !pr.silenced && <Badge tone="muted">Off</Badge>}
        <Badge tone="muted">{r.audience === 'cleaner' ? 'Cleaner' : 'Guest'}</Badge>
        <Badge tone={r.send_mode === 'auto' ? 'pos' : 'muted'}>{r.send_mode === 'auto' ? 'Auto' : 'Approve first'}</Badge>
        {pr.forcedApprove && <Badge tone="neg">Door code, no lock: approve forced</Badge>}
        {r.configured_in_ota && <Badge tone="muted">Configured in Airbnb / VRBO</Badge>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
        {describeTiming(r)}. {DELIVERY_LABELS[r.delivery]}.
        {r.channel_exclusions.length > 0 && <> Not for {r.channel_exclusions.join(', ')}.</>}
        {r.min_nights ? <> Stays of {r.min_nights}+ nights.</> : null}
      </div>
      <div className="font-serif" style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 8, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {r.body}
      </div>

      {pr.preview && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--paper-2)', borderLeft: '3px solid var(--rule)', fontSize: 12, lineHeight: 1.55 }}>
          <div style={{ color: 'var(--ink-4)', marginBottom: 4 }}>
            Preview for the next stay: {pr.preview.fireAt ? `fires ${fmtWhen(pr.preview.fireAt)}` : 'its moment has passed'}
            {pr.preview.rail ? `, by ${railLabel(pr.preview.rail)}` : ', no rail: guest has no contact on file'}
            {pr.preview.missing.length > 0 && (
              <span style={{ color: 'var(--negative)' }}> Missing {pr.preview.missing.join(', ')}.</span>
            )}
          </div>
          {pr.preview.subject && <div style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{pr.preview.subject}</div>}
          <div style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{pr.preview.masked}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" disabled={pending} onClick={onToggle} style={ghostBtn(is(`en:${r.key}`))}>
          {is(`en:${r.key}`) ? 'Saving' : pr.active ? 'Silence here' : 'Turn on here'}
        </button>
        <button type="button" disabled={pending} onClick={onMode} style={ghostBtn(is(`mode:${r.key}`))}>
          {is(`mode:${r.key}`) ? 'Saving' : r.send_mode === 'auto' ? 'Require approval' : 'Send automatically'}
        </button>
        {r.audience === 'guest' && (
          <button type="button" disabled={pending} onClick={onOta} style={ghostBtn(is(`ota:${r.key}`))}>
            {is(`ota:${r.key}`) ? 'Saving' : r.configured_in_ota ? 'Not configured in Airbnb' : 'Mark configured in Airbnb'}
          </button>
        )}
        <button type="button" disabled={pending} onClick={onEdit} style={ghostBtn(false)}>
          {pr.source === 'property' ? 'Edit' : 'Override for this home'}
        </button>
        <button type="button" disabled={pending || !canTest} onClick={onTest} style={ghostBtn(is(`test:${r.id}`))} title={canTest ? '' : 'Enter your phone above first'}>
          {is(`test:${r.id}`) ? 'Sending' : 'Test'}
        </button>
        {pr.source === 'property' && (
          <button type="button" disabled={pending} onClick={onRemove} style={quietBtn(is(`rm:${r.key}`))} title="Removes this home's version and its send history; the fleet default applies again">
            {is(`rm:${r.key}`) ? 'Removing' : 'Remove override'}
          </button>
        )}
      </div>
    </div>
  );
}

function SendRow({
  s,
  open,
  onOpen,
  draft,
  onDraft,
  pending,
  busy,
  onApprove,
  onSkip,
}: {
  s: PanelSend;
  open: boolean;
  onOpen: () => void;
  draft?: string;
  onDraft?: (v: string) => void;
  pending: boolean;
  busy: string | null;
  onApprove?: () => void;
  onSkip?: () => void;
}) {
  const tone = s.status === 'awaiting_approval' ? 'signal' : s.status === 'sent' ? 'pos' : s.status === 'scheduled' || s.status === 'sending' ? 'muted' : s.status === 'failed' || s.status === 'skipped_no_contact' ? 'neg' : 'muted';
  const isOta = s.delivery_used === 'ota_manual';
  const canEdit = s.status === 'awaiting_approval' && !isOta && !!onDraft;
  const body = draft ?? s.body_rendered ?? '';
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }} onClick={onOpen}>
        <Badge tone={tone}>{SEND_STATUS_LABELS[s.status] ?? s.status}</Badge>
        <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink)' }}>{s.key}</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>{s.guest_name}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {fmtDate(s.check_in)} to {fmtDate(s.check_out)}
          {s.channel ? `, ${s.channel}` : ''}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 'auto' }}>
          {s.status === 'sent' && s.sent_at ? `sent ${fmtWhen(s.sent_at)}` : `fires ${fmtWhen(s.fire_at)}`}
          {s.delivery_used ? ` by ${railLabel(s.delivery_used)}` : ''}
        </span>
      </div>
      {(open || s.status === 'awaiting_approval') && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55 }}>
          {s.error && <div style={{ color: s.status === 'sent' ? 'var(--ink-3)' : 'var(--negative)', marginBottom: 6 }}>{s.error}</div>}
          {s.missing_fields.length > 0 && <div style={{ color: 'var(--negative)', marginBottom: 6 }}>Missing: {s.missing_fields.join(', ')}. Fill the property record or edit the text.</div>}
          {s.to_address && !isOta && <div style={{ color: 'var(--ink-4)', marginBottom: 6 }}>To {s.to_address}</div>}
          {s.subject_rendered && (s.delivery_used === 'email') && <div style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{s.subject_rendered}</div>}
          {canEdit ? (
            <textarea value={body} onChange={(e) => onDraft?.(e.target.value)} rows={4} style={{ ...inputStyle, width: '100%', fontFamily: 'inherit', lineHeight: 1.5 }} />
          ) : (
            <div style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap', background: 'var(--paper-2)', padding: '8px 12px', borderLeft: '3px solid var(--rule)' }}>{s.body_rendered}</div>
          )}
          {s.status === 'awaiting_approval' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              {isOta ? (
                <>
                  {s.ota_url && (
                    <a href={s.ota_url} target="_blank" rel="noreferrer" style={{ ...ghostBtn(false), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                      Open in {s.channel === 'airbnb' ? 'Airbnb' : s.channel === 'vrbo' ? 'VRBO' : 'Booking.com'}
                    </a>
                  )}
                  <button type="button" disabled={pending} onClick={() => copy(s.body_rendered ?? '')} style={ghostBtn(false)}>
                    Copy text
                  </button>
                  <button type="button" disabled={pending} onClick={onApprove} style={solidBtn(pending && busy === `ap:${s.id}`)}>
                    {pending && busy === `ap:${s.id}` ? 'Saving' : 'Mark pasted'}
                  </button>
                </>
              ) : (
                <button type="button" disabled={pending} onClick={onApprove} style={solidBtn(pending && busy === `ap:${s.id}`)}>
                  {pending && busy === `ap:${s.id}` ? 'Sending' : 'Approve and send'}
                </button>
              )}
              <button type="button" disabled={pending} onClick={onSkip} style={quietBtn(pending && busy === `sk:${s.id}`)}>
                {pending && busy === `sk:${s.id}` ? 'Skipping' : 'Skip'}
              </button>
            </div>
          )}
          {s.status === 'scheduled' && onSkip && (
            <div style={{ marginTop: 8 }}>
              <button type="button" disabled={pending} onClick={onSkip} style={quietBtn(pending && busy === `sk:${s.id}`)}>
                {pending && busy === `sk:${s.id}` ? 'Skipping' : 'Skip this one'}
              </button>
            </div>
          )}
          {s.approved_by && <div style={{ color: 'var(--ink-4)', marginTop: 6 }}>Approved by {s.approved_by}</div>}
        </div>
      )}
    </div>
  );
}

const CHANNELS = ['airbnb', 'vrbo', 'booking_com', 'direct', 'manual'] as const;

function RuleForm({
  form,
  onChange,
  onSave,
  onCancel,
  pending,
}: {
  form: RuleFormInput;
  onChange: (f: RuleFormInput) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const set = <K extends keyof RuleFormInput>(k: K, v: RuleFormInput[K]) => onChange({ ...form, [k]: v });
  const isConfirm = form.trigger === 'booking_confirmed';
  return (
    <div style={{ padding: '16px 18px', background: 'var(--paper-2)', borderLeft: '3px solid var(--signal)', marginBottom: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Key">
          <input value={form.key} onChange={(e) => set('key', e.target.value)} placeholder="pre_arrival" style={inputStyle} className="font-mono" />
        </Field>
        <Field label="Audience">
          <select value={form.audience} onChange={(e) => set('audience', e.target.value as RuleFormInput['audience'])} style={selectStyle}>
            <option value="guest">Guest</option>
            <option value="cleaner">Cleaner</option>
          </select>
        </Field>
        <Field label="Trigger">
          <select value={form.trigger} onChange={(e) => set('trigger', e.target.value as RuleFormInput['trigger'])} style={selectStyle}>
            {AUTOMATION_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Offset (days)">
          <input type="number" disabled={isConfirm} value={form.offset_days} onChange={(e) => set('offset_days', Number(e.target.value))} style={inputStyle} />
        </Field>
        <Field label="At (local time)">
          <input type="time" disabled={isConfirm} value={form.at_local} onChange={(e) => set('at_local', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Delivery">
          <select value={form.delivery} onChange={(e) => set('delivery', e.target.value as RuleFormInput['delivery'])} style={selectStyle}>
            {AUTOMATION_DELIVERIES.map((d) => (
              <option key={d} value={d}>
                {DELIVERY_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select value={form.send_mode} onChange={(e) => set('send_mode', e.target.value as RuleFormInput['send_mode'])} style={selectStyle}>
            <option value="approve">Approve first</option>
            <option value="auto">Send automatically</option>
          </select>
        </Field>
        <Field label="Minimum nights">
          <input value={form.min_nights} onChange={(e) => set('min_nights', e.target.value)} placeholder="any" inputMode="numeric" style={inputStyle} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Not for channels">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-2)' }}>
            {CHANNELS.map((c) => (
              <label key={c} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.channel_exclusions.includes(c)}
                  onChange={(e) =>
                    set('channel_exclusions', e.target.checked ? [...form.channel_exclusions, c] : form.channel_exclusions.filter((x) => x !== c))
                  }
                />
                {c}
              </label>
            ))}
          </div>
        </Field>
      </div>
      {(form.delivery === 'email' || form.delivery === 'sms_then_email') && (
        <div style={{ marginTop: 12 }}>
          <Field label="Email subject">
            <input value={form.subject} onChange={(e) => set('subject', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </Field>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Field label="Message">
          <textarea value={form.body} onChange={(e) => set('body', e.target.value)} rows={5} style={{ ...inputStyle, width: '100%', fontFamily: 'inherit', lineHeight: 1.5 }} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-2)' }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled for this home
        </label>
        {form.audience === 'guest' && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={form.configured_in_ota} onChange={(e) => set('configured_in_ota', e.target.checked)} /> Already configured in Airbnb / VRBO scheduled messages
          </label>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10 }}>
          <button type="button" onClick={onCancel} disabled={pending} style={quietBtn(false)}>
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={pending} style={solidBtn(pending)}>
            {pending ? 'Saving' : 'Save for this home'}
          </button>
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}

function Badge({ tone, children }: { tone: 'signal' | 'pos' | 'neg' | 'muted'; children: React.ReactNode }) {
  const color = tone === 'signal' ? 'var(--signal)' : tone === 'pos' ? 'var(--positive)' : tone === 'neg' ? 'var(--negative)' : 'var(--ink-4)';
  return (
    <span style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color, border: `1px solid ${color}`, padding: '2px 7px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function blankForm(): RuleFormInput {
  return {
    key: '',
    audience: 'guest',
    trigger: 'pre_arrival',
    offset_days: -1,
    at_local: '10:00',
    delivery: 'sms_then_email',
    send_mode: 'approve',
    min_nights: '',
    subject: '',
    body: '',
    enabled: true,
    channel_exclusions: [],
    configured_in_ota: false,
  };
}

function formFromRule(r: AutomationRule): RuleFormInput {
  return {
    key: r.key,
    audience: r.audience,
    trigger: r.trigger,
    offset_days: r.offset_days,
    at_local: r.at_local ? r.at_local.slice(0, 5) : '',
    delivery: r.delivery,
    send_mode: r.send_mode,
    min_nights: r.min_nights === null ? '' : String(r.min_nights),
    subject: r.subject ?? '',
    body: r.body,
    enabled: r.enabled,
    channel_exclusions: [...r.channel_exclusions],
    configured_in_ota: r.configured_in_ota,
  };
}

function describeTiming(r: AutomationRule): string {
  if (r.trigger === 'booking_confirmed') return 'As soon as the booking is confirmed';
  const n = Math.abs(r.offset_days);
  const days = n === 0 ? '' : `${n} day${n === 1 ? '' : 's'} ${r.offset_days < 0 ? 'before' : 'after'}`;
  const at = r.at_local ? ` at ${fmtClock(r.at_local)}` : ' as the day begins';
  switch (r.trigger) {
    case 'pre_arrival':
    case 'checkin_day':
      return `${days ? `${days} check-in` : 'On the check-in day'}${at}`;
    case 'mid_stay':
      return `Mid-stay${days ? `, ${days} the middle night` : ''}${at}`;
    case 'pre_checkout':
    case 'post_checkout':
      return `${days ? `${days} checkout` : 'On the checkout day'}${at}`;
  }
  return TRIGGER_LABELS[r.trigger];
}

function railLabel(rail: string): string {
  switch (rail) {
    case 'sms':
      return 'text';
    case 'email':
      return 'email';
    case 'cleaner_sms':
      return 'cleaner text';
    case 'ota_manual':
      return 'paste into the OTA app';
    default:
      return rail;
  }
}

function fmtClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function copy(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable: the text is on screen */
  }
}

// ── Styles ───────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  fontWeight: 600,
};

const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  background: 'var(--paper-2)',
  borderLeft: '3px solid var(--rule)',
  padding: '10px 14px',
  marginBottom: 16,
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle, width: '100%' };

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 0',
  borderBottom: '1px solid var(--rule)',
};

const linkBtn: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
};

function ghostBtn(p: boolean, disabled = false): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink)',
    background: 'transparent',
    border: '1px solid var(--ink)',
    padding: '8px 14px',
    fontWeight: 600,
    cursor: p ? 'wait' : disabled ? 'not-allowed' : 'pointer',
    opacity: p || disabled ? 0.6 : 1,
    whiteSpace: 'nowrap',
  };
}

function solidBtn(p: boolean): React.CSSProperties {
  return {
    ...ghostBtn(p),
    color: 'var(--paper)',
    background: 'var(--ink)',
  };
}

function quietBtn(p: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    color: 'var(--ink-4)',
    background: 'transparent',
    border: 'none',
    padding: '8px 6px',
    cursor: p ? 'wait' : 'pointer',
    whiteSpace: 'nowrap',
  };
}
