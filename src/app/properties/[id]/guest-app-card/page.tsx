import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { requirePropertyDocumentAccess } from '@/lib/property-document-auth';
import { getGuestAppRow, guestAppUrl } from '@/lib/guest-app-db';
import { renderQrForPlacard } from '@/lib/qr-sizing';
import { QUO_LINES } from '@/lib/quo-lines';
import { phoneDisplay } from '@/lib/guest-app';
import { ScaMark } from '@/components/properties/ScaMark';
import { GuestDocumentBar } from '@/components/properties/GuestDocumentBar';

export const dynamic = 'force-dynamic';

/** One name per document: the tile, this tab's title and the bar say the same thing. */
export const metadata = { title: 'Guest app card' };

type CardProperty = { id: string; name: string; title: string | null };

async function getProperty(id: string): Promise<CardProperty | null> {
  const { data } = await supabase.from('properties').select('id, name, title').eq('id', id).maybeSingle();
  return (data as CardProperty | null) ?? null;
}

/**
 * The guest app card: a 4 x 6 inch card for the glass case, the same size
 * and brand as the Wi-Fi placard and the welcome card so the three read as
 * one set on the counter. One QR, to this home's permanent guest app link
 * (/h/<token>), so the card printed today still works next summer.
 *
 * Self-guarded like the Wi-Fi placard: the link it encodes opens the home's
 * Wi-Fi password, so the page checks a staff session or the two-minute
 * render token before reading anything. A home with the app switched off
 * renders the card without a QR and says why; the PDF route refuses it.
 *
 * Rotating the link on the property page retires every printed card. The
 * card says nothing about Helm: no URL is printed (the Helm host is not a
 * guest's address), and a guest whose phone will not scan texts the guest
 * line instead.
 */
export default async function GuestAppCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePropertyDocumentAccess(id, 'guest-app-card');
  const p = await getProperty(id);
  if (!p) notFound();

  const row = await getGuestAppRow(p.id);
  const qr =
    row?.enabled
      ? await renderQrForPlacard({
          uri: guestAppUrl(row.token),
          // Q survives a scuffed card and glare through the glass case.
          errorCorrectionLevel: 'Q',
          color: { dark: '#0F2A44', light: '#F4ECD8' },
          floorPx: 168,
        })
      : null;

  return (
    <>
      <style>{cardCss}</style>
      <GuestDocumentBar propertyId={p.id} homeName={p.name} documentName="Guest app card" type="guest-app-card" />
      <div className="rt-doc" data-property-document="guest-app-card">
        <article className="rt-card">
          <div className="rt-panel">
            <div className="rt-head">
              <ScaMark size={44} />
              <h1 className="rt-display">
                Your stay, <em>on your phone.</em>
              </h1>
              {p.title ? <div className="rt-home">{p.title}</div> : null}
            </div>

            <div className="rt-qr-block">
              <div className="rt-qr" style={{ width: qr?.sizePx ?? 168, height: qr?.sizePx ?? 168 }}>
                {qr ? (
                  <span dangerouslySetInnerHTML={{ __html: qr.svg }} />
                ) : (
                  <div className="rt-qr-empty">
                    <div className="rt-qr-empty-h">The guest app is off</div>
                    <div>Turn it on for this home in Helm to print its code.</div>
                  </div>
                )}
              </div>
              <div className="rt-caption">Point your camera here</div>
            </div>

            <div className="rt-body">
              <p className="rt-lede">Wi-Fi, checkout, how the house works, and our picks nearby.</p>
              <p className="rt-text">
                Questions? Text us at <span className="rt-num">{phoneDisplay(QUO_LINES.guests.number)}</span>
              </p>
            </div>
          </div>

          <div className="rt-footer">staycapeann.com</div>
        </article>
      </div>
    </>
  );
}

const cardCss = `
  /* 4 x 6 inch card, portrait. Same frame, panel and type as the Wi-Fi
     placard and the welcome card. */
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
    box-sizing: border-box;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  /* 4in x 6in at 96dpi = 384 x 576 px. The 36px navy frame survives a
     consumer printer's ~0.125in of bleed, as on the placard. */
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
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    .rt-card { box-shadow: none; }
  }

  .rt-panel {
    flex: 1;
    background: var(--sca-cream);
    padding: 24px 24px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    text-align: center;
    color: var(--sca-navy);
  }
  .rt-head { display: flex; flex-direction: column; align-items: center; }

  .rt-display {
    margin: 12px 0 0;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 24px;
    line-height: 1.1;
    font-weight: 400;
    letter-spacing: -0.01em;
  }
  .rt-display em { font-style: italic; display: block; }

  /* The home's guest-facing title, a quiet qualifier in tan small caps. */
  .rt-home {
    margin-top: 8px;
    font-size: 9.5px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--sca-tan);
  }

  .rt-qr-block { display: flex; flex-direction: column; align-items: center; }
  .rt-qr { display: flex; align-items: center; justify-content: center; }
  .rt-qr svg { width: 100%; height: 100%; }
  .rt-qr-empty {
    font-size: 11px;
    line-height: 1.55;
    font-style: italic;
    opacity: 0.7;
    padding: 0 8px;
  }
  .rt-qr-empty-h {
    font-style: normal;
    font-family: var(--font-fraunces), Georgia, serif;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .rt-caption {
    margin-top: 10px;
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    font-weight: 600;
    opacity: 0.7;
  }

  .rt-body {
    width: 100%;
    border-top: 1px solid var(--sca-navy);
    padding-top: 10px;
  }
  .rt-lede {
    margin: 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-size: 14px;
    line-height: 1.35;
  }
  .rt-text {
    margin: 6px 0 0;
    font-size: 10.5px;
    line-height: 1.4;
    opacity: 0.8;
  }
  .rt-num { white-space: nowrap; font-weight: 600; }

  .rt-footer {
    color: var(--sca-cream);
    text-align: center;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.04em;
    padding: 18px 0 22px;
  }

  @media print {
    .rt-panel { padding: 16px 22px 14px; }
    .rt-display { margin-top: 8px; font-size: 22px; }
    .rt-footer { padding: 10px 0 12px; }
  }
`;
