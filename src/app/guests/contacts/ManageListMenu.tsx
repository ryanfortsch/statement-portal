'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { SubmitButton } from '@/components/SubmitButton';
import { importContactsFromCsv, syncFromGuesty, type ImportOutcome } from '../actions';

/**
 * The one menu behind Contacts' two verbs. The chores that keep the list
 * itself in shape live here instead of on the toolbar: the campaigns
 * archive, a one-time CSV import (Squarespace's Profiles export; the column
 * map is in the Playbook), and a Guesty sync, which Helm also runs every
 * morning on its own.
 */
export function ManageListMenu({ lastGuestySync }: { lastGuestySync: string | null }) {
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [fileName, setFileName] = useState('');
  const { busy, pending, error, run } = useRecoverableAction();

  function onImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setOutcome(null);
    run(async () => {
      const result = await importContactsFromCsv(data);
      setOutcome(result);
      if (result.ok) { form.reset(); setFileName(''); }
    }, 'Could not confirm the import. Check the list before importing the file again.');
  }

  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...menuButtonStyle, cursor: 'pointer', listStyle: 'none' }}>Manage list ▾</summary>
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 8px)',
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          width: 'min(340px, calc(100vw - 32px))',
          zIndex: 10,
        }}
      >
        <Link href="/guests/campaigns" style={{ ...rowStyle, display: 'block', textDecoration: 'none', color: 'var(--ink)' }}>
          Campaigns <span style={{ color: 'var(--ink-3)' }}>→</span>
        </Link>

        <form onSubmit={onImport} encType="multipart/form-data" style={{ ...rowStyle, display: 'grid', gap: 8 }}>
          <label htmlFor="contacts-csv" style={{ fontSize: 13, color: 'var(--ink)' }}>Import a CSV</label>
          <input
            id="contacts-csv"
            name="csv"
            type="file"
            accept=".csv,text/csv"
            required
            disabled={pending}
            onChange={(event) => { setOutcome(null); setFileName(event.target.files?.[0]?.name ?? ''); }}
            style={{ fontSize: 12, color: 'var(--ink)' }}
          />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Matched by email; mailing lists become tags.{' '}
            <Link href="/playbook/import-guest-contacts-from-a-csv" style={{ color: 'var(--ink-3)' }}>Columns</Link>
          </span>
          <button type="submit" disabled={pending || !fileName} aria-busy={pending} style={smallButtonStyle}>
            {pending ? 'Importing…' : 'Import'}
          </button>
          {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--negative)' }}>{error}</p>}
          {outcome && !outcome.ok && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--negative)' }}>{outcome.error}</p>}
          {outcome?.ok && (
            <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--ink)' }}>
              Imported {outcome.imported} of {outcome.rows} {outcome.rows === 1 ? 'contact' : 'contacts'}.
              {outcome.problems.length > 0 && <> {outcome.problems.length} {outcome.problems.length === 1 ? 'row' : 'rows'} could not be read.</>}
            </p>
          )}
        </form>

        <form action={syncFromGuesty} style={{ ...rowStyle, borderBottom: 'none', display: 'grid', gap: 6 }}>
          <SubmitButton label="Sync from Guesty" busyLabel="Syncing from Guesty…" style={smallButtonStyle} spinnerTone="ink" />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {lastGuestySync ? `Last run ${lastGuestySync}. ` : ''}Helm also runs it every morning.
          </span>
        </form>
      </div>
    </details>
  );
}

const rowStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--rule)',
  fontSize: 13,
};

const menuButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 16px',
  border: '1px solid var(--ink)',
  display: 'inline-block',
};

const smallButtonStyle: React.CSSProperties = {
  justifySelf: 'start',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '8px 14px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};
