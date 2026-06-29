import { Section } from '@/components/Section';

/**
 * Static placeholder for the pending-approval queue, shown while the server
 * streams the real MessagingQueue / OwnerMessagingQueue in. Shared by the
 * route-segment loading.tsx (instant skeleton on tap) and the in-page
 * <Suspense> fallback so a route transition and an in-page re-stream look
 * identical. Pure server component, no data, no client APIs.
 *
 * Card box mirrors a real ApprovalCard's rhythm (gap 18 column, 1px
 * var(--rule) border) and uses the same var(--paper-2) tone HelmLoading's
 * Block uses, so the swap to real content shifts as little as possible.
 */
export function QueueSkeleton() {
  return (
    <Section title="Pending" eyebrow="loading…">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{
              border: '1px solid var(--rule)',
              borderRadius: 10,
              padding: '18px 18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Bar h={12} w={130} />
              <div style={{ flex: 1 }} />
              <Bar h={12} w={64} />
            </div>
            <Bar h={11} w="92%" />
            <Bar h={11} w="78%" />
            <Bar h={11} w="42%" />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Bar({ h, w }: { h: number; w: number | string }) {
  return <div style={{ height: h, width: w, maxWidth: '100%', background: 'var(--paper-2)' }} />;
}
