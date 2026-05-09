import QRCode from 'qrcode';

/**
 * Render a QR code with a size guaranteed to print readably on a 4×6
 * Stay Cape Ann placard.
 *
 * The problem this solves: QR module count grows with URI length and
 * encoding mode. A longer SSID — for example "73 Rocky Neck" with a
 * space, which forces the encoder out of alphanumeric mode and into
 * byte mode — bumps the symbol from QR Version 4 (33×33) to Version 5
 * (37×37). At a fixed render size, denser symbols mean smaller modules,
 * which can fall below the ~1.0mm threshold that consumer printers
 * reproduce reliably. Below that, modules blur together and decode
 * fails. We hit this once when 73 Rocky Neck's printed placard didn't
 * scan (PR #244 → #245).
 *
 * Strategy: scale the rendered size with the module count so each module
 * stays ≥ ~1.06mm at the 4-inch print width (≈ 6% safety above the
 * known-good 1.0mm floor). Fall back to a per-caller floor (e.g. 140 for
 * the WiFi placard) so simpler URIs render at the original visual size
 * instead of shrinking.
 *
 * Geometry:
 *   - Placard renders to a 384px-wide design canvas
 *   - That canvas prints at 4 inches wide = 101.6 mm
 *   - 1 design pixel = 0.265 mm in print
 *   - 4.0 design px per QR module ≈ 1.06 mm per module printed
 */
export async function renderQrForPlacard(args: {
  uri: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  /** Foreground / background, in hex. */
  color: { dark: string; light: string };
  /** Smallest design-pixel size the QR is allowed to render at. */
  floorPx: number;
}): Promise<{ svg: string; sizePx: number; modules: number; version: number }> {
  const { uri, errorCorrectionLevel = 'Q', color, floorPx } = args;
  const qr = QRCode.create(uri, { errorCorrectionLevel });
  const modules = qr.modules.size;

  // 4.0 design px per module → ~1.06 mm per module at 4-inch print.
  // That's ~6% above the 1.0 mm floor where consumer printers start to
  // fail, which gives a small safety buffer without bloating the QR.
  const dynamicSize = Math.ceil(modules * 4.0);
  const sizePx = Math.max(floorPx, dynamicSize);

  const svg = await QRCode.toString(uri, {
    type: 'svg',
    errorCorrectionLevel,
    margin: 0,
    color,
  });

  return { svg, sizePx, modules, version: qr.version };
}
