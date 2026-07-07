/**
 * Loading state for the statement render page. The render page draws its
 * own full document (no HelmMasthead), so this is a bespoke placeholder:
 * the statement's paper tone with a single centered serif line.
 */
export default function StatementRenderLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#faf7f1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <p
        className="font-serif"
        style={{
          fontSize: 22,
          fontWeight: 300,
          letterSpacing: '-0.01em',
          color: '#1e2e34',
          margin: 0,
        }}
      >
        Preparing statement…
      </p>
    </div>
  );
}
