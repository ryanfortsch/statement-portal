/** Render the real cleaner component and stylesheet with synthetic stays only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'helm-cleaner-portal-'));
const output = process.env.CLEANER_PORTAL_TEST_OUTPUT;
const css = await readFile(join(root,'src/components/cleaner/CleanerStayPortal.module.css'),'utf8');
const classes = Object.fromEntries([...css.matchAll(/\.([a-zA-Z]\w*)/g)].map(m=>[m[1],m[1]]));
const source = (await readFile(join(root,'src/components/cleaner/CleanerStayPortal.tsx'),'utf8'))
  .replace("import styles from './CleanerStayPortal.module.css';", `const styles = ${JSON.stringify(classes)};`);
await symlink(join(root,'node_modules'),join(scratch,'node_modules'));
await writeFile(join(scratch,'portal.mjs'), ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,
}}).outputText);
const { CleanerStayPortal } = await import(pathToFileURL(join(scratch,'portal.mjs')).href);
const base = { checkIn:'2026-11-24',checkOut:'2026-11-28',arrivalTime:'15:00',checkoutTime:'11:00',
  guests:4,staying:false,adjusted:false,noCleaning:false,needsReview:false };
const report = {propertyName:'Synthetic Calderwood home',from:'2026-11-11',through:'2027-11-11',stays:[
  {...base,checkIn:'2026-11-09',checkOut:'2026-11-12',staying:true}, base,
  {...base,checkIn:'2026-12-01',checkOut:'2026-12-08',guests:null,adjusted:true,noCleaning:true,needsReview:true},
  {...base,checkIn:'2027-11-11',checkOut:'2027-12-01',arrivalTime:null,checkoutTime:null},
]};
const server=createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const url=new URL(req.url,'http://fixture.test'),language=url.searchParams.get('language')==='pt'?'pt':'en';
  const value=url.searchParams.has('empty')?{...report,stays:[]}:report;
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'");
  res.end(`<!doctype html><html lang="${language}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic cleaner portal</title><style>
  :root{--ink:#0b2545;--ink-3:#51677d;--ink-4:#788b9c;--paper:#fcfaf5;--paper-2:#f2eee5;--rule:#ddd6c8;--signal:#946322}*{box-sizing:border-box}body{margin:0;background:var(--paper)}${css}</style>
  ${renderToStaticMarkup(React.createElement(CleanerStayPortal,{report:value,language,checkoutHref:'/c/synthetic'}))}</html>`);
});
let browser; const errors=[];let checks=0;
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||(process.platform==='darwin'
    ?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':await chromium.executablePath()),headless:true,
    args:process.platform==='darwin'?['--no-sandbox']:chromium.args});
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',request=>request.url().startsWith(origin+'/')?request.continue():request.abort());
  if(output)await mkdir(output,{recursive:true});
  for(const language of ['en','pt'])for(const width of [360,390,1024]){
    await page.setViewport({width,height:900});await page.goto(`${origin}/?language=${language}`);
    assert.equal(await page.$$eval('li.card',rows=>rows.length),4);checks++;
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');checks++;
    const text=await page.$eval('main',e=>e.textContent);
    assert.match(text,language==='en'?/Ready by 3:00 PM/:/Pronto até 15:00/);checks++;
    assert.match(text,language==='en'?/Confirm dates with the team/:/Confirme as datas com a equipe/);checks++;
    assert.match(text,language==='en'?/Not confirmed/:/Não confirmado/);checks++;
    assert.equal(await page.$eval('main',e=>e.lang),language==='en'?'en-US':'pt-BR');checks++;
    assert.deepEqual(await page.$$eval('a',links=>links.map(a=>a.getAttribute('href'))),['/c/synthetic']);checks++;
    assert.ok(await page.$eval('footer a',e=>e.getBoundingClientRect().height>=44));checks++;
    if(output&&width===390)await page.screenshot({path:join(output,`cleaner-portal-${language}.png`),fullPage:true});
  }
  await page.goto(`${origin}/?empty`);assert.equal(await page.$eval('.empty',e=>e.textContent),'No confirmed guest stays in this window.');checks++;
  assert.equal(await page.$$eval('li.card',rows=>rows.length),0);checks++;
  assert.deepEqual(errors,[]);
  console.log(`${checks} cleaner portal browser checks passed (synthetic data; no provider calls or sends).`);
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});
}
