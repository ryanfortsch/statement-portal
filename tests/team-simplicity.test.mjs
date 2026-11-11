import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { receivesDailyDigest } from '../src/lib/cleaner-digest-enrollment.ts';
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const compiled = { exports: {} };
  new Function('require','module','exports',source)(id => {
    if (id in mocks) return mocks[id];
    if (id === 'react/jsx-runtime' || id === 'react') return require(id);
    throw Error(`Unexpected import ${id}`);
  },compiled,compiled.exports);
  return compiled.exports;
}
const blank = () => null;
const common = {
  'next/link': ({ children, href }) => React.createElement('a',{href},children),
  '@/components/Section': { Section: ({ children, id, title, eyebrow }) => React.createElement('section',{id},title,eyebrow,children) },
  '@/components/SubmitButton': { SubmitButton: ({ label, disabled }) => React.createElement('button',{disabled},label) },
  '@/components/RetryDashboard': { RetryDashboard: () => React.createElement('button',null,'Retry') },
  '@/components/MessagingCountsRefresh': { MessagingCountsRefresh: blank },
  '@/lib/supabase-admin': { supabaseAdmin: {} },
  '../turnovers/schedule/actions': new Proxy({}, { get: () => blank }),
  '@/lib/checkout-schedule': { formatTime12: t => t },
};
async function schedule({ status='sent', failed=false, offline=false, noRecipients=false, portalOnly=false, notice }={}) {
  const { ScheduleDigestCard } = load('../src/app/cleaner-messaging/ScheduleDigestCard.tsx', {
    ...common,
    '@/lib/cleaner-digest': {
      getOpenDigest: async () => ({ id:'synthetic-digest',service_date:'2026-10-31',status,body:'Original schedule',sent_at:'2026-10-30T18:00:00Z',sent_log:[{results:[{name:'Test cleaner',ok:!failed}]}] }),
      listScheduleRecipients: async () => noRecipients ? [] : [{ id:'recipient',enabled:true,daily_digest_enabled:!portalOnly,display_name:'Test cleaner',language:'pt',phone:'+19785550100' }],
      receivesDailyDigest,
      getScheduleSettings: async () => ({ autosend_enabled:false,send_hour_et:18 }),
      composeDigestBodyLive: async () => 'Current draft',tomorrowET: () => '2026-10-31',portalLink: () => '#portal',digestBaseUrl: () => 'https://example.test',
    },
    '@/lib/checkout-schedule': { ...common['@/lib/checkout-schedule'],buildCheckoutSchedule: async () => { if(offline) throw Error('Synthetic unavailable'); return [{rows:[],counts:{checkouts:0}}]; } },
    '@/lib/turnover-notes': { loadTurnoverNotes: async () => [] },
    '@/lib/cleaner-note': { formatOperatorNote: () => '', noteRenderingIsStale: () => false },
    '@/lib/property-scope': { CAPE_ANN_REGION:'synthetic' }, '@/lib/home-label': { homeLabel: x => x }, '@/lib/house-date': { houseDay: x => x },
  });
  return renderToStaticMarkup(await ScheduleDigestCard({notice}));
}
test('a successfully sent schedule is folded and names who it texts', async () => {
  const html = await schedule();
  assert.match(html, /<details><summary[^>]*>View schedule</);
  assert.match(html, /Texts Test cleaner/); assert.match(html, /Sends only when you approve it/);
  assert.match(html, /href="\/turnovers\/settings#schedule-recipients"/); assert.match(html, /Original schedule/);
});
test('pending, failed and unavailable schedules stay open; unavailable sends are disabled', async () => {
  for (const options of [{status:'pending'},{failed:true},{offline:true},{notice:{err:'save_failed'}}]) {
    const html = await schedule(options);
    assert.match(html, /<details open=""><summary[^>]*>Review schedule/);
    if(options.offline) { assert.match(html, /live schedule could not be loaded/); assert.match(html, /<button disabled="">Send an update/); }
  }
  const recipients = await schedule({status:'pending',noRecipients:true});
  assert.match(recipients, /Nobody gets this text yet/);
  assert.match(recipients, /Cleaner settings/);
  assert.match(recipients, /<button disabled="">Approve &amp; send via Quo/);
});
test('answered owner questions stay folded while pending questions and errors stay visible', async () => {
  const card = (status, id) => ({ status,propertyId:id,propertyName:id,checkIn:'2026-10-30',checkOut:'2026-10-31',checkoutTime:'10:00' });
  for (const pending of [[],[card('pending','Pending home')]]) {
    const { OwnerHoldQuestionsCard } = load('../src/app/cleaner-messaging/OwnerHoldQuestionsCard.tsx', {
      ...common,'@/lib/button-class': { buttonClass: () => '' },
      '@/lib/owner-hold-questions': { loadOwnerHoldQuestions: async () => ({today:'2026-10-30',pending,cards:[...pending,card('clean','Answered home')]}) },
    });
    const html = renderToStaticMarkup(await OwnerHoldQuestionsCard({notice:'save_failed'}));
    assert.match(html, /That did not save/);
    assert.doesNotMatch(html, /<details[^>]*open/);
    assert.match(html, /Answered · 1 upcoming/);
    if(pending.length) assert.ok(html.indexOf('Pending home') < html.indexOf('<details'));
  }
});

test('a portal-only cleaner is not offered as a daily text recipient',async()=>{
  const html=await schedule({status:'pending',portalOnly:true});
  assert.match(html,/Nobody gets this text yet/);
  assert.match(html,/<button disabled="">Approve &amp; send via Quo/);
  assert.doesNotMatch(html,/Texts Test cleaner/);
});

test('real recipient forms preserve existing daily enrollment and default a new recipient to daily texts off',async()=>{
  const recipients=[true,false].map((daily,i)=>({phone:`+1555555010${i}`,display_name:`Synthetic ${i}`,enabled:true,
    portal_token:`synthetic-${i}`,daily_digest_enabled:daily,property_ids:['65_calderwood'],region:'bridgeport_ct',language:'en'}));
  const {default:Settings}=load('../src/app/turnovers/settings/page.tsx',{
    ...common,'@/components/HelmMasthead':{HelmMasthead:blank},'@/components/HelmFooter':{HelmFooter:blank},
    '@/components/TurnoverTabs':{TurnoverTabs:blank},
    '@/lib/supabase-admin':{supabaseAdmin:{from:()=>({select:()=>({order:async()=>({data:[]}),then:resolve=>resolve({data:[]})})})}},
    '@/lib/property-scope':{CAPE_ANN_REGION:'cape_ann',regionLabel:x=>x,isCapeAnnOps:()=>false},
    '@/lib/cleaner-digest':{listScheduleRecipients:async()=>recipients,getScheduleSettings:async()=>({autosend_enabled:true,send_hour_et:18}),
      portalLink:()=> '#synthetic',describeRecipientScope:()=> 'Synthetic home'},
    '../schedule/actions':new Proxy({},{get:()=>blank}), '../schedule/RecipientToggle':{RecipientToggle:blank},
  });
  const html=renderToStaticMarkup(await Settings({searchParams:Promise.resolve({})}));
  const controls=[...html.matchAll(/<input\b[^>]*name="dailyDigestEnabled"[^>]*>/g)].map(m=>m[0]);
  assert.equal(controls.length,3);
  assert.match(controls[0],/checked=""/);assert.doesNotMatch(controls[1],/checked=/);assert.doesNotMatch(controls[2],/checked=/);
  assert.match(html,/Daily checkout text: on/);assert.match(html,/Daily checkout text: off/);
});
