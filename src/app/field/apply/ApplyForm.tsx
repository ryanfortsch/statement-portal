'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { submitApplication, type ApplyState } from './actions';
import { ApplyVideo } from './ApplyVideo';

/**
 * The public application form, as a client component with useActionState
 * (same pattern as OnboardingForm): a validation failure renders a specific
 * inline error next to the submit button and the form stays mounted with
 * everything the applicant typed — including an uploaded intro video —
 * instead of redirecting to a wiped form with a generic message.
 *
 * Mobile-first details: 16px inputs (below 16 iOS auto-zooms on every focus),
 * inputMode/autoComplete so phone keyboards and autofill do the typing, and a
 * pending submit button so a slow connection can't double-fire.
 */

const input: React.CSSProperties = {
  width: '100%',
  font: 'inherit',
  fontSize: 16,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '10px 12px',
  marginTop: 5,
};
const lbl: React.CSSProperties = { fontSize: 13, color: 'var(--ink-3)', display: 'block', marginBottom: 20 };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        background: 'var(--signal)',
        color: 'var(--paper)',
        border: 'none',
        borderRadius: 6,
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.75 : 1,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        padding: '14px 30px',
        minHeight: 48,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="animate-spin"
          style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(250,247,241,0.35)', borderTopColor: 'var(--paper)', borderRadius: '50%' }}
        />
      )}
      {pending ? 'Sending application…' : 'Submit application'}
    </button>
  );
}

/** Inline error that scrolls itself into view — after tapping Submit the eye
 *  (and the viewport) is at the bottom of a long form, so an error rendered
 *  anywhere else reads as a dead button. */
function InlineError({ error }: { error: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);
  if (!error) return null;
  return (
    <div
      ref={ref}
      role="alert"
      style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', fontSize: 14, marginBottom: 16, borderRadius: 6 }}
    >
      {error}
    </div>
  );
}

export function ApplyForm({ source }: { source: string }) {
  const [state, formAction] = useActionState<ApplyState, FormData>(submitApplication, { error: '' });

  return (
    <form action={formAction} style={{ maxWidth: 520, paddingBottom: 40 }}>
      <input type="hidden" name="source" value={source} />
      <label style={lbl}>
        Full name *
        <input name="full_name" required autoComplete="name" placeholder="Jordan Reed" style={input} />
      </label>
      <label style={lbl}>
        Email *
        <input name="email" type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" style={input} />
      </label>
      <label style={lbl}>
        Phone *
        <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="(978) 555-0123" style={input} />
      </label>
      <label style={lbl}>
        Where are you based? *
        <input name="area" required autoComplete="address-level2" placeholder="Gloucester, Rockport, Beverly…" style={input} />
      </label>
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
        <legend style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8, padding: 0 }}>
          Do you have a reliable vehicle? *
        </legend>
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)', minHeight: 40 }}>
            <input type="radio" name="has_transport" value="yes" required /> Yes
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)', minHeight: 40 }}>
            <input type="radio" name="has_transport" value="no" /> No
          </label>
        </div>
      </fieldset>
      <label style={lbl}>
        When can you work?
        <input name="availability" placeholder="e.g. weekend afternoons (most turnovers are Wed–Sun)" style={input} />
      </label>
      <label style={lbl}>
        How did you hear about us?
        <input name="heard_about" placeholder="Indeed, a friend, Facebook…" style={input} />
      </label>
      <label style={lbl}>
        Tell us a little about yourself
        <textarea name="about" rows={4} placeholder="Any property, hospitality, cleaning, or home-maintenance experience? Why this work?" style={{ ...input, resize: 'vertical' }} />
      </label>
      <ApplyVideo />
      <InlineError error={state.error} />
      <SubmitButton />
    </form>
  );
}
