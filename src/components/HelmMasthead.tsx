import Link from 'next/link';
import { HelmModuleNav } from './HelmModuleNav';
import { HelmMobileMenu } from './HelmMobileMenu';
import { UserMenu } from './UserMenu';
import { CommandPaletteTrigger } from './CommandPaletteTrigger';

type Props = {
  rightContent?: React.ReactNode;
};

/**
 * The standard Helm masthead: logo + Helm wordmark + module nav. The active
 * module is derived from the pathname inside the nav components, so pages
 * pass nothing to highlight themselves; `rightContent` puts a period
 * selector / action button on the right.
 *
 * Every module renders this shell, /statements included (its Period
 * dropdown rides in the rightContent slot). New modules should default
 * to it too.
 *
 * The slot never sits beside the full module nav: at 1020px of content the
 * nav leaves it about 19px, less than one Messaging count, so it squeezed
 * the wordmark into the nav ("HelmWORK") on desktop and ran into it on a
 * phone. Where the nav shows, and on a phone, the slot takes its own line
 * under the wordmark row (globals.css, .rt-masthead-slot); where the nav has
 * already folded into Menu (641 to 1023px) it sits inline. The wordmark and
 * its divider never shrink.
 */
export function HelmMasthead({ rightContent }: Props) {
  return (
    <header className="sticky top-0 z-50" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--ink)' }}>
      <div className="max-w-[1100px] mx-auto px-10">
        <div
          className="rt-masthead-top flex flex-wrap items-center"
          style={{ padding: '16px 0 12px', columnGap: 10, rowGap: 10 }}
        >
          <div className="flex items-center gap-4" style={{ flex: '1 0 auto' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Link
              href="/"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}
              aria-label="Helm home"
            >
              <img
                src="/rising-tide-logo.png"
                alt="Rising Tide"
                style={{ width: 36, height: 36, display: 'block' }}
              />
              <span
                className="font-serif"
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                  color: 'var(--ink)',
                }}
              >
                Helm
              </span>
            </Link>
            <span
              style={{ width: 1, height: 14, background: 'var(--rule)', flexShrink: 0 }}
              aria-hidden="true"
            />
            <HelmModuleNav />
          </div>
          <CommandPaletteTrigger />
          {rightContent && <div className="rt-masthead-slot">{rightContent}</div>}
          <div className="flex items-center" style={{ gap: 10, flexShrink: 0 }}>
            <HelmMobileMenu />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
