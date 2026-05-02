import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const salutation = projection.prospect_first_names || projection.prospect_first_name || projection.prospect_name;
  const propertyTag = `${projection.property_address}${projection.property_city ? `, ${projection.property_city}` : ''}`;

  return (
    <>
      <style>{guideCss}</style>
      <div className="rt-doc">
        <PageCover propertyTag={propertyTag} />
        <PageWelcome salutation={salutation} />
        <PageWhoWeAre />
        <PageOnboarding />
        <PageChecklist />
        <PageFAQTop />
        <PageFAQMid />
        <PageFAQBottom />
      </div>
    </>
  );
}

// ─── Pages ──────────────────────────────────────────────────────────────────
function PageCover({ propertyTag }: { propertyTag: string }) {
  return (
    <section className="rt-doc-page rt-cover">
      <div className="rt-cover-inner">
        <div className="rt-cover-eyebrow">Rising Tide</div>
        <h1 className="rt-cover-h1">Partnership Guide</h1>
        <div className="rt-cover-rule" />
        <p className="rt-cover-tag">Boutique Property Management for Vacation Rentals</p>
        <p className="rt-cover-where">Cape Ann, Massachusetts</p>
        <div className="rt-cover-property">{propertyTag}</div>
      </div>
      <div className="rt-cover-foot">
        <div className="rt-cover-foot-name">Allie Fortsch</div>
        <div className="rt-cover-foot-title">Owner / Operator, Rising Tide</div>
        <div className="rt-cover-foot-contact">
          allie@risingtidestr.com &middot; (978) 865-2387 &middot; risingtidestr.com
          <br />
          85 Eastern Ave, Gloucester, MA
        </div>
      </div>
    </section>
  );
}

function PageWelcome({ salutation }: { salutation: string }) {
  return (
    <section className="rt-doc-page">
      <DocHeader title="Welcome to Rising Tide" />
      <div className="rt-letter">
        <p className="rt-letter-greet">Dear {salutation},</p>
        <p>
          We&rsquo;re excited to introduce you to Rising Tide &mdash; a boutique vacation rental management company built around a simple belief: your home deserves to be cared for as if it were our own. By keeping our portfolio intentionally small, we&rsquo;re able to offer the kind of attentive, hands-on management that larger operators simply can&rsquo;t provide.
        </p>
        <p>
          This guide is your single reference point for everything you need to know about our partnership: from how we work to what to expect along the way. Inside, you&rsquo;ll find:
        </p>
        <ul className="rt-letter-list">
          <li>A clear overview of the onboarding journey</li>
          <li>A checklist of the few things we need from you</li>
          <li>Answers to the questions owners ask most</li>
        </ul>
        <p>
          As a boutique company, you&rsquo;ll always have a direct line to me. Questions, ideas, or just a quick check-in &mdash; please don&rsquo;t hesitate to reach out.
        </p>
        <p>We&rsquo;re looking forward to a successful partnership and smooth sailing ahead.</p>
        <p style={{ marginTop: 36 }}>Warm regards,</p>
        <div className="rt-sig-allie" aria-hidden="true">Allie</div>
        <div className="rt-letter-sig">
          <div>Allie Fortsch</div>
          <div className="rt-letter-sig-sub">Owner / Operator, Rising Tide</div>
          <div className="rt-letter-sig-sub">allie@risingtidestr.com &middot; (978) 865-2387</div>
        </div>
      </div>
      <DocFooter />
    </section>
  );
}

function PageWhoWeAre() {
  return (
    <section className="rt-doc-page">
      <DocHeader title="Who We Are" />
      <div className="rt-body">
        <p>
          Rising Tide is a boutique short-term rental management company serving Cape Ann, Massachusetts. We manage a carefully curated portfolio of vacation properties &mdash; not the largest roster we can fill, but the right properties we can serve exceptionally well.
        </p>
        <p>Our approach is built on three commitments:</p>
        <div className="rt-pillars">
          <Pillar
            heading="Boutique Care"
            body="We keep our portfolio intentionally small so every owner and property receives hands-on, personalized attention."
          />
          <Pillar
            heading="Guest Excellence"
            body="We manage every guest interaction with professionalism and warmth — maintaining a 4.99-star average rating across our properties."
          />
          <Pillar
            heading="Owner Transparency"
            body="Monthly statements, real-time property access, and clear communication whenever decisions are needed. No surprises."
          />
        </div>
        <blockquote className="rt-quote">
          &ldquo;We care for your home as if it were our own.&rdquo;
        </blockquote>
      </div>
      <DocFooter />
    </section>
  );
}

function Pillar({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rt-pillar">
      <div className="rt-pillar-h">{heading}</div>
      <div className="rt-pillar-b">{body}</div>
    </div>
  );
}

function PageOnboarding() {
  const steps: { n: string; title: string; body: string; timeline: string }[] = [
    { n: '01', title: 'Property Walkthrough', body: 'We visit the property together to align on scope, identify what\'s needed, and set expectations for launch. Typically 1–2 hours.', timeline: 'Timeline: 1–2 days to schedule' },
    { n: '02', title: 'Contract & Deposit', body: 'Review and e-sign the management agreement. A $2,000 working capital deposit covers initial setup.', timeline: 'Timeline: Completed prior to setup' },
    { n: '03', title: 'Onboarding Form', body: 'Complete the onboarding form with your property details, utilities, and access information. This is the foundation for everything we do behind the scenes.', timeline: 'Timeline: Completed during setup phase' },
    { n: '04', title: 'Property Setup', body: 'Rising Tide outfits and prepares your property to our hospitality standards — photography, listing creation, smart lock installation, supplies, and staging as needed.', timeline: 'Timeline: 1–4 weeks depending on scope' },
    { n: '05', title: 'Launch', body: 'Your property goes live on Airbnb, VRBO, the Rising Tide direct booking website (staycollections.com), and additional channels. Now the fun part begins.', timeline: 'Timeline: 1–3 days to go live' },
  ];
  return (
    <section className="rt-doc-page">
      <DocHeader title="The Onboarding Journey" />
      <p className="rt-section-lead">From our first conversation to your first booking, here&rsquo;s exactly what to expect:</p>
      <div className="rt-steps">
        {steps.map((s) => (
          <div key={s.n} className="rt-step">
            <div className="rt-step-num">{s.n}</div>
            <div className="rt-step-body">
              <div className="rt-step-title">{s.title}</div>
              <p className="rt-step-text">{s.body}</p>
              <div className="rt-step-time">{s.timeline}</div>
            </div>
          </div>
        ))}
      </div>
      <DocFooter />
    </section>
  );
}

function PageChecklist() {
  const items: { n: string; title: string; body: string }[] = [
    { n: '1', title: 'Schedule Your Property Walkthrough', body: 'Reach out to Allie to set up a time. This is the starting point for everything.' },
    { n: '2', title: 'Complete the Onboarding Form', body: 'Fill out the onboarding form with your property details, utilities, and access information.' },
    { n: '3', title: 'Sign the Management Agreement', body: 'Review and e-sign your management contract. We\'ll send it digitally for your convenience.' },
  ];
  return (
    <section className="rt-doc-page">
      <DocHeader title="Your Checklist" />
      <p className="rt-section-lead">Three things we need from you to get started. That&rsquo;s it.</p>
      <div className="rt-checklist">
        {items.map((it) => (
          <div key={it.n} className="rt-checklist-item">
            <div className="rt-checklist-num">{it.n}</div>
            <div>
              <div className="rt-checklist-title">{it.title}</div>
              <p className="rt-checklist-body">{it.body}</p>
            </div>
          </div>
        ))}
      </div>
      <DocFooter />
    </section>
  );
}

function PageFAQTop() {
  return (
    <section className="rt-doc-page">
      <DocHeader title="Owner FAQ" subtitle="What to Expect Working With Rising Tide" />
      <FAQGroup
        eyebrow="Guest Communication"
        items={[
          { q: 'Who communicates with guests?', a: 'We handle all guest communication from booking through checkout — questions, requests, check-in coordination, and issue resolution. This centralized approach ensures fast response times and a consistently high-quality guest experience.' },
          { q: 'Will I be copied on guest messages?', a: 'No. We manage guest communication end-to-end so you\'re not pulled into day-to-day questions. If something arises that requires your awareness or decision-making, we\'ll reach out directly.' },
        ]}
      />
      <FAQGroup
        eyebrow="Maintenance, Issues & Decision Thresholds"
        items={[
          { q: 'Will I be contacted about every issue at the property?', a: 'No — and that\'s intentional. We resolve routine matters independently and reach out when an unexpected expense exceeds $300, a decision affects the home long-term, or your input would meaningfully impact the outcome. Our goal is to manage day-to-day issues quietly and involve you only when it truly matters.' },
          { q: 'What happens if something urgent comes up?', a: 'If an issue poses a risk to guest safety, the home itself, or an upcoming stay, we may take immediate action to stabilize the situation and notify you as soon as possible.' },
          { q: 'How do you handle damage caused by guests?', a: 'We assess the cause and pursue recovery whenever possible — filing claims through the booking platform, applying security deposits when applicable, and providing documentation throughout. Coverage varies by channel and is never guaranteed, but we always make a good-faith effort before costs reach the owner.' },
          { q: 'What about general wear and tear or home-related issues?', a: 'Aging systems, appliance failure, leaks, and structural issues are the owner\'s responsibility. We\'ll notify you promptly and can recommend trusted vendors.' },
        ]}
      />
      <DocFooter />
    </section>
  );
}

function PageFAQMid() {
  return (
    <section className="rt-doc-page">
      <DocHeader title="Owner FAQ" subtitle="Continued" />
      <FAQGroup
        eyebrow="Pricing, Occupancy & Performance"
        items={[
          { q: 'How are nightly rates determined?', a: 'Rates are set with a focus on long-term performance — not simply filling every available night. We balance demand, seasonality, and the quality of your home to support strong revenue over time.' },
          { q: 'Why might the calendar not be completely full?', a: 'A completely full calendar isn\'t always the goal. Selective gaps can support stronger average nightly rates, preserve flexibility for high-value last-minute bookings, and reduce unnecessary wear during peak periods. We prioritize overall performance, not just occupancy percentage.' },
          { q: 'Do you focus on direct bookings?', a: 'Yes — thoughtfully. We build repeat demand and direct relationships over time while maintaining strong visibility across major platforms. The goal is a balanced channel mix that supports stability, rate discipline, and long-term performance.' },
        ]}
      />
      <FAQGroup
        eyebrow="Owner Use & Access"
        items={[
          { q: 'Can I block dates for personal use?', a: 'Yes. You can block dates directly through the Rising Tide Owner Portal. We recommend doing so as early as possible to avoid conflicts with confirmed bookings.' },
          { q: 'Can I stay at the property while it\'s under management?', a: 'Yes — owner stays are always welcome. During owner use, Rising Tide does not provide guest-style services or monitoring unless otherwise arranged in advance.' },
        ]}
      />
      <FAQGroup
        eyebrow="Financial Visibility & Reporting"
        items={[
          { q: 'How and when do I receive payouts?', a: 'Owner payouts are issued monthly following the close of each month. Each payout is accompanied by a clear statement showing gross booking revenue, expenses, management fees, and net owner payout.' },
          { q: 'What level of financial visibility will I have?', a: 'You\'ll have ongoing access to booking and performance data through the Rising Tide Owner Portal — full transparency without the noise of day-to-day management.' },
        ]}
      />
      <DocFooter />
    </section>
  );
}

function PageFAQBottom() {
  return (
    <section className="rt-doc-page">
      <DocHeader title="Owner FAQ" subtitle="Continued" />
      <FAQGroup
        eyebrow="Communication & Support"
        items={[
          { q: 'How should I reach Rising Tide?', a: 'Email is best for non-urgent questions. For time-sensitive matters, you\'ll have a direct point of contact. We respond promptly and communicate clearly, especially when decisions are required.' },
          { q: 'How often should I expect proactive updates?', a: 'Most owners prefer a lighter-touch approach. We communicate when decisions are needed, when notable issues arise, and through monthly financial reporting. If you\'d prefer more frequent check-ins, we\'re happy to align on a cadence that works for you.' },
        ]}
      />
      <div className="rt-faq-group">
        <div className="rt-faq-eyebrow">Responsibilities & Boundaries</div>
        <div className="rt-faq-q">What Rising Tide handles</div>
        <ul className="rt-faq-bullets">
          <li>All guest communication and support during stays</li>
          <li>Pricing, calendar management, and distribution across platforms</li>
          <li>Coordinating cleanings and turnovers</li>
          <li>Addressing guest-related issues while the home is occupied</li>
          <li>Identifying and flagging maintenance concerns tied to rental use</li>
        </ul>
        <div className="rt-faq-q" style={{ marginTop: 12 }}>What remains the owner&rsquo;s responsibility</div>
        <ul className="rt-faq-bullets">
          <li>Routine homeownership matters when the property is not actively rented</li>
          <li>Mail, packages, and deliveries</li>
          <li>Seasonal responsibilities (e.g., snow removal during vacancies)</li>
          <li>Long-term maintenance, upgrades, and capital improvements</li>
        </ul>
        <p className="rt-faq-a" style={{ marginTop: 8 }}>
          We&rsquo;ll flag issues we observe, but we are not responsible for maintaining the home outside the scope of active rental management.
        </p>
        <p className="rt-faq-a">
          <strong>Vacant periods.</strong> When a property is vacant and not preparing for an upcoming stay, Rising Tide does not actively monitor or manage the home. Owners should plan for seasonal care, snow events, mail, and general oversight.
        </p>
      </div>
      <div className="rt-closer">
        <div className="rt-closer-h">What a Successful Partnership Looks Like</div>
        <p>Clear expectations. Trust in the process. Open communication when decisions are needed. Our role is to manage the details so you can step back with confidence.</p>
      </div>
      <DocFooter />
    </section>
  );
}

function FAQGroup({ eyebrow, items }: { eyebrow: string; items: { q: string; a: string }[] }) {
  return (
    <div className="rt-faq-group">
      <div className="rt-faq-eyebrow">{eyebrow}</div>
      {items.map((it) => (
        <div key={it.q} className="rt-faq-row">
          <div className="rt-faq-q">{it.q}</div>
          <p className="rt-faq-a">{it.a}</p>
        </div>
      ))}
    </div>
  );
}

function DocHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="rt-doc-h">
      <h2 className="rt-doc-h-title">{title}</h2>
      {subtitle && <div className="rt-doc-h-sub">{subtitle}</div>}
      <div className="rt-doc-h-rule" />
    </header>
  );
}

function DocFooter() {
  return (
    <footer className="rt-doc-foot">
      Rising Tide &middot; risingtidestr.com &middot; allie@risingtidestr.com &middot; (978) 865-2387
    </footer>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const guideCss = `
  /* US Letter portrait at 96dpi: 816 × 1056 css px */
  @page { size: 8.5in 11in; margin: 0; }

  html, body { background: var(--ink); margin: 0; padding: 0; }

  .rt-doc {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 24px 0;
    background: #0e1a1f;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-doc-page {
    position: relative;
    width: 816px;
    height: 1056px;
    background: var(--paper);
    color: var(--ink);
    padding: 72px 80px 48px;
    box-sizing: border-box;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
    display: flex;
    flex-direction: column;
  }
  @media print {
    html, body { background: var(--paper); }
    .rt-doc { gap: 0; padding: 0; background: var(--paper); display: block; }
    .rt-doc-page { box-shadow: none; page-break-after: always; break-after: page; }
    .rt-doc-page:last-child { page-break-after: auto; break-after: auto; }
  }

  /* Cover */
  .rt-cover {
    background: var(--ink);
    color: var(--paper);
    padding: 96px 80px 60px;
    justify-content: space-between;
  }
  .rt-cover-inner { display: flex; flex-direction: column; }
  .rt-cover-eyebrow {
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--paper-3);
    font-weight: 500;
  }
  .rt-cover-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 76px;
    line-height: 1;
    font-weight: 300;
    color: var(--paper);
    letter-spacing: -0.03em;
    margin: 14px 0 0;
  }
  .rt-cover-rule { width: 64px; height: 2px; background: var(--signal); margin-top: 32px; }
  .rt-cover-tag {
    margin-top: 28px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 22px;
    line-height: 1.3;
    color: var(--paper);
    font-weight: 300;
    max-width: 540px;
  }
  .rt-cover-where {
    margin-top: 14px;
    font-size: 14px;
    letter-spacing: 0.18em;
    color: var(--paper-3);
    text-transform: uppercase;
    font-weight: 500;
  }
  .rt-cover-property {
    margin-top: 64px;
    border-top: 1px solid var(--paper-3);
    padding-top: 18px;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--paper-3);
    font-weight: 500;
  }
  .rt-cover-foot { font-size: 11px; line-height: 1.5; }
  .rt-cover-foot-name {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    color: var(--paper);
    font-weight: 400;
  }
  .rt-cover-foot-title {
    margin-top: 4px;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--paper-3);
    font-weight: 500;
  }
  .rt-cover-foot-contact {
    margin-top: 12px;
    color: var(--paper-3);
    font-size: 11px;
    line-height: 1.5;
  }

  /* Inner page header */
  .rt-doc-h { margin-bottom: 28px; }
  .rt-doc-h-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 36px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0;
  }
  .rt-doc-h-sub {
    margin-top: 6px;
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-doc-h-rule { width: 48px; height: 2px; background: var(--signal); margin-top: 16px; }

  /* Letter (welcome page) */
  .rt-letter { font-size: 13px; line-height: 1.65; color: var(--ink); flex: 1; }
  .rt-letter p { margin: 0 0 14px; max-width: 600px; }
  .rt-letter-greet { font-size: 14px !important; }
  .rt-letter-list { margin: 0 0 14px 22px; padding: 0; }
  .rt-letter-list li { padding: 4px 0; max-width: 580px; }
  .rt-sig-allie {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 32px;
    color: var(--signal);
    font-weight: 300;
    line-height: 1;
    margin-top: 8px;
    letter-spacing: -0.02em;
  }
  .rt-letter-sig {
    margin-top: 14px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    color: var(--ink);
  }
  .rt-letter-sig-sub { font-family: var(--font-inter), sans-serif; font-size: 11px; color: var(--ink-3); margin-top: 1px; }

  /* Section lead */
  .rt-section-lead { margin: 0 0 28px; font-size: 13px; color: var(--ink-3); line-height: 1.55; max-width: 600px; }

  /* Body */
  .rt-body { font-size: 13px; line-height: 1.65; color: var(--ink); flex: 1; }
  .rt-body p { margin: 0 0 14px; max-width: 620px; }

  /* Pillars (3 commitments) */
  .rt-pillars {
    margin: 28px 0;
    border-top: 1px solid var(--rule);
  }
  .rt-pillar {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 28px;
    padding: 18px 0;
    border-bottom: 1px solid var(--rule);
  }
  .rt-pillar-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--signal);
    font-weight: 400;
  }
  .rt-pillar-b { font-size: 13px; line-height: 1.55; color: var(--ink); }

  .rt-quote {
    margin: 32px 0 0;
    padding: 0;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 22px;
    color: var(--ink);
    text-align: center;
    font-weight: 300;
    line-height: 1.4;
  }

  /* Steps (onboarding journey) */
  .rt-steps { display: flex; flex-direction: column; }
  .rt-step {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 22px;
    padding: 18px 0;
    border-top: 1px solid var(--rule);
  }
  .rt-step:last-child { border-bottom: 1px solid var(--rule); }
  .rt-step-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 28px;
    color: var(--signal);
    font-weight: 300;
    line-height: 1;
  }
  .rt-step-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-step-text { margin: 6px 0 6px; font-size: 12px; line-height: 1.6; color: var(--ink-3); max-width: 560px; }
  .rt-step-time {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }

  /* Checklist */
  .rt-checklist { display: flex; flex-direction: column; gap: 18px; }
  .rt-checklist-item {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 22px;
    padding: 18px 22px;
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
  }
  .rt-checklist-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 30px;
    color: var(--signal);
    font-weight: 300;
    line-height: 1;
  }
  .rt-checklist-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-checklist-body { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--ink-3); max-width: 540px; }

  /* FAQ */
  .rt-faq-group { margin-bottom: 22px; }
  .rt-faq-eyebrow {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  .rt-faq-row { margin-bottom: 12px; }
  .rt-faq-q {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    color: var(--ink);
    font-weight: 500;
    margin-bottom: 4px;
  }
  .rt-faq-a { margin: 0 0 6px; font-size: 11px; line-height: 1.6; color: var(--ink-3); max-width: 600px; }
  .rt-faq-bullets { margin: 4px 0 0 18px; padding: 0; font-size: 11px; color: var(--ink-3); line-height: 1.6; }
  .rt-faq-bullets li { padding: 1px 0; }

  /* Closer (last page) */
  .rt-closer {
    margin-top: auto;
    padding: 24px;
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
  }
  .rt-closer-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 400;
    margin-bottom: 8px;
  }
  .rt-closer p { margin: 0; font-size: 12px; line-height: 1.55; color: var(--ink-3); max-width: 580px; }

  /* Footer */
  .rt-doc-foot {
    margin-top: auto;
    padding-top: 24px;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    border-top: 1px solid var(--rule);
  }
`;
