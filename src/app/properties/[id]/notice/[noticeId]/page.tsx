import { notFound } from 'next/navigation';
import { getPropertyNotice, splitNoticeParagraphs } from '@/lib/property-notices';

export const dynamic = 'force-dynamic';

/**
 * Bespoke Stay Cape Ann notice — a 4 × 6 inch printout for a single
 * property-specific quirk (e.g. "please run the bathroom fan during
 * showers"). Same brand language as the WiFi placard so a stack of these
 * sitting in glass cases around a property reads as one consistent set:
 * navy #0F2A44 outer frame, cream #F4ECD8 interior, tan #B89B6E sun in
 * the inlined SCA logo, Fraunces display + Inter body.
 *
 * Renders the notice keyed by its UUID rather than the property id so the
 * proxy regex can keep "anything under /properties/<id>/notice/<uuid>"
 * public for puppeteer without exposing the auth-gated editor that lives
 * under the plural /notices/... path.
 */
export default async function PropertyNoticePage({
  params,
}: {
  params: Promise<{ id: string; noticeId: string }>;
}) {
  const { id, noticeId } = await params;
  const notice = await getPropertyNotice(noticeId);

  // 404 when the notice was deleted, or when it was authored under a
  // different property — we don't want a `/properties/foo/notice/<uuid>`
  // URL to render a notice that actually belongs to property "bar".
  if (!notice || notice.property_id !== id) notFound();

  const paragraphs = splitNoticeParagraphs(notice.body);

  return (
    <>
      <style>{noticeCss}</style>
      <div className="rt-doc">
        <article className="rt-card">
          <div className="rt-panel">
            <ScaMark />

            {notice.eyebrow ? <div className="rt-eyebrow">{notice.eyebrow}</div> : null}

            <h1 className="rt-title">{notice.title}</h1>

            <div className="rt-body">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>

          <div className="rt-footer">staycapeann.com</div>
        </article>
      </div>
    </>
  );
}

/**
 * Inlined Stay Cape Ann logo mark — same simplified version used on the
 * WiFi placard (cream circle dropped, just navy house + tan sun + horizon
 * + navy water band) so the bespoke notices read as part of the same set.
 * Source of truth: /Users/maguire/Developer/stay-cape-ann/app/icon.svg.
 */
function ScaMark() {
  return (
    <div className="rt-mark" aria-hidden="true">
      <svg viewBox="0 0 200 200" width="42" height="42">
        <circle cx="100" cy="82" r="28" fill="#B89B6E" />
        <path d="M100 48 L138 82 L138 112 L62 112 L62 82 Z" fill="#0F2A44" />
        <line x1="40" y1="118" x2="160" y2="118" stroke="#B89B6E" strokeWidth="5" />
        <path d="M18 145 L182 145 A95 95 0 0 1 18 145 Z" fill="#0F2A44" />
      </svg>
    </div>
  );
}

const noticeCss = `
  /* 4 × 6 inch placard, portrait. Matches the WiFi placard so a row of
     printed Stay Cape Ann notices in a glass case reads as one set. */
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
     bleed still leave a visibly substantial navy frame — matches the
     WiFi placard + Welcome Card so the SCA 4×6 set prints consistently. */
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
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    .rt-card { box-shadow: none; }
  }

  /* Cream inner panel */
  .rt-panel {
    flex: 1;
    background: var(--sca-cream);
    padding: 30px 30px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--sca-navy);
    overflow: hidden;
  }

  .rt-mark { line-height: 0; margin-top: 2px; }

  .rt-eyebrow {
    margin-top: 18px;
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--sca-navy);
    opacity: 0.7;
    font-weight: 600;
  }

  .rt-title {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 30px;
    line-height: 1.05;
    font-weight: 400;
    color: var(--sca-navy);
    letter-spacing: -0.02em;
    margin: 16px 0 0;
    max-width: 100%;
  }

  /* Body — divided from the title by a hairline rule for editorial weight */
  .rt-body {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--sca-navy);
    width: 100%;
    color: var(--sca-navy);
    font-size: 13px;
    line-height: 1.55;
  }
  .rt-body p { margin: 0 0 10px; }
  .rt-body p:last-child { margin-bottom: 0; }

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
