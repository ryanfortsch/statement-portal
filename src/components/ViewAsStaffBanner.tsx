'use client';

import { useHelmView } from './HelmViewContext';
import { useViewAsSwitch } from './useViewAsSwitch';

/**
 * The strip along the bottom of the sticky masthead while an owner views
 * Helm as staff, so the mode is never forgotten and the way back is one
 * click from any page, /not-available included (the action posts to the
 * page it was clicked on, and every page that renders the masthead is one
 * a staff login may open). Renders nothing for anyone else.
 */
export function ViewAsStaffBanner() {
  const view = useHelmView();
  const { pending, toOwner } = useViewAsSwitch();
  if (!view.viewingAsStaff) return null;

  return (
    <div role="status" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
      <div
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingTop: 6, paddingBottom: 7, fontSize: 13, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2 }}
      >
        <span>Viewing Helm as staff.</span>
        <button
          type="button"
          onClick={toOwner}
          disabled={pending}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--signal-soft)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            cursor: pending ? 'default' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? 'Switching back' : 'Back to owner view.'}
        </button>
      </div>
    </div>
  );
}
