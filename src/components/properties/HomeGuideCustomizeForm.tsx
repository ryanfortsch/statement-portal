import { updateHomeGuideOverrides } from '@/app/properties/actions';
import type { HomeGuideOverrides } from '@/lib/properties';

/**
 * Inline editor for per-cell free-form overrides on the Stay Cape Ann
 * home guide. Each of the six cells has an optional plain-text override
 * that REPLACES the auto-populated default in the rendered guide. Empty
 * fields revert to the default.
 *
 * Two paragraph conventions for the override prose:
 *   - Blank line splits paragraphs
 *   - Lead a paragraph with "Note:" or "Aside:" to render it in the
 *     italic aside style (matches the existing default-cell layout)
 *
 * Renders as a <details> block (collapsed by default) so it doesn't
 * crowd the Guest Deliverables grid until staff wants to use it.
 */
export function HomeGuideCustomizeForm({
  propertyId,
  overrides,
}: {
  propertyId: string;
  overrides: HomeGuideOverrides | null;
}) {
  const ov = overrides ?? {};
  const isCustomized = Object.values(ov).some((v) => v && v.trim().length > 0);

  const fields: Array<{ key: keyof HomeGuideOverrides; num: string; title: string; defaultHint: string }> = [
    {
      key: 'wifi',
      num: '01',
      title: 'Wi-Fi',
      defaultHint:
        'Default: shows the wifi_name / wifi_password from this property\'s onboarding fields (or a "see the placard" line if blank).',
    },
    {
      key: 'climate',
      num: '02',
      title: 'Climate',
      defaultHint:
        'Default: "Heat: <heating>. Cool: <cooling>." pulled from the property fields, plus an aside about matching thermostat modes.',
    },
    {
      key: 'bathrooms',
      num: '03',
      title: 'Bathrooms',
      defaultHint:
        'Default: hardcoded line about the bathroom fan + an aside asking guests to limit flushed items to toilet paper. Override if either rule differs for this property.',
    },
    {
      key: 'parking',
      num: '04',
      title: 'Parking',
      defaultHint:
        'Default: uses the parking field if filled; otherwise the city-level default from civic.parking. Aside asks guests to keep shared driveway access clear.',
    },
    {
      key: 'kitchen',
      num: '05',
      title: 'Kitchen',
      defaultHint:
        'Default: hardcoded prose for Coffee + Cooktop + a stain aside. Most properties will want a custom override here.',
    },
    {
      key: 'trash',
      num: '06',
      title: 'Trash & Recycling',
      defaultHint:
        'Default: indoor / outdoor bins line + civic-driven pickup day, plus an aside about not taking bins to the curb on departure.',
    },
  ];

  return (
    <details
      id="home-guide-customize"
      style={{
        marginTop: 24,
        border: '1px solid var(--rule)',
        background: 'var(--paper-2)',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div className="eyebrow">Customize home guide</div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            Free-form text per cell. Replaces the auto-populated default for that section only.
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: isCustomized ? 'var(--signal)' : 'var(--ink-3)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {isCustomized ? 'Customized' : 'Defaults'}
        </div>
      </summary>

      <form
        action={updateHomeGuideOverrides.bind(null, propertyId)}
        style={{ padding: '4px 18px 22px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {fields.map((f) => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label
                htmlFor={`override_${f.key}`}
                style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
                    fontSize: 10,
                    color: 'var(--signal)',
                    letterSpacing: '0.08em',
                    fontWeight: 600,
                  }}
                >
                  {f.num}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-fraunces), Georgia, serif',
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    color: 'var(--ink)',
                  }}
                >
                  {f.title}
                </span>
              </label>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5, fontStyle: 'italic' }}>
                {f.defaultHint}
              </div>
              <textarea
                id={`override_${f.key}`}
                name={`override_${f.key}`}
                defaultValue={ov[f.key] ?? ''}
                rows={4}
                placeholder="Leave blank to keep the default."
                style={{
                  fontFamily: 'var(--font-inter), system-ui, sans-serif',
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: 'var(--ink)',
                  background: 'var(--paper)',
                  border: '1px solid var(--rule)',
                  padding: '10px 12px',
                  resize: 'vertical',
                  minHeight: 64,
                  outline: 'none',
                }}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: 'var(--ink-4)',
            lineHeight: 1.55,
            fontStyle: 'italic',
          }}
        >
          Blank line splits paragraphs. Lead a paragraph with &ldquo;Note:&rdquo; or &ldquo;Aside:&rdquo; to render
          it as a smaller italic aside (matches the default-cell second line).
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="submit"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '11px 22px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Save overrides
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Saved overrides take effect immediately on the rendered guide.
          </span>
        </div>
      </form>
    </details>
  );
}
