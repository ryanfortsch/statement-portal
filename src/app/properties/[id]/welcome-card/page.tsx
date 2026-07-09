import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { renderQrForPlacard } from '@/lib/qr-sizing';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('id, name, title').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

/**
 * Stay Cape Ann Welcome Card. A 4 × 6 inch printout that sits on the
 * counter (or a side table) when guests arrive. Combines two beats from
 * the Adobe Express prototype Dotti shared:
 *
 *   1. The warm welcome — "we're glad you're here, this home was
 *      thoughtfully prepared for you, settle in."
 *   2. The subscribe pitch — "thinking about your next stay? join the
 *      list." with a scannable QR pointing at staycapeann.com/contact.
 *
 * Distinct from the Welcome Guide (the US Letter functional doc with
 * Wi-Fi / climate / parking / trash) — this is the smaller, more
 * emotional artifact, sized to the same 4 × 6 glass case slot as the
 * WiFi placard so a row of Stay Cape Ann printouts on a counter reads
 * as one set.
 *
 * The page is fully generic (no property-specific data) — the same card
 * goes in every Stay Cape Ann home — but lives under the per-property
 * route prefix so the proxy regex and PDF endpoint stay consistent with
 * the other guest deliverables.
 */
const SUBSCRIBE_URL = 'https://staycapeann.com/contact';

export default async function WelcomeCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // QR rendered straight onto cream so it prints with no transparency
  // artifacts. ECC level Q balances density against scuffs in a printed
  // tabletop context — same setting we use for the WiFi placard. Size
  // scales with module count via renderQrForPlacard so the printed
  // module never falls below the ~1.0mm consumer-printer floor; URL is
  // short today (fits QR Version 3) but future copy edits won't silently
  // break the scan.
  const { svg: qrSvg, sizePx: qrSize } = await renderQrForPlacard({
    uri: SUBSCRIBE_URL,
    errorCorrectionLevel: 'Q',
    color: { dark: '#0F2A44', light: '#F4ECD8' },
    floorPx: 110,
  });

  return (
    <>
      <style>{cardCss}</style>
      <div className="rt-doc">
        <article className="rt-card">
          <div className="rt-panel">
            <ScaMark />

            <h1 className="rt-display">
              Welcome<em>.</em>
            </h1>

            <p className="rt-welcome">
              We&rsquo;re so glad you&rsquo;re here. This home has been
              thoughtfully prepared so you can settle in, slow down, and
              enjoy your time on Cape Ann.
            </p>

            <div className="rt-rule" aria-hidden="true" />

            <h2 className="rt-subhead">Thinking about your next stay?</h2>

            <p className="rt-pitch">
              We occasionally share availability and special stays — thoughtfully
              and infrequently.
            </p>

            <div className="rt-qr" style={{ width: qrSize, height: qrSize }}>
              <span dangerouslySetInnerHTML={{ __html: qrSvg }} />
            </div>

            <div className="rt-qr-caption">staycapeann.com/contact</div>
          </div>

          <div className="rt-footer">staycapeann.com</div>
        </article>
      </div>
    </>
  );
}

/**
 * Inlined Stay Cape Ann logo mark — same simplified version used on the
 * WiFi placard and bespoke notices so the whole 4 × 6 set reads
 * consistently. Source of truth: /Users/maguire/Developer/stay-cape-ann/app/icon.svg.
 */
function ScaMark() {
  return (
    <div className="rt-mark" aria-hidden="true">
      <svg viewBox="0 0 200 200" width="40" height="40">
        <circle cx="100" cy="82" r="28" fill="#B89B6E" />
        <path d="M100 48 L138 82 L138 112 L62 112 L62 82 Z" fill="#0F2A44" />
        <line x1="40" y1="118" x2="160" y2="118" stroke="#B89B6E" strokeWidth="5" />
        <path d="M18 145 L182 145 A95 95 0 0 1 18 145 Z" fill="#0F2A44" />
      </svg>
    </div>
  );
}

const cardCss = `
  /* 4 × 6 inch placard, portrait. Same dims + brand language as the WiFi
     placard so the two cards read as a set when stacked on a counter. */
  @page { size: 4in 6in; margin: 0; }
  html, body { background: #0e1a1f; margin: 0; padding: 0; }

  :root {
    --sca-navy: #0F2A44;
    --sca-cream: #F4ECD8;
    --sca-tan: #B89B6E;
  }

  .rt-doc {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 24px;
    font-family: var(--font-inter), system-ui, sans-serif;
  }

  /* 4in × 6in @ 96dpi = 384 × 576 px. Outer navy padding is intentionally
     generous (36px ≈ 0.375") so consumer printers that crop ~0.125" of
     bleed still leave a visibly substantial navy frame on the printed
     card — matches the WiFi placard so the two cards print as a set. */
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
    /* Keep the navy frame + cream panel when printing straight from the
       browser (Cmd+P strips backgrounds by default; the puppeteer PDF
       path already forces printBackground: true). */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    .rt-card { box-shadow: none; }
  }

  /* Cream interior */
  .rt-panel {
    flex: 1;
    background: var(--sca-cream);
    padding: 22px 26px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--sca-navy);
    overflow: hidden;
  }

  .rt-mark { line-height: 0; margin-top: 2px; }

  .rt-display {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 38px;
    line-height: 1;
    font-weight: 300;
    color: var(--sca-navy);
    letter-spacing: -0.025em;
    margin: 14px 0 0;
  }
  .rt-display em { font-style: italic; font-weight: 400; }

  /* Top half — the warm welcome paragraph, set in italic Fraunces so it
     reads as voice rather than instructions. */
  .rt-welcome {
    margin: 12px 0 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--sca-navy);
    max-width: 280px;
  }

  /* Hairline divider between the welcome and the subscribe pitch */
  .rt-rule {
    width: 60px;
    height: 1px;
    background: var(--sca-navy);
    opacity: 0.5;
    margin: 20px 0 18px;
  }

  /* Bottom half — the subscribe pitch */
  .rt-subhead {
    font-family: var(--font-fraunces), Georgia, serif;
    font-size: 17px;
    line-height: 1.15;
    font-weight: 400;
    color: var(--sca-navy);
    letter-spacing: -0.01em;
    margin: 0;
  }

  .rt-pitch {
    margin: 8px 0 0;
    font-size: 11px;
    line-height: 1.55;
    color: var(--sca-navy);
    opacity: 0.78;
    max-width: 280px;
  }

  /* QR — sized so the whole card reads as welcome-first, subscribe-second.
     Width and height come from inline style (set by renderQrForPlacard so
     module size stays ≥ ~1.06mm at 4×6 print regardless of URL length —
     see lib/qr-sizing.ts). Floor is 110px since the welcome-card URL is
     short and that's the visually-balanced size on this layout. */
  .rt-qr {
    margin-top: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-qr svg { width: 100%; height: 100%; }

  .rt-qr-caption {
    margin-top: 8px;
    font-family: var(--font-mono-dash), ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 9.5px;
    letter-spacing: 0.04em;
    color: var(--sca-navy);
    opacity: 0.75;
  }

  /* Navy footer band — staycapeann.com. Bottom padding generous so the
     wordmark sits well inside the bleed-safe zone on a printed card. */
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
