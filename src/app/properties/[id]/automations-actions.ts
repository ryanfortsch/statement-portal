'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  approveSend,
  deletePropertyRule,
  sendTestToOperator,
  setAutomationsEnabled,
  setPropertyRuleFlags,
  skipSend,
  upsertPropertyRule,
  type RuleInput,
} from '@/lib/automations';
import type { AutomationDelivery, AutomationTrigger, SendMode } from '@/lib/automations-core';

/**
 * Server actions for the property Automations tab (/properties/[id]).
 * Operator-in-the-loop over the automation engine: the switch, the home's
 * overrides of the fleet defaults, Approve / Skip on parked sends, and a
 * masked test text to the operator. Every action stamps the signed-in
 * operator as the actor.
 */

export type AutomationActionResult = { ok: boolean; message: string };

async function actor(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function bump(propertyId: string) {
  revalidatePath(`/properties/${propertyId}`);
}

export async function setAutomationsEnabledAction(propertyId: string, enabled: boolean): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await setAutomationsEnabled(propertyId, enabled, who);
  bump(propertyId);
  if (!r.ok) return { ok: false, message: r.error };
  if (!r.enabled) return { ok: true, message: 'Automations are off for this home. Anything still scheduled was cancelled.' };
  const p = r.planned;
  const planned = p ? `${p.planned} message${p.planned === 1 ? '' : 's'} planned across ${p.bookings} stay${p.bookings === 1 ? '' : 's'}` : 'planning runs on the next cron pass';
  return { ok: true, message: `Automations are on. ${planned}.` };
}

export type RuleFormInput = {
  key: string;
  audience: 'guest' | 'cleaner';
  trigger: AutomationTrigger;
  offset_days: number;
  at_local: string;
  delivery: AutomationDelivery;
  send_mode: SendMode;
  min_nights: string;
  subject: string;
  body: string;
  enabled: boolean;
  channel_exclusions: string[];
  configured_in_ota: boolean;
};

/** Create or replace this home's own version of a rule. */
export async function saveRuleOverrideAction(propertyId: string, form: RuleFormInput): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const minNights = form.min_nights.trim() === '' ? null : Number(form.min_nights);
  const input: RuleInput = {
    key: form.key.trim().toLowerCase(),
    audience: form.audience,
    trigger: form.trigger,
    offset_days: Number(form.offset_days),
    at_local: form.at_local.trim() === '' ? null : form.at_local.trim().slice(0, 5),
    delivery: form.delivery,
    send_mode: form.send_mode,
    min_nights: Number.isFinite(minNights as number) ? minNights : null,
    subject: form.subject.trim() || null,
    body: form.body,
    enabled: form.enabled,
    channel_exclusions: form.channel_exclusions.filter(Boolean),
    configured_in_ota: form.configured_in_ota,
  };
  const r = await upsertPropertyRule(propertyId, input, who);
  bump(propertyId);
  return r.ok ? { ok: true, message: `Saved ${r.rule.key} for this home.` } : { ok: false, message: r.error };
}

export async function setRuleEnabledAction(propertyId: string, key: string, enabled: boolean): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await setPropertyRuleFlags(propertyId, key, { enabled }, who);
  bump(propertyId);
  return r.ok ? { ok: true, message: enabled ? `${key} is on for this home.` : `${key} is silenced for this home.` } : { ok: false, message: r.error };
}

export async function setRuleSendModeAction(propertyId: string, key: string, sendMode: SendMode): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await setPropertyRuleFlags(propertyId, key, { send_mode: sendMode }, who);
  bump(propertyId);
  return r.ok
    ? { ok: true, message: sendMode === 'auto' ? `${key} sends on its own.` : `${key} waits for your approval.` }
    : { ok: false, message: r.error };
}

export async function setRuleConfiguredInOtaAction(propertyId: string, key: string, configured: boolean): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await setPropertyRuleFlags(propertyId, key, { configured_in_ota: configured }, who);
  bump(propertyId);
  return r.ok
    ? { ok: true, message: configured ? `${key} is marked as handled by the OTA's own scheduled message.` : `${key} will park OTA guests for a paste again.` }
    : { ok: false, message: r.error };
}

export async function deleteRuleOverrideAction(propertyId: string, key: string): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await deletePropertyRule(propertyId, key);
  bump(propertyId);
  return r.ok ? { ok: true, message: `Removed this home's ${key}; the fleet default applies again.` } : { ok: false, message: r.error ?? 'Delete failed.' };
}

export async function approveSendAction(propertyId: string, sendId: string, body?: string | null): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await approveSend(sendId, who, { body: body ?? null });
  bump(propertyId);
  if (!r.ok) return { ok: false, message: r.error };
  switch (r.status) {
    case 'sent':
      return { ok: true, message: 'Sent.' };
    case 'awaiting_approval':
      return { ok: false, message: 'Still waiting: the message has missing fields or no rail. Fill the property record or skip it.' };
    case 'skipped_cancelled':
    case 'skipped_dates_moved':
      return { ok: false, message: 'Not sent: the stay changed since this was planned.' };
    case 'failed':
      return { ok: false, message: 'The send failed. The ledger row carries the reason.' };
    default:
      return { ok: true, message: `Recorded as ${r.status}.` };
  }
}

export async function skipSendAction(propertyId: string, sendId: string): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await skipSend(sendId, who);
  bump(propertyId);
  return r.ok ? { ok: true, message: 'Skipped.' } : { ok: false, message: r.error };
}

export async function sendTestAction(propertyId: string, ruleId: string, phone: string): Promise<AutomationActionResult> {
  const who = await actor();
  if (!who) return { ok: false, message: 'Not signed in' };
  const r = await sendTestToOperator(propertyId, ruleId, phone);
  return r.ok ? { ok: true, message: 'Test sent from the GUESTS line, secrets masked.' } : { ok: false, message: r.error ?? 'Test failed.' };
}
