import type { ProjectionRow } from '@/lib/projections-types';
import {
  CONTRACT_BASE,
  type ContractClause,
  type ContractKv,
  type ContractPage,
  type ContractSection,
  type ContractSectionContent,
} from '@/lib/contract-base';
import { applyContractOverrides, type ContractOverride } from '@/lib/contract-overrides';

/**
 * Rising Tide management contract — data-driven renderer.
 *
 * The contract source lives in src/lib/contract-base.ts as a structured
 * tree of pages → sections → clauses, each with a stable ID and a
 * {{varName}} template for deal-specific values. The redlines tool
 * persists ContractOverride[] (see src/lib/contract-overrides.ts) on
 * the projection record; this component applies those overrides to the
 * base tree at render time so edits modify the contract in place.
 *
 * Why this shape: the prior hard-coded JSX gave the redlines engine no
 * way to address individual clauses, so every owner-requested edit
 * collapsed to a "Rider — Additional Terms" appendix. The 36 Granite St
 * retro called this out as the core architectural defect. With stable
 * IDs + action-aware overrides, each redline (replace / modify / rename
 * / delete / add) now lands in the right place in the body.
 *
 * Signing flow + cover layout are unchanged — when projection.contract_signed_at
 * is set, the owner signature block renders the typed name + date.
 */
export function ContractDocument({
  projection,
  signingForm,
}: {
  projection: ProjectionRow;
  signingForm?: React.ReactNode;
}) {
  const overrides = (projection.contract_overrides ?? []) as ContractOverride[];
  let pages: ContractPage[];
  try {
    pages = applyContractOverrides(overrides, CONTRACT_BASE);
  } catch (err) {
    // A failing override should not break the whole contract preview.
    // Log + fall back to the un-overridden base so staff still sees the
    // baseline contract and can fix the broken override.
    console.error('Contract override apply failed; rendering base:', err);
    pages = CONTRACT_BASE;
  }

  const vars = buildTemplateVars(projection);
  const ownerName = vars.ownerName;
  const issuedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Signature state. The "Date" field in the signature block is the contract's
  // effective date (term_start), not the moment the owner clicked submit.
  const signedName = projection.contract_signed_name || null;
  const signedAt = projection.contract_signed_at;
  const effectiveDate = projection.term_start ? formatDateNarrative(projection.term_start) : null;

  // Legacy custom_clauses fallback: ONLY when the new overrides path is
  // unused AND there's pre-overrides clause data on the row. New work
  // never adds to the Rider page.
  const hasLegacyRider =
    (overrides.length === 0) &&
    (projection.custom_clauses?.length ?? 0) > 0;

  return (
    <>
      <style>{contractCss}</style>
      <div className="rt-doc">
        {/* Page 1 — cover */}
        <section className="rt-doc-page rt-cover">
          <div className="rt-cover-inner">
            <div className="rt-cover-eyebrow">Rising Tide</div>
            <h1 className="rt-cover-h1">Management Contract</h1>
            <div className="rt-cover-rule" />
            <p className="rt-cover-tag">
              This agreement outlines the terms and responsibilities between Rising Tide STR, LLC and the property owner for short-term rental management services.
            </p>
          </div>
          <div className="rt-cover-foot">
            <div className="rt-cover-foot-row"><span>Date:</span><span>{issuedDate}</span></div>
            <div className="rt-cover-foot-row"><span>Property Owner:</span><span><Term>{ownerName}</Term></span></div>
            <div className="rt-cover-foot-q">
              Questions? Reach Allie at allie@risingtidestr.com or (978) 865-2387
            </div>
          </div>
        </section>

        {/* Body pages — driven by the structured tree + overrides */}
        {pages
          .filter((p) => p.kind === 'body')
          .map((page, idx) => (
            <section key={page.id} className="rt-doc-page">
              {page.sections.map((section) => (
                <SectionRenderer key={section.id} section={section} vars={vars} />
              ))}
              <DocFooter pageNum={idx + 2} />
            </section>
          ))}

        {/* Legacy Rider page — only for projections that haven't moved
            to the overrides engine. New custom additions go via the
            'add' override action with explicit anchors. */}
        {hasLegacyRider && (
          <section className="rt-doc-page">
            <SectionTitle title="Rider — Additional Terms" />
            <p className="rt-c-body">
              The following additional terms have been agreed between the
              Parties and form part of this Agreement. They are read
              alongside the standard terms above; in the event of conflict,
              these additional terms shall control.
            </p>
            {(projection.custom_clauses ?? []).map((clause, idx) => (
              <div key={idx} className="rt-c-clause">
                <h3 className="rt-c-clause-title">
                  {String(idx + 1).padStart(2, '0')}. {clause.title || 'Untitled clause'}
                </h3>
                {clause.body.split(/\n+/).map((para, pi) => (
                  <p key={pi} className="rt-c-body">{para}</p>
                ))}
              </div>
            ))}
            <DocFooter pageNum={pages.filter((p) => p.kind === 'body').length + 2} />
          </section>
        )}

        {/* Signatures — own page, gives the block room to breathe */}
        <section className="rt-doc-page rt-c-sig-page">
          <SectionTitle title="Signatures" />
          <p className="rt-c-sig-lede">
            By signing below, the Parties acknowledge that they have read, understood, and agree to be bound by the terms of this Management Contract.
          </p>
          <div className="rt-c-sig-grid">
            <SignerBlock
              eyebrow="Owner"
              printedName={ownerName}
              signedName={signedName}
              dateValue={effectiveDate}
            />
            <SignerBlock
              eyebrow="Property Manager"
              printedName="Allie O'Brien, Rising Tide STR, LLC"
              signedName={null}
              dateValue={effectiveDate}
            />
          </div>
          {signedName && signedAt && (
            <div className="rt-c-audit">
              Electronically signed by <strong>{signedName}</strong> on{' '}
              {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
              {projection.contract_signed_ip ? ` from ${projection.contract_signed_ip}` : ''}.
            </div>
          )}
          <p className="rt-c-thanks">
            <b>Thank you for choosing Rising Tide.</b><br />
            Questions? Reach Allie directly at allie@risingtidestr.com or (978) 865-2387.
          </p>
          <DocFooter
            pageNum={
              pages.filter((p) => p.kind === 'body').length + 2 + (hasLegacyRider ? 1 : 0)
            }
          />
        </section>

        {/* Public-facing signing form, only when not yet signed. Hidden in print. */}
        {signingForm && !signedName && <div className="rt-c-signing-slot">{signingForm}</div>}
      </div>
    </>
  );
}

// ─── Renderers ──────────────────────────────────────────────────────────────

function SectionRenderer({ section, vars }: { section: ContractSection; vars: TemplateVars }) {
  const hasKv = section.content.some((c) => c.type === 'kv');
  const bullets = section.content.filter((c) => c.type === 'bullet') as ContractClause[];
  const paragraphs = section.content.filter((c) => c.type === 'paragraph') as ContractClause[];

  return (
    <>
      <SectionTitle title={section.title} />
      {section.intro && <ParagraphClause clause={section.intro} vars={vars} />}
      {hasKv && (
        <div className="rt-c-kv">
          {section.content
            .filter((c): c is ContractKv => c.type === 'kv')
            .map((kv) => (
              <div key={kv.id}>
                <span>{kv.label}</span>
                <span><Term>{interpolate(kv.valueTemplate, vars)}</Term></span>
              </div>
            ))}
        </div>
      )}
      {paragraphs.map((p) => (
        <ParagraphClause key={p.id} clause={p} vars={vars} />
      ))}
      {bullets.length > 0 && (
        <ul className="rt-c-bullets">
          {bullets.map((b) => (
            <BulletClause key={b.id} clause={b} vars={vars} />
          ))}
        </ul>
      )}
    </>
  );
}

function ParagraphClause({ clause, vars }: { clause: ContractClause; vars: TemplateVars }) {
  return <p className="rt-c-body">{renderTemplate(clause.template, vars)}</p>;
}

function BulletClause({ clause, vars }: { clause: ContractClause; vars: TemplateVars }) {
  // Normalize the bold label: every labeled bullet in this contract ends with
  // a colon ("Notification Requirement:"). New clauses produced by the
  // redlines tool sometimes arrive without one — bake it in at render time
  // so the contract reads consistently.
  const label = normalizeBoldPrefix(clause.boldPrefix);
  // Strip a duplicate of the label from the start of the template. The
  // redline tool occasionally emits both `boldPrefix: "Owner Approval
  // Required"` AND a template that starts with "Owner Approval Required:".
  // Without this strip the rendered bullet reads "Owner Approval Required
  // Owner Approval Required: ..." — clearly wrong.
  const template = stripDuplicatePrefix(clause.template, label);
  return (
    <li>
      {label ? <b>{label} </b> : null}
      {renderTemplate(template, vars)}
      {clause.children && clause.children.length > 0 && (
        <ul>
          {clause.children.map((child) => (
            <BulletClause key={child.id} clause={child} vars={vars} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Bold-label normalizer. Ensures every labeled bullet ends with ":". */
function normalizeBoldPrefix(prefix?: string): string | undefined {
  if (!prefix) return undefined;
  const trimmed = prefix.trim().replace(/:+$/, '');
  if (!trimmed) return undefined;
  return `${trimmed}:`;
}

/**
 * Strip a duplicated bold label from the start of a clause template. Matches
 * the label with or without trailing colon, case-insensitively, so all four
 * variants get cleaned up:
 *
 *   "Owner Approval Required: body"     →  "body"
 *   "Owner Approval Required body"      →  "body"
 *   "owner approval required: body"     →  "body"
 *   "Owner approval required :body"     →  "body"
 */
function stripDuplicatePrefix(template: string, normalizedLabel?: string): string {
  if (!normalizedLabel) return template;
  const noColon = normalizedLabel.replace(/:+$/, '').trim();
  if (!noColon) return template;
  const pattern = new RegExp(
    `^\\s*${escapeRegex(noColon)}\\s*:?\\s*`,
    'i',
  );
  return template.replace(pattern, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Template engine ────────────────────────────────────────────────────────

type TemplateVars = ReturnType<typeof buildTemplateVars>;

function buildTemplateVars(p: ProjectionRow) {
  const ownerName = p.prospect_full_legal || p.prospect_name || '';
  const propertyAddress = `${p.property_address}${p.property_city ? `, ${p.property_city}` : ''}`;
  return {
    ownerName,
    propertyAddress,
    propertyType: p.property_type || 'House',
    mgmtPct: fmtPct(p.mgmt_fee_pct),
    deposit: fmtMoney(p.initial_deposit),
    minBalance: fmtMoney(p.min_account_balance),
    minDays: `${p.min_availability_days} days`,
    saleDays: `${p.sale_notification_days} days`,
    repFee: fmtMoney(p.reputation_fee),
    termStartShort: p.term_start ? formatDateShort(p.term_start) : null,
    termEndShort: p.term_end ? formatDateShort(p.term_end) : null,
    termStartLong: p.term_start ? formatDateNarrative(p.term_start) : null,
    termEndLong: p.term_end ? formatDateNarrative(p.term_end) : null,
  };
}

/** Interpolate a template into a plain string (for KV values + previews). */
function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = (vars as unknown as Record<string, string | null | undefined>)[key];
    if (v == null || v === '') return '—';
    return v;
  });
}

/** Render a template as React, swapping {{var}} placeholders for JSX nodes. */
function renderTemplate(template: string, vars: TemplateVars): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push(template.slice(lastIndex, match.index));
    }
    const varName = match[1];
    const value = (vars as unknown as Record<string, string | null | undefined>)[varName];
    parts.push(<TemplateVar key={`v-${keyCounter++}`} name={varName} value={value ?? null} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < template.length) parts.push(template.slice(lastIndex));
  return parts;
}

/** Render a single template variable. Date variables that are null render
 *  as a fillable underline; everything else gets the dotted-underline Term
 *  treatment. Keeps the rt-c-blank / rt-c-term semantics from the original
 *  ContractDocument. */
function TemplateVar({ name, value }: { name: string; value: string | null }) {
  const isDate = name.startsWith('term');
  if (value == null) {
    if (isDate) return <span className="rt-c-blank" aria-label="date blank" />;
    return <Term>—</Term>;
  }
  return <Term>{value}</Term>;
}

// ─── Small shared subcomponents ─────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="rt-c-section">
      <span className="rt-c-section-mark" aria-hidden="true">▸</span>
      {title}
    </h2>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="rt-c-term">{children}</span>;
}

function SignerBlock({
  eyebrow,
  printedName,
  signedName,
  dateValue,
}: {
  eyebrow: string;
  printedName: string;
  signedName: string | null;
  dateValue: string | null;
}) {
  return (
    <div className="rt-c-signer">
      <div className="rt-c-signer-eyebrow">{eyebrow}</div>
      <div className="rt-c-signer-field">
        <div className="rt-c-signer-line">{printedName}</div>
        <div className="rt-c-signer-cap">Printed Name</div>
      </div>
      <div className="rt-c-signer-field">
        <div className="rt-c-signer-line">
          {signedName ? <span className="rt-c-signer-signed">{signedName}</span> : null}
        </div>
        <div className="rt-c-signer-cap">Signature</div>
      </div>
      <div className="rt-c-signer-field">
        <div className="rt-c-signer-line rt-c-signer-line-mono">{dateValue || ''}</div>
        <div className="rt-c-signer-cap">Date</div>
      </div>
    </div>
  );
}

function DocFooter({ pageNum }: { pageNum: number }) {
  return (
    <footer className="rt-c-foot">
      <span>Rising Tide &middot; Management Contract &middot; risingtidestr.com</span>
      <span>{pageNum}</span>
    </footer>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}
function formatDateNarrative(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// Suppress an unused-import warning for ContractSectionContent (carried for typing only).
type _Unused = ContractSectionContent;

// ─── CSS ────────────────────────────────────────────────────────────────────
const contractCss = `
  @page { size: 8.5in 11in; margin: 0; }

  html, body { background: var(--ink); margin: 0; padding: 0; }

  .rt-doc {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 24px 0;
    background: #0e1a1f;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-doc-page {
    position: relative;
    width: 816px;
    height: 1056px;
    background: var(--paper);
    color: var(--ink);
    padding: 72px 80px 56px;
    box-sizing: border-box;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
  }
  @media print {
    html, body { background: var(--paper); }
    .rt-doc { gap: 0; padding: 0; background: var(--paper); display: block; }
    .rt-doc-page { box-shadow: none; page-break-after: always; break-after: page; }
    .rt-doc-page:last-child { page-break-after: auto; break-after: auto; }
    .rt-c-signing-slot { display: none !important; }
  }

  /* Cover */
  .rt-cover {
    background: var(--ink);
    color: var(--paper);
    padding: 96px 80px 60px;
    justify-content: space-between;
  }
  .rt-cover-inner { display: flex; flex-direction: column; }
  .rt-cover-eyebrow {
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--paper-3);
    font-weight: 500;
  }
  .rt-cover-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 64px;
    line-height: 1;
    font-weight: 300;
    color: var(--paper);
    letter-spacing: -0.03em;
    margin: 14px 0 0;
  }
  .rt-cover-rule { width: 64px; height: 2px; background: var(--signal); margin-top: 32px; }
  .rt-cover-tag {
    margin-top: 28px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 18px;
    line-height: 1.5;
    color: var(--paper);
    font-weight: 300;
    max-width: 540px;
  }
  .rt-cover-foot { font-size: 13px; line-height: 1.6; color: var(--paper); }
  .rt-cover-foot-row {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--paper-3);
  }
  .rt-cover-foot-row:last-of-type { border-bottom: 1px solid var(--paper-3); }
  .rt-cover-foot-row span:first-child {
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--paper-3);
    font-weight: 500;
  }
  .rt-cover-foot-q { margin-top: 16px; font-size: 11px; color: var(--paper-3); font-style: italic; }

  .rt-c-section {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 16px;
    font-weight: 500;
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 22px 0 10px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 6px;
  }
  .rt-c-section:first-child { margin-top: 0; }
  .rt-c-section-mark { color: var(--signal); font-size: 12px; }

  .rt-c-body {
    margin: 0 0 12px;
    padding-left: 24px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink);
    max-width: 684px;
  }

  .rt-c-blank {
    display: inline-block;
    width: 130px;
    border-bottom: 1px solid var(--ink-3);
    height: 1em;
    vertical-align: text-bottom;
    margin: 0 2px;
  }

  .rt-c-bullets {
    margin: 0 0 12px;
    padding-left: 42px;
    list-style: disc;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink);
    max-width: 702px;
  }
  .rt-c-bullets li { padding: 3px 0; }
  .rt-c-bullets li::marker { color: var(--signal); }
  .rt-c-bullets ul {
    margin: 4px 0 0;
    padding-left: 24px;
    list-style: circle;
  }
  .rt-c-bullets ul li { padding: 2px 0; }

  /* Legacy Rider clauses (for projections that pre-date the overrides infra). */
  .rt-c-clause {
    margin: 0 0 18px;
    padding: 12px 16px 6px;
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
  }
  .rt-c-clause-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .rt-c-clause .rt-c-body { margin-bottom: 6px; }
  .rt-c-clause .rt-c-body:last-child { margin-bottom: 0; }

  .rt-c-kv { display: grid; grid-template-columns: 1fr; gap: 6px; margin: 0 0 16px; }
  .rt-c-kv > div { display: grid; grid-template-columns: 180px 1fr; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--rule); font-size: 12px; color: var(--ink); }
  .rt-c-kv > div span:first-child { font-weight: 500; }

  .rt-c-term {
    font-weight: 500;
    color: var(--ink);
    border-bottom: 1px dotted var(--signal);
    padding: 0 1px 1px;
    white-space: nowrap;
  }

  .rt-c-sig-page { padding-top: 96px; }
  .rt-c-sig-lede {
    margin: 14px 0 56px;
    font-size: 12px;
    line-height: 1.65;
    color: var(--ink-3);
    max-width: 620px;
    font-style: italic;
    text-indent: 0;
  }

  .rt-c-sig-grid {
    margin-top: 8px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 64px;
  }
  .rt-c-signer { display: flex; flex-direction: column; gap: 32px; }
  .rt-c-signer-eyebrow {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .rt-c-signer-field { display: flex; flex-direction: column; }
  .rt-c-signer-line {
    border-bottom: 1px solid var(--ink);
    height: 40px;
    display: flex;
    align-items: flex-end;
    padding: 0 2px 6px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    color: var(--ink);
    font-weight: 400;
    line-height: 1;
  }
  .rt-c-signer-line-mono {
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 13px;
  }
  .rt-c-signer-signed {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 24px;
    color: var(--signal);
    line-height: 1;
    font-weight: 400;
  }
  .rt-c-signer-cap {
    margin-top: 8px;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-c-audit {
    margin-top: 14px;
    padding: 10px 14px;
    border-left: 3px solid var(--signal);
    background: var(--paper-2);
    font-size: 10px;
    line-height: 1.5;
    color: var(--ink-3);
    font-style: italic;
  }
  .rt-c-audit strong { color: var(--ink); font-style: normal; }

  .rt-c-thanks {
    margin: 28px 0 0;
    text-align: center;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink);
    padding: 18px;
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
  }

  .rt-c-foot {
    margin-top: auto;
    padding-top: 18px;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    border-top: 1px solid var(--rule);
  }

  .rt-c-signing-slot {
    width: 816px;
    background: var(--paper);
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  }
`;
