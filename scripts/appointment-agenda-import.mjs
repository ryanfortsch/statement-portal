/** Reviewed business snapshots only. Default is offline validation. --apply is
 * an explicit production write requiring the operator's separate authorization.
 * No mailbox fetches, invites, sends, migrations or automatic overwrites. */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { validateAppointment } from '../src/lib/appointment-agenda.ts';
const path = process.argv.slice(2).find(a => a !== '--apply');
if (!path) throw Error('Pass a reviewed JSON manifest; omit --apply to validate offline.');
const manifest = JSON.parse(await readFile(path, 'utf8'));
if (manifest.scope !== 'business' || !/^[^@\s]+@risingtidestr\.com$/.test(manifest.userEmail) || !Array.isArray(manifest.entries) || !manifest.entries.length) throw Error('A business manifest with an explicit Helm account is required.');
const keys = new Set(), ids = new Set();
const checked = manifest.entries.map(({id, details}) => {
  const r = validateAppointment(details);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || ids.has(id) || !r.ok) throw Error('Invalid or duplicate appointment: ' + (r.error || id));
  ids.add(id);
  for (const key of r.value.sourceKeys) { if (keys.has(key)) throw Error('Two proposed appointments claim the same source. Review them first.'); keys.add(key); }
  return { id, details: r.value };
});
console.log(`Validated ${checked.length} reviewed business appointments, ${keys.size} distinct source identities.`);
if (!process.argv.includes('--apply')) { console.log('Offline validation only. Nothing read from or written to Helm.'); process.exit(0); }
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Configure the explicitly authorized target before applying.');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
for (const item of checked) {
  const {data,error} = await db.rpc('save_agenda_appointment', { p_user_email: manifest.userEmail, p_id:item.id, p_expected_version:0, p_details:item.details });
  if (error || !data) throw Error(`Import stopped at ${item.id}; earlier rows may be committed. Reuse this manifest to retry safely. ${error?.message || 'No receipt'}`);
  // Independent read-back establishes identity, namespace and exact payload.
  const read = await db.from('agenda_appointments').select('id,user_email,details').eq('id',item.id).eq('user_email',manifest.userEmail).single();
  if (read.error || !read.data || JSON.stringify(validateAppointment(read.data.details)) !== JSON.stringify({ok:true,value:item.details})) throw Error(`Read-back not confirmed for ${item.id}; inspect before continuing.`);
  console.log(`Saved and verified ${item.id}`);
}
