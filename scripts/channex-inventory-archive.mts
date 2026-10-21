/** Explicit maintenance for the existing isolated staging database; no provider calls.
 * Default --check reads and validates only. --archive performs one paused CAS.
 * A lost response requires checking state/receipt, never an automatic retry.
 */
import { createBookingInventoryConsumerStore } from '../src/lib/channex-staging/booking-inventory-consumer-store.ts';
import { prepareInventoryArchive, archiveBookingInventory, verifyInventoryArchive } from '../src/lib/channex-staging/inventory-archive.ts';
const mode=process.argv[2];
if(!['--check','--archive','--verify'].includes(mode)||process.argv.length!==(mode==='--verify'?4:3))throw Error('Use --check, --archive or --verify <archive-id>');
if(process.env.CHANNEX_WORKER_MODE!=='isolated-staging')throw Error('Explicit staging mode required');
const store=createBookingInventoryConsumerStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'','HELMTEST-calderwood');
try {
 if(mode==='--verify'){
  const archive=await store.readArchive(process.argv[3]);if(!archive)throw Error('Archive missing');
  const proof=verifyInventoryArchive(archive);
  console.log(JSON.stringify({status:'verified',id:archive.id,commands:proof.journal.commands.length,previous:proof.previous}));
 }else if(mode==='--check'){
  const archive=prepareInventoryArchive(await store.read());
  console.log(JSON.stringify({status:'ready',id:archive.id,nextVersion:archive.next.format===2?archive.next.baseVersion:null}));
 }else console.log(JSON.stringify(await archiveBookingInventory(store)));
}catch{
 // No raw database/provider payloads, access credentials or guest data in output.
 console.error('Inventory maintenance did not verify completion. Read current state and archive before retrying.');
 process.exitCode=1;
}
