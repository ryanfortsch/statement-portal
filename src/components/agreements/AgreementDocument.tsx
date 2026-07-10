import type { GuestAgreementRow } from '@/lib/agreement-types';
import {
  AGREEMENT_HOST_EMAIL,
  AGREEMENT_HOST_NAME,
  AGREEMENT_HOST_ORG,
  AGREEMENT_HOST_PHONE,
  SCA_AFFILIATION_LINE,
  agreementHeading,
  agreementIntro,
  agreementSubheading,
  buildAgreementSections,
  fmtAgreementDate,
} from '@/lib/agreement-base';

/**
 * Stay Cape Ann guest rental agreement — print-ready document renderer.
 *
 * The guest-facing sibling of ContractDocument (the owner management
 * contract). Same editorial system (Fraunces + Inter on paper/ink), but
 * branded Stay Cape Ann with the Rising Tide affiliation line up top so
 * guests always see who actually bills them. Unlike the owner contract's
 * fixed page tree, sections come from buildAgreementSections() — a
 * per-agreement list numbered at render time, so conditional sections
 * (deposit, utilities, mid-term protections, custom clauses) never leave
 * numbering gaps.
 *
 * Renders in three contexts:
 *   - public signing page /agreement/<token> (signingForm slot filled)
 *   - internal preview /guests/agreements/<id>/doc
 *   - Puppeteer PDF render (print media; form hidden, signatures shown)
 */
export function AgreementDocument({
  agreement,
  signingForm,
}: {
  agreement: GuestAgreementRow;
  signingForm?: React.ReactNode;
}) {
  const a = agreement;
  const sections = buildAgreementSections(a);
  const heading = agreementHeading(a);
  const subheading = agreementSubheading(a);

  const issuedDate = new Date(a.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  const guestSignedDate = a.guest_signed_at
    ? new Date(a.guest_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const pmSignedDate = a.countersigned_at
    ? new Date(a.countersigned_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <>
      <style>{agreementCss}</style>
      <div className="sca-doc">
        <section className="sca-sheet">
          {/* Masthead — wordmark row + document title + affiliation */}
          <header className="sca-mast">
            <div className="sca-mast-brand">
              <span className="sca-wordmark">Stay Cape Ann</span>
              <span className="sca-mast-org">by Rising Tide</span>
            </div>
            <h1 className="sca-h1">Rental Agreement</h1>
            <div className="sca-rule" />
            <div className="sca-property">
              <div className="sca-property-address">{a.property_address}</div>
              <div className="sca-property-city">{a.property_city}</div>
            </div>
            <div className="sca-meta">
              <div className="sca-meta-row"><span>Guest</span><span>{a.guest_name}</span></div>
              <div className="sca-meta-row">
                <span>Stay</span>
                <span>{fmtAgreementDate(a.stay_start)} &ndash; {fmtAgreementDate(a.stay_end)}</span>
              </div>
              <div className="sca-meta-row"><span>Issued</span><span>{issuedDate}</span></div>
            </div>
            <p className="sca-affiliation">{SCA_AFFILIATION_LINE}</p>
          </header>

          {/* Agreement heading + parties lead-in */}
          <div className="sca-doc-head">
            <h2 className="sca-doc-type">{heading}</h2>
            {subheading && <div className="sca-doc-sub">{subheading}</div>}
            <p className="sca-intro">{agreementIntro(a)}</p>
          </div>

          {/* Numbered sections */}
          {sections.map((section, idx) => (
            <div key={section.id} className="sca-section">
              <h3 className="sca-section-title">
                <span className="sca-section-num">{idx + 1}.</span> {section.title}
              </h3>
              {section.blocks.map((block, bi) =>
                block.type === 'paragraph' ? (
                  <p key={bi} className="sca-body">{block.text}</p>
                ) : (
                  <ul key={bi} className="sca-bullets">
                    {block.items.map((item, ii) => (
                      <li key={ii}>{item}</li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          ))}

          {/* Parties */}
          <div className="sca-parties">
            <h3 className="sca-section-title sca-parties-title">Parties</h3>
            <div className="sca-parties-grid">
              <div>
                <div className="sca-party-eyebrow">Guest</div>
                <div className="sca-party-name">{a.guest_name}</div>
                {(a.guest_email || a.guest_phone) && (
                  <div className="sca-party-contact">
                    {[a.guest_email, a.guest_phone].filter(Boolean).join(' | ')}
                  </div>
                )}
              </div>
              <div>
                <div className="sca-party-eyebrow">Property Manager</div>
                <div className="sca-party-name">{AGREEMENT_HOST_NAME}</div>
                <div className="sca-party-contact">
                  {AGREEMENT_HOST_ORG} (Stay Cape Ann)<br />
                  {AGREEMENT_HOST_EMAIL} | {AGREEMENT_HOST_PHONE}
                </div>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="sca-sig">
            <h3 className="sca-section-title sca-parties-title">Acknowledgment &amp; Agreement</h3>
            <p className="sca-sig-lede">
              By signing below, both parties acknowledge that they have read, understood, and agree to abide by
              all terms and conditions outlined in this Agreement.
            </p>
            {/* On screen pre-signature (public route), the typed-name form
                replaces the empty grid. The blank grid still renders as a
                print-only fallback so a paper printout of an unsigned
                agreement has real signature lines instead of a web form. */}
            {signingForm && !a.guest_signed_name && (
              <div className="sca-sig-action sca-screen-only">{signingForm}</div>
            )}
            <div className={`sca-sig-grid${signingForm && !a.guest_signed_name ? ' sca-print-only' : ''}`}>
              <SignerBlock
                eyebrow="Guest"
                printedName={a.guest_name}
                signedName={a.guest_signed_name}
                dateValue={guestSignedDate}
              />
              <SignerBlock
                eyebrow="Property Manager"
                printedName={`${AGREEMENT_HOST_NAME}, ${AGREEMENT_HOST_ORG}`}
                signedName={a.countersigned_at ? AGREEMENT_HOST_NAME : null}
                dateValue={pmSignedDate}
              />
            </div>
            {a.guest_signed_name && a.guest_signed_at && (
              <div className="sca-audit">
                Electronically signed by <strong>{a.guest_signed_name}</strong> on{' '}
                {new Date(a.guest_signed_at).toLocaleString('en-US', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                  timeZone: 'America/New_York',
                })}
                .
                {a.countersigned_at && (
                  <>
                    {' '}Countersigned by <strong>{AGREEMENT_HOST_NAME}</strong> on{' '}
                    {new Date(a.countersigned_at).toLocaleString('en-US', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                      timeZone: 'America/New_York',
                    })}
                    .
                  </>
                )}
              </div>
            )}
          </div>

          <footer className="sca-foot">
            <span>Stay Cape Ann &middot; a Rising Tide Property Management brand &middot; staycapeann.com</span>
          </footer>
        </section>

        {/* Certificate of Completion — audit-trail page, appended once the
            guest has signed (mirrors the management contract's). */}
        {a.guest_signed_at && (
          <section className="sca-sheet sca-cert">
            <div className="sca-cert-eyebrow">Audit Trail</div>
            <h2 className="sca-cert-h">Certificate of Completion</h2>
            <p className="sca-cert-lede">
              This certificate documents the electronic execution of the rental agreement under the federal
              ESIGN Act (15 U.S.C. &sect;&nbsp;7001 et seq.) and the Massachusetts Uniform Electronic
              Transactions Act (Mass. Gen. Laws ch.&nbsp;110G).
            </p>

            <div className="sca-cert-block">
              <div className="sca-cert-block-title">Document</div>
              <div className="sca-cert-kv">
                <div className="sca-cert-k">Title</div>
                <div className="sca-cert-v">Rental Agreement &mdash; {a.property_address}, {a.property_city}</div>
                <div className="sca-cert-k">Document ID</div>
                <div className="sca-cert-v sca-cert-mono">{a.id}</div>
                <div className="sca-cert-k">Guest</div>
                <div className="sca-cert-v">{a.guest_name}</div>
              </div>
            </div>

            <div className="sca-cert-block">
              <div className="sca-cert-block-title">Signature Events</div>
              <div className="sca-cert-event">
                <div className="sca-cert-event-head">
                  <span className="sca-cert-event-num">01</span>
                  <span className="sca-cert-event-label">Guest signed</span>
                </div>
                <div className="sca-cert-kv">
                  <div className="sca-cert-k">Signed by</div>
                  <div className="sca-cert-v"><strong>{a.guest_signed_name}</strong> (typed signature)</div>
                  <div className="sca-cert-k">Timestamp</div>
                  <div className="sca-cert-v">
                    {new Date(a.guest_signed_at).toLocaleString('en-US', {
                      dateStyle: 'full',
                      timeStyle: 'long',
                      timeZone: 'America/New_York',
                    })}
                  </div>
                  {a.guest_signed_ip && (
                    <>
                      <div className="sca-cert-k">IP address</div>
                      <div className="sca-cert-v sca-cert-mono">{a.guest_signed_ip}</div>
                    </>
                  )}
                  {a.guest_signed_user_agent && (
                    <>
                      <div className="sca-cert-k">Device</div>
                      <div className="sca-cert-v">{parseUserAgent(a.guest_signed_user_agent)}</div>
                    </>
                  )}
                </div>
              </div>
              {a.countersigned_at && (
                <div className="sca-cert-event">
                  <div className="sca-cert-event-head">
                    <span className="sca-cert-event-num">02</span>
                    <span className="sca-cert-event-label">Property Manager countersigned</span>
                  </div>
                  <div className="sca-cert-kv">
                    <div className="sca-cert-k">Signed by</div>
                    <div className="sca-cert-v"><strong>{AGREEMENT_HOST_NAME}</strong>, {AGREEMENT_HOST_ORG}</div>
                    <div className="sca-cert-k">Timestamp</div>
                    <div className="sca-cert-v">
                      {new Date(a.countersigned_at).toLocaleString('en-US', {
                        dateStyle: 'full',
                        timeStyle: 'long',
                        timeZone: 'America/New_York',
                      })}
                    </div>
                    <div className="sca-cert-k">Source</div>
                    <div className="sca-cert-v">Rising Tide STR (authenticated session)</div>
                  </div>
                </div>
              )}
            </div>

            <p className="sca-cert-foot">
              Certificate generated by Rising Tide STR, operator of the Stay Cape Ann brand. The full audit
              record (signature events, IP, user-agent) is retained in Rising Tide&rsquo;s system of record.
              This page travels with the agreement PDF as proof of execution.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

/** Best-effort "Browser on OS" for the audit certificate. */
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
    <div className="sca-signer">
      <div className="sca-signer-eyebrow">{eyebrow}</div>
      <div className="sca-signer-field">
        <div className="sca-signer-line">{printedName}</div>
        <div className="sca-signer-cap">Printed Name</div>
      </div>
      <div className="sca-signer-field">
        <div className="sca-signer-line">
          {signedName ? <span className="sca-signer-signed">{signedName}</span> : null}
        </div>
        <div className="sca-signer-cap">Signature</div>
      </div>
      <div className="sca-signer-field">
        <div className="sca-signer-line sca-signer-line-mono">{dateValue || ''}</div>
        <div className="sca-signer-cap">Date</div>
      </div>
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const agreementCss = `
  @page { size: 8.5in 11in; margin: 0; }

  html, body { background: #0e1a1f; margin: 0; padding: 0; }

  .sca-doc {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 24px 0 48px;
    background: #0e1a1f;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .sca-sheet {
    position: relative;
    width: 816px;
    min-height: 1056px;
    background: var(--paper);
    color: var(--ink);
    padding: 64px 80px 56px;
    box-sizing: border-box;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
  }

  @media print {
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body { background: var(--paper); }
    .sca-doc { gap: 0; padding: 0; background: var(--paper); display: block; }
    /* The single content sheet dissolves into a paginated flow; its
       padding repeats on every printed page via box-decoration-break
       (same mechanism as the management contract's body wrapper). */
    .sca-sheet {
      width: auto;
      min-height: 0;
      box-shadow: none;
      display: block;
      padding: 56px 80px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .sca-section { break-inside: avoid-page; page-break-inside: avoid; }
    .sca-section-title { break-after: avoid; page-break-after: avoid; }
    .sca-sig, .sca-parties { break-inside: avoid; page-break-inside: avoid; }
    .sca-cert {
      page-break-before: always;
      break-before: page;
    }
  }

  /* Masthead */
  .sca-mast { margin-bottom: 36px; }
  .sca-mast-brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--ink);
  }
  .sca-wordmark {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .sca-mast-org {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .sca-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 52px;
    line-height: 1.02;
    font-weight: 300;
    letter-spacing: -0.03em;
    color: var(--ink);
    margin: 34px 0 0;
  }
  .sca-rule { width: 64px; height: 2px; background: var(--signal); margin: 24px 0; }
  .sca-property-address {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    font-weight: 400;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  .sca-property-city { font-size: 13px; color: var(--ink-3); margin-top: 3px; }
  .sca-meta { margin-top: 20px; }
  .sca-meta-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 12px;
    padding: 7px 0;
    border-top: 1px solid var(--rule);
    font-size: 12.5px;
    color: var(--ink);
  }
  .sca-meta-row:last-of-type { border-bottom: 1px solid var(--rule); }
  .sca-meta-row span:first-child {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    padding-top: 2px;
  }
  .sca-affiliation {
    margin: 18px 0 0;
    font-size: 10.5px;
    line-height: 1.6;
    color: var(--ink-3);
    font-style: italic;
    max-width: 620px;
  }

  /* Document heading + intro */
  .sca-doc-head { margin-bottom: 26px; }
  .sca-doc-type {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 17px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink);
    margin: 0;
  }
  .sca-doc-sub {
    margin-top: 4px;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .sca-intro {
    margin: 14px 0 0;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--ink);
    max-width: 656px;
  }

  /* Sections */
  .sca-section { margin-bottom: 18px; }
  .sca-section-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
    margin: 0 0 7px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 5px;
  }
  .sca-section-num { color: var(--signal); font-weight: 600; }
  .sca-body {
    margin: 0 0 8px;
    padding-left: 22px;
    font-size: 11px;
    line-height: 1.62;
    color: var(--ink);
    max-width: 672px;
  }
  .sca-body:last-child { margin-bottom: 0; }
  .sca-bullets {
    margin: 0 0 8px;
    padding-left: 42px;
    list-style: disc;
    font-size: 11px;
    line-height: 1.62;
    color: var(--ink);
    max-width: 672px;
  }
  .sca-bullets li { padding: 2px 0; }
  .sca-bullets li::marker { color: var(--signal); }

  /* Parties */
  .sca-parties { margin-top: 30px; }
  .sca-parties-title { border-bottom: 1px solid var(--ink); }
  .sca-parties-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    margin-top: 12px;
  }
  .sca-party-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .sca-party-name { font-size: 13px; font-weight: 600; color: var(--ink); }
  .sca-party-contact { margin-top: 3px; font-size: 11px; line-height: 1.55; color: var(--ink-3); }

  /* Signatures */
  .sca-sig { margin-top: 30px; }
  .sca-sig-lede {
    margin: 10px 0 34px;
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--ink-3);
    font-style: italic;
    max-width: 620px;
  }
  .sca-sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 56px;
  }
  .sca-sig-action { margin-top: 4px; }
  .sca-sig-action .sca-sign-form { padding: 0; background: transparent; }
  .sca-signer { display: flex; flex-direction: column; gap: 26px; }
  .sca-signer-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .sca-signer-field { display: flex; flex-direction: column; }
  .sca-signer-line {
    border-bottom: 1px solid var(--ink);
    height: 38px;
    display: flex;
    align-items: flex-end;
    padding: 0 2px 6px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    color: var(--ink);
    line-height: 1;
  }
  .sca-signer-line-mono { font-family: var(--font-inter), system-ui, sans-serif; font-size: 12px; }
  .sca-signer-signed {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 23px;
    color: var(--signal);
    line-height: 1;
  }
  .sca-signer-cap {
    margin-top: 7px;
    font-size: 9.5px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .sca-audit {
    margin-top: 22px;
    padding: 10px 14px;
    border-left: 3px solid var(--signal);
    background: var(--paper-2);
    font-size: 10px;
    line-height: 1.55;
    color: var(--ink-3);
    font-style: italic;
    max-width: 620px;
  }
  .sca-audit strong { color: var(--ink); font-style: normal; }

  .sca-foot {
    margin-top: auto;
    padding-top: 22px;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    border-top: 1px solid var(--rule);
  }
  /* Screen/print swap for the signing form vs blank signature grid. */
  .sca-print-only { display: none; }
  @media print {
    .sca-foot { display: none !important; }
    .sca-screen-only { display: none !important; }
    .sca-sig-grid.sca-print-only { display: grid !important; }
  }

  /* Certificate */
  .sca-cert { display: block; padding: 96px 80px 80px; }
  .sca-cert-eyebrow {
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 12px;
  }
  .sca-cert-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 28px;
    line-height: 1.15;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.01em;
    margin: 0 0 18px;
  }
  .sca-cert-lede { margin: 0 0 32px; font-size: 12px; line-height: 1.65; color: var(--ink-3); max-width: 560px; }
  .sca-cert-block {
    margin-bottom: 28px;
    padding: 18px 20px;
    background: var(--paper-2);
    border-left: 3px solid var(--rule);
  }
  .sca-cert-block-title {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    font-weight: 700;
    margin-bottom: 14px;
  }
  .sca-cert-kv { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; font-size: 12px; line-height: 1.55; }
  .sca-cert-k { color: var(--ink-3); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; padding-top: 2px; }
  .sca-cert-v { color: var(--ink); }
  .sca-cert-mono { font-family: var(--font-mono), monospace; font-size: 11px; }
  .sca-cert-event { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rule); }
  .sca-cert-event:first-of-type { margin-top: 0; padding-top: 0; border-top: none; }
  .sca-cert-event-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
  .sca-cert-event-num { font-family: var(--font-mono), monospace; font-size: 10px; color: var(--ink-4); letter-spacing: 0.1em; }
  .sca-cert-event-label { font-size: 12px; font-weight: 600; color: var(--ink); }
  .sca-cert-foot { margin-top: 28px; font-size: 11px; line-height: 1.6; color: var(--ink-3); max-width: 560px; }
`;
