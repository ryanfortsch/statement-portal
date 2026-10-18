'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { RENEWAL_WORDS, type LockedTerms, type RenewalType } from '@/lib/contract-register';
import { registerAgreement } from '../actions';

export type RegisterFormInitial = {
  property_id: string;
  projection_id: string;
  drive_file_id: string;
  replaces: string;
  edit: string;
  owner_party: string;
  executed_on: string;
  term_start: string;
  term_end: string;
  renewal_type: RenewalType;
  notice_days_initial: string;
  notice_days_renewal: string;
  fee_pct: string;
  signed_via: 'docusign' | 'external';
  drive_url: string;
  notes: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const RENEWAL_CHOICES: RenewalType[] = ['auto_renew', 'fixed', 'mutual_agreement'];

/**
 * The register's write form. Terms the signed contract states (`locked`)
 * print as text instead of inputs; the action takes them from the contract
 * either way, so this is about honesty on screen, not the guard.
 */
export function RegisterAgreementForm({
  initial,
  locked,
  homes,
  submitLabel,
}: {
  initial: RegisterFormInitial;
  locked: LockedTerms | null;
  /** The home picker, when the form was opened without a home (a Drive PDF). */
  homes: { id: string; name: string }[] | null;
  submitLabel: string;
}) {
  const [renewal, setRenewal] = useState<RenewalType>(initial.renewal_type);
  const [dirty, setDirty] = useState(false);
  const { busy, pending, error, setError, run } = useRecoverableAction();
  useDraftNavigationGuard(dirty, pending);

  return (
    <form
      method="post"
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current) return;
        const data = new FormData(event.currentTarget);
        run(async () => {
          const result = await registerAgreement(data);
          if (result?.error) setError(result.error);
        }, 'Could not confirm the save. Your entries are still here. Open the register in a new tab to check before trying again.');
      }}
      style={{ display: 'grid', gap: 22, maxWidth: 640 }}
    >
      <input type="hidden" name="projection_id" value={initial.projection_id} />
      <input type="hidden" name="drive_file_id" value={initial.drive_file_id} />
      <input type="hidden" name="replaces" value={initial.replaces} />
      <input type="hidden" name="edit" value={initial.edit} />

      {homes ? (
        <Field label="Home">
          <select name="property_id" defaultValue="" required disabled={pending} style={input}>
            <option value="" disabled>
              Pick the home it covers
            </option>
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="property_id" value={initial.property_id} />
      )}

      {locked?.owner_party ? (
        <Fixed label="Owner party">{locked.owner_party}</Fixed>
      ) : (
        <Field label="Owner party" hint="As the agreement names them: a person or an LLC.">
          <input name="owner_party" defaultValue={initial.owner_party} required disabled={pending} style={input} />
        </Field>
      )}

      <Field label="Executed" hint="The date the agreement was fully signed.">
        <input type="date" name="executed_on" defaultValue={initial.executed_on} disabled={pending} style={{ ...input, maxWidth: 200 }} />
      </Field>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {locked?.term_start ? (
          <Fixed label="Term starts">{fmtDate(locked.term_start)}</Fixed>
        ) : (
          <Field label="Term starts">
            <input type="date" name="term_start" defaultValue={initial.term_start} disabled={pending} style={{ ...input, maxWidth: 200 }} />
          </Field>
        )}
        {locked?.term_end ? (
          <Fixed label="Term ends">{fmtDate(locked.term_end)}</Fixed>
        ) : (
          <Field label="Term ends" hint="The end date written in the agreement.">
            <input type="date" name="term_end" defaultValue={initial.term_end} required disabled={pending} style={{ ...input, maxWidth: 200 }} />
          </Field>
        )}
        {locked?.fee_pct != null ? (
          <Fixed label="Fee">{locked.fee_pct}%</Fixed>
        ) : (
          <Field label="Fee" hint="Percent, like 25.">
            <input name="fee_pct" inputMode="decimal" defaultValue={initial.fee_pct} disabled={pending} style={{ ...input, maxWidth: 110 }} />
          </Field>
        )}
      </div>

      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        <legend className="eyebrow" style={{ marginBottom: 8 }}>
          Renewal
        </legend>
        {RENEWAL_CHOICES.map((r) => {
          const w = RENEWAL_WORDS[r];
          return (
            <label key={r} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 14, color: 'var(--ink)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="renewal_type"
                value={r}
                checked={renewal === r}
                onChange={() => setRenewal(r)}
                disabled={pending}
              />
              <span>
                {w.word}
                <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>: {w.meaning}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {renewal === 'auto_renew' && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Field label="Notice window, days" hint={RENEWAL_WORDS.notice_window.meaning}>
            <input name="notice_days_initial" inputMode="numeric" defaultValue={initial.notice_days_initial} disabled={pending} style={{ ...input, maxWidth: 110 }} />
          </Field>
          <Field label="After the first renewal, days" hint="Only if the agreement steps the notice up later. Blank keeps the same window.">
            <input name="notice_days_renewal" inputMode="numeric" defaultValue={initial.notice_days_renewal} disabled={pending} style={{ ...input, maxWidth: 110 }} />
          </Field>
        </div>
      )}

      {!initial.projection_id && (
        <Field label="Signed through">
          <select name="signed_via" defaultValue={initial.signed_via} disabled={pending} style={{ ...input, maxWidth: 260 }}>
            <option value="external">Paper or other</option>
            <option value="docusign">Docusign</option>
          </select>
        </Field>
      )}

      <Field label="Drive file" hint="The link to the signed PDF in the Drive Contracts folder.">
        <input name="drive_url" type="url" defaultValue={initial.drive_url} placeholder="https://drive.google.com/file/d/..." disabled={pending} style={input} />
      </Field>

      <Field label="Notes" hint="Anything the paper says that the register has no box for.">
        <textarea name="notes" defaultValue={initial.notes} rows={3} disabled={pending} style={{ ...input, resize: 'vertical' }} />
      </Field>

      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--negative)', fontSize: 13.5, lineHeight: 1.5 }}>
          {error}{' '}
          <a href="/properties/contracts" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)' }}>
            Open the register
          </a>
        </p>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            cursor: pending ? 'progress' : 'pointer',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            padding: '11px 20px',
            borderRadius: 6,
          }}
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        <Link href="/properties/contracts" style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none' }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

const input: CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  borderRadius: 6,
  width: '100%',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 160px' }}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

function Fixed({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 160px' }}>
      <span className="eyebrow">{label}</span>
      <span style={{ fontSize: 14, color: 'var(--ink)', padding: '8px 0' }}>{children}</span>
      <span style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>From the signed contract.</span>
    </div>
  );
}
