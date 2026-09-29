import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPdfDownload, savePdfDownload } from '../pdf-download.ts';

const pdf = '%PDF-1.7\nSynthetic fixture\n%%EOF';
for (const status of [400, 401, 403, 404, 429, 500, 503]) test('reject HTTP ' + status + ' before treating its body as a file', async () => {
  await assert.rejects(readPdfDownload(new Response(pdf, { status, headers: { 'Content-Type': 'application/pdf' } }), 'fallback.pdf'), status === 401 || status === 403 ? /not authorized/ : /could not be prepared/);
});
for (const type of ['text/html', 'application/json', 'text/plain', '']) test('reject non-PDF content type ' + type, async () => {
  await assert.rejects(readPdfDownload(new Response(pdf, { headers: { 'Content-Type': type } }), 'fallback.pdf'), /did not return a PDF/);
});
for (const body of ['', '%PDF', '<html>login</html>', '{"error":"unavailable"}']) test('reject invalid PDF body ' + JSON.stringify(body), async () => {
  await assert.rejects(readPdfDownload(new Response(body, { headers: { 'Content-Type': 'application/pdf' } }), 'fallback.pdf'), /empty or invalid/);
});
test('keep server filename and original PDF bytes', async () => {
  const value = await readPdfDownload(new Response(pdf, { headers: { 'Content-Type': 'application/pdf; charset=binary', 'Content-Disposition': 'attachment; filename="Signed copy.pdf"' } }), 'fallback.pdf');
  assert.equal(value.filename, 'Signed copy.pdf'); assert.equal(await value.blob.text(), pdf);
});
test('use fallback filename when server omits disposition', async () => {
  assert.equal((await readPdfDownload(new Response(pdf, { headers: { 'Content-Type': 'APPLICATION/PDF' } }), 'fallback.pdf')).filename, 'fallback.pdf');
});
test('a failed body read cannot become a successful download', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.error(Error('Lost body')); } }), { headers: { 'Content-Type': 'application/pdf' } });
  await assert.rejects(readPdfDownload(response, 'fallback.pdf'), /Lost body/);
});
for (const throws of [false, true]) test('blob cleanup is delayed even when browser click throws: ' + throws, () => {
  const events: string[] = []; let cleanup: (() => void) | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalTimeout = globalThis.setTimeout, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const anchor = { href: '', download: '', click() { events.push('click'); if (throws) throw Error('Download blocked'); }, remove() { events.push('remove'); } };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild: () => events.push('append') } } });
    URL.createObjectURL = () => { events.push('create'); return 'blob:synthetic'; };
    URL.revokeObjectURL = url => { assert.equal(url, 'blob:synthetic'); events.push('revoke'); };
    globalThis.setTimeout = ((fn: () => void, ms: number) => { assert.equal(ms, 5000); cleanup = fn; return 1; }) as unknown as typeof setTimeout;
    if (throws) assert.throws(() => savePdfDownload(new Blob([pdf]), 'copy.pdf'), /Download blocked/);
    else savePdfDownload(new Blob([pdf]), 'copy.pdf');
    assert.equal(anchor.href, 'blob:synthetic'); assert.equal(anchor.download, 'copy.pdf');
    assert.deepEqual(events, ['create', 'append', 'click', 'remove']); assert.ok(cleanup); cleanup(); assert.equal(events.at(-1), 'revoke');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    globalThis.setTimeout = originalTimeout; URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  }
});
