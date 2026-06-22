/** A small round contractor avatar (photo, or initials fallback). Server-safe —
 *  plain render, no client JS. Used wherever a contractor is shown by name. */
export function FieldAvatar({ name, url, size = 22 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--paper-2, #fff)',
        border: '1px solid var(--rule)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        verticalAlign: 'middle',
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.42), color: 'var(--ink-4)' }}>{initials}</span>
      )}
    </span>
  );
}
