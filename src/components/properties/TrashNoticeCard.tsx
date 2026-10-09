import type { TrashNotice } from '@/lib/trash-notice';
import { ScaMark } from './ScaMark';

/**
 * The 4 x 6 trash-day notice. Goes on the fridge, so it is built to be read
 * from across a kitchen: "Trash & Recycling", the collection day as the
 * headline, the two things the guest actually does (carts out the night
 * before, back in once emptied), and where the carts live. Nothing else:
 * it is for guests (Dotti, 2026-10-09), so no small print and no filler.
 *
 * Same brand language as the WiFi placard, Welcome Card and bespoke
 * notices (navy frame, cream panel, Fraunces display, Inter body) so the
 * 4 x 6 set reads as one family. Every sentence comes from civic.ts or the
 * property row; nothing here words a rule of its own.
 *
 * Server-renderable. The per-property page, the fleet-wide print page and
 * the Puppeteer PDF all render this one component.
 */
/**
 * The day is the headline and should fill the cream, but Fraunces widths
 * differ by almost two to one between "Friday" and "Wednesday", so one size
 * either cramps the long days or wastes the short ones. Sized per weekday
 * instead, each measured in the preview harness to sit just inside the
 * cream (about 290px of the 312px panel). Collection runs Monday to Friday;
 * anything else falls back to the smallest.
 */
const DAY_SIZE: Record<string, number> = {
  Monday: 92,
  Tuesday: 86,
  Wednesday: 60,
  Thursday: 72,
  Friday: 118,
};

export function TrashNoticeCard({ notice }: { notice: TrashNotice }) {
  return (
    <article className="rt-card" data-property-document="trash-notice" data-property-id={notice.propertyId}>
      <div className="rt-panel">
        <ScaMark size={40} />

        <h1 className="rt-title">
          Trash <span className="rt-amp">&amp;</span> Recycling
        </h1>
        <div className="rt-day" style={{ fontSize: DAY_SIZE[notice.day] ?? 60 }}>
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
              <dt>{notice.backWhen ? `${notice.day}, ${notice.backWhen}` : notice.day}</dt>
              <dd>{notice.backLine}</dd>
            </div>
          </dl>

          {/* Where the carts live, in the operator's own words (trash_notes is
              location only by contract; the day and the rule compose on top). */}
          {notice.location ? <p className="rt-location">{notice.location}</p> : null}
        </div>
      </div>

      {/* The home's name rides in the footer so a stack printed for the
          whole fleet can be sorted by hand. Guest-facing title first. */}
      <div className="rt-footer">
        <div className="rt-footer-site">staycapeann.com</div>
        <div className="rt-footer-home">{notice.displayName}</div>
      </div>
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
    --sca-sand: #C8B89A;
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

  /* Cream inner panel. Mark, title and day sit at the top; the steps
     centre in what is left. */
  .rt-panel {
    flex: 1;
    min-height: 0;
    background: var(--sca-cream);
    padding: 24px 24px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--sca-navy);
    overflow: hidden;
  }

  /* The subject. Clearly second to the day, but readable from the table. */
  .rt-title {
    margin: 12px 0 0;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 25px;
    line-height: 1.1;
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

  /* The headline. Font size is set inline per weekday (DAY_SIZE) so every
     day name fills the cream. */
  .rt-day {
    margin: 4px 0 0;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    line-height: 1;
    font-weight: 400;
    letter-spacing: -0.03em;
    color: var(--sca-navy);
    white-space: nowrap;
  }

  /* Steps and location, centred in the height the day leaves. */
  .rt-body {
    margin: auto 0;
    padding-top: 22px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* The two steps, as dated rows divided by hairlines. */
  .rt-steps {
    margin: 0;
    padding: 0;
    width: 100%;
    border-top: 1px solid var(--sca-navy);
  }
  .rt-step {
    padding: 16px 0 15px;
    border-bottom: 1px solid var(--sca-navy);
  }
  .rt-step dt {
    margin: 0;
    font-size: 11.5px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .rt-step dd {
    margin: 7px 0 0;
    font-size: 16px;
    line-height: 1.4;
  }

  /* Where the carts live: the house's own voice, in italic Fraunces. */
  .rt-location {
    margin: 16px 0 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 14.5px;
    line-height: 1.45;
    max-width: 264px;
  }

  /* Navy footer band. Bottom padding generous so the wordmark sits inside
     the bleed-safe zone on a printed card. */
  .rt-footer {
    color: var(--sca-cream);
    text-align: center;
    padding: 12px 0 16px;
  }
  .rt-footer-site {
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.04em;
  }
  .rt-footer-home {
    margin-top: 4px;
    font-size: 8.5px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    opacity: 0.6;
  }
`;
