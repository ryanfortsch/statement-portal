'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  saveClimateProfile,
  runClimateNow,
  type SaveClimateState,
} from './climate-actions';
import type { ClimateProfile } from '@/lib/climate';
import type { SeamThermostat } from '@/lib/seam';

/**
 * Climate automation panel (Operations tab).
 *
 * Maps the property to its Seam thermostat and sets the per-property
 * setpoints. The engine (src/lib/climate.ts) holds the eco setpoint while the
 * property is empty and switches to comfort starting precool_lead_hours
 * before a check-in. Summer cools, winter heats. "Run now" fires the engine
 * for this property immediately so the operator can see it act.
 */
export function ClimatePanel({
  propertyId,
  profile,
  thermostats,
}: {
  propertyId: string;
  profile: ClimateProfile | null;
  thermostats: SeamThermostat[];
}) {
  const action = saveClimateProfile.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<SaveClimateState, FormData>(action, {
    error: null,
  });

  const [running, startRun] = useTransition();
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const thermoLabel = (t: SeamThermostat) =>
    t.properties?.name ?? t.properties?.model?.display_name ?? t.device_id;

  const lastApplied =
    profile?.last_applied_state && profile.last_applied_mode && profile.last_applied_setpoint != null
      ? `${profile.last_applied_mode} to ${profile.last_applied_setpoint}°F (${profile.last_applied_state})`
      : null;

  // Key the form on saveable fields so React remounts with fresh defaults
  // after save + revalidation (uncontrolled inputs ignore prop updates).
  const formKey = [
    profile?.seam_device_id,
    profile?.enabled,
    profile?.season_mode,
    profile?.summer_eco_f,
    profile?.summer_comfort_f,
    profile?.winter_eco_f,
    profile?.winter_comfort_f,
    profile?.precool_lead_hours,
    profile?.checkin_hour,
    profile?.checkout_hour,
  ].join('|');

  return (
    <div style={{ paddingBottom: 6 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
        Drives this property&apos;s Seam thermostat off the booking calendar: holds the eco setpoint
        while empty, then starts cooling (or heating) to the comfort setpoint{' '}
        {profile?.precool_lead_hours ?? 4} hours before each check-in and reverts after checkout.
      </p>

      {/* Status */}
      <div style={statusStyle}>
        {profile?.last_error ? (
          <span style={{ color: 'var(--negative)' }}>Last run errored: {profile.last_error}</span>
        ) : lastApplied ? (
          <span>
            Last set <strong style={{ color: 'var(--ink)' }}>{lastApplied}</strong>
            {profile?.last_applied_at ? ` · ${new Date(profile.last_applied_at).toLocaleString()}` : ''}
          </span>
        ) : (
          <span>Not run yet.</span>
        )}
      </div>

      {thermostats.length === 0 && (
        <div style={noteStyle}>
          No Seam thermostats found. Connect the Ecobee in the Seam console and set{' '}
          <code>SEAM_API_KEY</code> in Vercel, then reload this page to map it.
        </div>
      )}

      <form key={formKey} action={formAction} style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
        {/* Device + enable */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 18 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 280px' }}>
            <span style={labelStyle}>Thermostat</span>
            <select name="seam_device_id" defaultValue={profile?.seam_device_id ?? ''} style={inputStyle}>
              <option value="">— not mapped —</option>
              {thermostats.map((t) => (
                <option key={t.device_id} value={t.device_id}>
                  {thermoLabel(t)}
                </option>
              ))}
              {/* Keep a previously-mapped id selectable even if Seam didn't list it this load */}
              {profile?.seam_device_id &&
                !thermostats.some((t) => t.device_id === profile.seam_device_id) && (
                  <option value={profile.seam_device_id}>{profile.seam_device_id} (saved)</option>
                )}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', paddingBottom: 9 }}>
            <input type="checkbox" name="enabled" defaultChecked={profile?.enabled ?? false} />
            <span style={{ fontSize: 13, color: 'var(--ink)' }}>Automation on</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 150px' }}>
            <span style={labelStyle}>Season</span>
            <select name="season_mode" defaultValue={profile?.season_mode ?? 'auto'} style={inputStyle}>
              <option value="auto">Auto (by month)</option>
              <option value="summer">Summer (cool)</option>
              <option value="winter">Winter (heat)</option>
            </select>
          </label>
        </div>

        {/* Setpoints */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, marginBottom: 18 }}>
          <Num name="summer_comfort_f" label="Summer comfort °F" value={profile?.summer_comfort_f ?? 70} />
          <Num name="summer_eco_f" label="Summer idle °F" value={profile?.summer_eco_f ?? 77} />
          <Num name="winter_comfort_f" label="Winter comfort °F" value={profile?.winter_comfort_f ?? 68} />
          <Num name="winter_eco_f" label="Winter idle °F" value={profile?.winter_eco_f ?? 60} />
          <Num name="precool_lead_hours" label="Pre-condition (hrs)" value={profile?.precool_lead_hours ?? 4} />
          <Num name="checkin_hour" label="Check-in hour (0-23)" value={profile?.checkin_hour ?? 16} />
          <Num name="checkout_hour" label="Checkout hour (0-23)" value={profile?.checkout_hour ?? 11} />
        </div>

        <input type="hidden" name="timezone" value={profile?.timezone ?? 'America/New_York'} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button type="submit" disabled={pending} style={primaryBtn(pending)}>
            {pending ? 'Saving…' : 'Save climate settings'}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() =>
              startRun(async () => {
                const res = await runClimateNow(propertyId);
                setRunMsg({ ok: res.ok, text: res.message });
              })
            }
            style={ghostBtn(running)}
          >
            {running ? 'Running…' : 'Run now'}
          </button>
          {state.ok && !state.error && <span style={{ fontSize: 12, color: 'var(--positive)' }}>Saved.</span>}
        </div>

        {state.error && <div style={errorStyle}>{state.error}</div>}
        {runMsg && (
          <div style={{ ...runMsgStyle, color: runMsg.ok ? 'var(--ink-3)' : 'var(--negative)' }}>{runMsg.text}</div>
        )}
      </form>
    </div>
  );
}

function Num({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input name={name} type="number" defaultValue={value} style={inputStyle} />
    </label>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '9px 11px',
  outline: 'none',
  boxSizing: 'border-box',
};

const statusStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  marginBottom: 14,
  lineHeight: 1.5,
};

const noteStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-3)',
  background: 'var(--paper-2)',
  borderLeft: '3px solid var(--rule)',
  padding: '10px 14px',
  marginBottom: 16,
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '12px 16px',
  borderLeft: '3px solid var(--negative)',
  background: 'var(--paper-2)',
  fontSize: 13,
  color: 'var(--negative)',
  lineHeight: 1.5,
};

const runMsgStyle: React.CSSProperties = {
  marginTop: 14,
  fontSize: 13,
  lineHeight: 1.5,
};

function primaryBtn(pending: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--paper)',
    background: 'var(--ink)',
    border: '1px solid var(--ink)',
    padding: '10px 18px',
    fontWeight: 600,
    cursor: pending ? 'wait' : 'pointer',
    opacity: pending ? 0.7 : 1,
  };
}

function ghostBtn(pending: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: 'var(--ink)',
    background: 'transparent',
    border: '1px solid var(--ink)',
    padding: '10px 18px',
    fontWeight: 600,
    cursor: pending ? 'wait' : 'pointer',
    opacity: pending ? 0.7 : 1,
  };
}
