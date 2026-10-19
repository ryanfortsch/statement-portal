'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  approveSendAction,
  otaPasteTextAction,
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
  sendStatusLabel,
  TRIGGER_LABELS,
  type AutomationRule,
} from '@/lib/automations-core';
import { EmptyState } from '@/components/EmptyState';
import { Drawer } from '@/components/Drawer';
import { buttonClass } from '@/lib/button-class';

/**
 * The property page's Automations section (Guest & listing tab): what Helm
 * sends this home's guests and cleaners, Guesty Message Automation, Helm-native.
 *
 * It opens on what will send next and to whom: the on/off switch
 * (automations_enabled, which only takes when Helm runs this home's
 * calendar), only the readiness checks that fail, the sends waiting for an
 * approval, and the next ones scheduled. With nothing scheduled it shows
 * the next stay as the rules would send it, previewed with secrets masked.
 *
 * The rules (fleet defaults with this home's overrides) sit behind Edit
 * rules, in a drawer: each card is its name, its trigger, its state and two
 * verbs, with the rest (approval mode, Airbnb, Test, Remove override) in a
 * More menu. The masked test text and the merge fields live there too.
 *
 * Everything renders from the server-built view; each action revalidates
 * the page so the next render carries the new state.
 */
export function AutomationsPanel({ propertyId, view }: { propertyId: string; view: AutomationsPanelView | null }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<RuleFormInput | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [openSend, setOpenSend] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // The real text of an OTA paste, fetched on demand and held only here.
  const [pasteText, setPasteText] = useState<Record<string, string>>({});
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
      <EmptyState rule={false}>Ask Ryan: automations are not set up here.</EmptyState>
    );
  }

  const { property, helmRun, lockMapped, hasRatePlan, recipients, nextStay, rules, sends, counts } = view;
  const on = property.automations_enabled;
  const awaiting = sends.filter((s) => s.status === 'awaiting_approval');
  const scheduled = sends.filter((s) => s.status === 'scheduled' || s.status === 'sending');
  const history = sends.filter((s) => s.status !== 'awaiting_approval' && s.status !== 'scheduled' && s.status !== 'sending');
  const ruleByKey = new Map(rules.map((r) => [r.rule.key, r.rule]));
  // Only what is wrong: a check that passes says nothing.
  const problems = [
    !hasRatePlan && 'No rate plan: check-in and checkout times will be missing',
    !lockMapped && 'No lock mapped: door-code messages wait for an approval',
    recipients.length === 0 && 'No cleaner covers this home (Turnovers, Schedule)',
    nextStay && !nextStay.hasPhone && !nextStay.hasEmail && `No phone or email for ${nextStay.guest_name}`,
  ].filter((p): p is string => !!p);
  // With nothing scheduled, the next stay as the rules would send it.
  const preview = rules
    .filter((pr) => pr.active && pr.preview?.fireAt)
    .map((pr) => ({ pr, at: pr.preview!.fireAt! }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'the guest';
  const toWhom = (rule: AutomationRule | undefined, guest: string) =>
    rule?.audience === 'cleaner' ? (recipients.length ? recipients.join(', ') : 'no cleaner on file') : guest;

  return (
    <div style={{ paddingBottom: 6 }}>
      {/* The switch, and the way into the rules */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '4px 0 14px' }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>
          <span style={{ fontWeight: 600 }}>{on ? 'On' : 'Off'}</span>
          <span style={{ color: 'var(--ink-3)' }}>
            {on
              ? helmRun
                ? ': Helm sends these messages'
                : ': paused until Helm runs the calendar'
              : helmRun
                ? ': nothing sends until it is turned on'
                : ': Guesty sends this home\'s messages until Helm runs its calendar'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(on || helmRun) && (
            <button
              type="button"
              className={buttonClass(on ? 'secondary' : 'primary', 'sm')}
              disabled={pending}
              aria-busy={pending && busy === 'switch'}
              onClick={() => run('switch', () => setAutomationsEnabledAction(propertyId, !on))}
            >
              {pending && busy === 'switch' ? 'Saving…' : on ? 'Turn off' : 'Turn on'}
            </button>
          )}
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => setRulesOpen(true)}>
            Edit rules
          </button>
        </div>
      </div>

      {msg && !rulesOpen && <Notice ok={msg.ok}>{msg.text}</Notice>}

      {problems.length > 0 && (
        <div style={{ display: 'flex', gap: '6px 18px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid var(--rule)', fontSize: 12 }}>
          {problems.map((p) => (
            <Ready key={p} ok={false} label={p} />
          ))}
        </div>
      )}

      {/* Waiting for an approval: the first thing that needs a person. */}
      {awaiting.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Waiting for approval</div>
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
                // The draft is the TEMPLATE (merge fields intact), never the
                // masked render: an unchanged draft sends the rule's own body.
                run(`ap:${s.id}`, () => approveSendAction(propertyId, s.id, draft[s.id] && draft[s.id] !== s.template_body ? draft[s.id] : null))
              }
              onSkip={() => run(`sk:${s.id}`, () => skipSendAction(propertyId, s.id))}
              pasteText={pasteText[s.id]}
              onCopy={() =>
                run(`cp:${s.id}`, async () => {
                  const r = await otaPasteTextAction(propertyId, s.id);
                  if (!r.ok || !r.text) return { ok: r.ok, message: r.message };
                  setPasteText({ ...pasteText, [s.id]: r.text });
                  // Say "Copied" only when the clipboard took it: Safari refuses
                  // a write after the server round trip, and a stale clipboard
                  // pasted into the OTA thread is some other guest's text.
                  const copied = await copyText(r.text);
                  return {
                    ok: true,
                    message: copied
                      ? 'Copied. Paste it into the OTA, then press Mark pasted.'
                      : 'Your browser did not copy it: select the text below and copy it, then press Mark pasted.',
                  };
                })
              }
            />
          ))}
        </div>
      )}

      {/* Next to send: when, what, to whom, by what. */}
      <div style={{ marginTop: 18 }}>
        {scheduled.length > 0 ? (
          <>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Next to send</div>
            {scheduled.map((s) => (
              <NextRow
                key={s.id}
                when={s.fire_at}
                name={ruleName(s.key)}
                to={toWhom(ruleByKey.get(s.key), s.guest_name)}
                by={s.delivery_used ? railLabel(s.delivery_used) : ruleByKey.get(s.key) ? DELIVERY_LABELS[ruleByKey.get(s.key)!.delivery]?.toLowerCase() : null}
                stay={`${fmtDate(s.check_in)} to ${fmtDate(s.check_out)}`}
                action={
                  <button type="button" className={buttonClass('quiet')} disabled={pending} onClick={() => run(`sk:${s.id}`, () => skipSendAction(propertyId, s.id))}>
                    {pending && busy === `sk:${s.id}` ? 'Skipping…' : 'Skip'}
                  </button>
                }
              />
            ))}
          </>
        ) : nextStay && preview.length > 0 ? (
          <>
            <div className="eyebrow" style={{ marginBottom: 2 }}>
              {on ? 'Next stay' : 'What Helm would send for the next stay'}: {nextStay.guest_name}, {fmtDate(nextStay.check_in)} to {fmtDate(nextStay.check_out)}
            </div>
            {preview.map(({ pr, at }) => (
              <NextRow
                key={pr.rule.id}
                when={at}
                name={ruleName(pr.rule.key)}
                to={toWhom(pr.rule, firstName(nextStay.guest_name))}
                by={pr.preview?.rail ? railLabel(pr.preview.rail) : null}
                problem={
                  !pr.preview?.rail
                    ? 'no phone or email on file'
                    : pr.preview.missing.length > 0
                      ? `missing ${pr.preview.missing.join(', ')}`
                      : null
                }
              />
            ))}
          </>
        ) : (
          <EmptyState rule={false}>{on ? 'Nothing is scheduled in the next 30 days.' : 'No upcoming stay to send for.'}</EmptyState>
        )}
      </div>

      {(history.length > 0 || counts.noContact > 0) && (
        <div style={{ marginTop: 14, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {history.length > 0 && (
            <button type="button" onClick={() => setShowHistory(!showHistory)} style={linkBtn} aria-expanded={showHistory}>
              {showHistory ? 'Hide' : 'Show'} {history.length} past send{history.length === 1 ? '' : 's'}
            </button>
          )}
          {counts.noContact > 0 && <span style={{ fontSize: 12, color: 'var(--negative)' }}>{counts.noContact} with no contact on file</span>}
        </div>
      )}
      {showHistory &&
        history.map((s) => (
          <SendRow key={s.id} s={s} open={openSend === s.id} onOpen={() => setOpenSend(openSend === s.id ? null : s.id)} pending={pending} busy={busy} />
        ))}

      {rulesOpen && (
        <Drawer title="Rules for this home" eyebrow="Automations" width={640} onClose={() => { setRulesOpen(false); setEditing(null); }}>
          {msg && <Notice ok={msg.ok}>{msg.text}</Notice>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 12 }}>
            <label style={labelStyle} htmlFor="automation-test-phone">Send tests to</label>
            <input
              id="automation-test-phone"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="your phone"
              inputMode="tel"
              style={{ ...inputStyle, width: 170 }}
            />
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              disabled={pending}
              onClick={() => setEditing(editing ? null : blankForm())}
              style={{ marginLeft: 'auto' }}
            >
              {editing ? 'Close the form' : 'Add a rule'}
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

          {rules.length === 0 && <EmptyState rule={false}>No automations for this home yet; add one above.</EmptyState>}

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

          <details style={{ marginTop: 24 }}>
            <summary style={{ fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>Merge fields</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px 18px', marginTop: 10 }}>
              {MERGE_FIELDS.map((f) => (
                <div key={f} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  <span className="font-mono" style={{ color: 'var(--ink)' }}>{`{{${f}}}`}</span> {MERGE_FIELD_HELP[f]}
                </div>
              ))}
            </div>
          </details>
        </Drawer>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Notice({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      role={ok ? 'status' : 'alert'}
      style={{
        marginBottom: 16,
        padding: '12px 16px',
        borderLeft: `3px solid ${ok ? 'var(--positive)' : 'var(--negative)'}`,
        background: 'var(--paper-2)',
        fontSize: 13,
        color: ok ? 'var(--ink)' : 'var(--negative)',
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function Ready({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: ok ? 'var(--ink-2)' : 'var(--negative)' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--positive)' : 'var(--negative)', flex: 'none' }} />
      {label}
    </span>
  );
}

/** One line of what will send: when, what, to whom, by what. */
function NextRow({ when, name, to, by, stay, problem, action }: { when: string; name: string; to: string; by: string | null | undefined; stay?: string; problem?: string | null; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 150px) 1fr auto', gap: 12, alignItems: 'baseline', padding: '10px 0', borderBottom: '1px solid var(--rule)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtWhen(when)}</span>
      <span style={{ fontSize: 13, color: 'var(--ink)', minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{name}</span> to {to}
        {by ? <span style={{ color: 'var(--ink-3)' }}>, by {by}</span> : null}
        {stay ? <span style={{ color: 'var(--ink-4)' }}> · {stay}</span> : null}
        {problem ? <span style={{ color: 'var(--negative)' }}> · {problem}</span> : null}
      </span>
      <span>{action}</span>
    </div>
  );
}

/** 'checkout_reminder' -> 'Checkout reminder'. */
function ruleName(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Rule';
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
  const state = pr.silenced
    ? 'Silenced here'
    : !pr.active
      ? 'Off'
      : pr.forcedApprove
        ? 'On, approve first (door code, no lock)'
        : r.send_mode === 'auto'
          ? 'On, sends itself'
          : 'On, approve first';
  // The rest of a rule's verbs, behind More.
  const more: MenuItem[] = [
    { label: r.send_mode === 'auto' ? 'Require approval' : 'Send automatically', onSelect: onMode },
    ...(r.audience === 'guest' ? [{ label: r.configured_in_ota ? 'Not configured in Airbnb' : 'Mark configured in Airbnb', onSelect: onOta }] : []),
    { label: canTest ? 'Send a test' : 'Send a test (add your phone above)', onSelect: onTest, disabled: !canTest },
    ...(pr.source === 'property'
      ? [{ label: 'Remove override', onSelect: onRemove, tone: 'danger' as const, title: "Removes this home's version; the fleet default applies again. What it already sent stays in the history and is not sent again" }]
      : []),
  ];
  const working = ['en', 'mode', 'ota', 'rm'].some((k) => is(`${k}:${r.key}`)) || is(`test:${r.id}`);
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)', opacity: pr.active ? 1 : 0.72, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>
          {ruleName(r.key)}
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink-4)', marginLeft: 8 }}>{pr.source === 'property' ? 'this home' : 'fleet'}{r.audience === 'cleaner' ? ', cleaner' : ''}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.5 }}>
          {describeTiming(r)}, {(DELIVERY_LABELS[r.delivery] ?? r.delivery).toLowerCase()}
        </div>
        <div style={{ fontSize: 12, marginTop: 3, color: pr.active ? (pr.forcedApprove ? 'var(--negative)' : 'var(--positive)') : 'var(--ink-4)' }}>
          {working ? 'Saving…' : state}
          {r.configured_in_ota && <span style={{ color: 'var(--ink-4)' }}> · Airbnb sends its own</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className={buttonClass('secondary', 'sm')} disabled={pending} onClick={onToggle}>
          {pr.active ? 'Silence here' : 'Turn on here'}
        </button>
        <button type="button" className={buttonClass('quiet')} disabled={pending} onClick={onEdit}>
          {pr.source === 'property' ? 'Edit' : 'Edit here'}
        </button>
        <MoreMenu label={`More for ${ruleName(r.key)}`} items={more} disabled={pending} />
      </div>
    </div>
  );
}

type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; tone?: 'danger'; title?: string };

/** A small menu: More opens it; a pick, Escape or a click outside closes it. */
function MoreMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the menu, not the drawer it sits in.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button type="button" className={buttonClass('quiet')} aria-haspopup="menu" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        More
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 5, background: 'var(--paper)', border: '1px solid var(--ink)', boxShadow: '0 8px 24px rgba(11,37,69,0.12)', minWidth: 240, padding: '4px 0' }}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '8px 14px',
                fontSize: 13,
                color: it.tone === 'danger' ? 'var(--negative)' : it.disabled ? 'var(--ink-4)' : 'var(--ink)',
                cursor: it.disabled ? 'default' : 'pointer',
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
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
  onCopy,
  pasteText,
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
  onCopy?: () => void;
  pasteText?: string;
}) {
  const tone = s.status === 'awaiting_approval' ? 'signal' : s.status === 'sent' ? 'pos' : s.status === 'scheduled' || s.status === 'sending' ? 'muted' : s.status === 'failed' || s.status === 'skipped_no_contact' ? 'neg' : 'muted';
  const isOta = s.delivery_used === 'ota_manual';
  // Editing works on the rule's template, merge fields intact, so the door
  // code fills at send time. The stored render is masked and is display only;
  // a row whose rule is gone has no template and is approve-or-skip as is.
  const canEdit = s.status === 'awaiting_approval' && !isOta && !!onDraft && s.template_body !== null;
  const template = draft ?? s.template_body ?? '';
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', cursor: 'pointer' }} onClick={onOpen}>
        {s.status !== 'awaiting_approval' && <Badge tone={tone}>{sendStatusLabel(s.status, s.error)}</Badge>}
        <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{ruleName(s.key)}</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>to {s.guest_name}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {fmtDate(s.check_in)} to {fmtDate(s.check_out)}
          {s.channel ? `, ${CHANNEL_NAMES[s.channel] ?? s.channel}` : ''}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)', marginLeft: 'auto' }}>
          {s.status === 'sent' && s.sent_at ? `sent ${fmtWhen(s.sent_at)}` : `fires ${fmtWhen(s.fire_at)}`}
          {s.delivery_used ? ` by ${railLabel(s.delivery_used)}` : ''}
        </span>
      </div>
      {(open || s.status === 'awaiting_approval') && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55 }}>
          {s.error && <div style={{ color: s.status === 'sent' ? 'var(--ink-3)' : 'var(--negative)', marginBottom: 6 }}>{s.error}</div>}
          {s.missing_fields.length > 0 && (
            <div style={{ color: 'var(--negative)', marginBottom: 6 }}>
              Missing: {s.missing_fields.join(', ')}. Fill the property record{canEdit ? ', or edit the template below to take the field out' : ''}.
            </div>
          )}
          {s.to_address && !isOta && <div style={{ color: 'var(--ink-4)', marginBottom: 6 }}>To {s.to_address}</div>}
          {s.subject_rendered && (s.delivery_used === 'email') && <div style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{s.subject_rendered}</div>}
          <div style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap', background: 'var(--paper-2)', padding: '8px 12px', borderLeft: '3px solid var(--rule)' }}>{s.body_rendered}</div>
          {isOta && pasteText && (
            // What goes into the OTA: the real text, shown after Copy text in
            // case the clipboard was refused. Never stored.
            <textarea readOnly value={pasteText} rows={5} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, width: '100%', marginTop: 8, fontFamily: 'inherit', lineHeight: 1.5 }} />
          )}
          {canEdit && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: 'var(--ink-4)', marginBottom: 4 }}>
                This send only. Keep <span className="font-mono">{'{{door_code}}'}</span> and <span className="font-mono">{'{{wifi_password}}'}</span> as written.
              </div>
              <textarea
                value={template}
                onChange={(e) => onDraft?.(e.target.value)}
                rows={4}
                style={{ ...inputStyle, width: '100%', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </div>
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
                  {/* The ledger's text is masked; this fetches the real one. */}
                  <button type="button" disabled={pending || !onCopy} onClick={onCopy} style={ghostBtn(pending && busy === `cp:${s.id}`)}>
                    {pending && busy === `cp:${s.id}` ? 'Preparing' : 'Copy text'}
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
const CHANNEL_NAMES: Record<string, string> = { airbnb: 'Airbnb', vrbo: 'Vrbo', booking_com: 'Booking.com', direct: 'Direct', manual: 'Manual' };

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
        <Field label="Short name">
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
                {CHANNEL_NAMES[c]}
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
            <input type="checkbox" checked={form.configured_in_ota} onChange={(e) => set('configured_in_ota', e.target.checked)} /> Already configured in Airbnb Scheduled Messages (VRBO and Booking.com stays still come here to paste)
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

/** Resolves true only when the clipboard write succeeded. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
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
