import { updateHomeGuideOverrides } from '@/app/properties/actions';
import {
  HOME_GUIDE_CATALOG,
  HOME_GUIDE_CATALOG_KEYS,
  type HomeGuideOverrides,
  type HomeGuideSlot,
} from '@/lib/properties';

/**
 * Inline editor for the Stay Cape Ann home guide. The guide has six cells:
 *
 *   Slots 1-4 are FIXED essentials (Wi-Fi, Climate, Parking, Trash) — every
 *   guest needs them, so they always render in this order. Each can have an
 *   optional free-form body override.
 *
 *   Slots 5-6 are PICKER-DRIVEN — staff picks each one from a catalog
 *   (Bathrooms, Kitchen, Hot Tub, Pets, Quiet Hours, etc., or Custom with
 *   a free-form title). Default: Bathrooms in 5, Kitchen in 6 (the
 *   original layout). Each slot has an optional body override (and an
 *   optional custom title for the 'custom' key).
 *
 * Free-form prose conventions on any body override:
 *   - Blank line splits paragraphs
 *   - A paragraph leading with "Note:" or "Aside:" renders in the smaller
 *     italic aside style (matches the rest of the guide)
 *
 * Renders as a <details> block (collapsed by default) so it doesn't crowd
 * the Guest Deliverables grid until staff wants to use it.
 */
export function HomeGuideCustomizeForm({
  propertyId,
  overrides,
}: {
  propertyId: string;
  overrides: HomeGuideOverrides | null;
}) {
  const ov = overrides ?? {};
  const isCustomized =
    !!ov.wifi?.trim() ||
    !!ov.climate?.trim() ||
    !!ov.parking?.trim() ||
    !!ov.trash?.trim() ||
    !!ov.slot5 ||
    !!ov.slot6 ||
    // Legacy keys also count as "customized" so the chip reflects existing data.
    !!ov.bathrooms?.trim() ||
    !!ov.kitchen?.trim();

  // Resolve slot defaults the same way the renderer does, so the editor
  // pre-fills with what the guide currently shows (rather than a blank).
  const slot5: HomeGuideSlot = ov.slot5 ?? (ov.bathrooms?.trim()
    ? { key: 'bathrooms', body: ov.bathrooms }
    : { key: 'bathrooms' });
  const slot6: HomeGuideSlot = ov.slot6 ?? (ov.kitchen?.trim()
    ? { key: 'kitchen', body: ov.kitchen }
    : { key: 'kitchen' });

  const fixedFields: Array<{
    key: 'wifi' | 'climate' | 'parking' | 'trash';
    num: string;
    title: string;
    defaultHint: string;
  }> = [
    {
      key: 'wifi',
      num: '01',
      title: 'Wi-Fi',
      defaultHint:
        'Default: network + password rows from the property\'s wifi_* columns (plus an "A scannable QR code is posted near the entry" aside). Override only if this property needs different copy here.',
    },
    {
      key: 'climate',
      num: '02',
      title: 'Climate',
      defaultHint:
        'Default: "Heat: <heating>. Cool: <cooling>." pulled from property fields, plus an aside about matching thermostat modes.',
    },
    {
      key: 'parking',
      num: '03',
      title: 'Parking',
      defaultHint:
        'Default: uses the parking field if filled; otherwise the city-level default from civic.parking. Aside asks guests to keep shared driveway access clear.',
    },
    {
      key: 'trash',
      num: '04',
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
            Slots 1-4 are the universal essentials. Slots 5-6 you pick from a catalog or write your own.
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
        <div className="rt-hg-section-eyebrow">Fixed essentials</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {fixedFields.map((f) => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SlotLabel num={f.num} title={f.title} htmlFor={`override_${f.key}`} />
              <HintLine text={f.defaultHint} />
              <textarea
                id={`override_${f.key}`}
                name={`override_${f.key}`}
                defaultValue={ov[f.key] ?? ''}
                rows={4}
                placeholder="Leave blank to keep the default."
                style={textareaStyle}
              />
            </div>
          ))}
        </div>

        <div className="rt-hg-section-eyebrow" style={{ marginTop: 28 }}>
          Picker slots
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <PickerSlot num="05" name="slot5" slot={slot5} />
          <PickerSlot num="06" name="slot6" slot={slot6} />
        </div>

        <div
          style={{
            marginTop: 18,
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
            Save changes
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            Saved customization takes effect immediately on the rendered guide.
          </span>
        </div>
      </form>

      <style>{customizeCss}</style>
      {/* Auto-open when the URL hash matches (e.g. operator clicked the
          Welcome Guide tile's "Customize" link). Runs on initial load
          AND on hashchange so the in-page link works without a full
          navigation. Plain inline script because <details> has no
          CSS-only way to open from :target. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){function o(){if(location.hash==='#home-guide-customize'){var d=document.getElementById('home-guide-customize');if(d&&d.tagName==='DETAILS'){d.open=true;}}}o();window.addEventListener('hashchange',o);})();`,
        }}
      />
    </details>
  );
}

function SlotLabel({ num, title, htmlFor }: { num: string; title: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
          fontSize: 10,
          color: 'var(--signal)',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}
      >
        {num}
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
        {title}
      </span>
    </label>
  );
}

function HintLine({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5, fontStyle: 'italic' }}>
      {text}
    </div>
  );
}

/**
 * One picker slot: dropdown of catalog keys + body textarea + (always
 * visible) custom title field. The custom title field is annotated as
 * "only used when type is Custom" so staff doesn't get confused; we
 * intentionally don't toggle it via client JS — this is a server-
 * rendered form.
 */
function PickerSlot({
  num,
  name,
  slot,
}: {
  num: string;
  name: 'slot5' | 'slot6';
  slot: HomeGuideSlot;
}) {
  const entry = HOME_GUIDE_CATALOG[slot.key];
  const placeholderBody = entry.defaultBody
    ? `Catalog default:\n\n${entry.defaultBody}`
    : 'No default — you need to write the body for this catalog choice.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SlotLabel num={num} title={`Slot ${num}`} htmlFor={`${name}_key`} />
      <HintLine text="Pick a section type from the catalog, then write or override the body below. Default catalog body is shown as a placeholder until you type." />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
        <label
          htmlFor={`${name}_key`}
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 600,
          }}
        >
          Type
        </label>
        <select
          id={`${name}_key`}
          name={`${name}_key`}
          defaultValue={slot.key}
          style={{
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            fontSize: 13,
            color: 'var(--ink)',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            padding: '8px 12px',
            minWidth: 200,
            cursor: 'pointer',
          }}
        >
          {HOME_GUIDE_CATALOG_KEYS.map((k) => (
            <option key={k} value={k}>
              {HOME_GUIDE_CATALOG[k].title}
              {!HOME_GUIDE_CATALOG[k].defaultBody && k !== 'custom' ? '  (needs body)' : ''}
            </option>
          ))}
        </select>
      </div>

      <label
        htmlFor={`${name}_custom_title`}
        style={{
          marginTop: 8,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          fontWeight: 600,
        }}
      >
        Custom title <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontWeight: 400, fontStyle: 'italic' }}>(only used when Type is Custom)</span>
      </label>
      <input
        id={`${name}_custom_title`}
        name={`${name}_custom_title`}
        type="text"
        defaultValue={slot.customTitle ?? ''}
        placeholder="e.g. Beach Access, Pool, Pets, Quiet Hours"
        style={{
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          fontSize: 13,
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          padding: '8px 12px',
          outline: 'none',
        }}
      />

      <label
        htmlFor={`${name}_body`}
        style={{
          marginTop: 8,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          fontWeight: 600,
        }}
      >
        Body
      </label>
      <textarea
        id={`${name}_body`}
        name={`${name}_body`}
        defaultValue={slot.body ?? ''}
        rows={5}
        placeholder={placeholderBody}
        style={textareaStyle}
      />
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-inter), system-ui, sans-serif',
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '10px 12px',
  resize: 'vertical',
  minHeight: 80,
  outline: 'none',
};

const customizeCss = `
  .rt-hg-section-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 14px;
  }
`;
