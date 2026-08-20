import type { Metadata } from 'next';
import { loadRateCards, type RateCard, type RateTier } from '@/lib/creative-rates';
import { fieldBaseUrl } from '@/lib/field-notify';
import { PrintButton } from '../rate-card/PrintButton';

/**
 * The Social Media Contributor hiring package, Helm-native. Everything the
 * role needs in one document: why it exists, the pay model, brand guide,
 * workflow, job post, and application questions. The pay sections (rate
 * table, month scenarios, job-post hook, fine print) render LIVE from the
 * standard creative rate card, so this document can never drift from what
 * the roster and the printable card say.
 *
 * Replaces the claude.ai artifact the roster used to link (private artifact
 * URLs 404 for signed-out viewers). Print-friendly like the rate-card page.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Social Media Contributor · Hiring package · Rising Tide',
  robots: { index: false, follow: false },
};

function fmt(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}
function views(n: number): string {
  return n.toLocaleString('en-US');
}

/** Row copy for a view rung by position: first, middle, top. */
function tierMeaning(i: number, count: number): string {
  if (i === count - 1) return 'It travelled. Top of the ladder.';
  if (i === 0) return 'The reel finds an audience.';
  return 'It is working.';
}

type Scenario = { label: string; shoots: number; rec?: boolean };
const SCENARIOS: Scenario[] = [
  { label: 'One shoot', shoots: 1 },
  { label: 'Two shoots', shoots: 2, rec: true },
  { label: 'Weekly shoots', shoots: 4 },
];

function scenarioBullets(card: RateCard, shoots: number): string[] {
  const reels = shoots * card.maxPerShoot;
  const floor = reels * card.baseCents;
  const out: string[] = [];
  if (card.carouselCents > 0) {
    out.push(
      shoots === 1
        ? `+${fmt(card.carouselCents)} with the carousel`
        : `+${fmt(shoots * card.carouselCents)} with a carousel per shoot`,
    );
  }
  const t0: RateTier | undefined = card.tiers[0];
  const top: RateTier | undefined = card.tiers[card.tiers.length - 1];
  if (t0) out.push(`One reel past ${views(t0.views)} views: ${fmt(floor - card.baseCents + t0.cents)}`);
  if (top && card.tiers.length > 1) out.push(`One that tops the ladder at ${views(top.views)}+: ${fmt(floor - card.baseCents + top.cents)}`);
  return out;
}

export default async function HiringPackagePage() {
  const { def: card } = await loadRateCards();
  const base = fieldBaseUrl();
  const top: RateTier | undefined = card.tiers[card.tiers.length - 1];

  const finePrint = [
    card.minSeconds > 0 ? `A reel runs at least ${card.minSeconds} seconds.` : null,
    `Views are read from Instagram's analytics and locked ${card.countDays} days after posting; the pay is the highest mark reached, not the sum.`,
    `Up to ${card.maxPerShoot} reel${card.maxPerShoot === 1 ? '' : 's'} per shoot.`,
    'One round of revisions is included.',
    'Travel inside Cape Ann is on you; a shoot beyond the island is quoted separately.',
    ...card.extraTerms,
  ]
    .filter(Boolean)
    .join(' ');

  const payHook = top
    ? `Reels pay ${fmt(card.baseCents)} to ${fmt(top.cents)} each, stepping up with the Instagram views they earn. Paid monthly.`
    : `Reels pay ${fmt(card.baseCents)} each. Paid monthly.`;

  return (
    <div className="hpkg">
      <style>{CSS}</style>
      <PrintButton />
      <div className="doc">
        <div className="wrap">
          <header>
            <div className="eyebrow">Rising Tide &middot; Stay Cape Ann &middot; Hiring package</div>
            <h1>Social Media Contributor</h1>
            <p className="lede">For the person who can make Cape Ann look as good as it feels.</p>
            <div className="meta">
              <span><b>1099</b> contributor</span>
              <span><b>Paid per reel</b>, climbs with views</span>
              <span><b>Remote</b> plus on-location shoots</span>
              <span><b>Flexible</b>, self-paced</span>
            </div>
          </header>

          <section>
            <div className="shead"><span className="n">01</span><h2>Why this role exists</h2><span className="rule" /></div>
            <p>Rising Tide manages a small book of the best short-term rentals on Cape Ann. Our whole edge is the guest experience, and the single biggest lever we do not use enough is social. It is the top of the funnel that fills the homes.</p>
            <p>Two audiences, two accounts, one contributor:</p>
            <div className="two" style={{ marginTop: 6 }}>
              <div className="card">
                <span className="tag">Primary &middot; guests</span>
                <h3>Stay Cape Ann</h3>
                <p>Guest-facing. The homes, the coast, the reasons to book direct. This is where most of the work goes, because direct bookings skip the OTA fees and are the growth we care about.</p>
              </div>
              <div className="card">
                <span className="tag">Secondary &middot; owners</span>
                <h3>Rising Tide STR</h3>
                <p>Owner-facing. Proof that we run the best homes on Cape Ann, so owners want to list with us. Lighter cadence, more considered.</p>
              </div>
            </div>
          </section>

          <section>
            <div className="shead"><span className="n">02</span><h2>What you&rsquo;ll make</h2><span className="rule" /></div>
            <p>The core deliverable is the <strong>Reel</strong>: you concept it, shoot on location at our homes, edit, and caption, ready to post. A shoot can also produce a <strong>photo carousel</strong> with its own fresh photos or clips, the add-on on the rate card. Instagram is where views are counted; crossposting to TikTok or Pinterest is welcome when it is your strength.</p>
            <p className="muted">You are not just filling a grid. You are selling a stay: the light in the morning, the walk to Old Garden Beach, the coffee on the deck, the detail that made a guest leave five stars.</p>
          </section>

          <section>
            <div className="shead"><span className="n">03</span><h2>The rate card</h2><span className="rule" /></div>
            <p>Every reel we green-light earns a base the day it is approved. As it is watched, the pay steps up to the highest view mark it reaches on Instagram inside two weeks. The base is guaranteed; the upside is yours when a reel travels. These are our standard rates, a starting point, not a ceiling, and we will talk about them for the right person.</p>
            <div className="rate-wrap">
              <table className="rate">
                <thead>
                  <tr><th>Mark</th><th>What it means</th><th style={{ textAlign: 'right' }}>Pays</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="asset">Base, per reel</td>
                    <td className="what">Every approved reel earns this, whatever happens next.</td>
                    <td className="price">{fmt(card.baseCents)}</td>
                  </tr>
                  {card.tiers.map((t, i) => (
                    <tr key={t.views} className={i === card.tiers.length - 1 ? 'feature' : undefined}>
                      <td className="asset">
                        {views(t.views)}{i === card.tiers.length - 1 ? '+' : ''} IG views{i === card.tiers.length - 1 ? ' ★' : ''}
                      </td>
                      <td className="what">{tierMeaning(i, card.tiers.length)}</td>
                      <td className="price">{fmt(t.cents)}</td>
                    </tr>
                  ))}
                  {card.carouselCents > 0 && (
                    <tr>
                      <td className="asset">Carousel add-on</td>
                      <td className="what">A photo carousel from the same shoot. Photos or fresh clips both work, nothing pulled from the reel.</td>
                      <td className="price">+{fmt(card.carouselCents)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>{finePrint}</p>
          </section>

          <section>
            <div className="shead"><span className="n">04</span><h2>What a month looks like</h2><span className="rule" /></div>
            <p>You are paid per reel, so volume is a dial we set together each month, and the ladder is the upside. The floors below are every reel landing at base; the other numbers are the same math with a reel catching.</p>
            <div className="scenarios">
              {SCENARIOS.map((s) => {
                const reels = s.shoots * card.maxPerShoot;
                const floor = reels * card.baseCents;
                return (
                  <div key={s.label} className="scn" style={s.rec ? { borderColor: 'var(--hp-gold)' } : undefined}>
                    <div className="lvl" style={s.rec ? { color: 'var(--hp-gold)' } : undefined}>{s.label}</div>
                    <div className="amt">{fmt(floor)}+</div>
                    <div className="per">floor &middot; {reels} reel{reels === 1 ? '' : 's'} at base{s.rec ? ' · recommended' : ''}</div>
                    <ul>
                      {scenarioBullets(card, s.shoots).map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="shead"><span className="n">05</span><h2>What &ldquo;delivered&rdquo; means</h2><span className="rule" /></div>
            <p>Pay is per reel, so we both need a clean line for when one is done. A reel counts as delivered, and earns its base, when it:</p>
            <ul className="check gold">
              <li>Meets the platform spec: right format, aspect ratio{card.minSeconds > 0 ? `, at least ${card.minSeconds} seconds` : ''}, full resolution.</li>
              <li>Is on brand, in look and in voice, per the guide below.</li>
              <li>Arrives complete: the visual, the caption, hashtags, and alt text together.</li>
              <li>Is cleared to use: original work or licensed music, fonts, and images, with a signed release for any recognizable guest.</li>
              <li>Lands in the shared drive by the agreed date, and passes one office review.</li>
            </ul>
            <p className="muted" style={{ marginTop: 12 }}>The office posts approved reels; the view count locks {card.countDays} days after posting and the month&rsquo;s tally is paid together. A revision asked for inside the included round is not a new reel; a genuinely new brief is.</p>
          </section>

          <section>
            <div className="shead"><span className="n">06</span><h2>Who we&rsquo;re looking for</h2><span className="rule" /></div>
            <ul className="check">
              <li><strong>Local to Cape Ann or the North Shore.</strong> You can get to the homes, and you already know the light on the water and the good corners of Gloucester, Rockport, and Manchester.</li>
              <li><strong>A portfolio that already looks like us:</strong> warm, editorial, real. Not corporate, not over-filtered, not stock.</li>
              <li><strong>Confident shooting and editing on a phone.</strong> Reels and Stories in CapCut or similar, stills in Lightroom mobile. Pro gear is a plus, never a requirement.</li>
              <li><strong>You understand social as a booking engine,</strong> especially Instagram for travel, homes, and hospitality.</li>
              <li><strong>Reliable and self-directed.</strong> You hit deadlines, take feedback well, and do not need to be chased.</li>
              <li><strong>You have a vehicle</strong> and can pass a light background check, since you will have access to owners&rsquo; homes.</li>
            </ul>
          </section>

          <section>
            <div className="shead"><span className="n">07</span><h2>The look and the voice</h2><span className="rule" /></div>
            <p>Rising Tide is warm, editorial, and quietly premium. We invite, we do not hype. Let it breathe.</p>
            <div className="dodont">
              <div className="do">
                <h4>Lean in</h4>
                <ul>
                  <li>Natural light, real moments, the details of a home</li>
                  <li>Cape Ann as a character: the coast, the fog, the harbor, the walk to the beach</li>
                  <li>Guest-experience moments and honest five-star feelings</li>
                  <li>Sensory, specific captions in sentence case</li>
                  <li>Loose location tags: Cape Ann, Gloucester, Rockport</li>
                </ul>
              </div>
              <div className="dont">
                <h4>Steer clear</h4>
                <ul>
                  <li>Generic stock or heavy filters</li>
                  <li>Exclamation-heavy, &ldquo;paradise!!!&rdquo; influencer voice</li>
                  <li>Em dashes, ever</li>
                  <li>Exact addresses, lockbox codes, or security details</li>
                  <li>Any guest&rsquo;s face without written permission</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <div className="shead"><span className="n">08</span><h2>How it works</h2><span className="rule" /></div>
            <div className="two">
              <div className="card">
                <span className="tag">The loop</span>
                <h3>Shoot, deliver, post, paid</h3>
                <p>We agree the month&rsquo;s shoot windows up front. You deliver reels and carousels into a shared Google Drive; the office reviews and posts. Views are counted at day {card.countDays}, and the month&rsquo;s approved work is paid together.</p>
              </div>
              <div className="card">
                <span className="tag">Access</span>
                <h3>Homes and posting</h3>
                <p>Shoots happen in vacant windows between guests; we hand you a shoot list and an entry code per home, the same way our field inspectors get in. You deliver captions; the office holds the account logins and schedules, so a password never changes hands.</p>
              </div>
            </div>
          </section>

          <section>
            <div className="shead"><span className="n">09</span><h2>Rights, privacy, terms</h2><span className="rule" /></div>
            <ul className="check">
              <li><strong>Work made for hire.</strong> Rising Tide owns every delivered asset and holds full usage rights, every channel, in perpetuity. You may show the work in your own portfolio with our okay.</li>
              <li><strong>Cleared media only.</strong> Licensed or original music, fonts, and images. You warrant that everything you deliver is cleared to use.</li>
              <li><strong>Privacy first.</strong> No exact addresses or security details on any post, and no recognizable guest without a signed release. Everything you see inside a home stays confidential.</li>
              <li><strong>1099 independent contractor.</strong> You set your own hours and use your own gear. We collect a W-9, and the home-access piece comes with a light background check.</li>
            </ul>
          </section>

          <section>
            <div className="shead"><span className="n">10</span><h2>How we&rsquo;ll hire</h2><span className="rule" /></div>
            <ol className="steps">
              <li>
                <h3>Apply</h3>
                <p>A short form: who you are, where you are based, your handles, your three best pieces, your gear, and a line on why this work. The public link: <a href={`${base}/field/apply?trade=creative`}>{base.replace(/^https?:\/\//, '')}/field/apply?trade=creative</a></p>
              </li>
              <li>
                <h3>We look at your work</h3>
                <p>We review the portfolio and a 60-second &ldquo;why I am a fit&rdquo; note or video. We are reading for taste and reliability more than follower count.</p>
              </li>
              <li>
                <h3>One paid trial reel</h3>
                <p>We commission a single real reel at the standard base, and it climbs the same ladder as any other. It is the best way for both of us to feel the fit, and you are paid for it either way.</p>
              </li>
              <li>
                <h3>Offer and onboard</h3>
                <p>We send the brand guide, set up access, and agree on month one&rsquo;s shoot cadence. You are live.</p>
              </li>
            </ol>
          </section>

          <section>
            <div className="shead"><span className="n">11</span><h2>The job post</h2><span className="rule" /></div>
            <p className="muted" style={{ fontSize: 13.5 }}>Ready to publish on Instagram, Indeed, or a local board. Point it at your apply link.</p>
            <div className="tearout">
              <div className="eyebrow">Now hiring &middot; Cape Ann</div>
              <h3>Make the best homes on Cape Ann look as good as they feel.</h3>
              <p>Rising Tide is a small, boutique vacation-rental company on Cape Ann, and we are looking for a local social media contributor to help us grow. You will shoot and edit Reels at our homes, curate what guests share, and give Stay Cape Ann a feed people want to book from.</p>
              <div className="hair" />
              <ul>
                <li><strong>{payHook}</strong></li>
                <li>Flexible, self-paced, mostly remote with on-location shoots.</li>
                <li>Great fit if you shoot and edit on your phone and have an eye for warm, real, editorial content.</li>
                <li>Local to Cape Ann or the North Shore, with a vehicle.</li>
              </ul>
              <div className="hair" />
              <p style={{ marginBottom: 0 }}>Send us your handles and three favorite things you have made. Link in bio.</p>
            </div>
          </section>

          <section>
            <div className="shead"><span className="n">12</span><h2>Application questions</h2><span className="rule" /></div>
            <ol className="qs">
              <li>Name, email, and phone.</li>
              <li>Where on Cape Ann or the North Shore are you based?</li>
              <li>Your Instagram, Pinterest, TikTok, or portfolio, and your three best pieces. <span className="hint">Especially anything for a home, a place, or a local business.</span></li>
              <li>Do you shoot and edit on your phone? What do you use? <span className="hint">CapCut, Lightroom, Later, and so on.</span></li>
              <li>What gear do you own, and do you have a vehicle?</li>
              <li>How much are you looking to take on in a month, and are our rates in your range?</li>
              <li>Why Cape Ann, and why this? <span className="hint">Optional 60-second video welcome.</span></li>
            </ol>
          </section>

          <section>
            <div className="shead"><span className="n">13</span><h2>How we&rsquo;ll know it&rsquo;s working</h2><span className="rule" /></div>
            <p>The ladder already pays you for reach, reel by reel. These wider signals are the health of the relationship, not the paycheck; we review them together each month.</p>
            <ul className="check">
              <li><strong>Saves and shares</strong> first: the truest sign a post earned its place.</li>
              <li><strong>Reach and follower growth</strong> on both accounts.</li>
              <li><strong>Profile visits to link clicks to direct bookings,</strong> which we can see in our marketing dashboard.</li>
              <li><strong>Pinterest outbound clicks,</strong> the quiet long-tail booking driver.</li>
            </ul>
          </section>

          <div className="footnote">
            Rising Tide STR &middot; Gloucester, MA. This package is a starting point for the role and the rates; both flex for the right person. Not a contract. Rates shown are the live standard card; customize per talent from the Creative roster.
          </div>
        </div>
      </div>
    </div>
  );
}

// Scoped under .hpkg so nothing leaks into Helm chrome; palette mirrors the
// original package design (sand ground, tide + gold accents, Iowan serif).
const CSS = `
.hpkg {
  --hp-sand: #f4efe3; --hp-sand-2: #fbf8f1; --hp-ink: #15303a; --hp-ink-2: #3a5158;
  --hp-ink-3: #647177; --hp-tide: #2c6a78; --hp-tide-deep: #204f5a; --hp-gold: #a8823c;
  --hp-rule: #e2d9c6; --hp-rule-soft: #ece4d5; --hp-good: #3f7d55;
  --hp-serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  --hp-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --hp-mono: 'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
}
.hpkg * { box-sizing: border-box; }
.hpkg .doc { background: var(--hp-sand); color: var(--hp-ink); font-family: var(--hp-sans); line-height: 1.62; font-size: 16px; padding: clamp(24px, 5vw, 60px) clamp(18px, 5vw, 40px) 80px; min-height: 100vh; }
.hpkg .wrap { max-width: 760px; margin: 0 auto; }
.hpkg .eyebrow { font-family: var(--hp-mono); font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--hp-tide); font-weight: 600; }
.hpkg h1 { font-family: var(--hp-serif); font-weight: 500; font-size: clamp(34px, 7vw, 52px); line-height: 1.04; letter-spacing: -0.01em; text-wrap: balance; margin: 14px 0 0; }
.hpkg .lede { font-family: var(--hp-serif); font-weight: 400; font-style: italic; font-size: clamp(18px, 2.5vw, 22px); line-height: 1.4; color: var(--hp-ink-2); max-width: 34ch; margin: 18px 0 0; text-wrap: balance; }
.hpkg .meta { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--hp-rule); display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 13px; color: var(--hp-ink-3); }
.hpkg .meta b { color: var(--hp-ink); font-weight: 600; }
.hpkg section { margin-top: clamp(40px, 6vw, 64px); }
.hpkg .shead { display: flex; align-items: baseline; gap: 14px; margin-bottom: 20px; }
.hpkg .shead .n { font-family: var(--hp-mono); font-size: 12px; color: var(--hp-gold); font-weight: 600; flex-shrink: 0; }
.hpkg .shead h2 { font-family: var(--hp-serif); font-weight: 500; font-size: clamp(22px, 3.4vw, 28px); margin: 0; line-height: 1.1; flex-shrink: 0; }
.hpkg .shead .rule { flex: 1; height: 1px; background: var(--hp-rule); align-self: center; }
.hpkg p { margin: 0 0 16px; max-width: 68ch; }
.hpkg p:last-child { margin-bottom: 0; }
.hpkg strong { font-weight: 600; }
.hpkg .muted { color: var(--hp-ink-3); }
.hpkg a { color: var(--hp-tide-deep); }
.hpkg .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .hpkg .two { grid-template-columns: 1fr; } }
.hpkg .card { background: var(--hp-sand-2); border: 1px solid var(--hp-rule); border-radius: 12px; padding: 18px 20px; }
.hpkg .card h3 { font-family: var(--hp-serif); font-weight: 500; font-size: 18px; margin: 0 0 6px; }
.hpkg .card p { font-size: 14px; color: var(--hp-ink-2); margin: 0; }
.hpkg .card .tag { font-family: var(--hp-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hp-tide); font-weight: 600; }
.hpkg .rate-wrap { overflow-x: auto; border: 1px solid var(--hp-rule); border-radius: 12px; background: var(--hp-sand-2); }
.hpkg table.rate { width: 100%; border-collapse: collapse; font-size: 14.5px; min-width: 460px; }
.hpkg table.rate th, .hpkg table.rate td { text-align: left; padding: 12px 18px; vertical-align: top; }
.hpkg table.rate thead th { font-family: var(--hp-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hp-ink-3); font-weight: 600; border-bottom: 1px solid var(--hp-rule); }
.hpkg table.rate tbody tr + tr td { border-top: 1px solid var(--hp-rule-soft); }
.hpkg table.rate .asset { font-weight: 600; color: var(--hp-ink); white-space: nowrap; }
.hpkg table.rate .what { color: var(--hp-ink-2); }
.hpkg table.rate .price { font-family: var(--hp-mono); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--hp-gold); text-align: right; white-space: nowrap; }
.hpkg table.rate tr.feature { background: rgba(168,130,60,0.07); }
.hpkg .scenarios { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 620px) { .hpkg .scenarios { grid-template-columns: 1fr; } }
.hpkg .scn { background: var(--hp-sand-2); border: 1px solid var(--hp-rule); border-radius: 12px; padding: 16px 18px; }
.hpkg .scn .lvl { font-family: var(--hp-mono); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--hp-tide); font-weight: 600; }
.hpkg .scn .amt { font-family: var(--hp-serif); font-size: 30px; font-weight: 500; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
.hpkg .scn .per { font-size: 12px; color: var(--hp-ink-3); }
.hpkg .scn ul { margin: 12px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--hp-ink-2); }
.hpkg .scn li { padding: 3px 0; }
.hpkg ul.check { margin: 0; padding: 0; list-style: none; }
.hpkg ul.check li { position: relative; padding: 6px 0 6px 26px; max-width: 66ch; }
.hpkg ul.check li::before { content: ""; position: absolute; left: 4px; top: 13px; width: 8px; height: 8px; border-radius: 50%; background: var(--hp-tide); }
.hpkg ul.check.gold li::before { background: var(--hp-gold); }
.hpkg .dodont { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 560px) { .hpkg .dodont { grid-template-columns: 1fr; } }
.hpkg .dodont h4 { font-family: var(--hp-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 8px; }
.hpkg .dodont .do h4 { color: var(--hp-good); }
.hpkg .dodont .dont h4 { color: #a1553f; }
.hpkg .dodont ul { margin: 0; padding: 0; list-style: none; font-size: 14px; color: var(--hp-ink-2); }
.hpkg .dodont li { padding: 4px 0 4px 16px; position: relative; }
.hpkg .dodont li::before { position: absolute; left: 0; top: 4px; font-family: var(--hp-mono); font-size: 13px; }
.hpkg .dodont .do li::before { content: "+"; color: var(--hp-good); }
.hpkg .dodont .dont li::before { content: "\\2013"; color: #a1553f; }
.hpkg ol.steps { counter-reset: s; list-style: none; margin: 0; padding: 0; }
.hpkg ol.steps > li { counter-increment: s; position: relative; padding: 0 0 20px 46px; }
.hpkg ol.steps > li:last-child { padding-bottom: 0; }
.hpkg ol.steps > li::before { content: counter(s); position: absolute; left: 0; top: -2px; width: 30px; height: 30px; border-radius: 50%; background: var(--hp-ink); color: var(--hp-sand); font-family: var(--hp-mono); font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.hpkg ol.steps h3 { font-family: var(--hp-serif); font-weight: 500; font-size: 17px; margin: 3px 0 4px; }
.hpkg ol.steps p { font-size: 14px; color: var(--hp-ink-2); margin: 0; }
.hpkg .tearout { background: var(--hp-ink); color: #eef4f2; border-radius: 14px; padding: clamp(22px, 4vw, 34px); margin-top: 22px; }
.hpkg .tearout .eyebrow { color: #e6b866; }
.hpkg .tearout h3 { font-family: var(--hp-serif); font-weight: 500; color: #fff; font-size: clamp(22px, 3.5vw, 28px); margin: 10px 0 16px; line-height: 1.1; }
.hpkg .tearout p { color: rgba(238,244,242,0.82); max-width: 60ch; }
.hpkg .tearout strong { color: #fff; }
.hpkg .tearout .hair { height: 1px; background: rgba(238,244,242,0.16); margin: 18px 0; }
.hpkg .tearout ul { margin: 0; padding: 0; list-style: none; }
.hpkg .tearout ul li { padding: 4px 0 4px 18px; position: relative; color: rgba(238,244,242,0.82); font-size: 14.5px; }
.hpkg .tearout ul li::before { content: ""; position: absolute; left: 2px; top: 11px; width: 6px; height: 6px; border-radius: 50%; background: #e6b866; }
.hpkg ol.qs { margin: 0; padding-left: 0; list-style: none; counter-reset: q; }
.hpkg ol.qs li { counter-increment: q; position: relative; padding: 9px 0 9px 34px; border-top: 1px solid var(--hp-rule-soft); font-size: 15px; }
.hpkg ol.qs li:first-child { border-top: none; }
.hpkg ol.qs li::before { content: counter(q, decimal-leading-zero); position: absolute; left: 0; top: 10px; font-family: var(--hp-mono); font-size: 12px; color: var(--hp-gold); }
.hpkg ol.qs .hint { color: var(--hp-ink-3); font-size: 13px; }
.hpkg .footnote { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--hp-rule); font-size: 13px; color: var(--hp-ink-3); }
@media print {
  .no-print { display: none !important; }
  .hpkg .doc { padding: 24px 32px; }
  .hpkg * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;
