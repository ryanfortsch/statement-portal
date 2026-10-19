// Local-only verification of the exact hosted installation artifact.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildCanonicalPilotInstall } from './build-canonical-pilot-install.mjs';
import { verifyCanonicalRevisions } from './verify-canonical-revisions.mjs';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),bundle=buildCanonicalPilotInstall();
let passed=0;
const check=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
const db=new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await check('installer refuses a database without the existing isolated rehearsal marker',async()=>{
    await assert.rejects(()=>db.exec(bundle.sql),/marker required/);await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0);
  });
  await db.exec('create schema helm_cleaner_rehearsal; create table helm_cleaner_rehearsal.delivery(id int primary key, version int); insert into helm_cleaner_rehearsal.delivery values(1,6)');
  await check('installer refuses any pre-existing public application table and preserves it',async()=>{
    await db.exec('create table public.fixture_existing(id int)');
    await assert.rejects(()=>db.exec(bundle.sql),/relation exists/);await db.exec('rollback');
    assert.notEqual((await db.query("select to_regclass('public.fixture_existing') present")).rows[0].present,null);
    await db.exec('drop table public.fixture_existing');
  });
  await db.exec('create table public.helm_pilot_message_state(id int primary key, version int); insert into public.helm_pilot_message_state values(1,7); grant select on public.helm_pilot_message_state to service_role');
  await check('installer late failure rolls back every canonical table and leaves rehearsal intact',async()=>{
    const broken=bundle.sql.replace("notify pgrst,'reload schema';\ncommit;","select 1/0;\ncommit;");
    assert.notEqual(broken,bundle.sql);
    await assert.rejects(()=>db.exec(broken),/division by zero/);await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,1);
    assert.equal((await db.query('select version from helm_cleaner_rehearsal.delivery')).rows[0].version,6);
  });
  await check('installer creates an empty canonical pilot and records exact source hashes',async()=>{
    await db.exec(bundle.sql);
    const m=(await db.query('select * from helm_pilot_installation.manifest')).rows[0];
    assert.equal(m.bundle_digest,bundle.digest);assert.deepEqual(m.sources,bundle.sources);
    for(const name of ['properties','bookings','automation_sends','helm_inventory_capture_scopes','helm_booking_inventory_consumers'])
      assert.equal((await db.query('select count(*)::int n from public.'+name)).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from helm_channex_revisions.scope')).rows[0].n,0);
  });
  await check('installer exposes no canonical table to anonymous or authenticated browser roles',async()=>{
    const rows=(await db.query("select tablename from pg_tables where schemaname='public'")).rows;
    for(const role of ['anon','authenticated']) for(const {tablename} of rows){
      const p=(await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'public.'+tablename])).rows[0];
      assert.equal(p.allowed,false,role+': '+tablename);
    }
    assert.equal((await db.query("select count(*)::int n from pg_policies where schemaname='public'")).rows[0].n,0);
  });
  await check('installation neither changes the cleaner rehearsal nor creates any message job',async()=>{
    assert.equal((await db.query('select version from helm_cleaner_rehearsal.delivery')).rows[0].version,6);
    assert.equal((await db.query('select version from helm_pilot_message_state')).rows[0].version,7);
    assert.equal((await db.query("select has_table_privilege('service_role','public.helm_pilot_message_state','SELECT') allowed")).rows[0].allowed,true);
    assert.equal((await db.query('select count(*)::int n from message_automations')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from automation_sends')).rows[0].n,0);
  });
  await check('repeat full installation refuses rather than replacing existing canonical state',async()=>{
    await assert.rejects(()=>db.exec(bundle.sql),/relation exists/);await db.exec('rollback');
    assert.equal((await db.query('select bundle_digest from helm_pilot_installation.manifest')).rows[0].bundle_digest,bundle.digest);
  });
  await verifyCanonicalRevisions(db,check);
  console.log(`PASS: ${passed} exact installer/integration checks; local only; no provider or hosted calls.`);
} catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
finally{await db.close();}
