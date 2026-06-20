import { signOutField } from './actions';

/**
 * Standalone shell for the contractor portal. Deliberately NOT the Helm
 * masthead — contractors never see internal chrome. Warm paper palette,
 * Fraunces wordmark, a single sign-out affordance.
 */
export function FieldShell({
  children,
  contractorName,
  showSignOut = true,
}: {
  children: React.ReactNode;
  contractorName?: string | null;
  showSignOut?: boolean;
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <header
        style={{
          borderBottom: '1px solid var(--rule)',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            className="font-serif"
            style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em' }}
          >
            Rising Tide
          </span>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: 'var(--signal)',
              fontWeight: 600,
            }}
          >
            Field
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {contractorName && (
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{contractorName}</span>
          )}
          {showSignOut && contractorName && (
            <form action={signOutField} style={{ margin: 0 }}>
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                }}
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: 760, margin: '0 auto', padding: '32px 24px 64px' }}>
        {children}
      </main>
      <footer
        style={{
          borderTop: '1px solid var(--rule)',
          padding: '16px 24px',
          fontSize: 11,
          color: 'var(--ink-4)',
          letterSpacing: '0.06em',
          textAlign: 'center',
        }}
      >
        Rising Tide STR · Gloucester, MA · (978) 865-2387
      </footer>
    </div>
  );
}
