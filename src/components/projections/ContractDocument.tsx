import type { ProjectionRow } from '@/lib/projections-types';
import {
  CONTRACT_BASE,
  type ContractClause,
  type ContractKv,
  type ContractPage,
  type ContractSection,
  type ContractSectionContent,
} from '@/lib/contract-base';
import {
  applyContractOverrides,
  describeOverrideFailure,
  type ContractOverride,
} from '@/lib/contract-overrides';

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
  // Fail-soft apply: failures are collected per-override; the successful
  // ones still land. console.error captures the failures in Vercel logs
  // so staff can diagnose; the visible banner below alerts them inline.
  const { pages, failures } = applyContractOverrides(overrides, CONTRACT_BASE);
  if (failures.length > 0) {
    console.error(
      `[ContractDocument] ${failures.length} of ${overrides.length} override(s) failed to apply on projection ${projection.id}:`,
      failures.map((f) => describeOverrideFailure(f)),
    );
  }

  const vars = buildTemplateVars(projection);
  const ownerName = vars.ownerName;
  // Pinned to America/New_York — server renders in UTC on Vercel, and
  // a late-night save would otherwise roll the "issued" date forward
  // by a day for Eastern-tz users.
  const issuedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  // Signature state. The DATE field next to each signature is the date
  // that party SIGNED — not the contract's effective term_start date.
  // Standard e-signature convention: date next to signature = moment
  // the signer executed. (term_start lives in the Term section body.)
  const signedName = projection.contract_signed_name || null;
  const signedAt = projection.contract_signed_at;
  const ownerSignedDate = signedAt
    ? new Date(signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  // Countersignature (Allie). The PM signature row renders her name
  // only after she has explicitly countersigned from the projection
  // detail page. PM signature date = countersign moment.
  const countersignedAt = projection.contract_countersigned_at;
  const pmSignedName = countersignedAt ? "Allie O'Brien" : null;
  const pmSignedDate = countersignedAt
    ? new Date(countersignedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

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
        {/* Failure banner — screen-only (.rt-c-skipped is display:none
            inside @media print so the printed contract stays clean).
            Surfaces silently-failing overrides to staff so they can
            diagnose; without this, a misaligned modify find string
            silently fails and the rendered text matches the base
            contract, looking exactly like nothing was applied. */}
        {failures.length > 0 && (
          <div className="rt-c-skipped">
            <div className="rt-c-skipped-head">
              <strong>
                {failures.length} of {overrides.length} redline edit{overrides.length === 1 ? '' : 's'} couldn&rsquo;t apply
              </strong>
              <span>The remaining {overrides.length - failures.length} edit{overrides.length - failures.length === 1 ? '' : 's'} did land. Common cause: the modify&rsquo;s find span doesn&rsquo;t match the current clause text (e.g. punctuation drift, or an earlier edit already changed that span). Re-run the interpreter for the affected edits.</span>
            </div>
            <ul className="rt-c-skipped-list">
              {failures.map((f, i) => (
                <li key={i}>{describeOverrideFailure(f)}</li>
              ))}
            </ul>
          </div>
        )}

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

        {/* Body pages wrapper. In print, .rt-doc-page wrappers inside
            this div use display:contents to dissolve into a flat
            section flow, and .rt-doc-body carries the 56px/80px
            padding so body content has a consistent margin on every
            printed sheet (we can't use @page margin because that
            forced a paper strip on the cover). On screen, .rt-doc-body
            is just a passthrough — each .rt-doc-page still renders
            as a discrete sheet. */}
        <div className="rt-doc-body">
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
        </div>

        {/* Signatures — own page, gives the block room to breathe.
            When the owner hasn't yet signed AND a signing form is
            available (public route), the form renders IN PLACE of
            the empty signature grid. Showing empty PRINTED-NAME /
            SIGNATURE / DATE rows alongside a separate "Ready to sign"
            box below was confusing — it looked like the contract was
            already prepared for someone else's signature. After
            submit, the grid renders with the typed signature. */}
        <section className="rt-doc-page rt-c-sig-page">
          <SectionTitle title="Signatures" />
          <p className="rt-c-sig-lede">
            By signing below, the Parties acknowledge that they have read, understood, and agree to be bound by the terms of this Management Contract.
          </p>
          {signingForm && !signedName ? (
            <div className="rt-c-sig-action">{signingForm}</div>
          ) : (
            <div className="rt-c-sig-grid">
              <SignerBlock
                eyebrow="Owner"
                printedName={ownerName}
                signedName={signedName}
                dateValue={ownerSignedDate}
              />
              <SignerBlock
                eyebrow="Property Manager"
                printedName="Allie O'Brien, Rising Tide STR, LLC"
                signedName={pmSignedName}
                dateValue={pmSignedDate}
              />
            </div>
          )}
          {signedName && signedAt && (
            <div className="rt-c-audit">
              Electronically signed by <strong>{signedName}</strong> on{' '}
              {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' })}.
              {/* IP + user-agent are persisted to contract_signed_ip and
                  contract_signed_user_agent for the legal audit trail
                  but kept off the visible document face — standard e-sign
                  convention puts those on a separate Certificate of
                  Completion, not the contract itself. */}
              {countersignedAt && (
                <>
                  {' '}Countersigned by <strong>Allie O&rsquo;Brien</strong> on{' '}
                  {new Date(countersignedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' })}.
                </>
              )}
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

        {/* Certificate of Completion — appended after the contract once
            the owner has signed. This is the audit trail page that
            travels with the executed PDF (modeled on DocuSign's
            Certificate of Completion). Records every signature event
            with timestamp, IP, and a parsed user-agent so the executed
            PDF is self-contained as legal proof. Hidden until signed
            so unsigned previews don't show empty audit data. */}
        {signedAt && (
          <section className="rt-doc-page rt-c-cert-page">
            <div className="rt-c-cert-eyebrow">Audit Trail</div>
            <h2 className="rt-c-cert-h">Certificate of Completion</h2>
            <p className="rt-c-cert-lede">
              This certificate documents the electronic execution of the management contract under the federal ESIGN Act (15 U.S.C. &sect;&nbsp;7001 et seq.) and the Massachusetts Uniform Electronic Transactions Act (Mass. Gen. Laws ch.&nbsp;110G).
            </p>

            <div className="rt-c-cert-block">
              <div className="rt-c-cert-block-title">Document</div>
              <div className="rt-c-cert-kv">
                <div className="rt-c-cert-k">Title</div>
                <div className="rt-c-cert-v">Management Contract &mdash; {projection.property_address}</div>
                <div className="rt-c-cert-k">Document ID</div>
                <div className="rt-c-cert-v rt-c-cert-mono">{projection.id}</div>
                <div className="rt-c-cert-k">Owner</div>
                <div className="rt-c-cert-v">{ownerName}</div>
              </div>
            </div>

            <div className="rt-c-cert-block">
              <div className="rt-c-cert-block-title">Signature Events</div>

              {/* Owner */}
              <div className="rt-c-cert-event">
                <div className="rt-c-cert-event-head">
                  <span className="rt-c-cert-event-num">01</span>
                  <span className="rt-c-cert-event-label">Owner signed</span>
                </div>
                <div className="rt-c-cert-kv">
                  <div className="rt-c-cert-k">Signed by</div>
                  <div className="rt-c-cert-v"><strong>{signedName}</strong> (typed signature)</div>
                  <div className="rt-c-cert-k">Timestamp</div>
                  <div className="rt-c-cert-v">{new Date(signedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: 'America/New_York' })}</div>
                  {projection.contract_signed_ip && (
                    <>
                      <div className="rt-c-cert-k">IP address</div>
                      <div className="rt-c-cert-v rt-c-cert-mono">{projection.contract_signed_ip}</div>
                    </>
                  )}
                  {projection.contract_signed_user_agent && (
                    <>
                      <div className="rt-c-cert-k">Device</div>
                      <div className="rt-c-cert-v">{parseUserAgent(projection.contract_signed_user_agent)}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Property Manager countersign */}
              {countersignedAt && (
                <div className="rt-c-cert-event">
                  <div className="rt-c-cert-event-head">
                    <span className="rt-c-cert-event-num">02</span>
                    <span className="rt-c-cert-event-label">Property Manager countersigned</span>
                  </div>
                  <div className="rt-c-cert-kv">
                    <div className="rt-c-cert-k">Signed by</div>
                    <div className="rt-c-cert-v"><strong>Allie O&rsquo;Brien</strong>, Rising Tide STR, LLC</div>
                    <div className="rt-c-cert-k">Timestamp</div>
                    <div className="rt-c-cert-v">{new Date(countersignedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: 'America/New_York' })}</div>
                    <div className="rt-c-cert-k">Source</div>
                    <div className="rt-c-cert-v">Helm (staff-authenticated)</div>
                  </div>
                </div>
              )}
            </div>

            <p className="rt-c-cert-foot">
              Certificate generated by Helm. The full audit record (signature events, IP, user-agent, document hash) is retained in Rising Tide&rsquo;s system of record at{' '}
              <span className="rt-c-cert-mono">risingtidestr.com</span>. This page travels with the contract PDF as proof of execution.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

/**
 * Best-effort parse of a User-Agent header into a human-readable
 * "Browser on OS" string for the audit certificate. We don't need
 * pixel-perfect detection — the goal is "looked like Chrome on macOS"
 * for the audit log, not feature-detection.
 */
function parseUserAgent(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' :
    'Browser';
  const os =
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Macintosh|Mac OS X/.test(ua) ? 'macOS' :
    /Windows/.test(ua) ? 'Windows' :
    /Linux/.test(ua) ? 'Linux' :
    'unknown OS';
  return `${browser} on ${os}`;
}

// ─── Renderers ──────────────────────────────────────────────────────────────

function SectionRenderer({ section, vars }: { section: ContractSection; vars: TemplateVars }) {
  const hasKv = section.content.some((c) => c.type === 'kv');
  const bullets = section.content.filter((c) => c.type === 'bullet') as ContractClause[];
  const paragraphs = section.content.filter((c) => c.type === 'paragraph') as ContractClause[];

  // Wrap each section in a .rt-c-section-wrap div so the print engine
  // tries to keep a section's title + body together (break-inside:avoid).
  // Sections that exceed a printed page still split naturally — this is
  // a soft preference, not a hard rule.
  return (
    <div className="rt-c-section-wrap">
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
    </div>
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
 * the label with or without trailing colon, with or without markdown bold
 * wrappers, case-insensitively. Cleans up every variant seen from the LLM:
 *
 *   "Owner Approval Required: body"           →  "body"
 *   "Owner Approval Required body"            →  "body"
 *   "owner approval required: body"           →  "body"
 *   "**Owner Approval Required:** body"       →  "body"
 *   "**Owner Approval Required**: body"       →  "body"
 *   "__Owner Approval Required:__ body"       →  "body"
 *   "**owner approval required** body"        →  "body"
 *
 * Why this is needed even though the prompt forbids markdown: the LLM emits
 * it anyway, especially on `add` overrides where it wants the body to look
 * like a bullet ("**Label:** body"). Renderer can't parse markdown, so the
 * asterisks render literally — combined with the schema's boldPrefix, the
 * label appears twice. Bug surfaced from the 36 Granite run on the
 * "Owner Approval Required" clause + 4 others.
 */
function stripDuplicatePrefix(template: string, normalizedLabel?: string): string {
  if (!normalizedLabel) return template;
  const noColon = normalizedLabel.replace(/:+$/, '').trim();
  if (!noColon) return template;
  // Pattern parts:
  //   ^\s*                 leading whitespace
  //   (\*\*|__)?           optional opening markdown bold marker
  //   \s*                  whitespace after marker
  //   <label>              the label text itself, case-insensitive
  //   \s*:?\s*             optional colon between label and closing marker
  //   (\*\*|__)?           optional closing markdown bold marker
  //   \s*:?\s*             optional colon AFTER closing marker (e.g. **Label**:)
  const pattern = new RegExp(
    `^\\s*(?:\\*\\*|__)?\\s*${escapeRegex(noColon)}\\s*:?\\s*(?:\\*\\*|__)?\\s*:?\\s*`,
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
  /* Page geometry. Single @page rule with margin: 0 — every sheet
     bleeds full. Per-sheet body margins come from the .rt-doc-body
     wrapper's padding combined with box-decoration-break: clone,
     which makes the wrapper's padding REPEAT on every printed
     sheet a paginated block spans (the CSS-standard mechanism for
     this; spec'd in CSS Backgrounds & Borders, supported in
     Chromium). Earlier attempts with named @page rules + the page
     property weren't reliably honored by Chromium for overflow
     sheets, leaving either the cover with a paper border or body
     overflow sheets with no margin. */
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
  /* Logical page in the contract tree (Summary+Term+Mgr Resp; Initial
     Deposit + Income; etc.). One .rt-doc-page renders identically on
     screen and in print: a fixed 816x1056 sheet with its own padding
     and footer at the bottom. The print mode adds page-break-after on
     each wrapper so the PDF mirrors the preview sheet-by-sheet. Tall
     blocks (override-expanded sections) flow naturally onto a second
     sheet without being clipped. */
  .rt-doc-page {
    position: relative;
    width: 816px;
    min-height: 1056px;
    background: var(--paper);
    color: var(--ink);
    padding: 72px 80px 56px;
    box-sizing: border-box;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
  }
  @media print {
    /* Force backgrounds to render (cover navy, override banners,
       etc.). Without this Chromium drops bg colors at print time
       even with Puppeteer's printBackground:true. */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body { background: var(--paper); }
    .rt-doc {
      gap: 0;
      padding: 0;
      background: var(--paper);
      display: block;
      align-items: initial;
    }
    /* Body pages dissolve into a continuous flow via display:contents.
       Sections become siblings of .rt-doc-body. The wrapper's
       padding + box-decoration-break:clone provides per-sheet
       margins that REPEAT on every printed sheet body content
       spans — this is the standardized CSS way to repeat box
       decorations across paginated fragments. */
    .rt-doc-body {
      padding: 56px 80px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .rt-doc-page {
      box-shadow: none;
      display: contents;
    }
    /* Cover bleeds full navy. With @page margin: 0 globally there's
       no @page margin to fight against — the element at width 8.5in
       and min-height 11in fills the sheet edge-to-edge. */
    .rt-cover {
      display: flex;
      flex-direction: column;
      width: 8.5in;
      min-height: 11in;
      box-sizing: border-box;
      padding: 96px 80px 80px;
      page-break-after: always;
      break-after: page;
    }
    /* Sig section flows naturally after body content, with
       break-inside:avoid keeping the signature block together as
       one unit. The forced page-break-before:always was producing
       a near-empty page 7 (just the tail sentence of Governing Law)
       before the sig sheet, because the body content's natural end
       sometimes overflows by a paragraph or two — forcing the
       break left that overflow stranded on its own sheet. Letting
       the sig section flow lets it share a sheet with body tail
       content when there's room, and naturally page-break when
       there isn't (via break-inside:avoid keeping it whole). */
    .rt-c-sig-page {
      display: flex;
      flex-direction: column;
      break-inside: avoid;
      page-break-inside: avoid;
      /* 40px top breathing room above SIGNATURES title; 80px on
         each side to match body wrapper horizontal padding (without
         this the sig grid extended all the way to the page edges
         and looked sloppy); 80px bottom so the thank-you box
         doesn't sit on the bottom edge. */
      padding: 40px 80px 80px;
      margin-top: 48px;
      /* The screen .rt-doc-page rule has min-height: 1056px (full
         sheet) to render the screen preview as discrete sheets. In
         print, that min-height was forcing the sig section to be at
         least one full sheet tall, which prevented it from fitting
         on the body's tail page alongside Governing Law's last
         paragraph. Override to 0 so sig sizes to its content and
         can share a sheet with body when there's room. */
      min-height: 0;
    }
    /* Small visual rhythm between sections in the continuous body
       flow. Keeps sections feeling like distinct blocks instead of
       running flush into each other. */
    .rt-c-section-wrap {
      margin-top: 28px;
    }
    .rt-c-section-wrap:first-child {
      margin-top: 0;
    }
    /* Keep section title with its first paragraph (no orphan
       titles), but allow long sections to split between paragraphs. */
    .rt-c-section {
      break-after: avoid;
      page-break-after: avoid;
    }
    .rt-c-signing-slot { display: none !important; }
    .rt-c-skipped { display: none !important; }
    /* Hide inline DocFooter — overflow-prone with the continuous
       body flow, and we couldn't keep Puppeteer's footerTemplate
       without breaking cover bleed. PDF goes without page numbers. */
    .rt-c-foot { display: none !important; }
  }

  /* Override-failure banner — staff-only, screen-only. Explicit colors
     (not CSS variables) because the contract preview page has a dark
     navy body background that flips the meaning of var(--ink) /
     var(--paper). A failure banner that's dark-on-dark is worse than
     no banner. */
  .rt-c-skipped {
    width: 816px;
    background: #fff5f1;
    border: 1px solid #c85a3a;
    border-left: 5px solid #c85a3a;
    padding: 16px 22px;
    box-sizing: border-box;
    color: #2a1810;
    font-size: 13px;
    line-height: 1.55;
  }
  .rt-c-skipped-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .rt-c-skipped-head strong { font-size: 14px; color: #c85a3a; font-weight: 700; letter-spacing: 0.01em; }
  .rt-c-skipped-head span { font-size: 12px; color: #6a4a3a; line-height: 1.55; }
  .rt-c-skipped-list {
    margin: 0;
    padding-left: 20px;
    font-family: var(--font-mono-dash, ui-monospace), Menlo, monospace;
    font-size: 11px;
    color: #2a1810;
    line-height: 1.6;
  }
  .rt-c-skipped-list li { margin-bottom: 3px; }

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
  /* Inline signing form, rendered in place of the empty signature
     grid on the public route when the owner hasn't signed yet. The
     form's own page-level chrome (its own padding + bg) is stripped
     because the sig page already provides the framing. */
  .rt-c-sig-action {
    margin-top: 16px;
  }
  .rt-c-sig-action .rt-sign-form {
    padding: 0;
    background: transparent;
  }
  .rt-c-sig-action .rt-sign-eyebrow,
  .rt-c-sig-action .rt-sign-h,
  .rt-c-sig-action .rt-sign-lead {
    /* These were the form's own headline; the contract's
       SIGNATURES section + lede already covers this ground.
       Hide them so the form starts directly at the checkbox. */
    display: none;
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

  /* Certificate of Completion — appended after signatures once the
     contract is signed. Distinct visual identity from the contract
     body so it reads as an audit document, not more contract text. */
  .rt-c-cert-page {
    padding: 96px 80px 80px;
  }
  @media print {
    .rt-c-cert-page {
      page-break-before: always;
      break-before: page;
      page: body-page;
    }
  }
  .rt-c-cert-eyebrow {
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 12px;
  }
  .rt-c-cert-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 28px;
    line-height: 1.15;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.01em;
    margin: 0 0 18px;
  }
  .rt-c-cert-lede {
    margin: 0 0 32px;
    font-size: 12px;
    line-height: 1.65;
    color: var(--ink-3);
    max-width: 560px;
  }
  .rt-c-cert-block {
    margin-bottom: 28px;
    padding: 18px 20px;
    background: var(--paper-2);
    border-left: 3px solid var(--rule);
  }
  .rt-c-cert-block-title {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    font-weight: 700;
    margin-bottom: 14px;
  }
  .rt-c-cert-kv {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 8px 16px;
    font-size: 12px;
    line-height: 1.55;
  }
  .rt-c-cert-k {
    color: var(--ink-3);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding-top: 2px;
  }
  .rt-c-cert-v {
    color: var(--ink);
  }
  .rt-c-cert-mono {
    font-family: var(--font-mono), monospace;
    font-size: 11px;
  }
  .rt-c-cert-event {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
  }
  .rt-c-cert-event:first-of-type {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  .rt-c-cert-event-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }
  .rt-c-cert-event-num {
    font-family: var(--font-mono), monospace;
    font-size: 10px;
    color: var(--ink-4);
    letter-spacing: 0.1em;
  }
  .rt-c-cert-event-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
  }
  .rt-c-cert-foot {
    margin-top: 28px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink-3);
    max-width: 560px;
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
