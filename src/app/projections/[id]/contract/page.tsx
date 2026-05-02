import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

function fmtDateLong(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
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

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const ownerName = projection.prospect_full_legal || projection.prospect_name;
  const today = new Date();
  const issuedDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const issuedNarrative = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const propertyAddress = `${projection.property_address}${projection.property_city ? `, ${projection.property_city}` : ''}`;
  const propertyType = projection.property_type || 'House';
  const mgmtPct = fmtPct(projection.mgmt_fee_pct);
  const deposit = fmtMoney(projection.initial_deposit);
  const minBalance = fmtMoney(projection.min_account_balance);
  const minDays = projection.min_availability_days;
  const saleDays = projection.sale_notification_days;
  const repFee = fmtMoney(projection.reputation_fee);
  const termStart = fmtDateShort(projection.term_start);
  const termEnd = fmtDateShort(projection.term_end);
  const termStartLong = fmtDateNarrative(projection.term_start);
  const termEndLong = fmtDateNarrative(projection.term_end);

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
          <Section title="Summary" />
          <p className="rt-c-body">
            This Agreement is made and entered into on <Term>{issuedNarrative}</Term> by and between Rising Tide STR, LLC (&ldquo;Property Manager&rdquo;), a Massachusetts Limited Liability Company, located at 3 Locust Lane, Gloucester, MA, and <Term>{ownerName}</Term> (&ldquo;Owner&rdquo;), collectively referred to as the &ldquo;Parties&rdquo;.
          </p>

          <Section title="Property Details" />
          <div className="rt-c-kv">
            <div><span>Address</span><span><Term>{propertyAddress}</Term></span></div>
            <div><span>Type</span><span><Term>{propertyType}</Term></span></div>
          </div>

          <Section title="Term" />
          <p className="rt-c-body">
            This Agreement shall commence on <Term>{termStart}</Term> and continue until <Term>{termEnd}</Term>, unless terminated earlier in accordance with the terms herein.
          </p>
          <p className="rt-c-body">
            This Agreement shall commence on <Term>{termStartLong}</Term> and continue through <Term>{termEndLong}</Term>, unless terminated earlier in accordance with the terms herein. Upon expiration of the initial term, this Agreement shall automatically renew for successive one-year terms unless either party provides written notice of non-renewal. For calendar year 2026, such notice must be provided at least 60 days prior to the end of the then-current term; thereafter, notice must be provided at least 120 days prior to the end of the then-current term. This advance notice requirement ensures adequate lead time to close the calendar and prevent unfillable bookings.
          </p>

          <Section title="Property Manager's Responsibilities" />
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
          <Section title="Initial Deposit" />
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

          <Section title="Rental Income and Fees" />
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

        {/* Page 4 — owner responsibilities, min availability, payments, expenses, termination */}
        <section className="rt-doc-page">
          <Section title="Owner's Responsibilities" />
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

          <Section title="Minimum Availability for Rental" />
          <p className="rt-c-body">
            The Owner agrees to make the Property available for short-term rental for a minimum of <Term>{minDays} days</Term> during the term of this Agreement. Availability is calculated as any day the Property is listed and unblocked for booking on short-term rental platforms.
          </p>

          <Section title="Payments and Accounting" />
          <ul className="rt-c-bullets">
            <li>Rental income, after deduction of Property Manager&rsquo;s fees, will be disbursed to the Owner monthly.</li>
            <li>The Property Manager shall maintain accurate records of all transactions and provide the Owner with monthly financial statements.</li>
            <li>The Property Manager is responsible for collecting and remitting occupancy and lodging taxes for each booking platform used.</li>
          </ul>

          <Section title="Expenses" />
          <ul className="rt-c-bullets">
            <li><b>Owner&rsquo;s Responsibilities:</b> The Owner shall cover costs related to the maintenance and repair of the Property unless the damage is due to guest negligence.</li>
            <li><b>Property Manager&rsquo;s Responsibilities:</b> The Property Manager shall make efforts to recover costs for damages caused by guests via the short-term rental platforms, credit card holds or insurance (if applicable).</li>
            <li><b>Consumables and Utilities:</b> The Owner shall cover costs related to the utilities and upkeep of the Property, while the Property Manager will cover the costs of replenishment of consumables (e.g., toiletries, paper towels, toilet paper).</li>
          </ul>
          <DocFooter pageNum={4} />
        </section>

        {/* Page 5 — termination, sale protection */}
        <section className="rt-doc-page">
          <Section title="Termination" />
          <p className="rt-c-body">
            Either Party may terminate this Agreement upon a material breach by the other Party, provided the breaching Party fails to cure such breach within thirty (30) days of receiving written notice. In the event of a severe breach that materially threatens the Property Manager&rsquo;s ability to operate (such as refusal to honor existing bookings or failure to comply with critical legal or safety requirements), the non-breaching Party may terminate this Agreement immediately without further notice.
          </p>

          <Section title="Protection Against Sale of Property" />
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

        {/* Page 6 — liability, insurance, force majeure, dispute resolution, severability, governing law */}
        <section className="rt-doc-page">
          <Section title="Liability and Indemnification" />
          <p className="rt-c-body">
            The Property Manager shall not be liable for any damage or loss unless due to willful misconduct or gross negligence. The Owner shall indemnify the Property Manager against any claims arising from the ownership, use, or condition of the Property.
          </p>

          <Section title="Insurance & Liability Coverage" />
          <ul className="rt-c-bullets">
            <li><b>Owner&rsquo;s Insurance Obligations:</b> The Owner shall maintain at all times, at the Owner&rsquo;s own expense, a comprehensive homeowner&rsquo;s insurance policy that covers short-term rental activities, including liability coverage for personal injury or property damage incurred by guests.</li>
            <li><b>Property Manager as Additional Insured:</b> The Owner shall name the Property Manager as an additional insured (or additional interest if full additional insured status is not available) on the insurance policy if such coverage is obtainable.</li>
            <li><b>Evidence of Coverage:</b> The Owner agrees to provide proof of such insurance upon execution of this Agreement and annually thereafter.</li>
          </ul>

          <Section title="Force Majeure" />
          <p className="rt-c-body">
            Neither Party shall be held liable for failure or delay in fulfilling its obligations under this Agreement if such failure or delay is caused by or results from events beyond that Party&rsquo;s reasonable control, including but not limited to natural disasters, acts of government, pandemics, or other unforeseen circumstances. The affected Party shall notify the other Party within 10 business days of the occurrence of the force majeure event. Both Parties will work in good faith to mitigate the impact of the force majeure event.
          </p>

          <Section title="Dispute Resolution & Attorneys' Fees" />
          <p className="rt-c-body">
            In the event of any dispute arising under or relating to this Agreement, the Parties agree first to attempt to resolve the dispute through good-faith negotiation. Should such negotiation fail, either Party may resort to litigation or arbitration. The prevailing Party in any litigation or arbitration arising from this Agreement shall be entitled to recover its reasonable attorneys&rsquo; fees, court costs, and other expenses incurred.
          </p>

          <Section title="Severability" />
          <p className="rt-c-body">
            If any provision of this Agreement is deemed unlawful or unenforceable, the remainder of the Agreement shall remain in full force and effect. The Parties agree to negotiate a replacement provision within 30 days of invalidation, ensuring the replacement aligns as closely as possible with the original intent of the Agreement.
          </p>

          <Section title="Governing Law & Entire Agreement" />
          <p className="rt-c-body">
            This Agreement shall be governed by and construed in accordance with the laws of the State of Massachusetts. This document represents the entire agreement between the Parties and supersedes all prior communications, agreements, or understandings, written or oral, concerning the subject matter hereof.
          </p>

          <Section title="Signatures" />
          <div className="rt-c-sig-grid">
            <div className="rt-c-sig">
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Owner&rsquo;s Name</span><span className="rt-c-sig-val"><Term>{ownerName}</Term></span></div>
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Owner&rsquo;s Signature</span><span className="rt-c-sig-line" /></div>
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Date</span><span className="rt-c-sig-line" /></div>
            </div>
            <div className="rt-c-sig">
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Rising Tide STR, LLC<br /><span className="rt-c-sig-sub">Representative</span></span><span className="rt-c-sig-val">Allie O&rsquo;Brien</span></div>
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Representative Signature</span><span className="rt-c-sig-line" /></div>
              <div className="rt-c-sig-row"><span className="rt-c-sig-label">Date</span><span className="rt-c-sig-line" /></div>
            </div>
          </div>
          <p className="rt-c-thanks">
            <b>Thank you for choosing Rising Tide.</b><br />
            Questions? Reach Allie directly at allie@risingtidestr.com or (978) 865-2387.
          </p>
          <DocFooter pageNum={6} />
        </section>
      </div>
    </>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────
function Section({ title }: { title: string }) {
  return (
    <h2 className="rt-c-section">
      <span className="rt-c-section-mark" aria-hidden="true">▸</span>
      {title}
    </h2>
  );
}

/** Highlights a deal-specific term with a soft underline so it's visually distinct from boilerplate. Edit these from the projection form. */
function Term({ children }: { children: React.ReactNode }) {
  return <span className="rt-c-term">{children}</span>;
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
  .rt-cover-foot-q {
    margin-top: 16px;
    font-size: 11px;
    color: var(--paper-3);
    font-style: italic;
  }

  /* Section heading */
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

  /* Body */
  .rt-c-body {
    margin: 0 0 12px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink);
    max-width: 660px;
  }

  /* Bullets */
  .rt-c-bullets {
    margin: 0 0 12px 18px;
    padding: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink);
  }
  .rt-c-bullets li { padding: 3px 0; max-width: 640px; }
  .rt-c-bullets ul { margin: 4px 0 0 18px; padding: 0; }
  .rt-c-bullets ul li { padding: 2px 0; }

  /* Key/value (Property Details) */
  .rt-c-kv {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
    margin: 0 0 16px;
  }
  .rt-c-kv > div {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 16px;
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
    color: var(--ink);
  }
  .rt-c-kv > div span:first-child { font-weight: 500; }

  /* Editable term highlight (visual cue that it's deal-specific). Tightens
     the eye to where the variable parts of the contract live. */
  .rt-c-term {
    font-weight: 500;
    color: var(--ink);
    border-bottom: 1px dotted var(--signal);
    padding: 0 1px 1px;
    white-space: nowrap;
  }

  /* Signatures */
  .rt-c-sig-grid {
    margin-top: 18px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  .rt-c-sig { display: flex; flex-direction: column; gap: 18px; }
  .rt-c-sig-row { display: grid; grid-template-columns: 140px 1fr; gap: 16px; align-items: end; }
  .rt-c-sig-label {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    line-height: 1.3;
  }
  .rt-c-sig-sub { font-size: 9px; letter-spacing: 0.06em; text-transform: none; color: var(--ink-3); font-weight: 400; }
  .rt-c-sig-val {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    color: var(--ink);
    border-bottom: 1px solid var(--ink);
    padding-bottom: 4px;
  }
  .rt-c-sig-line {
    height: 22px;
    border-bottom: 1px solid var(--ink);
  }

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

  /* Footer */
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
`;
