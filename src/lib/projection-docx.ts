import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
} from 'docx';
import type { ProjectionRow } from '@/lib/projections-types';
import type { DeliverableType } from '@/lib/projection-pdf';

/**
 * Word-doc renderer for the Prospects (projections) module's deliverables.
 *
 * Right now this covers the **management contract** only — that's the
 * deliverable owners actually negotiate, and the PDF / online-signing path
 * doesn't accept redlines. The guide and projection deck are sales
 * artifacts; their PDFs are the canonical form.
 *
 * The Word doc mirrors the printed contract (ContractDocument.tsx) one
 * section at a time. When the prospect record has no term_start or
 * contract_signed_name yet, blanks render as a row of underscores so the
 * doc reads as a draft. When signed, the typed name appears on the
 * signature line and an audit line at the end records when it was signed.
 *
 * Word-native fonts only (Cambria + Calibri + Consolas). Brand colors used
 * sparingly (signal accent on section titles + dotted-term underline; navy
 * on body). White page background — Word doc colored backgrounds bloat
 * the file and don't print cleanly on a home printer.
 */

const INK = '1E2E34';
const INK_3 = '506470';
const INK_4 = '8A9AA6';
const SIGNAL = 'C85A3A'; // warm red-orange accent (matches the printed contract)
const RULE = 'D4CFC2';

const SERIF = 'Cambria';
const SANS = 'Calibri';
const MONO = 'Consolas';

const IN = 1440; // 1 inch in twips

export type ProjectionDocxType = Extract<DeliverableType, 'contract'>;

/** Filesystem-safe filename: "16 Waterman Rd - Contract.docx" */
export function projectionDocxFilename(
  propertyAddress: string,
  type: ProjectionDocxType,
): string {
  const labels: Record<ProjectionDocxType, string> = { contract: 'Contract' };
  const safe = `${propertyAddress} - ${labels[type]}.docx`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}

/**
 * Build the Word doc for a projection deliverable. Returns a Buffer the API
 * route streams back as application/vnd.openxmlformats-...
 */
export async function renderProjectionDocx(args: {
  projection: ProjectionRow;
  type: ProjectionDocxType;
}): Promise<Buffer> {
  const { projection, type } = args;
  if (type !== 'contract') {
    throw new Error(`Unsupported projection docx type: ${type}`);
  }
  const doc = buildContract(projection);
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

// ─── Contract ───────────────────────────────────────────────────────────────

function buildContract(p: ProjectionRow): Document {
  const ownerName = p.prospect_full_legal || p.prospect_name || '';
  const today = new Date();
  const issuedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const propertyAddress = `${p.property_address}${p.property_city ? `, ${p.property_city}` : ''}`;
  const propertyType = p.property_type || 'House';
  const mgmtPct = fmtPct(p.mgmt_fee_pct);
  const deposit = fmtMoney(p.initial_deposit);
  const minBalance = fmtMoney(p.min_account_balance);
  const minDays = `${p.min_availability_days} days`;
  const saleDays = `${p.sale_notification_days} days`;
  const repFee = fmtMoney(p.reputation_fee);

  const termStartShort = p.term_start ? fmtDateShort(p.term_start) : null;
  const termEndShort = p.term_end ? fmtDateShort(p.term_end) : null;
  const termStartLong = p.term_start ? fmtDateNarrative(p.term_start) : null;
  const termEndLong = p.term_end ? fmtDateNarrative(p.term_end) : null;

  const signedName = p.contract_signed_name || null;
  const signedAt = p.contract_signed_at;
  const effectiveDate = p.term_start ? fmtDateNarrative(p.term_start) : null;

  const hasRider = (p.custom_clauses?.length ?? 0) > 0;

  const children: Array<Paragraph | Table> = [
    // Title block
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'RISING TIDE',
          font: SANS,
          size: 18,
          color: INK_3,
          characterSpacing: 160,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'Management Contract', font: SERIF, size: 56, color: INK }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: SIGNAL, space: 4 } },
      children: [],
    }),
    italicLede(
      'This agreement outlines the terms and responsibilities between Rising Tide STR, LLC and the property owner for short-term rental management services.',
    ),
    spacer(120),
    coverFacts([
      ['Date', issuedDate],
      ['Property Owner', ownerName || '_______________________'],
    ]),
    spacer(120),
    italicNote(
      'Questions? Reach Allie at allie@risingtidestr.com or (978) 865-2387.',
    ),

    pageBreak(),

    // Summary
    sectionTitle('Summary'),
    bodyPara([
      bodyText('This Agreement is made and entered into on '),
      termOrBlank(termStartLong),
      bodyText(
        ' by and between Rising Tide STR, LLC ("Property Manager"), a Massachusetts Limited Liability Company, located at 3 Locust Lane, Gloucester, MA, and ',
      ),
      termRun(ownerName),
      bodyText(' ("Owner"), collectively referred to as the "Parties".'),
    ]),

    sectionTitle('Property Details'),
    kvTable([
      ['Address', propertyAddress || '_______________________'],
      ['Type', propertyType],
    ]),

    sectionTitle('Term'),
    bodyPara([
      bodyText('This Agreement shall commence on '),
      termOrBlank(termStartShort),
      bodyText(' and continue until '),
      termOrBlank(termEndShort),
      bodyText(', unless terminated earlier in accordance with the terms herein.'),
    ]),
    bodyPara([
      bodyText('This Agreement shall commence on '),
      termOrBlank(termStartLong),
      bodyText(' and continue through '),
      termOrBlank(termEndLong),
      bodyText(
        ', unless terminated earlier in accordance with the terms herein. Upon expiration of the initial term, this Agreement shall automatically renew for successive one-year terms unless either party provides written notice of non-renewal. For calendar year 2026, such notice must be provided at least 60 days prior to the end of the then-current term; thereafter, notice must be provided at least 120 days prior to the end of the then-current term. This advance notice requirement ensures adequate lead time to close the calendar and prevent unfillable bookings.',
      ),
    ]),

    sectionTitle("Property Manager's Responsibilities"),
    ...bulletList([
      'Market and advertise the Property for short-term rentals.',
      'Handle booking and reservations and offer customer support to guests.',
      'Collect rental payments and deposit them into a bank account.',
      'Disburse rental income to the Owner monthly.',
      'Conduct check-in and check-out procedures.',
      'Provide cleaning and maintenance services.',
      'Supply and replenish consumables, including toiletries, paper towels, toilet paper, etc.',
      'Ensure the property is ready for rental by installing necessary items for launching the property.',
      'The Property Manager will use commercially reasonable efforts to market and rent the Property; however, the Property Manager makes no representations or warranties regarding occupancy levels or the amount of rental income that will be generated.',
    ]),

    pageBreak(),

    // Deposit
    sectionTitle('Initial Deposit'),
    ...bulletListMixed([
      [boldText('Deposit Amount: '), bodyText('The Owner agrees to deposit '), termRun(deposit), bodyText(' into the bank account to cover initial setup costs and maintain this minimum balance for ongoing expenses.')],
      [boldText('Use of Deposit: '), bodyText('The deposit will be used for the purchase of necessary items to launch the property. Additional setup items may include:')],
    ]),
    ...subBullets([
      'Interior decor and furnishings to enhance the guest experience',
      'Basic kitchen supplies',
      'Operational necessities (i.e., smart lock)',
    ]),
    ...bulletListMixed([
      [boldText('Ownership of Purchased Items: '), bodyText("All items purchased with initial deposit will become the Owner's property.")],
      [boldText('Minimum Account Balance: '), bodyText('The account must maintain a minimum balance of '), termRun(minBalance), bodyText(' at all times. If the balance falls below '), termRun(minBalance), bodyText(', the Property Manager is authorized to deduct the necessary amount from the Gross Rental Income to restore the balance.')],
    ]),

    sectionTitle('Rental Income and Fees'),
    ...bulletListMixed([
      [boldText('Gross Rental Income Definition: '), bodyText('"Gross Rental Income" shall be defined as the total amount paid out by short-term rental platforms (e.g., Airbnb, VRBO) to Rising Tide STR, LLC, after the deduction of their service fees, taxes, or any other charges imposed by the platform. This includes all revenue streams from the rental, such as rental fees, cleaning fees, and any additional service charges paid by guests.')],
      [boldText('Commission on Gross Rental Income: '), bodyText('The Property Manager shall deduct a fee of '), termRun(mgmtPct), bodyText(' of the Gross Rental Income as compensation for its management services. This fee will be calculated based on the net amount received post-platform fees and taxes.')],
      [bodyText('Additional fees will only apply to extraordinary services that fall outside the scope of routine management. Examples include:')],
    ]),
    ...subBullets([
      "Coordinating large-scale repairs or renovations at the Owner's request.",
      'Emergency interventions requiring significant time, such as addressing severe property damage due to natural disasters.',
    ]),
    ...bulletList([
      'The Property Manager will provide written notice and an estimate of these fees before incurring the cost, ensuring full transparency.',
      'A detailed statement of rental income and fees will be provided monthly.',
    ]),

    pageBreak(),

    sectionTitle("Owner's Responsibilities"),
    ...bulletList([
      'Provide the Property Manager with access to the Property for management purposes.',
      'Cover costs related to the maintenance and repair of the Property unless due to guest negligence.',
    ]),
    ...subBullets([
      '"Guest negligence" is defined as damages resulting from a guest\'s intentional acts, gross negligence, or failure to follow property guidelines.',
    ]),
    ...bulletList([
      'Cover costs related to the utilities and upkeep of the Property.',
      "The Owner shall ensure the Property complies with all applicable federal, state, and local laws, regulations, ordinances, and licensing requirements for short-term rentals. The Owner acknowledges that the Property Manager shall not be liable for any fines, penalties, or legal actions resulting from the Owner's failure to comply with such requirements.",
      'The Owner is responsible for providing and maintaining the Property in a safe, habitable condition, including adherence to building codes, fire safety requirements, and any other relevant health and safety regulations.',
    ]),

    sectionTitle('Minimum Availability for Rental'),
    bodyPara([
      bodyText('The Owner agrees to make the Property available for short-term rental for a minimum of '),
      termRun(minDays),
      bodyText(' during the term of this Agreement. Availability is calculated as any day the Property is listed and unblocked for booking on short-term rental platforms.'),
    ]),

    sectionTitle('Payments and Accounting'),
    ...bulletList([
      "Rental income, after deduction of Property Manager's fees, will be disbursed to the Owner monthly.",
      'The Property Manager shall maintain accurate records of all transactions and provide the Owner with monthly financial statements.',
      'The Property Manager is responsible for collecting and remitting occupancy and lodging taxes for each booking platform used.',
    ]),

    sectionTitle('Expenses'),
    ...bulletListMixed([
      [boldText("Owner's Responsibilities: "), bodyText('The Owner shall cover costs related to the maintenance and repair of the Property unless the damage is due to guest negligence.')],
      [boldText("Property Manager's Responsibilities: "), bodyText('The Property Manager shall make efforts to recover costs for damages caused by guests via the short-term rental platforms, credit card holds or insurance (if applicable).')],
      [boldText('Consumables and Utilities: '), bodyText('The Owner shall cover costs related to the utilities and upkeep of the Property, while the Property Manager will cover the costs of replenishment of consumables (e.g., toiletries, paper towels, toilet paper).')],
    ]),

    pageBreak(),

    sectionTitle('Termination'),
    bodyPara([
      bodyText(
        "Either Party may terminate this Agreement upon a material breach by the other Party, provided the breaching Party fails to cure such breach within thirty (30) days of receiving written notice. In the event of a severe breach that materially threatens the Property Manager's ability to operate (such as refusal to honor existing bookings or failure to comply with critical legal or safety requirements), the non-breaching Party may terminate this Agreement immediately without further notice.",
      ),
    ]),

    sectionTitle('Protection Against Sale of Property'),
    bodyPara([
      bodyText(
        "Cancellations of confirmed reservations can inflict serious harm on a short-term rental business. Apart from the immediate loss of rental income, platforms like Airbnb or VRBO may impose penalties, require refunds to guests, or, in severe cases, remove the Property Manager from their platforms. Such outcomes can damage the Property Manager's reputation and future hosting ability, necessitating the following protections:",
      ),
    ]),
    ...bulletListMixed([
      [boldText('Notification Requirement: '), bodyText('The Owner shall provide the Property Manager with '), termRun(saleDays), bodyText("' written notice of intent to sell the Property.")],
      [boldText('Existing Reservations: '), bodyText('The Owner agrees to either: (a) Ensure the buyer honors all existing reservations; or (b) Compensate the Property Manager for all direct costs incurred due to the cancellation of these reservations.')],
      [boldText('Compensation for Cancellations: '), bodyText('If existing reservations cannot be honored, the Owner shall compensate the Property Manager as follows:')],
    ]),
    ...subBulletsMixed([
      [boldText('Lost Gross Rental Income. '), bodyText('The total Gross Rental Income projected from all affected reservations based on average nightly rates for similar periods.')],
      [boldText('Platform Penalties. '), bodyText('Any fees, penalties, or fines imposed by booking platforms (e.g., Airbnb, VRBO) due to cancellations resulting from the sale.')],
      [boldText('Reputation Damages. '), bodyText('A fixed fee of '), termRun(repFee), bodyText(' to cover long-term reputational harm. This amount reflects the typical loss incurred from platform penalties, reduced listing visibility, and adverse guest reviews.')],
    ]),
    ...bulletListMixed([
      [boldText('Binding Obligation: '), bodyText('This clause shall remain binding on the Owner and any potential buyer. The Owner agrees to disclose this obligation to the buyer as part of the sale agreement. Failure to do so may result in the Owner being liable for all outlined damages.')],
    ]),
  ];

  // Rider — per-deal addenda
  if (hasRider) {
    children.push(pageBreak());
    children.push(sectionTitle('Rider — Additional Terms'));
    children.push(
      bodyPara([
        bodyText(
          'The following additional terms have been agreed between the Parties and form part of this Agreement. They are read alongside the standard terms above; in the event of conflict, these additional terms shall control.',
        ),
      ]),
    );
    for (const [idx, clause] of (p.custom_clauses ?? []).entries()) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAF7F1' },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: SIGNAL, space: 6 } },
          children: [
            new TextRun({
              text: `${String(idx + 1).padStart(2, '0')}. ${clause.title || 'Untitled clause'}`,
              font: SERIF,
              size: 24,
              color: INK,
              bold: true,
            }),
          ],
        }),
      );
      for (const para of (clause.body || '').split(/\n+/)) {
        if (!para.trim()) continue;
        children.push(bodyPara([bodyText(para)]));
      }
    }
  }

  // Legal page
  children.push(pageBreak());
  children.push(sectionTitle('Liability and Indemnification'));
  children.push(
    bodyPara([
      bodyText(
        'The Property Manager shall not be liable for any damage or loss unless due to willful misconduct or gross negligence. The Owner shall indemnify the Property Manager against any claims arising from the ownership, use, or condition of the Property.',
      ),
    ]),
  );

  children.push(sectionTitle('Insurance & Liability Coverage'));
  children.push(
    ...bulletListMixed([
      [boldText("Owner's Insurance Obligations: "), bodyText("The Owner shall maintain at all times, at the Owner's own expense, a comprehensive homeowner's insurance policy that covers short-term rental activities, including liability coverage for personal injury or property damage incurred by guests.")],
      [boldText('Property Manager as Additional Insured: '), bodyText('The Owner shall name the Property Manager as an additional insured (or additional interest if full additional insured status is not available) on the insurance policy if such coverage is obtainable.')],
      [boldText('Evidence of Coverage: '), bodyText('The Owner agrees to provide proof of such insurance upon execution of this Agreement and annually thereafter.')],
    ]),
  );

  children.push(sectionTitle('Force Majeure'));
  children.push(
    bodyPara([
      bodyText(
        "Neither Party shall be held liable for failure or delay in fulfilling its obligations under this Agreement if such failure or delay is caused by or results from events beyond that Party's reasonable control, including but not limited to natural disasters, acts of government, pandemics, or other unforeseen circumstances. The affected Party shall notify the other Party within 10 business days of the occurrence of the force majeure event. Both Parties will work in good faith to mitigate the impact of the force majeure event.",
      ),
    ]),
  );

  children.push(sectionTitle("Dispute Resolution & Attorneys' Fees"));
  children.push(
    bodyPara([
      bodyText(
        "In the event of any dispute arising under or relating to this Agreement, the Parties agree first to attempt to resolve the dispute through good-faith negotiation. Should such negotiation fail, either Party may resort to litigation or arbitration. The prevailing Party in any litigation or arbitration arising from this Agreement shall be entitled to recover its reasonable attorneys' fees, court costs, and other expenses incurred.",
      ),
    ]),
  );

  children.push(sectionTitle('Severability'));
  children.push(
    bodyPara([
      bodyText(
        'If any provision of this Agreement is deemed unlawful or unenforceable, the remainder of the Agreement shall remain in full force and effect. The Parties agree to negotiate a replacement provision within 30 days of invalidation, ensuring the replacement aligns as closely as possible with the original intent of the Agreement.',
      ),
    ]),
  );

  children.push(sectionTitle('Governing Law & Entire Agreement'));
  children.push(
    bodyPara([
      bodyText(
        'This Agreement shall be governed by and construed in accordance with the laws of the State of Massachusetts. This document represents the entire agreement between the Parties and supersedes all prior communications, agreements, or understandings, written or oral, concerning the subject matter hereof.',
      ),
    ]),
  );

  // Signatures
  children.push(pageBreak());
  children.push(sectionTitle('Signatures'));
  children.push(
    bodyPara([
      new TextRun({
        text: 'By signing below, the Parties acknowledge that they have read, understood, and agree to be bound by the terms of this Management Contract.',
        font: SERIF,
        italics: true,
        size: 22,
        color: INK_3,
      }),
    ]),
  );
  children.push(spacer(160));
  children.push(
    signatureTable(
      { eyebrow: 'Owner', printedName: ownerName || '________________________', signedName, dateValue: effectiveDate },
      { eyebrow: 'Property Manager', printedName: "Allie O'Brien, Rising Tide STR, LLC", signedName: null, dateValue: effectiveDate },
    ),
  );
  if (signedName && signedAt) {
    children.push(
      new Paragraph({
        spacing: { before: 200 },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAF7F1' },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: SIGNAL, space: 6 } },
        children: [
          new TextRun({
            text: `Electronically signed by ${signedName} on ${new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}${p.contract_signed_ip ? ` from ${p.contract_signed_ip}` : ''}.`,
            font: SANS,
            italics: true,
            size: 18,
            color: INK_3,
          }),
        ],
      }),
    );
  }
  children.push(spacer(280));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Thank you for choosing Rising Tide.', font: SERIF, size: 22, color: INK, bold: true }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Questions? Reach Allie directly at allie@risingtidestr.com or (978) 865-2387.',
          font: SERIF,
          italics: true,
          size: 20,
          color: INK_3,
        }),
      ],
    }),
  );

  return new Document({
    creator: 'Rising Tide STR',
    title: `${ownerName || 'Owner'} — Management Contract`,
    styles: { default: { document: { run: { font: SANS, size: 22, color: INK } } } },
    numbering: {
      config: [
        {
          reference: 'main-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 540, hanging: 280 } } },
            },
          ],
        },
        {
          reference: 'sub-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1080, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 8.5 * IN, height: 11 * IN, orientation: PageOrientation.PORTRAIT },
            margin: { top: 0.75 * IN, right: 0.85 * IN, bottom: 0.75 * IN, left: 0.85 * IN },
          },
        },
        children,
      },
    ],
  });
}

// ─── Building blocks ────────────────────────────────────────────────────────

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({
        text: '▸  ',
        font: SANS,
        size: 18,
        color: SIGNAL,
        bold: true,
      }),
      new TextRun({
        text: text.toUpperCase(),
        font: SERIF,
        size: 22,
        color: INK,
        bold: true,
        characterSpacing: 40,
      }),
    ],
  });
}

function bodyPara(runs: TextRun[]): Paragraph {
  return new Paragraph({
    spacing: { after: 140, line: 320 },
    indent: { left: 280 },
    children: runs,
  });
}

function bodyText(text: string): TextRun {
  return new TextRun({ text, font: SANS, size: 20, color: INK });
}

function boldText(text: string): TextRun {
  return new TextRun({ text, font: SANS, size: 20, color: INK, bold: true });
}

function italicLede(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text, font: SERIF, italics: true, size: 24, color: INK_3 }),
    ],
  });
}

function italicNote(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text, font: SERIF, italics: true, size: 18, color: INK_4 }),
    ],
  });
}

function termRun(text: string): TextRun {
  return new TextRun({
    text,
    font: SANS,
    size: 20,
    color: INK,
    bold: true,
    underline: { type: 'dotted', color: SIGNAL },
  });
}

/** Inline date span — renders the value when present, or a blank when null. */
function termOrBlank(value: string | null): TextRun {
  if (value) return termRun(value);
  return new TextRun({
    text: '_____________________',
    font: MONO,
    size: 20,
    color: INK_3,
  });
}

function kvTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            margins: { top: 60, bottom: 60, left: 0, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: k.toUpperCase(),
                    font: SANS,
                    size: 16,
                    color: INK_3,
                    characterSpacing: 80,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            margins: { top: 60, bottom: 60, left: 0, right: 0 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: v, font: SANS, size: 20, color: INK })],
              }),
            ],
          }),
        ],
      }),
    ),
  });
}

function coverFacts(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 },
              left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            },
            margins: { top: 80, bottom: 80, left: 0, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: k.toUpperCase(),
                    font: SANS,
                    size: 16,
                    color: INK_3,
                    characterSpacing: 80,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 },
              left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
              right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
            },
            margins: { top: 80, bottom: 80, left: 0, right: 0 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: v, font: SANS, size: 22, color: INK })],
              }),
            ],
          }),
        ],
      }),
    ),
  });
}

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };
}

function bulletList(items: string[]): Paragraph[] {
  return items.map((text) =>
    new Paragraph({
      numbering: { reference: 'main-bullets', level: 0 },
      spacing: { after: 80, line: 300 },
      children: [bodyText(text)],
    }),
  );
}

function bulletListMixed(items: TextRun[][]): Paragraph[] {
  return items.map((runs) =>
    new Paragraph({
      numbering: { reference: 'main-bullets', level: 0 },
      spacing: { after: 80, line: 300 },
      children: runs,
    }),
  );
}

function subBullets(items: string[]): Paragraph[] {
  return items.map((text) =>
    new Paragraph({
      numbering: { reference: 'sub-bullets', level: 0 },
      spacing: { after: 60, line: 300 },
      children: [bodyText(text)],
    }),
  );
}

function subBulletsMixed(items: TextRun[][]): Paragraph[] {
  return items.map((runs) =>
    new Paragraph({
      numbering: { reference: 'sub-bullets', level: 0 },
      spacing: { after: 60, line: 300 },
      children: runs,
    }),
  );
}

function signatureTable(
  owner: { eyebrow: string; printedName: string; signedName: string | null; dateValue: string | null },
  manager: { eyebrow: string; printedName: string; signedName: string | null; dateValue: string | null },
): Table {
  const block = (b: { eyebrow: string; printedName: string; signedName: string | null; dateValue: string | null }): TableCell => {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      margins: { top: 80, bottom: 80, left: 0, right: 120 },
      children: [
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: b.eyebrow.toUpperCase(),
              font: SANS,
              size: 16,
              color: SIGNAL,
              characterSpacing: 80,
              bold: true,
            }),
          ],
        }),
        signatureField(b.printedName, 'Printed Name', false),
        signatureField(b.signedName ?? '', 'Signature', true),
        signatureField(b.dateValue ?? '', 'Date', false),
      ],
    });
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [block(owner), block(manager)] })],
  });
}

function signatureField(value: string, caption: string, isSignature: boolean): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: INK, space: 4 } },
    children: [
      new TextRun({
        text: value || ' ',
        font: isSignature && value ? SERIF : SANS,
        italics: isSignature && Boolean(value),
        size: isSignature && value ? 28 : 22,
        color: isSignature && value ? SIGNAL : INK,
      }),
      new TextRun({ text: '', break: 1 }),
      new TextRun({
        text: caption.toUpperCase(),
        font: SANS,
        size: 14,
        color: INK_4,
        characterSpacing: 80,
        bold: true,
      }),
    ],
  });
}

function spacer(twips: number): Paragraph {
  return new Paragraph({ spacing: { before: twips }, children: [] });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

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
