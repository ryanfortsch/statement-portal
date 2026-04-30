import Link from 'next/link';
import { HELM_MODULES, type HelmModule } from '@/lib/helm-modules';

export default function HelmHome() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* ─── MASTHEAD ─── */}
      <header style={{ borderBottom: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10" style={{ padding: '20px 40px 18px' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 28, height: 28 }} />
              <span className="font-serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>Helm</span>
            </div>
            <span style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500 }}>
              Rising Tide &middot; Internal Operations
            </span>
          </div>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 64, paddingBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>The Bridge</div>
        <h1 className="font-serif" style={{
          fontSize: 56,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          maxWidth: 720,
        }}>
          Run Rising Tide from <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>one place.</em>
        </h1>
        <p style={{
          marginTop: 22,
          fontSize: 16,
          lineHeight: 1.55,
          color: 'var(--ink-3)',
          maxWidth: 580,
        }}>
          Helm is the internal operations hub for Rising Tide STR. Statements, ops, inspections, work, properties, owners, all under one roof.
        </p>
      </section>

      {/* ─── MODULES ─── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1 }}>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {HELM_MODULES.map((m) => (
            <ModuleRow key={m.id} module={m} />
          ))}
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; 85 Eastern Ave &middot; Gloucester, MA 01930</span>
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>
            &ldquo;We care for your home as if it were our own.&rdquo;
          </span>
        </div>
      </footer>
    </div>
  );
}

function ModuleRow({ module: m }: { module: HelmModule }) {
  const reachable = m.status === 'active' || m.status === 'external';

  const callToAction =
    m.status === 'active' ? 'Open →' :
    m.status === 'external' ? 'Open ↗' :
    'Soon';

  const content = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '28px 0',
        borderBottom: '1px solid var(--rule)',
        opacity: reachable ? 1 : 0.5,
        transition: 'opacity 0.15s',
      }}
    >
      <span className="font-mono" style={{
        fontSize: 11,
        color: reachable ? 'var(--signal)' : 'var(--ink-4)',
        letterSpacing: '.08em',
      }}>
        {m.number}
      </span>
      <div>
        <h2 className="font-serif" style={{
          fontSize: 28,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
        }}>
          {m.title}
        </h2>
        <p style={{
          marginTop: 6,
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--ink-3)',
          maxWidth: 620,
        }}>
          {m.description}
        </p>
      </div>
      <span style={{
        fontSize: 10,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: reachable ? 'var(--ink)' : 'var(--ink-4)',
        whiteSpace: 'nowrap',
      }}>
        {callToAction}
      </span>
    </div>
  );

  if (m.status === 'external') {
    return (
      <a
        href={m.href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {content}
      </a>
    );
  }

  if (m.status === 'active') {
    return (
      <Link href={m.href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {content}
      </Link>
    );
  }

  return <div>{content}</div>;
}
