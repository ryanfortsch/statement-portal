import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRegistryEntry, scaDraftPreviewSignature, scaPreviewSignature, validateScaForm, type ScaFormDraft } from '../sca-launch.ts';
import { readScaPreviewContent, requireScaPreviewMatch } from '../sca-preview.ts';

const draft: ScaFormDraft = {
  guestyListingId:'harbor', internalName:'Harbor House', publicName:'Stay by the Harbor',
  icalUrl:'https://example.test/calendar', stripeAccountKey:'HARBOR', rank:10,
  pitch:'By the water', tagline:'Harbor views', description:'A quiet home',
  highlights:['Waterfront','Patio','Parking'],
  stayFavorite:{name:'Example Cafe',town:'Gloucester',blurb:'Breakfast nearby',lat:42.6,lng:-70.6},
  sleepingArrangements:[{name:'Primary',beds:'King',photo:['https://example.test/room.jpg']}],
};
const valid=validateScaForm(draft);
assert.equal(valid.ok,true);
const entry=buildRegistryEntry(valid.data);

function reader(content = JSON.stringify({listings:{harbor:entry}})) {
  const calls: string[]=[];
  return {
    calls,
    async getBranchHeadSha(branch:string) {calls.push(branch);return 'checked-commit';},
    async getFile(path:string,ref:string) {calls.push(`${path}@${ref}`);return {contentUtf8:content};},
  };
}

test('draft signature matches the exact registry serializer, including normalized photo fields',()=>{
  assert.equal(scaDraftPreviewSignature(draft),scaPreviewSignature('harbor',entry));
  assert.equal(scaDraftPreviewSignature({...draft,tagline:' Harbor views ',highlights:[...draft.highlights,'']}),scaDraftPreviewSignature(draft));
});

test('registry object key order does not change the signature; list order and listing ID do',()=>{
  assert.equal(scaPreviewSignature('harbor',Object.fromEntries(Object.entries(entry).reverse())),scaDraftPreviewSignature(draft));
  assert.notEqual(scaDraftPreviewSignature({...draft,highlights:[...draft.highlights].reverse()}),scaDraftPreviewSignature(draft));
  assert.notEqual(scaDraftPreviewSignature({...draft,guestyListingId:'another'}),scaDraftPreviewSignature(draft));
});

test('invalid drafts and missing registry entries cannot be a verified preview',()=>{
  assert.equal(scaDraftPreviewSignature({...draft,tagline:''}),null);
  assert.equal(scaPreviewSignature('harbor',null),null);
  assert.equal(scaPreviewSignature('harbor',[]),null);
});

test('preview reads pin the registry to the checked commit',async()=>{
  const source=reader();
  const result=await readScaPreviewContent(source,'registry.json','preview-branch','harbor');
  assert.deepEqual(source.calls,['preview-branch','registry.json@checked-commit']);
  assert.deepEqual(result,{headSha:'checked-commit',signature:scaDraftPreviewSignature(draft)});
});

test('matching content returns the commit SHA for GitHub merge preconditioning',async()=>{
  assert.equal(await requireScaPreviewMatch(reader(),'registry.json','preview-branch',draft,'harbor'),'checked-commit');
});

test('newer form edits are rejected even if separately saved to the database',async()=>{
  await assert.rejects(requireScaPreviewMatch(reader(),'registry.json','preview-branch',{...draft,tagline:'New saved draft'},'harbor'),/differs from the preview/);
});

test('a different listing, absent draft, or absent branch is rejected before reading GitHub',async()=>{
  const source=reader();
  await assert.rejects(requireScaPreviewMatch(source,'registry.json','preview-branch',draft,'another'),/complete draft/);
  await assert.rejects(requireScaPreviewMatch(source,'registry.json','preview-branch',undefined,'harbor'),/complete draft/);
  await assert.rejects(requireScaPreviewMatch(source,'registry.json',null,draft,'harbor'),/complete draft/);
  assert.deepEqual(source.calls,[]);
});

test('missing listing or changed branch content fails the pre-publish check',async()=>{
  await assert.rejects(requireScaPreviewMatch(reader('{"listings":{}}'),'registry.json','preview-branch',draft,'harbor'),/differs from the preview/);
  await assert.rejects(requireScaPreviewMatch(reader(JSON.stringify({listings:{harbor:{...entry,description:'Someone else edited this'}}})),'registry.json','preview-branch',draft,'harbor'),/differs from the preview/);
});

test('missing, malformed or unreadable registries never permit publishing',async()=>{
  const source={...reader(),getFile:async()=>null};
  await assert.rejects(requireScaPreviewMatch(source,'registry.json','preview-branch',draft,'harbor'),/Could not read/);
  await assert.rejects(requireScaPreviewMatch(reader('{broken'),'registry.json','preview-branch',draft,'harbor'),SyntaxError);
  await assert.rejects(requireScaPreviewMatch({...reader(),getBranchHeadSha:async()=>{throw new Error('Offline');}},'registry.json','preview-branch',draft,'harbor'),/Offline/);
});
