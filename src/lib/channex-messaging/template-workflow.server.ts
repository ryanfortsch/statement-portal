import 'server-only';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireProductionInspectionEnvironment } from '@/lib/channex-production-runtime';
import { MESSAGE_RULE_FIELDS } from './preparation-rules';
import { runCalderwoodTemplateWorkflow } from './template-workflow';

export async function ownerTemplateWorkflow(raw: unknown) {
  const actor = await requireOwnerEmail();
  requireProductionInspectionEnvironment(process.env);
  return runCalderwoodTemplateWorkflow(raw, actor, {
    rpc: async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error };
    },
    current: async () => {
      const [property, rules] = await Promise.all([
        supabaseAdmin.from('properties').select('calendar_authority,automations_enabled').eq('id', '65_calderwood').single(),
        supabaseAdmin.from('message_automations').select(MESSAGE_RULE_FIELDS).eq('property_id', '65_calderwood').order('id').limit(7),
      ]);
      if (property.error || rules.error || !property.data || !Array.isArray(rules.data)) throw Error('Template review unavailable');
      return { authority: property.data.calendar_authority, automationsEnabled: property.data.automations_enabled, rules: rules.data };
    },
  }, { enabled: true });
}
