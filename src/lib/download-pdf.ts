/**
 * Client-side helper that fetches /api/statement-pdf, pulls the filename
 * out of the Content-Disposition header, and triggers a real browser
 * download. Lets the caller render its own loading state around the
 * fetch instead of relying on the browser's silent <a download> behavior.
 *
 * Throws on non-2xx responses. Callers should wrap in try/finally.
 */
export async function downloadStatementPdf(id: string, month: string): Promise<void> {
  const res = await fetch(
    `/api/statement-pdf?id=${encodeURIComponent(id)}&month=${encodeURIComponent(month)}`,
  );
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `statement-${id}-${month}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
