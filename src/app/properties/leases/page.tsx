import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { EmptyState } from '@/components/EmptyState';
import { SubmitButton } from '@/components/SubmitButton';
import { buttonClass } from '@/lib/button-class';
import { loadLeaseLeads, type LeaseLeadRow } from '@/lib/lease-leads';
import { PropertiesTabBar } from '../PropertiesTabBar';
import { checkLeaseLeadsNow, dismissLeaseLead, restoreLeaseLead } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Winter lease leads from Zillow, vetted (src/lib/lease-leads-core.ts).
 * Serious leads lead the page and reach the owners' home feed; the rest wait
 * here so nothing is lost. Owners only (OWNER_PATH_PREFIXES): a lead carries
 * a renter's income and dates.
 */
export default async function LeasesPage() {
  const leads = await loadLeaseLeads({ includeDismissed: true });
  const live = leads.filter((l) => !l.dismissed_at);
  const serious = live.filter((l) => l.verdict === 'serious');
  const waiting = live.filter((l) => l.verdict === 'needs_answers' || l.verdict === 'new');
  const filtered = live.filter((l) => l.verdict === 'not_a_fit' || l.verdict === 'spam');
  const dismissed = leads.filter((l) => l.dismissed_at);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero
        plain
        eyebrow="Helm · Properties"
        title="Leases"
        line="Zillow leads for the winter leases, read every half hour and held to the playbook's written criteria. Each lead that needs answers gets the screening questions once; only serious ones reach your home feed."
      />
      <PropertiesTabBar active="leases" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80, flex: 1 }}>
        <form action={checkLeaseLeadsNow} style={{ marginBottom: 32 }}>
          <SubmitButton label="Check Zillow now" busyLabel="Reading the mail" className={buttonClass('secondary', 'sm')} />
        </form>

        <Group title="Serious" eyebrow={`${serious.length}`}>
          {serious.length === 0 ? (
            <EmptyState>No serious applicants yet.</EmptyState>
          ) : (
            serious.map((l) => <LeadCard key={l.id} lead={l} />)
          )}
        </Group>

        <Group title="Waiting on answers" eyebrow={`${waiting.length}`}>
          {waiting.length === 0 ? <EmptyState>Nobody is waiting on an answer.</EmptyState> : waiting.map((l) => <LeadRow key={l.id} lead={l} />)}
        </Group>

        {filtered.length > 0 && (
          <details style={{ marginTop: 40 }}>
            <summary className="eyebrow" style={{ cursor: 'pointer' }}>Filtered out · {filtered.length} (not a fit or a scam)</summary>
            <div style={{ marginTop: 14 }}>{filtered.map((l) => <LeadRow key={l.id} lead={l} />)}</div>
          </details>
        )}

        {dismissed.length > 0 && (
          <details style={{ marginTop: 24 }}>
            <summary className="eyebrow" style={{ cursor: 'pointer' }}>Dismissed · {dismissed.length}</summary>
            <div style={{ marginTop: 14 }}>{dismissed.map((l) => <LeadRow key={l.id} lead={l} />)}</div>
          </details>
        )}
      </section>

      <HelmFooter module="Properties" right="Source: Zillow mail" />
    </div>
  );
}

function Group({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 10, marginBottom: 6 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>{title}</h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      {children}
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

function verdictWord(v: string): string {
  return v === 'needs_answers' ? 'needs answers' : v === 'not_a_fit' ? 'not a fit' : v;
}

function Links({ lead }: { lead: LeaseLeadRow }) {
  return (
    <span style={{ display: 'inline-flex', gap: 14, alignItems: 'baseline' }}>
      {lead.reply_url && (
        <a href={lead.reply_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--tide-deep)' }}>
          Reply in Zillow ↗
        </a>
      )}
      {lead.application_url && (
        <a href={lead.application_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--tide-deep)' }}>
          {lead.has_application ? 'Application ↗' : 'Send application ↗'}
        </a>
      )}
    </span>
  );
}

function DismissOrRestore({ lead }: { lead: LeaseLeadRow }) {
  return (
    <form action={lead.dismissed_at ? restoreLeaseLead : dismissLeaseLead}>
      <input type="hidden" name="id" value={lead.id} />
      <SubmitButton label={lead.dismissed_at ? 'Restore' : 'Dismiss'} busyLabel={lead.dismissed_at ? 'Restoring' : 'Dismissing'} className={buttonClass('quiet')} spinnerTone="ink" />
    </form>
  );
}

function LeadCard({ lead }: { lead: LeaseLeadRow }) {
  return (
    <article style={{ padding: '20px 0', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <div>
          <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 400, margin: 0 }}>{lead.renter_name ?? 'A renter'}</h3>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {lead.label ?? lead.zillow_address ?? 'Unmatched listing'}
            {lead.monthly_rent ? ` · $${lead.monthly_rent.toLocaleString()} a month` : ''} · first wrote {when(lead.first_seen_at)}
            {lead.last_message_at !== lead.first_seen_at ? `, last ${when(lead.last_message_at)}` : ''}
          </p>
        </div>
        <DismissOrRestore lead={lead} />
      </div>
      {lead.summary && <p style={{ fontSize: 14, marginTop: 12, maxWidth: 760, lineHeight: 1.55 }}>{lead.summary}</p>}
      {lead.verdict_reasons.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          {lead.verdict_reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 12 }}>
        <Links lead={lead} />
      </div>
    </article>
  );
}

function LeadRow({ lead }: { lead: LeaseLeadRow }) {
  const missing = lead.verdict_reasons.filter((r) => r.startsWith('missing: ')).map((r) => r.slice(9));
  const other = lead.verdict_reasons.filter((r) => !r.startsWith('missing: '));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--rule)', alignItems: 'baseline' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>
          <strong style={{ fontWeight: 500 }}>{lead.renter_name ?? 'A renter'}</strong>
          <span style={{ color: 'var(--ink-3)' }}> · {lead.label ?? lead.zillow_address ?? 'unmatched'} · {when(lead.last_message_at)} · {verdictWord(lead.verdict)}</span>
        </div>
        {lead.summary && <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>{lead.summary}</div>}
        {(lead.screening_sent_at || lead.screening_error) && (
          <div style={{ fontSize: 12, color: lead.screening_sent_at ? 'var(--ink-3)' : 'var(--negative)', marginTop: 4 }}>
            {lead.screening_sent_at ? `Screening questions sent ${when(lead.screening_sent_at)}` : `Screening questions not sent: ${lead.screening_error}`}
          </div>
        )}
        {(missing.length > 0 || other.length > 0) && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
            {other.join(' · ')}
            {other.length > 0 && missing.length > 0 ? ' · ' : ''}
            {missing.length > 0 ? `Still to ask: ${missing.join(', ')}` : ''}
          </div>
        )}
        <div style={{ marginTop: 6 }}>
          <Links lead={lead} />
        </div>
      </div>
      <DismissOrRestore lead={lead} />
    </div>
  );
}
