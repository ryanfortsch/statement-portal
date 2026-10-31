import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',source)(id => {
    if (id in mocks) return mocks[id];
    if (id === 'react/jsx-runtime' || id === 'react') return require(id);
    throw Error(`Unexpected import ${id}`);
  },module,module.exports);
  return module.exports;
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
async function schedule({ status='sent', failed=false, offline=false, noRecipients=false, notice }={}) {
  const { ScheduleDigestCard } = load('../src/app/cleaner-messaging/ScheduleDigestCard.tsx', {
    ...common,
    '@/lib/cleaner-digest': {
      getOpenDigest: async () => ({ id:'synthetic-digest',service_date:'2026-10-31',status,body:'Original schedule',sent_at:'2026-10-30T18:00:00Z',sent_log:[{results:[{name:'Test cleaner',ok:!failed}]}] }),
      listScheduleRecipients: async () => noRecipients ? [] : [{ id:'recipient',enabled:true,display_name:'Test cleaner',language:'pt',phone:'+19785550100' }],
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
test('a successfully sent schedule is folded with settings available inside', async () => {
  const html = await schedule();
  assert.match(html, /<details><summary[^>]*>View schedule and settings/);
  assert.match(html, /Schedule settings/); assert.match(html, /Original schedule/);
});
test('pending, failed and unavailable schedules stay open; unavailable sends are disabled', async () => {
  for (const options of [{status:'pending'},{failed:true},{offline:true},{notice:{err:'save_failed'}}]) {
    const html = await schedule(options);
    assert.match(html, /<details open=""><summary[^>]*>Review schedule/);
    if(options.offline) { assert.match(html, /live schedule could not be loaded/); assert.match(html, /<button disabled="">Send an update/); }
  }
  const recipients = await schedule({status:'pending',noRecipients:true});
  assert.match(recipients, /Choose a recipient in Schedule settings/);
  assert.match(recipients, /<details open=""[^>]*><summary[^>]*>Schedule settings/);
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
