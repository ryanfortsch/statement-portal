import type { TrashNotice } from '@/lib/trash-notice';
import { ScaMark } from './ScaMark';

/**
 * The 4 x 6 trash-day notice. Goes on the fridge, so it is built to be read
 * from across a kitchen: "Trash & Recycling", the collection day as the
 * headline, the two things the guest actually does (carts out the night
 * before, back in once emptied), and where the carts live. Nothing else:
 * it is for guests (Dotti, 2026-10-09), so no small print and no filler.
 *
 * One of the Stay Cape Ann 4 x 6 set with the Wi-Fi placard, Welcome card
 * and bespoke notices, and it takes their measurements rather than its own
 * (Dotti, 2026-10-26: "way off compared to our other guest wayfinding"):
 * the same panel padding, the Wi-Fi card's 28px headline, the notice's
 * 10px label caps, hairline rows, the Welcome card's light display face
 * and italic voice, and the one-line staycapeann.com footer, so the cream
 * panel ends at the same height on every card. Every sentence comes from
 * civic.ts or the property row; nothing here words a rule of its own.
 *
 * Server-renderable. The per-property page, the fleet-wide print page and
 * the Puppeteer PDF all render this one component.
 */
/**
 * The day is the headline and should fill the cream, but Fraunces widths
 * differ by almost two to one between "Friday" and "Wednesday", so one size
 * either cramps the long days or wastes the short ones. Sized per weekday
 * instead, each measured in REAL Fraunces at weight 300 to sit about 236px
 * wide inside the 256px the panel padding leaves. The first cut was measured
 * against the Georgia fallback, which is narrower, and "Friday" at 118px ran
 * off both sides of the cream. Collection runs Monday to Friday; anything
 * else falls back to the smallest.
 */
const DAY_SIZE: Record<string, number> = {
  Monday: 66,
  Tuesday: 64,
  Wednesday: 47,
  Thursday: 56,
  Friday: 84,
};

export function TrashNoticeCard({ notice }: { notice: TrashNotice }) {
  return (
    <article className="rt-card" data-property-document="trash-notice" data-property-id={notice.propertyId}>
      <div className="rt-panel">
        <ScaMark size={40} />

        <h1 className="rt-title">
          Trash <span className="rt-amp">&amp;</span> Recycling
        </h1>
        <div className="rt-day" style={{ fontSize: DAY_SIZE[notice.day] ?? 47 }}>
          {notice.day}
        </div>

        {/* Centred in whatever height the day leaves, so a short day name
            and a long one both read as one balanced card. */}
        <div className="rt-body">
          <dl className="rt-steps">
            <div className="rt-step">
              <dt>{notice.outNight} night</dt>
              <dd>{notice.outLine}</dd>
            </div>
            <div className="rt-step">
              <dt>{`${notice.day}, ${notice.backWhen}`}</dt>
              <dd>{notice.backLine}</dd>
            </div>
          </dl>

          {/* Where the carts live, in the operator's own words (trash_notes is
              location only by contract; the day and the rule compose on top). */}
          {notice.location ? <p className="rt-location">{notice.location}</p> : null}
        </div>
      </div>

      {/* Navy footer band, one line like the rest of the set. */}
      <div className="rt-footer">staycapeann.com</div>
    </article>
  );
}

export const trashNoticeCss = `
  /* 4 x 6 inch placard, portrait. Matches the WiFi placard, Welcome Card and
     bespoke notices so the Stay Cape Ann 4 x 6 set prints as one family. */
  @page { size: 4in 6in; margin: 0; }
  html, body { background: #0e1a1f; margin: 0; padding: 0; }

  :root {
    --sca-navy: #0F2A44;
    --sca-cream: #F4ECD8;
  }

  .rt-doc {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    align-content: flex-start;
    flex-wrap: wrap;
    gap: 32px;
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
    font-family: var(--font-inter), system-ui, sans-serif;
  }

  /* 4in x 6in @ 96dpi = 384 x 576 px. The 36px navy frame survives the
     ~0.125" a consumer printer crops at the edge, same as the siblings. */
  .rt-card {
    width: 384px;
    height: 576px;
    background: var(--sca-navy);
    padding: 36px 36px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  }
  @media print {
    /* Keep the navy frame + cream panel when printing from the browser
       (Cmd+P strips backgrounds by default; the Puppeteer PDF path already
       forces printBackground: true). */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    /* One card per 4 x 6 page, so the fleet-wide page prints a stack. */
    .rt-card { box-shadow: none; page-break-after: always; break-after: page; }
    .rt-card:last-child { page-break-after: auto; break-after: auto; }
    .rt-screen { display: none !important; }
  }

  /* Cream inner panel, padded like the Wi-Fi placard. Mark, title and day
     sit at the top; the steps centre in what is left. */
  .rt-panel {
    flex: 1;
    min-height: 0;
    background: var(--sca-cream);
    padding: 28px 28px 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--sca-navy);
    overflow: hidden;
  }

  .rt-mark { line-height: 0; margin-top: 4px; }

  /* The subject, set exactly like "Wi-Fi" on the placard. */
  .rt-title {
    margin: 14px 0 0;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 28px;
    line-height: 1;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--sca-navy);
    white-space: nowrap;
  }
  /* Room on both sides of the ampersand so the two words read apart
     (Dotti, 2026-10-09: "more spacing between trash and recycling"). */
  .rt-title .rt-amp {
    margin: 0 0.22em;
  }

  /* The headline, in the Welcome card's light display face. Font size is
     set inline per weekday (DAY_SIZE) so every day name fills the cream. */
  .rt-day {
    margin: 12px 0 0;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    line-height: 1;
    font-weight: 300;
    letter-spacing: -0.025em;
    color: var(--sca-navy);
    white-space: nowrap;
  }

  /* Steps and location, centred in the height the day leaves. */
  .rt-body {
    margin: auto 0;
    padding-top: 20px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* The two steps, as hairline rows like the placard's network and
     password. */
  .rt-steps {
    margin: 0;
    padding: 0;
    width: 100%;
    border-top: 1px solid var(--sca-navy);
  }
  .rt-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
    border-bottom: 1px solid var(--sca-navy);
  }
  /* Label caps as on the notice eyebrow and the placard's rows. */
  .rt-step dt {
    margin: 0;
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    font-weight: 600;
    opacity: 0.7;
  }
  .rt-step dd {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    text-wrap: balance;
  }

  /* Where the carts live: the house's own voice, in the Welcome card's
     italic Fraunces. */
  .rt-location {
    margin: 16px 0 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    line-height: 1.55;
    max-width: 250px;
    text-wrap: balance;
  }

  /* Navy footer band, the same line and padding as the rest of the set so
     the cream ends at the same height on every card. */
  .rt-footer {
    color: var(--sca-cream);
    text-align: center;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.04em;
    padding: 18px 0 22px;
  }
`;
