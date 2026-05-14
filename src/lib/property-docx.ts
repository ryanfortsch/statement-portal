import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IImageOptions,
} from 'docx';
import QRCode from 'qrcode';
import { civicForProperty } from '@/lib/civic';
import type { HelmPropertyRow } from '@/lib/properties';
import { LOCAL_CONTACTS_24HR } from '@/lib/properties';
import type { PropertyDeliverable } from '@/lib/property-pdf';

/**
 * Word-doc renderers for the Properties module's guest-facing deliverables.
 *
 * The HTML/print pages at /properties/<id>/<deliverable> are the canonical
 * brand-pixel-perfect artifact — what guests actually see. Staff who need
 * to tweak copy before printing (custom warnings, owner stays with
 * different Wi-Fi, owner-name change between turnovers, etc.) get a
 * Word doc here so they can edit in Word and save the modified copy.
 *
 * Design intent for the .docx files:
 *   - Word-native fonts only (Cambria + Calibri). Fraunces / Inter aren't
 *     installed in most Word setups, and silently falling back to Cambria
 *     Math or Times looks worse than picking Word-native upfront.
 *   - Brand colors (navy / tan) on a plain white page. Cream backgrounds
 *     are technically possible in Word but bloat the file and don't print
 *     well on a home printer.
 *   - 4×6 placards (WiFi, Welcome Card) get a 4×6 page size so Word's
 *     print preview matches the printed result. 8.5×11 deliverables
 *     (Welcome Guide, Information Note) stay portrait US Letter.
 *   - QR codes are embedded as PNG at the same printed-mm-per-module
 *     geometry the placard renderer uses (≥ 1.06 mm) so the .docx-printed
 *     QR scans just as well as the PDF.
 */

// Stay Cape Ann brand colors (no leading # in docx).
const NAVY = '0F2A44';
const TAN = 'B89B6E';
const INK_3 = '506470'; // muted body text

// Common font choices — Word-native so the doc renders the same on any
// machine without font substitution.
const SERIF = 'Cambria';
const SANS = 'Calibri';
const MONO = 'Consolas';

// docx measurements: 1 inch = 1440 twips; font size is half-points.
const IN = 1440;

/** Filesystem-safe .docx filename mirroring the PDF naming. */
export function propertyDocxFilename(
  propertyName: string,
  type: PropertyDeliverable,
  noticeTitle?: string,
): string {
  const labels: Record<PropertyDeliverable, string> = {
    'home-guide': 'Welcome Guide',
    'wifi-placard': 'WiFi Placard',
    'info-note': 'Information Note',
    'notice': 'Notice',
    'welcome-card': 'Welcome Card',
  };
  const base =
    type === 'notice' && noticeTitle ? `Notice - ${noticeTitle}` : labels[type];
  const safe = `${propertyName} - ${base}.docx`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}

/**
 * Build the Word doc for a property + deliverable type. Returns the
 * .docx file as a Buffer ready to stream back from the API route.
 *
 * Bespoke notices (`type === 'notice'`) aren't supported here — those
 * already have an in-Helm editor at /properties/<id>/notices/...
 */
export async function renderPropertyDocx(args: {
  property: HelmPropertyRow;
  type: PropertyDeliverable;
}): Promise<Buffer> {
  const { property, type } = args;

  switch (type) {
    case 'wifi-placard':
      return packDoc(await buildWifiPlacard(property));
    case 'welcome-card':
      return packDoc(await buildWelcomeCard(property));
    case 'home-guide':
      return packDoc(buildHomeGuide(property));
    case 'info-note':
      return packDoc(buildInfoNote(property));
    case 'notice':
      throw new Error(
        'Bespoke notices are edited directly in Helm; no .docx export needed.',
      );
  }
}

async function packDoc(doc: Document): Promise<Buffer> {
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf);
}

// ─── WiFi Placard ───────────────────────────────────────────────────────────

async function buildWifiPlacard(p: HelmPropertyRow): Promise<Document> {
  const ssid = p.wifi_name || '';
  const pass = p.wifi_password || '';
  const wifiUri = `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:false;;`;

  const qrImage = await maybeQrImage({
    uri: ssid && pass ? wifiUri : null,
    // 1.5 inch printed QR = 144 px at 96dpi. Matches the placard's 140px
    // floor and prints with a ≥ ~1.0 mm module size for the typical
    // v4-v5 WiFi URI symbol.
    printInches: 1.5,
  });

  return new Document({
    creator: 'Stay Cape Ann',
    title: 'Wi-Fi placard',
    styles: defaultStyles(),
    sections: [
      {
        properties: {
          page: {
            size: { width: 4 * IN, height: 6 * IN, orientation: PageOrientation.PORTRAIT },
            margin: { top: 0.5 * IN, right: 0.4 * IN, bottom: 0.4 * IN, left: 0.4 * IN },
          },
        },
        children: [
          eyebrow('Stay Cape Ann'),
          displayHeading('Wi-Fi', { size: 48, mt: 100 }),
          ...(qrImage
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 320, after: 160 },
                  children: [qrImage],
                }),
              ]
            : [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 320, after: 160 },
                  children: [
                    new TextRun({
                      text: 'Add a Wi-Fi name and password before printing.',
                      italics: true,
                      color: INK_3,
                      font: SERIF,
                    }),
                  ],
                }),
              ]),
          fieldRow('Network', ssid || '—'),
          fieldRow('Password', pass || '—'),
          spacer(360),
          footer('staycapeann.com'),
        ],
      },
    ],
  });
}

// ─── Welcome Card ───────────────────────────────────────────────────────────

async function buildWelcomeCard(_p: HelmPropertyRow): Promise<Document> {
  const SUBSCRIBE_URL = 'https://staycapeann.com/contact';
  const qrImage = await maybeQrImage({ uri: SUBSCRIBE_URL, printInches: 1.2 });

  return new Document({
    creator: 'Stay Cape Ann',
    title: 'Welcome card',
    styles: defaultStyles(),
    sections: [
      {
        properties: {
          page: {
            size: { width: 4 * IN, height: 6 * IN, orientation: PageOrientation.PORTRAIT },
            margin: { top: 0.5 * IN, right: 0.4 * IN, bottom: 0.4 * IN, left: 0.4 * IN },
          },
        },
        children: [
          eyebrow('Stay Cape Ann'),
          displayHeading('Welcome.', { size: 56, mt: 80 }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 280 },
            children: [
              new TextRun({
                text:
                  'We’re so glad you’re here. This home has been thoughtfully prepared so you can settle in, slow down, and enjoy your time on Cape Ann.',
                italics: true,
                font: SERIF,
                size: 22,
                color: NAVY,
              }),
            ],
          }),
          hairline(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 280, after: 100 },
            children: [
              new TextRun({
                text: 'Thinking about your next stay?',
                font: SERIF,
                size: 28,
                color: NAVY,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [
              new TextRun({
                text:
                  'We occasionally share availability and special stays — thoughtfully and infrequently.',
                font: SANS,
                size: 18,
                color: NAVY,
              }),
            ],
          }),
          ...(qrImage
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 80, after: 100 },
                  children: [qrImage],
                }),
              ]
            : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'staycapeann.com/contact',
                font: MONO,
                size: 18,
                color: NAVY,
              }),
            ],
          }),
          spacer(240),
          footer('staycapeann.com'),
        ],
      },
    ],
  });
}

// ─── Welcome Guide (home-guide) ─────────────────────────────────────────────

function buildHomeGuide(p: HelmPropertyRow): Document {
  const stayName = p.title || `Stay at ${p.name}`;
  const cityShort = (p.city || '').split(',')[0] || 'Cape Ann';
  const civic = civicForProperty(p);

  const cells: Array<{ num: string; title: string; body: Paragraph[] }> = [
    {
      num: '01',
      title: 'Wi-Fi',
      body: p.wifi_name || p.wifi_password
        ? [
            kvLine('Network', p.wifi_name || ''),
            kvLine('Password', p.wifi_password || ''),
            aside('A scannable QR code is posted near the entry.'),
          ]
        : [aside('See the placard near the entry for network and password.')],
    },
    {
      num: '02',
      title: 'Climate',
      body: [
        plainCellPara(
          p.heating || p.cooling
            ? `Heat: ${humanize(p.heating) || 'central'}. Cool: ${humanize(p.cooling) || 'central'}.`
            : 'Thermostats control each floor independently.',
        ),
        aside('All thermostats must be set to the same mode (heat / cool) to function correctly.'),
      ],
    },
    {
      num: '03',
      title: 'Bathrooms',
      body: [
        plainCellPara(
          'Use the bathroom fan while showering — the button may not depress, but the fan still runs and shuts off automatically.',
        ),
        aside('Please limit any flushed items to toilet paper.'),
      ],
    },
    {
      num: '04',
      title: 'Parking',
      body: [
        plainCellPara(p.parking ? humanize(p.parking) : civic.parking),
        aside('Please keep shared driveway access clear.'),
      ],
    },
    {
      num: '05',
      title: 'Kitchen',
      body: [
        plainCellPara(
          'Coffee. Fill the water tank, insert a pod, choose your size, brew.',
        ),
        plainCellPara(
          'Cooktop. Slide out the hood to operate the fan; use only the pans we’ve provided on the burners.',
        ),
        aside('Counter tops stain easily — please blot dark drinks and oils right away.'),
      ],
    },
    {
      num: '06',
      title: 'Trash & Recycling',
      body: [
        plainCellPara(
          civic.trashDay
            ? `Indoor bins are in the kitchen. When full, empty into the outdoor bins behind the home. Pickup is on ${civic.trashDay}${civic.recyclingDay && civic.recyclingDay !== civic.trashDay ? ` (recycling on ${civic.recyclingDay})` : ''}.`
            : 'Indoor bins are in the kitchen. When full, empty into the outdoor bins behind the home. Pickup runs weekly.',
        ),
        aside('No need to take bins to the curb on departure.'),
      ],
    },
  ];

  return new Document({
    creator: 'Stay Cape Ann',
    title: 'Welcome Guide',
    styles: defaultStyles(),
    sections: [
      {
        properties: {
          page: {
            size: { width: 8.5 * IN, height: 11 * IN, orientation: PageOrientation.PORTRAIT },
            margin: { top: 0.6 * IN, right: 0.6 * IN, bottom: 0.5 * IN, left: 0.6 * IN },
          },
        },
        children: [
          eyebrow('Stay Cape Ann'),
          new Paragraph({
            spacing: { before: 200, after: 80 },
            children: [
              new TextRun({ text: 'Welcome ', font: SERIF, size: 84, color: NAVY }),
              new TextRun({ text: 'home.', font: SERIF, size: 84, color: NAVY, italics: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 280 },
            children: [
              new TextRun({
                text: `We’re glad you’re here at ${stayName}${p.address ? `. ${p.address}, ${cityShort}.` : '.'}`,
                font: SANS,
                size: 22,
                color: NAVY,
              }),
            ],
          }),
          twoColumnGrid(cells),
          spacer(400),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Hassle-free departure.', font: SERIF, size: 36, color: NAVY }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 200 },
            children: [
              new TextRun({
                text: 'No chores required. Just lock the door and travel safely.',
                font: SERIF,
                italics: true,
                size: 22,
                color: NAVY,
              }),
            ],
          }),
          footer('staycapeann.com'),
        ],
      },
    ],
  });
}

// ─── Information Note (Gloucester only) ─────────────────────────────────────

function buildInfoNote(p: HelmPropertyRow): Document {
  const cityShort = (p.city || '').split(',')[0].trim();
  const civic = civicForProperty(p);
  const operator = LOCAL_CONTACTS_24HR.operator;
  const backup = LOCAL_CONTACTS_24HR.backup;

  const grid: Array<{ num: string; title: string; body: Paragraph[] }> = [
    {
      num: '01',
      title: 'Trash & Recycling',
      body: [
        kvLine('Trash', civic.trashDay || '—'),
        kvLine('Recycling', civic.recyclingDay || '—'),
        aside('Place bins curbside the night before. Pet waste, yard waste, and household hazardous items go in the trash, not recycling.'),
        ...(p.trash_notes ? [plainCellPara(p.trash_notes)] : []),
      ],
    },
    { num: '02', title: 'Parking', body: [plainCellPara(civic.parking)] },
    { num: '03', title: 'Noise Ordinance', body: [plainCellPara(civic.noise)] },
    { num: '04', title: 'Animal Control', body: [plainCellPara(civic.animals)] },
    {
      num: '05',
      title: 'Gas, Water & Electric Shutoffs',
      body: [
        kvLine('Gas', p.gas_shutoff_location || '—'),
        kvLine('Water', p.water_shutoff_location || '—'),
        kvLine('Electrical panel', p.electrical_panel_location || '—'),
        aside('If you smell gas, leave the home immediately and call the operator.'),
      ],
    },
    {
      num: '06',
      title: 'Fire Safety',
      body: [
        kvLine('Exits', p.fire_exit_locations || '—'),
        kvLine('Smoke / CO alarms', p.smoke_detector_locations || '—'),
        kvLine('Extinguishers', p.fire_extinguisher_locations || '—'),
      ],
    },
  ];

  return new Document({
    creator: 'Stay Cape Ann',
    title: 'Information Note',
    styles: defaultStyles(),
    sections: [
      {
        properties: {
          page: {
            size: { width: 8.5 * IN, height: 11 * IN, orientation: PageOrientation.PORTRAIT },
            margin: { top: 0.6 * IN, right: 0.6 * IN, bottom: 0.5 * IN, left: 0.6 * IN },
          },
        },
        children: [
          eyebrow('Stay Cape Ann · Information Note'),
          new Paragraph({
            spacing: { before: 200, after: 80 },
            children: [
              new TextRun({ text: 'House & ', font: SERIF, size: 72, color: NAVY }),
              new TextRun({ text: 'civic info.', font: SERIF, size: 72, color: NAVY, italics: true }),
            ],
          }),
          new Paragraph({
            spacing: { after: 280 },
            children: [
              new TextRun({
                text: `For guests staying at ${p.title || p.name}${p.address ? ` (${p.address}${cityShort ? `, ${cityShort}` : ''})` : ''}. Posted per the short-term rental ordinance${cityShort ? ` of ${cityShort}, MA` : ''}. Please review on arrival.`,
                font: SANS,
                size: 22,
                color: NAVY,
              }),
            ],
          }),
          contactsTable(operator, backup),
          spacer(160),
          twoColumnGrid(grid),
          spacer(280),
          permitFooter(p),
        ],
      },
    ],
  });
}

// ─── Shared docx building blocks ─────────────────────────────────────────────

function defaultStyles(): NonNullable<ConstructorParameters<typeof Document>[0]['styles']> {
  return {
    default: {
      document: {
        run: { font: SANS, size: 22, color: NAVY },
      },
    },
  };
}

function eyebrow(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: SANS,
        size: 16,
        color: NAVY,
        characterSpacing: 80,
      }),
    ],
  });
}

function displayHeading(text: string, opts: { size: number; mt?: number }): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: opts.mt ?? 0, after: 120 },
    children: [new TextRun({ text, font: SERIF, size: opts.size, color: NAVY })],
  });
}

function fieldRow(label: string, value: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60 },
    children: [
      new TextRun({
        text: `${label.toUpperCase()}\n`,
        font: SANS,
        size: 14,
        color: NAVY,
        characterSpacing: 60,
      }),
      new TextRun({
        text: value,
        font: MONO,
        size: 24,
        color: NAVY,
        break: 1,
      }),
    ],
  });
}

function kvLine(key: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${key.toUpperCase()}  `, font: SANS, size: 14, color: NAVY, characterSpacing: 50 }),
      new TextRun({ text: value, font: SANS, size: 20, color: NAVY }),
    ],
  });
}

function plainCellPara(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, font: SANS, size: 20, color: NAVY })],
  });
}

function aside(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text, font: SERIF, italics: true, size: 18, color: INK_3 }),
    ],
  });
}

function hairline(): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 1 },
    },
    children: [],
  });
}

function spacer(twips: number): Paragraph {
  return new Paragraph({ spacing: { before: twips }, children: [] });
}

function footer(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    border: {
      top: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 8 },
    },
    children: [
      new TextRun({ text, font: SERIF, italics: true, size: 22, color: NAVY }),
    ],
  });
}

function permitFooter(p: HelmPropertyRow): Paragraph {
  const permit = p.str_registration_id || '—';
  const expiry = p.str_permit_expires ? ` · expires ${p.str_permit_expires}` : '';
  return new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 6 } },
    spacing: { before: 160 },
    children: [
      new TextRun({ text: `STR PERMIT  `, font: SANS, size: 14, color: NAVY, characterSpacing: 60 }),
      new TextRun({ text: `${permit}${expiry}`, font: MONO, size: 18, color: NAVY }),
      new TextRun({ text: `    ·    Issued by Rising Tide STR  ·  risingtidestr.com`, font: SANS, size: 16, color: NAVY, break: 0 }),
    ],
  });
}

function contactsTable(
  operator: typeof LOCAL_CONTACTS_24HR.operator,
  backup: typeof LOCAL_CONTACTS_24HR.backup,
): Table {
  const cell = (
    eyebrowText: string,
    name: string,
    role: string,
    extras: string[],
    accent?: string,
  ): TableCell =>
    new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: eyebrowText.toUpperCase(),
              font: SANS,
              size: 14,
              color: INK_3,
              characterSpacing: 70,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({ text: name, font: SERIF, size: 26, color: accent ?? NAVY }),
          ],
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: role, font: SERIF, italics: true, size: 16, color: INK_3 })],
        }),
        ...extras.map(
          (line) =>
            new Paragraph({
              spacing: { after: 20 },
              children: [new TextRun({ text: line, font: MONO, size: 18, color: NAVY })],
            }),
        ),
      ],
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('Operator · 24/7', operator.name, operator.role, [operator.phone, operator.email].filter(Boolean) as string[]),
          cell('Additional 24-hour contact', backup.name, backup.role, [backup.phone, backup.email].filter(Boolean) as string[]),
          cell('In a true emergency', '911', 'Police, fire, medical', [], TAN),
        ],
      }),
    ],
  });
}

/** 2-column × 3-row grid of editorial cells, modeled on the print page. */
function twoColumnGrid(cells: Array<{ num: string; title: string; body: Paragraph[] }>): Table {
  const cellNode = (c: { num: string; title: string; body: Paragraph[] }): TableCell =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      margins: { top: 120, bottom: 120, left: 120, right: 120 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 12, color: NAVY },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      children: [
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: c.num + '   ', font: MONO, size: 14, color: TAN, characterSpacing: 40 }),
            new TextRun({ text: c.title, font: SERIF, size: 26, color: NAVY }),
          ],
        }),
        ...c.body,
      ],
    });

  const rows: TableRow[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(
      new TableRow({
        height: { value: 2000, rule: HeightRule.ATLEAST },
        children: [cellNode(cells[i]), cellNode(cells[i + 1] ?? { num: '', title: '', body: [] })],
      }),
    );
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

// ─── QR / WiFi URI helpers ───────────────────────────────────────────────────

async function maybeQrImage(args: { uri: string | null; printInches: number }): Promise<ImageRun | null> {
  if (!args.uri) return null;
  // Render QR at a generous source size so Word's printer doesn't have to
  // upscale tiny pixels. 600 px source displayed at printInches keeps the
  // module size well above the 1.0 mm consumer-printer reproduction floor.
  const buf = await QRCode.toBuffer(args.uri, {
    type: 'png',
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 600,
    color: { dark: '#0F2A44', light: '#FFFFFF' },
  });
  const px = Math.round(args.printInches * 96);
  const opts: IImageOptions = {
    data: buf,
    transformation: { width: px, height: px },
    type: 'png',
  };
  return new ImageRun(opts);
}

function escapeWifi(s: string): string {
  return s.replace(/([\\;,":])/g, '\\$1');
}

function humanize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toLowerCase() + s.slice(1);
}
