import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { LOCAL_CONTACTS_24HR, type HelmPropertyRow } from '@/lib/properties';
import { civicForProperty } from '@/lib/civic';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

/**
 * Property Information Note — required by the Gloucester STR permit
 * inspection (and good practice for any short-term rental). One US Letter
 * page, portrait, print-ready. Posted inside the home so guests + inspectors
 * can find local contacts, trash schedule, parking rules, noise ordinance,
 * and safety equipment locations at a glance.
 *
 * Resolution order for cell content (see lib/civic.ts):
 *   1. Per-property override columns on public.properties (from onboarding).
 *   2. Address-derived defaults — Gloucester trash schedule keyed by street
 *      from the city's published list; city-wide ordinance text.
 *   3. Empty cells render "—" rather than punting elsewhere; the Note is
 *      the source of truth, never refers to another document.
 */
export default async function InfoNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const cityShort = (p.city || '').split(',')[0].trim();
  const civic = civicForProperty(p);

  const operator = LOCAL_CONTACTS_24HR.operator;
  const backup = LOCAL_CONTACTS_24HR.backup;

  return (
    <>
      <style>{noteCss}</style>
      <div className="rt-doc">
        <article className="rt-page">
          <header className="rt-head">
            <div className="rt-eyebrow">
              <span>Stay Cape Ann</span>
              <span className="rt-eyebrow-dot" aria-hidden="true">•</span>
              <span>Information Note</span>
            </div>
            <h1 className="rt-display">
              House &amp; <em>civic info.</em>
            </h1>
            <p className="rt-tag">
              For guests staying at <strong>{p.title || p.name}</strong>
              {p.address ? ` (${p.address}${cityShort ? `, ${cityShort}` : ''})` : ''}. Posted per the
              short-term rental ordinance{cityShort ? ` of ${cityShort}, MA` : ''}. Please review on arrival.
            </p>
          </header>

          {/* Local contacts — full-width strip, on top because life-safety first */}
          <section className="rt-contacts">
            <div className="rt-contact-cell">
              <div className="rt-contact-eyebrow">Operator · 24/7</div>
              <div className="rt-contact-name">{operator.name}</div>
              <div className="rt-contact-role">{operator.role}</div>
              {operator.phone && <div className="rt-contact-line rt-mono">{operator.phone}</div>}
              {operator.email && <div className="rt-contact-line rt-mono">{operator.email}</div>}
            </div>
            <div className="rt-contact-cell">
              <div className="rt-contact-eyebrow">Additional 24-Hour Contact</div>
              <div className="rt-contact-name">{backup.name}</div>
              <div className="rt-contact-role">{backup.role}</div>
              {backup.phone && <div className="rt-contact-line rt-mono">{backup.phone}</div>}
              {backup.email && <div className="rt-contact-line rt-mono">{backup.email}</div>}
            </div>
            <div className="rt-contact-cell rt-emergency">
              <div className="rt-contact-eyebrow">In a true emergency</div>
              <div className="rt-contact-name">911</div>
              <div className="rt-contact-role">Police, fire, medical</div>
            </div>
          </section>

          {/* Six-cell grid */}
          <div className="rt-grid">
            <Cell num="01" title="Trash &amp; Recycling">
              <p>
                <span className="rt-k">Trash</span>
                <span className="rt-v">{civic.trashDay || '—'}</span>
              </p>
              <p>
                <span className="rt-k">Recycling</span>
                <span className="rt-v">{civic.recyclingDay || '—'}</span>
              </p>
              <p className="rt-aside">
                Place bins curbside the night before. Pet waste, yard waste, and household hazardous
                items go in the trash, not recycling.
              </p>
              {p.trash_notes && <p>{p.trash_notes}</p>}
            </Cell>

            <Cell num="02" title="Parking">
              <p>{civic.parking}</p>
            </Cell>

            <Cell num="03" title="Noise Ordinance">
              <p>{civic.noise}</p>
            </Cell>

            <Cell num="04" title="Animal Control">
              <p>{civic.animals}</p>
            </Cell>

            <Cell num="05" title="Gas, Water &amp; Electric Shutoffs">
              <div className="rt-stack">
                <div className="rt-stack-label">Gas</div>
                <div className="rt-stack-value">{p.gas_shutoff_location || '—'}</div>
              </div>
              <div className="rt-stack">
                <div className="rt-stack-label">Water</div>
                <div className="rt-stack-value">{p.water_shutoff_location || '—'}</div>
              </div>
              <div className="rt-stack">
                <div className="rt-stack-label">Electrical panel</div>
                <div className="rt-stack-value">{p.electrical_panel_location || '—'}</div>
              </div>
              <p className="rt-aside">If you smell gas, leave the home immediately and call the operator.</p>
            </Cell>

            <Cell num="06" title="Fire Safety">
              <div className="rt-stack">
                <div className="rt-stack-label">Exits</div>
                <div className="rt-stack-value">{p.fire_exit_locations || '—'}</div>
              </div>
              <div className="rt-stack">
                <div className="rt-stack-label">Smoke / CO alarms</div>
                <div className="rt-stack-value">{p.smoke_detector_locations || '—'}</div>
              </div>
              <div className="rt-stack">
                <div className="rt-stack-label">Extinguishers</div>
                <div className="rt-stack-value">{p.fire_extinguisher_locations || '—'}</div>
              </div>
            </Cell>
          </div>

          {/* Footer: permit + signoff */}
          <footer className="rt-foot">
            <div className="rt-foot-rule" />
            <div className="rt-foot-row">
              <div>
                <div className="rt-foot-label">STR Permit</div>
                <div className="rt-foot-val rt-mono">
                  {p.str_registration_id || '—'}
                  {p.str_permit_expires ? ` · expires ${p.str_permit_expires}` : ''}
                </div>
              </div>
              <div>
                <div className="rt-foot-label">Issued by</div>
                <div className="rt-foot-val">Rising Tide STR · risingtidestr.com</div>
              </div>
            </div>
          </footer>
        </article>
      </div>
    </>
  );
}

function Cell({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rt-cell">
      <div className="rt-cell-head">
        <span className="rt-cell-num">{num}</span>
        <h3 className="rt-cell-title" dangerouslySetInnerHTML={{ __html: title }} />
      </div>
      <div className="rt-cell-body">{children}</div>
    </section>
  );
}

const noteCss = `
  @page { size: 8.5in 11in; margin: 0; }
  html, body { background: var(--ink); margin: 0; padding: 0; }
  .rt-doc {
    display: flex;
    justify-content: center;
    padding: 24px 0;
    background: #0e1a1f;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-page {
    width: 816px;
    height: 1056px;
    background: var(--paper);
    color: var(--ink);
    padding: 56px 60px 48px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  }
  @media print {
    html, body { background: var(--paper); }
    .rt-doc { background: var(--paper); padding: 0; display: block; }
    .rt-page { box-shadow: none; }
  }

  /* Header */
  .rt-head { padding-bottom: 20px; border-bottom: 1px solid var(--ink); }
  .rt-eyebrow {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .rt-eyebrow-dot { color: var(--ink-4); font-size: 14px; line-height: 1; }
  .rt-display {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 46px;
    line-height: 1;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.025em;
    margin: 12px 0 0;
  }
  .rt-display em { font-style: italic; color: var(--tide-deep); font-weight: 400; }
  .rt-tag {
    margin: 14px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-3);
    max-width: 640px;
  }
  .rt-tag strong {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-weight: 400;
    color: var(--ink);
    font-size: 14px;
  }

  /* Contacts strip */
  .rt-contacts {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    border-bottom: 1px solid var(--ink);
  }
  .rt-contact-cell {
    padding: 18px 20px 16px;
    border-right: 1px solid var(--rule);
  }
  .rt-contact-cell:last-child { border-right: none; }
  .rt-contact-eyebrow {
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .rt-contact-name {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    font-weight: 400;
    color: var(--ink);
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .rt-contact-role {
    font-size: 11px;
    color: var(--ink-3);
    font-style: italic;
    margin-top: 2px;
  }
  .rt-contact-line {
    font-size: 12px;
    color: var(--ink);
    margin-top: 4px;
    line-height: 1.4;
  }
  .rt-emergency .rt-contact-name { color: var(--signal); }

  /* Six-cell info grid */
  .rt-grid {
    margin-top: 22px;
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 32px;
    row-gap: 18px;
    align-content: start;
  }
  .rt-cell {
    display: flex;
    flex-direction: column;
    border-top: 2px solid var(--ink);
    padding-top: 10px;
  }
  .rt-cell-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  .rt-cell-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 10px;
    color: var(--signal);
    letter-spacing: 0.08em;
    font-weight: 500;
  }
  .rt-cell-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 17px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-cell-body { font-size: 11.5px; line-height: 1.55; color: var(--ink); }
  .rt-cell-body p { margin: 0 0 5px; }
  .rt-cell-body p:last-child { margin-bottom: 0; }
  .rt-aside { color: var(--ink-3); font-size: 10.5px; font-style: italic; }

  /* Key/value rows (Trash, etc — short labels) */
  .rt-k {
    display: inline-block;
    width: 86px;
    font-size: 9.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    vertical-align: top;
  }
  .rt-v {
    display: inline-block;
    color: var(--ink);
    max-width: calc(100% - 90px);
  }

  /* Stacked label/value (Fire Safety, Shutoffs — variable-length labels) */
  .rt-stack { margin-bottom: 8px; }
  .rt-stack:last-of-type { margin-bottom: 0; }
  .rt-stack-label {
    font-size: 9.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    margin-bottom: 1px;
  }
  .rt-stack-value {
    color: var(--ink);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .rt-mono {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
  }
  .rt-link {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 10.5px;
    color: var(--ink-3);
  }

  /* Footer */
  .rt-foot { margin-top: 22px; }
  .rt-foot-rule { height: 2px; background: var(--ink); margin-bottom: 14px; }
  .rt-foot-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .rt-foot-label {
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .rt-foot-val { font-size: 11px; color: var(--ink); }
`;
