/** The property page's Listing section in React/Chromium: a read view per block,
 * Edit opens one block, Draft with AI fills the Guesty description fields and Save keeps them;
 * Cancel restores a block, the amenity catalog edits in a drawer, and each block posts only its part.
 * Synthetic content and controlled Server Action promises only; no model, no database.
 * (Until 2026-10-18 this fixture drove the Listing Copy Studio, which is retired.)
 * --serve exposes the same fixture for manual browser checks. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), 'helm-listing-editor-'));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
for (const [name, path] of [
  ['component', 'src/app/properties/[id]/ListingPanel.tsx'],
  ['policy', 'src/app/properties/[id]/HousePolicyReadout.tsx'],
  ['copyshape', 'src/lib/listing-copy-shape.ts'],
  ['drawer', 'src/components/Drawer.tsx'],
  ['stabletime', 'src/lib/stable-time.ts'],
  ['confirm-dialog', 'src/components/ConfirmDialog.tsx'],
  ['confirm-question', 'src/lib/confirm-question.ts'],
  ['button-class', 'src/lib/button-class.ts'],
]) await writeFile(join(scratch, name + '.js'), compile(await readFile(join(root, path), 'utf8')));
await writeFile(join(scratch, 'actions.js'), `
  const call = (kind, args) => new Promise((resolve, reject) => {
    window.calls.push({kind, args, resolve, reject});
  });
  export const draftListingWithAiAction = (...args) => call('draft', args);
  export const saveListingContentAction = (propertyId, prev, fd) => call('save', [propertyId, Object.fromEntries([...fd.entries()].filter(([k]) => typeof fd.get(k) === 'string')), fd.getAll('amenities')]);
  const unused = () => Promise.resolve({ ok: true });
  export const addPhotoUrlAction = unused, deletePhotoAction = unused, movePhotoAction = unused,
    recordUploadedPhotoAction = unused, setHeroAction = unused, updatePhotoAction = unused;
`);
await writeFile(join(scratch, 'link.js'), compile(`
  import React from 'react';
  export default function Link({href, children, ...rest}) { return <a href={href} {...rest}>{children}</a>; }
`));
await writeFile(join(scratch, 'blob.js'), `export const upload = () => Promise.reject(new Error('No uploads in this fixture'));`);
await writeFile(join(scratch, 'sellit.js'), compile(`
  import React from 'react';
  export function HowWeSellIt() { return <div>How we sell it editor</div>; }
`));
await writeFile(join(scratch, 'entry.js'), compile(`
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {ListingPanel} from './component.js';
  window.calls = [];
  const base = {
    property_id: 'synthetic', title: 'Saved title', summary: 'Saved summary', space: '', access: '',
    interaction: 'Text us', neighborhood: '', notes: '', property_type: 'House', room_type: '',
    bedrooms: 3, bathrooms: 2, beds: 4, amenities: ['Wifi'], amenities_not_included: [],
    source: 'helm', source_ref: null, updated_at: '2026-10-18T12:00:00Z', updated_by: 'staff@example.test',
  };
  window.lastBase = base;
  const policy = {checkout: null, maxOccupancy: null, pets: null, quietHours: null, cancellation: null, houseRules: null};
  function Fixture() {
    const [content, setContent] = useState(base);
    const [sca, setSca] = useState(null);
    const [n, setN] = useState(0);
    window.setContent = patch => setContent(c => ({...c, ...patch}));
    window.replaceContent = (next, nextSca = null) => { setContent(next); setSca(nextSca); setN(x => x + 1); };
    return <ListingPanel key={n} propertyId="synthetic" content={content} photos={[]} beds={{text: '', perRoom: []}}
      catalog={[{group: 'Basics', items: ['Wifi', 'Washer']}]} helmRun={false}
      registry={{title: 'Registry title', bedrooms: null, bathrooms: null}} housePolicy={policy} sca={sca}/>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`));
await new Promise((done, reject) => {
  const compiler = webpack({mode:'development',devtool:false,context:scratch,
    entry:join(scratch,'entry.js'),output:{path:scratch,filename:'bundle.js'},
    resolve:{modules:[join(root,'node_modules')],alias:{
      './listing-actions':join(scratch,'actions.js'),
      './HousePolicyReadout':join(scratch,'policy.js'),
      './HowWeSellIt':join(scratch,'sellit.js'),
      '@/lib/listing-copy-shape':join(scratch,'copyshape.js'),
      '@/components/Drawer':join(scratch,'drawer.js'),
      '@/lib/stable-time':join(scratch,'stabletime.js'),
      '@/components/ConfirmDialog':join(scratch,'confirm-dialog.js'),
      '@/lib/confirm-question':join(scratch,'confirm-question.js'),
      '@/lib/button-class':join(scratch,'button-class.js'),
      'next/link':join(scratch,'link.js'),
      '@vercel/blob/client':join(scratch,'blob.js'),
    }},performance:{hints:false},
  });
  compiler.run((error,stats)=>compiler.close(()=>error || stats?.hasErrors()
    ? reject(error || Error(stats.toString({all:false,errors:true}))) : done()));
});
const server = createServer(async (req,res) => {
  if (req.method !== 'GET') {res.writeHead(405).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'");
  if (req.url === '/bundle.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    res.end(await readFile(join(scratch,'bundle.js')));
  } else {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><title>Listing editor fixture</title><meta name="viewport" content="width=device-width"><style>body{font:15px system-ui;margin:20px;--ink:#222;--paper:#fff;--rule:#ddd;--ink-3:#444;--ink-4:#666;--positive:#175d29;--negative:#a22;--signal:#a22}button{margin-right:8px}</style><div id="root"></div><script src="/bundle.js"></script>');
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, page, checks = 0;
try {
  if (process.argv.includes('--serve')) {
    console.log(`Fixture: ${origin}/`);
    await new Promise(resolve => {process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else {
    browser = await puppeteer.launch({
      executablePath:process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await chromium.executablePath()),
      headless:true,args:process.platform === 'darwin' ? ['--no-sandbox'] : chromium.args,
    });
    page = await browser.newPage(); page.setDefaultTimeout(10000);
    const errors=[], confirmations=[], decisions=[];
    page.on('pageerror', e=>errors.push(e.message));
    page.on('dialog', async dialog => {
      confirmations.push(dialog.message());
      if (decisions.shift()) await dialog.accept(); else await dialog.dismiss();
    });
    await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(origin+'/') ? request.continue() : request.abort());
    const click = text => page.evaluate(text => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
      if (!b || b.disabled) throw Error(`Button not ready: ${text}`);
      b.click();
    }, text);
    const reset = async () => { await page.goto(origin); await page.waitForSelector('[name="space"]'); };
    const clickLabel = label => page.evaluate(label => {
      const b = document.querySelector(`button[aria-label="${label}"]`);
      if (!b || b.disabled) throw Error(`Button not ready: ${label}`);
      b.click();
    }, label);
    const val = name => page.$eval(`[name="${name}"]`, e => e.value);
    const edit = (selector,value) => page.$eval(selector,(input,value)=>{
      const proto=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },value);
    const waitCalls = n => page.waitForFunction(n=>window.calls.length===n,{},n);
    const waitText = text=>page.waitForFunction(text=>document.body.textContent.includes(text),{},text);
    const finish = (result,reject=false) => page.evaluate((result,reject)=>{
      const call=window.calls.at(-1); reject ? call.reject(new Error('Synthetic transport failure')) : call.resolve(result);
    },result,reject);
    const draft = {title:'AI title',summary:'AI summary',space:'AI space',access:'AI access',neighborhood:'AI neighborhood'};
    const pass = name=>{checks++;console.log(`PASS ${name}`);};

    await reset();
    assert.equal(await page.$('textarea[name="summary"]'), null, 'the listing opens read-only');
    assert.equal(await page.$('input[aria-label="Note for Draft with AI"]'), null, 'Draft with AI waits for an open block');
    await waitText('Saved title'); await waitText('Saved summary');
    pass('the listing opens as content a guest reads, with no form open');

    await clickLabel('Edit title and summary'); await page.waitForSelector('textarea[name="summary"]');
    assert.equal(await page.$('textarea[name="space"]'), null, 'Edit opens one block');
    await edit('input[aria-label="Note for Draft with AI"]','The view at low tide');
    decisions.push(false); await click('Draft with AI'); await waitCalls(1);
    assert.equal(confirmations.length,1); assert.match(confirmations[0],/Fill blanks only keeps your text/);
    assert.deepEqual(await page.evaluate(()=>window.calls[0].args),['synthetic','The view at low tide']);
    await waitText('Drafting…');
    await finish({ok:true,draft,photos:2}); await waitText('Drafted from the property record and 2 Listing photos.');
    assert.equal(await val('summary'),'Saved summary'); assert.equal(await val('title'),'Saved title');
    assert.equal(await val('space'),'AI space'); assert.equal(await val('access'),'AI access'); assert.equal(await val('neighborhood'),'AI neighborhood');
    assert.equal(await val('interaction'),'Text us');
    pass('a declined replacement keeps typed text, fills only the blanks, and never touches a set title');

    decisions.push(true); await click('Draft with AI'); await waitCalls(2);
    await finish({ok:true,draft:{...draft,summary:'Second summary'},photos:0}); await waitText('Drafted from the property record.');
    assert.equal(await val('summary'),'Second summary'); assert.equal(await val('title'),'Saved title');
    pass('an accepted replacement rewrites the four description fields');

    await edit('textarea[name="space"]','Hand edit'); const before = await page.evaluate(()=>['summary','space','access','neighborhood'].map(n=>document.querySelector(`[name="${n}"]`).value));
    decisions.push(true); await click('Draft with AI'); await waitCalls(3);
    await finish({ok:false,error:'Could not draft the listing: synthetic'}); await waitText('Could not draft the listing: synthetic');
    decisions.push(true); await click('Draft with AI'); await waitCalls(4);
    await finish(null,true); await waitText('Could not draft the listing. Try again.');
    assert.deepEqual(await page.evaluate(()=>['summary','space','access','neighborhood'].map(n=>document.querySelector(`[name="${n}"]`).value)),before);
    pass('returned and thrown failures keep every field as it was and allow a retry');

    await page.$eval('form[aria-label="Listing copy"]', f => f.requestSubmit()); await waitCalls(5);
    const saved = await page.evaluate(()=>window.calls.at(-1).args[1]);
    assert.equal(saved.part,'copy'); assert.equal(saved.interaction,'Text us');
    assert.equal(saved.summary,'Second summary'); assert.equal(saved.space,'Hand edit'); assert.equal(saved.title,'Saved title');
    await finish({error:null,ok:true,message:'Saved.'}); await waitText('Saved.');
    pass('Save listing saves the drafted text with the hand edits');

    await page.evaluate(()=>window.setContent({updated_at:'2026-10-18T13:00:00Z',summary:'Newer saved summary',space:'Newer space'}));
    await page.waitForFunction(()=>document.querySelector('[name="summary"]').value==='Newer saved summary');
    assert.equal(await val('space'),'Newer space');
    assert.equal(await page.$('textarea[name="space"]'), null, 'a newer record closes the open blocks');
    pass('a newer saved record replaces an old draft instead of being overwritten by it');

    await page.evaluate(()=>window.setContent({updated_at:'2026-10-18T14:00:00Z',summary:'A harbor house.\n✓ Private dock\n✓ Walk to town'}));
    await waitText('A harbor house.'); await waitText('Private dock');
    assert.ok(!(await page.evaluate(()=>document.body.textContent.includes('✓ Private dock'))), 'a highlight reads as a list item, not a raw line');
    await clickLabel('Edit about'); await page.waitForSelector('textarea[name="space"]');
    await edit('textarea[name="space"]','Thrown away');
    await click('Cancel');
    await page.waitForFunction(()=>!document.querySelector('textarea[name="space"]'));
    assert.equal(await val('space'),'Newer space');
    pass('Cancel closes the block and keeps the saved text');

    await clickLabel('Edit amenities'); await page.waitForSelector('[role="dialog"] input[name="amenities"]');
    assert.equal(await page.$$eval('input[name="amenities"]', l => l.length), 2, 'the catalog renders only in the drawer');
    await page.$eval('[role="dialog"] input[value="Washer"]', e => e.click());
    const beforeAmen = await page.evaluate(()=>window.calls.length);
    await page.$eval('form[aria-label="Amenities"]', f => f.requestSubmit()); await waitCalls(beforeAmen + 1);
    const amen = await page.evaluate(()=>window.calls.at(-1).args);
    assert.equal(amen[1].part,'amenities'); assert.equal(amen[1].title, undefined, 'saving amenities never posts the copy');
    assert.deepEqual(amen[2],['Wifi','Washer']);
    await finish({error:null,ok:true,message:'Amenities saved.'});
    await page.evaluate(()=>window.setContent({updated_at:'2026-10-18T15:00:00Z',amenities:['Wifi','Washer']}));
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    await waitText('Wifi · Washer');
    pass('the amenity catalog edits in a drawer and saves only the amenities');

    await clickLabel('Edit home type and size'); await page.waitForSelector('form[aria-label="Home type and size"]');
    const beforeBasics = await page.evaluate(()=>window.calls.length);
    await page.$eval('form[aria-label="Home type and size"]', f => f.requestSubmit()); await waitCalls(beforeBasics + 1);
    const basics = await page.evaluate(()=>window.calls.at(-1).args[1]);
    assert.equal(basics.part,'basics'); assert.equal(basics.bedrooms,'3'); assert.equal(basics.summary, undefined);
    await finish({error:null,ok:true,message:'Listing saved.'});
    pass('home type and size posts only its own part');

    const headings = () => page.$$eval('h3', l => l.map(h => h.textContent));
    await page.evaluate(()=>window.replaceContent(null));
    await waitText('Helm has no listing copy for this home yet. The live listing is in Guesty.');
    assert.deepEqual(await headings(), [], 'an empty Guesty-run listing still shows empty blocks');
    assert.ok(!(await page.evaluate(()=>/Nothing written yet|Not written|None on file|No photos yet/.test(document.body.textContent))));
    assert.equal(await page.$$eval('button', l => l.filter(b => b.offsetParent).length), 1, 'more than the one Add action');
    await click('Add listing copy'); await page.waitForSelector('textarea[name="summary"]');
    assert.ok(await page.$('input[aria-label="Note for Draft with AI"]'), 'Add opens the copy with Draft with AI');
    await waitText('Guest access and notes');
    assert.deepEqual(await headings(), ['Title and summary']);
    await click('Cancel');
    await waitText('Helm has no listing copy for this home yet. The live listing is in Guesty.');
    assert.deepEqual(await headings(), [], 'Cancel left an empty block behind');
    pass('an empty listing is one line and one Add; Add opens the copy, Cancel puts the line back');

    await page.evaluate(()=>window.replaceContent({...window.lastBase, title: null, summary: 'Only a summary', space: '', access: '', interaction: '', notes: '', neighborhood: '', amenities: [], amenities_not_included: [], property_type: null, room_type: null, beds: null, bedrooms: null, bathrooms: null}));
    await waitText('Only a summary');
    assert.deepEqual(await headings(), ['Title and summary']);
    const adds = await page.evaluate(()=>[...document.querySelectorAll('button, a')].map(e => e.textContent.trim()).filter(t => ['About','Guest access and notes','Amenities','Photos','Home type and size'].includes(t)));
    assert.deepEqual(adds, ['About','Guest access and notes','Amenities','Photos','Home type and size']);
    await click('Amenities'); await page.waitForSelector('[role="dialog"] input[name="amenities"]');
    await page.keyboard.press('Escape'); await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    pass('a block shows only with content; the empty ones are one Add line, each opening its block');

    await page.evaluate(()=>window.replaceContent(null, {listingUrl: 'https://www.staycapeann.com/stays/x', snapshot: {title: 'Harbor Cottage', tagline: 'Steps from the cove', highlights: ['Deck'], about: 'Bright rooms.', rooms: [{name: 'Primary', beds: '1 King'}], heroPhoto: null}}));
    await waitText('On staycapeann.com'); await waitText('Harbor Cottage'); await waitText('From the live listing, read-only.');
    assert.ok(!(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Edit'))), 'the snapshot offers an Edit');
    assert.ok(!(await page.evaluate(()=>document.body.textContent.includes('Helm has no listing copy'))));
    await click('Write Helm’s own copy'); await page.waitForSelector('textarea[name="summary"]');
    pass('with no Helm copy, the live staycapeann.com copy shows read-only, labelled');

    await page.evaluate(()=>window.replaceContent({...window.lastBase, source: 'guesty_seed'}));
    await waitText('Copied from Guesty');
    assert.ok(!(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Edit'))), 'a Guesty seed is editable before Edit in Helm');
    await click('Edit in Helm'); await page.waitForSelector('button[aria-label="Edit title and summary"]');
    pass('a Guesty seed reads as Guesty\'s copy until Edit in Helm');
    assert.deepEqual(errors,[]);
    console.log(`All ${checks} listing editor browser checks passed.`);
  }
} catch (error) {
  if (page && !page.isClosed()) console.error('Synthetic editor state:',await page.evaluate(()=>({
    text:document.body.innerText.slice(0,2000),calls:window.calls?.map(c=>c.kind),
  })).catch(()=>null));
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
