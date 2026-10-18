import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { Section } from '@/components/Section';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isCapeAnnOps, regionLabel, CAPE_ANN_REGION } from '@/lib/property-scope';
import {
  listScheduleRecipients,
  portalLink,
  describeRecipientScope,
  type ScheduleRecipient,
} from '@/lib/cleaner-digest';
import { saveRecipientAction, saveDefaultTimesAction } from '../schedule/actions';
import { RecipientToggle } from '../schedule/RecipientToggle';

/**
 * Cleaner settings: the two admin sections that used to sit at the foot of
 * the schedule workroom. Who gets the daily text (the
 * cleaner_schedule_recipients rows, each with its live page link) and the
 * per-home default times the schedule falls back to when no adjustment is
 * set. The actions stay in ../schedule/actions.ts and land back here.
 *
 * Not a Turnovers tab: the schedule page links here from its foot, and the
 * property page and masthead send staff here to fix a missing cleaner.
 */

export const dynamic = 'force-dynamic';

const ERR_COPY: Record<string, string> = {
  bad_time: 'That time did not parse - use HH:MM or "11am".',
  bad_phone: 'That phone did not parse - ten digits, US.',
  bad_name: 'A recipient needs a display name.',
  bad_property: 'One of those property ids is not in the registry.',
  bad_region: 'That region is not in the registry.',
  mixed_region: 'Those homes are in different regions. A recipient gets one region\'s digest: add one row per region.',
  phone_taken: 'A recipient with that phone already exists.',
  recipient_gone: 'That recipient no longer exists.',
  save_failed: 'That did not save.',
};

type Notice = { tone: 'ok' | 'bad'; text: string };

function NoticeLine({ notice, style }: { notice: Notice | null; style?: React.CSSProperties }) {
  if (!notice) return null;
  return (
    <div
      role={notice.tone === 'bad' ? 'alert' : 'status'}
      style={{ fontSize: 13, fontWeight: 600, color: notice.tone === 'bad' ? 'var(--signal)' : 'var(--positive)', ...style }}
    >
      {notice.text}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: 'var(--font-mono), monospace',
  padding: '6px 9px',
  border: '1px solid var(--rule)',
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--ink)',
};

/**
 * Add / edit form for one cleaner_schedule_recipients row. No homes
 * selected means every home in the region; a selection means exactly those
 * homes, whatever region they sit in. Phone is the primary key, so an edit
 * carries the original as a hidden field.
 */
function RecipientForm({
  recipient,
  regions,
  properties,
}: {
  recipient: ScheduleRecipient | null;
  regions: string[];
  properties: Array<{ id: string; name: string; region: string | null }>;
}) {
  const byRegion = new Map<string, Array<{ id: string; name: string }>>();
  for (const p of properties) {
    const key = p.region || CAPE_ANN_REGION;
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key)!.push({ id: p.id, name: p.name });
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
  return (
    <form action={saveRecipientAction} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {recipient && <input type="hidden" name="originalPhone" value={recipient.phone} />}
      <label style={labelStyle}>
        Phone
        <input name="phone" defaultValue={recipient?.phone ?? ''} placeholder="(978) 555-0100" required style={{ ...inputStyle, width: 150 }} />
      </label>
      <label style={labelStyle}>
        Name
        <input name="displayName" defaultValue={recipient?.display_name ?? ''} placeholder="First name" required style={{ ...inputStyle, fontFamily: 'inherit', width: 140 }} />
      </label>
      <label style={labelStyle}>
        Region
        <select name="region" defaultValue={recipient?.region ?? CAPE_ANN_REGION} style={{ ...inputStyle, fontFamily: 'inherit', width: 170 }}>
          {regions.map((r) => (
            <option key={r} value={r}>{regionLabel(r)}</option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Homes (none = every home in region)
        <select name="propertyIds" multiple defaultValue={recipient?.property_ids ?? []} size={5} style={{ ...inputStyle, fontFamily: 'inherit', minWidth: 220 }}>
          {[...byRegion.entries()].map(([region, homes]) => (
            <optgroup key={region} label={regionLabel(region)}>
              {homes.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Language
        <select name="language" defaultValue={recipient?.language ?? 'pt'} style={{ ...inputStyle, fontFamily: 'inherit', width: 130 }}>
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
      </label>
      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
        <input type="checkbox" name="enabled" value="true" defaultChecked={recipient?.enabled ?? false} />
        enabled
      </label>
      <SubmitButton
        label={recipient ? 'Save' : 'Add recipient'}
        busyLabel="Saving..."
        style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 5, cursor: 'pointer' }}
      />
    </form>
  );
}

export default async function CleanerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const err = first(sp.err);
  // A recipient save lands with at=recipients, so its outcome renders in
  // that section where the anchor scrolls to. A default-times save lands
  // on its row with ?saved=1 or ?err=, and the head carries that.
  const atRecipients = first(sp.at) === 'recipients';
  const errNotice: Notice | null = err ? { tone: 'bad', text: ERR_COPY[err] ?? `Error: ${err}` } : null;
  const recipientNotice: Notice | null = atRecipients
    ? errNotice ?? (first(sp.saved) ? { tone: 'ok', text: 'Recipient saved.' } : null)
    : null;
  const headNotice: Notice | null = atRecipients
    ? null
    : errNotice ?? (first(sp.saved) ? { tone: 'ok', text: 'Saved.' } : null);

  const [recipients, propsRes] = await Promise.all([
    listScheduleRecipients(supabase).catch(() => []),
    supabase
      .from('properties')
      .select('id, name, default_checkout_time, default_checkin_time, is_active, kind, region')
      .order('name'),
  ]);

  // Every active managed home, all regions: the recipient form's picker and
  // the region options. The Cape Ann filter is for the default-times list,
  // which is the Cape Ann crew's.
  const allProps = ((propsRes.data ?? []) as Array<{ id: string; name: string; default_checkout_time: string | null; default_checkin_time: string | null; is_active: boolean | null; kind: string | null; region: string | null }>)
    .filter((p) => p.is_active !== false && p.kind !== 'hq');
  const timeProps = allProps.filter((p) => isCapeAnnOps(p));
  const allPropNames = new Map(allProps.map((p) => [p.id, p.name]));
  const regionOptions = [...new Set([
    CAPE_ANN_REGION,
    ...allProps.map((p) => p.region || CAPE_ANN_REGION),
    ...recipients.map((r) => r.region),
  ])].sort((a, b) => (a === CAPE_ANN_REGION ? -1 : b === CAPE_ANN_REGION ? 1 : a.localeCompare(b)));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs />

      <Section
        title="Cleaner settings"
        right={
          <Link href="/turnovers/schedule" style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            ← Schedule
          </Link>
        }
        paddingBottom={8}
      >
        <NoticeLine notice={headNotice} />
      </Section>

      <Section id="schedule-recipients" title="Who gets the daily text" eyebrow="Via Quo, after your approval" paddingTop={8} paddingBottom={12}>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          <NoticeLine notice={recipientNotice} style={{ padding: '10px 0 0' }} />
          {recipients.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>
              No recipients yet. Add one below.
            </div>
          )}
          {recipients.map((r) => (
            <div key={r.phone} id={`recipient-${r.phone.replace(/\D/g, '')}`} style={{ borderTop: '1px solid var(--rule)', scrollMarginTop: 100 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', flexWrap: 'wrap' }}>
                <RecipientToggle phone={r.phone} name={r.display_name} enabled={r.enabled} />
                <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, color: 'var(--ink-3)' }}>{r.phone}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {regionLabel(r.region)} · {describeRecipientScope(r, regionLabel, (id) => allPropNames.get(id) ?? id)}
                </span>
                <span className="eyebrow" style={{ fontSize: 10 }}>{r.language === 'en' ? 'English' : 'Português'}</span>
                <a
                  href={portalLink(r.portal_token)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  live page
                </a>
              </div>
              <details style={{ marginTop: -6 }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 11, color: 'var(--ink-4)', padding: '0 0 8px' }}>
                  edit scope, language, phone ▾
                </summary>
                <div style={{ padding: '4px 0 16px' }}>
                  <RecipientForm recipient={r} regions={regionOptions} properties={allProps} />
                </div>
              </details>
            </div>
          ))}
          <details style={{ borderTop: '1px solid var(--rule)' }}>
            <summary style={{ padding: '10px 0', cursor: 'pointer', listStyle: 'none', fontSize: 13, fontWeight: 600 }}>
              + Add a recipient
            </summary>
            <div style={{ padding: '4px 0 16px' }}>
              <RecipientForm recipient={null} regions={regionOptions} properties={allProps} />
            </div>
          </details>
        </div>
      </Section>

      <Section id="default-times" title="Default times per property" eyebrow="When no adjustment is set" paddingTop={8}>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {timeProps.map((p) => (
            <form
              key={p.id}
              id={`times-${p.id}`}
              action={saveDefaultTimesAction}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--rule)', flexWrap: 'wrap', scrollMarginTop: 100 }}
            >
              <input type="hidden" name="propertyId" value={p.id} />
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{p.name}</span>
              <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Guest checkout
                <input name="checkoutTime" defaultValue={p.default_checkout_time ?? ''} placeholder="10:00" style={{ ...inputStyle, width: 84 }} />
              </label>
              {/* default_checkin_time is the CLEANER's finish target, not the
                  guest's 4 PM check-in (lib/onboarding-catalog.ts, #1294). The
                  old label "in" with a 16:00 placeholder invited a new hire to
                  "correct" it and move the crew's target an hour later. */}
              <label style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Cleaner deadline
                <input name="checkinTime" defaultValue={p.default_checkin_time ?? ''} placeholder="15:00" style={{ ...inputStyle, width: 84 }} />
              </label>
              <SubmitButton
                label="Save"
                busyLabel="..."
                spinnerTone="ink"
                style={{ fontSize: 11, padding: '5px 12px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer' }}
              />
            </form>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
          Blank = Guesty&rsquo;s listing default.
        </div>
      </Section>

      <div style={{ flex: 1 }} />
      <HelmFooter left="Turnovers · Cleaner settings" right="Recipients and default times" />
    </div>
  );
}
