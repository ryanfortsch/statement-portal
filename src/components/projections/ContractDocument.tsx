import type { ProjectionRow } from '@/lib/projections-types';

/**
 * The 6-page Rising Tide management contract. Shared between the internal
 * preview at /projections/<id>/contract and the public signing flow at
 * /contract/<token>.
 *
 * - When `projection.contract_signed_at` is set, the Owner signature block
 *   renders the typed name + signed date in place of empty lines, so the
 *   downloadable PDF reflects the signature.
 * - When `signingForm` is passed (only on the public route, only if not yet
 *   signed), it renders below the contract pages. Hidden in print so the
 *   PDF is just the contract.
 */
export function ContractDocument({
  projection,
  signingForm,
}: {
  projection: ProjectionRow;
  signingForm?: React.ReactNode;
}) {
  const ownerName = projection.prospect_full_legal || projection.prospect_name;
  const today = new Date();
  const issuedDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const propertyAddress = `${projection.property_address}${projection.property_city ? `, ${projection.property_city}` : ''}`;
  const propertyType = projection.property_type || 'House';
  const mgmtPct = fmtPct(projection.mgmt_fee_pct);
  const deposit = fmtMoney(projection.initial_deposit);
  const minBalance = fmtMoney(projection.min_account_balance);
  const minDays = projection.min_availability_days;
  const saleDays = projection.sale_notification_days;
  const repFee = fmtMoney(projection.reputation_fee);
  // Term-date renderings. Empty term_start / term_end render as a fillable
  // underline, not "—", so the contract reads "...shall commence on ____".
  const termStartShort = projection.term_start ? fmtDateShort(projection.term_start) : null;
  const termEndShort = projection.term_end ? fmtDateShort(projection.term_end) : null;
  const termStartLong = projection.term_start ? fmtDateNarrative(projection.term_start) : null;
  const termEndLong = projection.term_end ? fmtDateNarrative(projection.term_end) : null;

  // Signature state. The "Date" field in the signature block is the contract's
  // effective date (term_start), not the moment the owner clicked submit.
  // Leave it blank if term_start hasn't been filled in. The actual signing
  // timestamp still appears in the audit footer below the signature block.
  const signedName = projection.contract_signed_name || null;
  const signedAt = projection.contract_signed_at;
  const effectiveDate = projection.term_start ? fmtDateNarrative(projection.term_start) : null;

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

        {/* Page 2 — summary, property, term, manager responsibilities */}
        <section className="rt-doc-page">
          <SectionTitle title="Summary" />
          <p className="rt-c-body">
            This Agreement is made and entered into on <DateOrBlank value={termStartLong} /> by and between Rising Tide STR, LLC (&ldquo;Property Manager&rdquo;), a Massachusetts Limited Liability Company, located at 3 Locust Lane, Gloucester, MA, and <Term>{ownerName}</Term> (&ldquo;Owner&rdquo;), collectively referred to as the &ldquo;Parties&rdquo;.
          </p>

          <SectionTitle title="Property Details" />
          <div className="rt-c-kv">
            <div><span>Address</span><span><Term>{propertyAddress}</Term></span></div>
            <div><span>Type</span><span><Term>{propertyType}</Term></span></div>
          </div>

          <SectionTitle title="Term" />
          <p className="rt-c-body">
            This Agreement shall commence on <DateOrBlank value={termStartShort} /> and continue until <DateOrBlank value={termEndShort} />, unless terminated earlier in accordance with the terms herein.
          </p>
          <p className="rt-c-body">
            This Agreement shall commence on <DateOrBlank value={termStartLong} /> and continue through <DateOrBlank value={termEndLong} />, unless terminated earlier in accordance with the terms herein. Upon expiration of the initial term, this Agreement shall automatically renew for successive one-year terms unless either party provides written notice of non-renewal. For calendar year 2026, such notice must be provided at least 60 days prior to the end of the then-current term; thereafter, notice must be provided at least 120 days prior to the end of the then-current term. This advance notice requirement ensures adequate lead time to close the calendar and prevent unfillable bookings.
          </p>

          <SectionTitle title="Property Manager's Responsibilities" />
          <ul className="rt-c-bullets">
            <li>Market and advertise the Property for short-term rentals.</li>
            <li>Handle booking and reservations and offer customer support to guests.</li>
            <li>Collect rental payments and deposit them into a bank account.</li>
            <li>Disburse rental income to the Owner monthly.</li>
            <li>Conduct check-in and check-out procedures.</li>
            <li>Provide cleaning and maintenance services.</li>
            <li>Supply and replenish consumables, including toiletries, paper towels, toilet paper, etc.</li>
            <li>Ensure the property is ready for rental by installing necessary items for launching the property.</li>
            <li>The Property Manager will use commercially reasonable efforts to market and rent the Property; however, the Property Manager makes no representations or warranties regarding occupancy levels or the amount of rental income that will be generated.</li>
          </ul>
          <DocFooter pageNum={2} />
        </section>

        {/* Page 3 — deposit + revenue + owner responsibilities */}
        <section className="rt-doc-page">
          <SectionTitle title="Initial Deposit" />
          <ul className="rt-c-bullets">
            <li><b>Deposit Amount:</b> The Owner agrees to deposit <Term>{deposit}</Term> into the bank account to cover initial setup costs and maintain this minimum balance for ongoing expenses.</li>
            <li>
              <b>Use of Deposit:</b> The deposit will be used for the purchase of necessary items to launch the property. Additional setup items may include:
              <ul>
                <li>Interior decor and furnishings to enhance the guest experience</li>
                <li>Basic kitchen supplies</li>
                <li>Operational necessities (i.e., smart lock)</li>
              </ul>
            </li>
            <li><b>Ownership of Purchased Items:</b> All items purchased with initial deposit will become the Owner&rsquo;s property.</li>
            <li><b>Minimum Account Balance:</b> The account must maintain a minimum balance of <Term>{minBalance}</Term> at all times. If the balance falls below <Term>{minBalance}</Term>, the Property Manager is authorized to deduct the necessary amount from the Gross Rental Income to restore the balance.</li>
          </ul>

          <SectionTitle title="Rental Income and Fees" />
          <ul className="rt-c-bullets">
            <li><b>Gross Rental Income Definition:</b> &ldquo;Gross Rental Income&rdquo; shall be defined as the total amount paid out by short-term rental platforms (e.g., Airbnb, VRBO) to Rising Tide STR, LLC, after the deduction of their service fees, taxes, or any other charges imposed by the platform. This includes all revenue streams from the rental, such as rental fees, cleaning fees, and any additional service charges paid by guests.</li>
            <li><b>Commission on Gross Rental Income:</b> The Property Manager shall deduct a fee of <Term>{mgmtPct}</Term> of the Gross Rental Income as compensation for its management services. This fee will be calculated based on the net amount received post-platform fees and taxes.</li>
            <li>
              Additional fees will only apply to extraordinary services that fall outside the scope of routine management. Examples include:
              <ul>
                <li>Coordinating large-scale repairs or renovations at the Owner&rsquo;s request.</li>
                <li>Emergency interventions requiring significant time, such as addressing severe property damage due to natural disasters.</li>
              </ul>
            </li>
            <li>The Property Manager will provide written notice and an estimate of these fees before incurring the cost, ensuring full transparency.</li>
            <li>A detailed statement of rental income and fees will be provided monthly.</li>
          </ul>
          <DocFooter pageNum={3} />
        </section>

        {/* Page 4 — owner responsibilities, min availability, payments, expenses */}
        <section className="rt-doc-page">
          <SectionTitle title="Owner's Responsibilities" />
          <ul className="rt-c-bullets">
            <li>Provide the Property Manager with access to the Property for management purposes.</li>
            <li>
              Cover costs related to the maintenance and repair of the Property unless due to guest negligence.
              <ul>
                <li>&ldquo;Guest negligence&rdquo; is defined as damages resulting from a guest&rsquo;s intentional acts, gross negligence, or failure to follow property guidelines.</li>
              </ul>
            </li>
            <li>Cover costs related to the utilities and upkeep of the Property.</li>
            <li>The Owner shall ensure the Property complies with all applicable federal, state, and local laws, regulations, ordinances, and licensing requirements for short-term rentals. The Owner acknowledges that the Property Manager shall not be liable for any fines, penalties, or legal actions resulting from the Owner&rsquo;s failure to comply with such requirements.</li>
            <li>The Owner is responsible for providing and maintaining the Property in a safe, habitable condition, including adherence to building codes, fire safety requirements, and any other relevant health and safety regulations.</li>
          </ul>

          <SectionTitle title="Minimum Availability for Rental" />
          <p className="rt-c-body">
            The Owner agrees to make the Property available for short-term rental for a minimum of <Term>{minDays} days</Term> during the term of this Agreement. Availability is calculated as any day the Property is listed and unblocked for booking on short-term rental platforms.
          </p>

          <SectionTitle title="Payments and Accounting" />
          <ul className="rt-c-bullets">
            <li>Rental income, after deduction of Property Manager&rsquo;s fees, will be disbursed to the Owner monthly.</li>
            <li>The Property Manager shall maintain accurate records of all transactions and provide the Owner with monthly financial statements.</li>
            <li>The Property Manager is responsible for collecting and remitting occupancy and lodging taxes for each booking platform used.</li>
          </ul>

          <SectionTitle title="Expenses" />
          <ul className="rt-c-bullets">
            <li><b>Owner&rsquo;s Responsibilities:</b> The Owner shall cover costs related to the maintenance and repair of the Property unless the damage is due to guest negligence.</li>
            <li><b>Property Manager&rsquo;s Responsibilities:</b> The Property Manager shall make efforts to recover costs for damages caused by guests via the short-term rental platforms, credit card holds or insurance (if applicable).</li>
            <li><b>Consumables and Utilities:</b> The Owner shall cover costs related to the utilities and upkeep of the Property, while the Property Manager will cover the costs of replenishment of consumables (e.g., toiletries, paper towels, toilet paper).</li>
          </ul>
          <DocFooter pageNum={4} />
        </section>

        {/* Page 5 — termination, sale protection */}
        <section className="rt-doc-page">
          <SectionTitle title="Termination" />
          <p className="rt-c-body">
            Either Party may terminate this Agreement upon a material breach by the other Party, provided the breaching Party fails to cure such breach within thirty (30) days of receiving written notice. In the event of a severe breach that materially threatens the Property Manager&rsquo;s ability to operate (such as refusal to honor existing bookings or failure to comply with critical legal or safety requirements), the non-breaching Party may terminate this Agreement immediately without further notice.
          </p>

          <SectionTitle title="Protection Against Sale of Property" />
          <p className="rt-c-body">
            Cancellations of confirmed reservations can inflict serious harm on a short-term rental business. Apart from the immediate loss of rental income, platforms like Airbnb or VRBO may impose penalties, require refunds to guests, or, in severe cases, remove the Property Manager from their platforms. Such outcomes can damage the Property Manager&rsquo;s reputation and future hosting ability, necessitating the following protections:
          </p>
          <ul className="rt-c-bullets">
            <li><b>Notification Requirement:</b> The Owner shall provide the Property Manager with <Term>{saleDays} days&rsquo;</Term> written notice of intent to sell the Property.</li>
            <li>
              <b>Existing Reservations:</b> The Owner agrees to either: (a) Ensure the buyer honors all existing reservations; or (b) Compensate the Property Manager for all direct costs incurred due to the cancellation of these reservations.
            </li>
            <li>
              <b>Compensation for Cancellations:</b> If existing reservations cannot be honored, the Owner shall compensate the Property Manager as follows:
              <ul>
                <li><b>Lost Gross Rental Income.</b> The total Gross Rental Income projected from all affected reservations based on average nightly rates for similar periods.</li>
                <li><b>Platform Penalties.</b> Any fees, penalties, or fines imposed by booking platforms (e.g., Airbnb, VRBO) due to cancellations resulting from the sale.</li>
                <li><b>Reputation Damages.</b> A fixed fee of <Term>{repFee}</Term> to cover long-term reputational harm. This amount reflects the typical loss incurred from platform penalties, reduced listing visibility, and adverse guest reviews.</li>
              </ul>
            </li>
            <li><b>Binding Obligation:</b> This clause shall remain binding on the Owner and any potential buyer. The Owner agrees to disclose this obligation to the buyer as part of the sale agreement. Failure to do so may result in the Owner being liable for all outlined damages.</li>
          </ul>
          <DocFooter pageNum={5} />
        </section>

        {/* Rider — per-deal addenda, only rendered if custom_clauses is non-empty */}
        {projection.custom_clauses && projection.custom_clauses.length > 0 && (
          <section className="rt-doc-page">
            <SectionTitle title="Rider — Additional Terms" />
            <p className="rt-c-body">
              The following additional terms have been agreed between the
              Parties and form part of this Agreement. They are read
              alongside the standard terms above; in the event of conflict,
              these additional terms shall control.
            </p>
            {projection.custom_clauses.map((clause, idx) => (
              <div key={idx} className="rt-c-clause">
                <h3 className="rt-c-clause-title">
                  {String(idx + 1).padStart(2, '0')}. {clause.title || 'Untitled clause'}
                </h3>
                {clause.body.split(/\n+/).map((para, pi) => (
                  <p key={pi} className="rt-c-body">{para}</p>
                ))}
              </div>
            ))}
            <DocFooter pageNum={6} />
          </section>
        )}

        {/* Legal text page — liability, insurance, force majeure, dispute resolution, severability, governing law */}
        <section className="rt-doc-page">
          <SectionTitle title="Liability and Indemnification" />
          <p className="rt-c-body">
            The Property Manager shall not be liable for any damage or loss unless due to willful misconduct or gross negligence. The Owner shall indemnify the Property Manager against any claims arising from the ownership, use, or condition of the Property.
          </p>

          <SectionTitle title="Insurance & Liability Coverage" />
          <ul className="rt-c-bullets">
            <li><b>Owner&rsquo;s Insurance Obligations:</b> The Owner shall maintain at all times, at the Owner&rsquo;s own expense, a comprehensive homeowner&rsquo;s insurance policy that covers short-term rental activities, including liability coverage for personal injury or property damage incurred by guests.</li>
            <li><b>Property Manager as Additional Insured:</b> The Owner shall name the Property Manager as an additional insured (or additional interest if full additional insured status is not available) on the insurance policy if such coverage is obtainable.</li>
            <li><b>Evidence of Coverage:</b> The Owner agrees to provide proof of such insurance upon execution of this Agreement and annually thereafter.</li>
          </ul>

          <SectionTitle title="Force Majeure" />
          <p className="rt-c-body">
            Neither Party shall be held liable for failure or delay in fulfilling its obligations under this Agreement if such failure or delay is caused by or results from events beyond that Party&rsquo;s reasonable control, including but not limited to natural disasters, acts of government, pandemics, or other unforeseen circumstances. The affected Party shall notify the other Party within 10 business days of the occurrence of the force majeure event. Both Parties will work in good faith to mitigate the impact of the force majeure event.
          </p>

          <SectionTitle title="Dispute Resolution & Attorneys' Fees" />
          <p className="rt-c-body">
            In the event of any dispute arising under or relating to this Agreement, the Parties agree first to attempt to resolve the dispute through good-faith negotiation. Should such negotiation fail, either Party may resort to litigation or arbitration. The prevailing Party in any litigation or arbitration arising from this Agreement shall be entitled to recover its reasonable attorneys&rsquo; fees, court costs, and other expenses incurred.
          </p>

          <SectionTitle title="Severability" />
          <p className="rt-c-body">
            If any provision of this Agreement is deemed unlawful or unenforceable, the remainder of the Agreement shall remain in full force and effect. The Parties agree to negotiate a replacement provision within 30 days of invalidation, ensuring the replacement aligns as closely as possible with the original intent of the Agreement.
          </p>

          <SectionTitle title="Governing Law & Entire Agreement" />
          <p className="rt-c-body">
            This Agreement shall be governed by and construed in accordance with the laws of the State of Massachusetts. This document represents the entire agreement between the Parties and supersedes all prior communications, agreements, or understandings, written or oral, concerning the subject matter hereof.
          </p>
          <DocFooter pageNum={projection.custom_clauses && projection.custom_clauses.length > 0 ? 7 : 6} />
        </section>

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
          <DocFooter pageNum={projection.custom_clauses && projection.custom_clauses.length > 0 ? 8 : 7} />
        </section>

        {/* Public-facing signing form, only when not yet signed. Hidden in print. */}
        {signingForm && !signedName && <div className="rt-c-signing-slot">{signingForm}</div>}
      </div>
    </>
  );
}

// ─── Helpers (formatting + small components) ────────────────────────────────
function fmtDateShort(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}
function fmtDateNarrative(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

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

/** Renders a Term-style date when present, or a fillable underline blank. */
function DateOrBlank({ value }: { value: string | null }) {
  if (value) return <Term>{value}</Term>;
  return <span className="rt-c-blank" aria-label="date blank" />;
}

/** A stacked signature block: printed name, signature, date — each on its own
 *  full-width line with a caption beneath. Used for both the Owner column and
 *  the Property Manager column on the signatures page. */
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
    padding-left: 24px;      /* whole block indented; wrapped lines stay aligned */
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink);
    max-width: 684px;        /* 660 + 24 padding so the right edge matches bullets */
  }

  /* Fillable underline blank — used inline in body paragraphs when a date or
     other deal-specific term is not yet filled in. */
  .rt-c-blank {
    display: inline-block;
    width: 130px;
    border-bottom: 1px solid var(--ink-3);
    height: 1em;
    vertical-align: text-bottom;
    margin: 0 2px;
  }

  /* Bullets — Tailwind's preflight zeros list-style on ul/ol, so we restore
     it here and color the markers signal so they read as Rising-Tide bullets.
     padding-left is 42px = 24px body indent + ~18px bullet column,
     so the text edge aligns with .rt-c-body. */
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

  /* Rider clauses (per-deal addenda) */
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

  /* Dedicated signatures page — gives the block real breathing room rather
     than fighting the legal text for the bottom of page 6. */
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

  /* Signature block — two stacked signers with full-width lines + captions.
     Replaces the old side-by-side label/value rows that read as cramped. */
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

  /* Public signing slot — wraps the signing form below the contract. Screen
     only; print rule above hides it so the PDF is just the contract. */
  .rt-c-signing-slot {
    width: 816px;
    background: var(--paper);
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  }
`;
