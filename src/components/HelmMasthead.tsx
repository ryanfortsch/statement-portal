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
 */
export function HelmMasthead({ rightContent }: Props) {
  return (
    <header className="sticky top-0 z-50" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--ink)' }}>
      <div className="max-w-[1100px] mx-auto px-10">
        <div
          className="rt-masthead-top flex items-center justify-between"
          style={{ padding: '16px 0 12px' }}
        >
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Link
              href="/"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
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
              style={{ width: 1, height: 14, background: 'var(--rule)' }}
              aria-hidden="true"
            />
            <HelmModuleNav />
          </div>
          <div className="flex items-center" style={{ gap: 10, flexShrink: 0 }}>
            <CommandPaletteTrigger />
            {rightContent}
            <HelmMobileMenu />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
