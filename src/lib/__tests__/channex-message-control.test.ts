import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageControlRequest, messageControlSchema, messageControlResultSchema } from '../channex-messaging/message-control.ts';
const id='90000000-0000-4000-8000-000000000001';
const snapshot={sendId:id,bookingId:id,lane:'guest',held:false,token:'a'.repeat(32),expiresAt:'2026-11-13T21:00:00.000Z',canHold:true,canResume:false};
test('hold requests cannot submit an actor, source clearance, scope or send command',()=>{
  const request={sendId:id,expected:'a'.repeat(32),held:true};
  assert.ok(messageControlRequest.safeParse(request).success);
  for(const extra of [{actor:'owner'},{send:true},{sourceDrainedAt:'2026-11-13'},{propertyId:'other'}])assert.equal(messageControlRequest.safeParse({...request,...extra}).success,false);
  for(const change of [{expected:''},{expected:'a'.repeat(31)},{held:'false'},{sendId:'other'}])assert.equal(messageControlRequest.safeParse({...request,...change}).success,false);
});
test('hold observations reject contradictory capabilities and unexpected private data',()=>{
  assert.ok(messageControlSchema.safeParse(snapshot).success);
  for(const change of [{held:true},{canResume:true},{lane:'other'},{to_address:'+12025550123'},{body:'private'},{expiresAt:'invalid'}])
    assert.equal(messageControlSchema.safeParse({...snapshot,...change}).success,false);
  assert.ok(messageControlSchema.safeParse({...snapshot,held:true,canHold:false,canResume:true}).success);
  assert.ok(messageControlSchema.safeParse({...snapshot,held:true,canHold:false,canResume:false}).success);
  assert.ok(messageControlResultSchema.safeParse({state:'conflict',control:snapshot}).success);
});
test('owner controls retain production, same-origin and bounded-body gates with no provider transport',()=>{
  const server=readFileSync('src/lib/channex-messaging/message-control.server.ts','utf8');
  const route=readFileSync('src/app/api/channex/message-control/route.ts','utf8');
  assert.match(server,/await requireOwnerEmail\(\)/);assert.match(server,/VERCEL_ENV === 'production'/);assert.match(server,/=== PRODUCTION_DB_URL/);
  assert.match(server,/p_actor: actor/);assert.doesNotMatch(server,/MessageTransport|\.from\(|fetch\(/);
  assert.match(route,/get\('origin'\) !== new URL\(request.url\).origin/);assert.match(route,/bytes \+= r.value.byteLength\) > 512/);
  assert.match(route,/private, no-store/);assert.match(route,/requireOwnerEmail/);
});
