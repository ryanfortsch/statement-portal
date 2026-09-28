import type { Metadata } from 'next';

// Owner-facing walkthrough for the Massachusetts DOR short-term rental
// registration (MassTaxConnect, Room Occupancy Certificate). Linked from the
// STR section of /onboarding/<token>, and safe to paste into an owner email.
//
// Public on purpose: it passes the proxy under the "/onboarding/" prefix and
// carries no owner data, only the state's published process. The static
// segment wins over the [token] sibling, so this never reads as a token.
//
// The certificate number it asks for lands in properties.tax_cert_id via the
// form's `room_occupancy_cert` field (the remittance filing reads it). The
// city permit is a different number and goes in str_registration_id.

export const metadata: Metadata = {
  title: 'Massachusetts Short-Term Rental Registration | Rising Tide',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const MTC_URL = 'https://mtc.dor.state.ma.us/mtc/';

export default function MaStrRegistrationGuidePage() {
  return (
    <>
      <style>{guideCss}</style>

      <div className="rt-public">
        <header className="rt-pub-mast">
          <div className="rt-pub-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" />
            <span>Rising Tide</span>
          </div>
          <span className="rt-pub-tag">Owner Guide</span>
        </header>

        <section className="rt-pub-hero">
          <div className="eyebrow">Massachusetts Department of Revenue</div>
          <h1>Registering your <em>short-term rental.</em></h1>
          <p className="rt-pub-lead">
            Massachusetts requires short-term rental operators to register each rental property with the
            Department of Revenue through MassTaxConnect and obtain a Room Occupancy Certificate of
            Registration for the property. Once you have it, send us the certificate number and
            we&rsquo;ll take it from there.
          </p>
        </section>

        <div className="rt-guide">
          <div className="rt-guide-callout">
            <div className="rt-guide-callout-h">Before you start: who owns the property?</div>
            <ul>
              <li>
                <strong>Owned individually.</strong>{' '}Register using the individual owner&rsquo;s information
                and SSN or ITIN.
              </li>
              <li>
                <strong>Owned by an LLC or other entity.</strong>{' '}Register under the legal entity that owns
                the property, generally using the entity&rsquo;s EIN/TIN.
              </li>
            </ul>
          </div>

          <Step num="01" title="Do you already have a MassTaxConnect account?">
            <p>
              Go to MassTaxConnect at{' '}
              <a href={MTC_URL} target="_blank" rel="noopener noreferrer">mtc.dor.state.ma.us</a>.
            </p>
            <p>
              <strong>Already have a login?</strong>{' '}Sign in with your existing username and password and
              skip ahead to Step 3.
            </p>
            <p>
              <strong>No login yet?</strong>{' '}Complete Step 2 first.
            </p>
          </Step>

          <Step num="02" title="Create a MassTaxConnect account">
            <p>From the MassTaxConnect homepage:</p>
            <ol>
              <li>Select <Ui>Sign Up</Ui> or <Ui>Register a New Taxpayer</Ui>.</li>
              <li>Choose the registration type that matches who owns the property.</li>
            </ol>
            <div className="rt-guide-split">
              <div>
                <div className="rt-guide-split-h">Owned personally</div>
                <p>Choose <Ui>Register an Individual</Ui> and follow the prompts. You will generally need:</p>
                <ul>
                  <li>Legal name</li>
                  <li>Address</li>
                  <li>Social Security Number or ITIN</li>
                  <li>Contact information</li>
                </ul>
              </div>
              <div>
                <div className="rt-guide-split-h">Owned by an LLC or entity</div>
                <p>
                  Choose <Ui>Register a New Business</Ui> and register the entity that legally owns the
                  property. Have ready:
                </p>
                <ul>
                  <li>Legal business or entity name</li>
                  <li>Federal EIN/TIN</li>
                  <li>Business start date</li>
                  <li>Legal and mailing address</li>
                  <li>Owner or officer information, as requested</li>
                  <li>Contact information</li>
                </ul>
              </div>
            </div>
            <p>
              Finish the registration and create your username, password, and authentication method,
              then continue to Step 3.
            </p>
          </Step>

          <Step num="03" title="Add the Room Occupancy account">
            <p>After logging in to MassTaxConnect:</p>
            <ol>
              <li>From the Home page, select <Ui>More&hellip;</Ui></li>
              <li>Select <Ui>Add an Account, New Location, or New License</Ui>.</li>
              <li>Select <Ui>Room Occupancy Consolidated (for activity for July 2019 and after)</Ui>.</li>
              <li>Follow the prompts to register your short-term rental activity.</li>
            </ol>
          </Step>

          <Step num="04" title="Add your short-term rental property">
            <p>MassTaxConnect will ask about the rental property itself. Enter:</p>
            <ul>
              <li>The property address</li>
              <li>The month the property will first be offered for short-term rental</li>
              <li>Property and ownership information</li>
              <li>The months the property will be available for rental</li>
            </ul>
            <p>
              If the property operates for only part of the year, select the seasonal filing and
              operation options when prompted. Answer the remaining questions and review everything
              carefully before submitting.
            </p>
          </Step>

          <Step num="05" title="Submit the registration">
            <p>
              Submit the Room Occupancy registration. The Department of Revenue creates a separate
              Certificate of Registration for each rental property.
            </p>
            <p className="rt-guide-warn">
              The general Room Occupancy Consolidated account number is <strong>not</strong> the
              property&rsquo;s certificate number. Don&rsquo;t send us that one.
            </p>
          </Step>

          <Step num="06" title="Retrieve your property’s certificate number">
            <p>Once the registration has been processed:</p>
            <ol>
              <li>Log back in to MassTaxConnect.</li>
              <li>Open your <Ui>Room Occupancy Consolidated</Ui> account.</li>
              <li>Select <Ui>View Operator&rsquo;s Properties</Ui>.</li>
              <li>Find the rental property.</li>
              <li>Select <Ui>View Certificate</Ui>.</li>
            </ol>
            <p>
              That property&rsquo;s certificate holds the registration details Airbnb, Vrbo, and we
              need. <strong>Send us the Room Occupancy Certificate number for the property</strong>, or
              enter it on your onboarding form.
            </p>
          </Step>

          <div className="rt-guide-notes">
            <div className="rt-guide-notes-h">Good to know</div>
            <p>
              Massachusetts requires every short-term rental property to be registered even when Airbnb,
              Vrbo, or a property manager collects and remits the room occupancy taxes on your behalf.
            </p>
            <p>
              Your city or town may have its own short-term rental registration, licensing, inspection, or
              permitting requirements. The MassTaxConnect registration does not replace them.
            </p>
          </div>
        </div>

        <p className="rt-guide-contact">
          Questions? Reach Allie at <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a> or
          (978) 865-2387.
        </p>

        <footer className="rt-pub-foot">
          Rising Tide &middot; risingtidestr.com &middot; allie@risingtidestr.com &middot; (978) 865-2387
        </footer>
      </div>
    </>
  );
}

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rt-guide-step">
      <div className="rt-guide-step-h">
        <span className="rt-guide-step-num">Step {num}</span>
        <h2>{title}</h2>
      </div>
      <div className="rt-guide-step-body">{children}</div>
    </section>
  );
}

/** A MassTaxConnect button or link name, set apart so owners can scan for it. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="rt-guide-ui">{children}</span>;
}

// Same paper-and-ink vocabulary as the onboarding form, so the two read as
// one document when an owner clicks through.
const guideCss = `
  html, body { background: var(--paper); margin: 0; padding: 0; color: var(--ink); }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .rt-public { max-width: 720px; margin: 0 auto; padding: 0 24px 80px; }
  .rt-pub-mast {
    display: flex; justify-content: space-between; align-items: center;
    padding: 24px 0 18px; border-bottom: 1px solid var(--ink);
  }
  .rt-pub-brand {
    display: flex; align-items: center; gap: 10px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px; font-weight: 500; color: var(--ink); letter-spacing: -0.005em;
  }
  .rt-pub-brand img { width: 28px; height: 28px; }
  .rt-pub-tag, .eyebrow {
    font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ink-4); font-weight: 500;
  }

  .rt-pub-hero { padding: 56px 0 36px; }
  .rt-pub-hero h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 44px; line-height: 1.05; font-weight: 300; letter-spacing: -0.02em;
    color: var(--ink); margin: 12px 0 0; max-width: 560px;
  }
  .rt-pub-hero h1 em { color: var(--tide-deep); font-weight: 400; }
  .rt-pub-lead { margin: 18px 0 0; font-size: 14px; line-height: 1.6; color: var(--ink-3); max-width: 560px; }

  .rt-guide { display: flex; flex-direction: column; gap: 36px; }
  .rt-guide p, .rt-guide li { font-size: 14px; line-height: 1.6; color: var(--ink-2, var(--ink)); }
  .rt-guide p { margin: 0 0 10px; max-width: 600px; }
  .rt-guide ul, .rt-guide ol { margin: 0 0 12px; padding-left: 20px; }
  .rt-guide ul { list-style: disc; }
  .rt-guide ol { list-style: decimal; }
  .rt-guide li::marker { color: var(--ink-4); }
  .rt-guide li { margin: 2px 0; }
  .rt-guide a, .rt-guide-contact a { color: var(--signal); text-decoration: none; }
  .rt-guide a:hover, .rt-guide-contact a:hover { text-decoration: underline; }

  .rt-guide-callout { border: 1px solid var(--rule); padding: 18px 20px; }
  .rt-guide-callout ul { margin: 0; }
  .rt-guide-callout-h, .rt-guide-notes-h, .rt-guide-split-h {
    font-size: 11px; letter-spacing: 0.06em; font-weight: 600; color: var(--ink); margin-bottom: 10px;
  }

  .rt-guide-step { border-top: 1px solid var(--ink); padding-top: 22px; }
  .rt-guide-step-h { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .rt-guide-step-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px; color: var(--signal); letter-spacing: 0.08em; font-weight: 500; text-transform: uppercase;
  }
  .rt-guide-step-h h2 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px; font-weight: 400; letter-spacing: -0.01em; color: var(--ink); margin: 0;
  }

  .rt-guide-ui {
    font-weight: 600; color: var(--ink);
    background: color-mix(in srgb, var(--ink) 6%, transparent); padding: 1px 5px;
  }

  .rt-guide-split {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px; margin: 6px 0 14px;
  }
  .rt-guide-split > div { border-left: 2px solid var(--rule); padding-left: 14px; }

  .rt-guide-warn { border-left: 2px solid var(--signal); padding-left: 14px; }

  .rt-guide-notes { border-top: 1px solid var(--rule); padding-top: 22px; }
  .rt-guide-notes p { color: var(--ink-3); font-size: 13px; }

  .rt-guide-contact { margin: 40px 0 0; font-size: 12px; color: var(--ink-3); }

  .rt-pub-foot {
    margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--rule);
    font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ink-4); text-align: center;
  }

  @media (max-width: 640px) {
    .rt-pub-hero h1 { font-size: 32px; }
  }
`;
