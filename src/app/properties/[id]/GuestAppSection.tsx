import Link from 'next/link';
import { cache } from 'react';
import { DownloadPropertyPdfButton } from '@/components/properties/DownloadPropertyPdfButton';
import { getGuestAppRow, guestAppView, loadGuestApp } from '@/lib/guest-app-db';
import { GuestAppPanel } from './GuestAppPanel';

/** One read of the home's link per request: the panel and the card tile share it. */
const rowFor = cache((propertyId: string) => getGuestAppRow(propertyId));

/**
 * The Guest app panel's server half: the link row and what the app has
 * nothing for yet, read with the same loader the guest's page uses, so the
 * list matches what a guest would see today.
 */
export async function GuestAppPanelLoader({ propertyId }: { propertyId: string }) {
  const row = await rowFor(propertyId);
  const app = await loadGuestApp(propertyId, row?.welcome_note ?? null).catch(() => null);
  return <GuestAppPanel propertyId={propertyId} initial={row ? guestAppView(row) : null} missing={app?.missing ?? []} />;
}

/** The Guest app card tile in the Guest documents grid. */
export async function GuestAppCardTile({ propertyId, actionStyle }: { propertyId: string; actionStyle: React.CSSProperties }) {
  const row = await rowFor(propertyId);
  return (
    <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="eyebrow">4 × 6 card with QR code</div>
      <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
        Guest app card
      </h3>
      {/* A tile says something only when it cannot print yet. */}
      {!row?.enabled ? (
        <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--negative)', lineHeight: 1.55 }}>
          Turn the guest app on to print its QR.
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        <Link href={`/properties/${propertyId}/guest-app-card`} target="_blank" style={actionStyle}>
          Open ↗
        </Link>
        {row?.enabled ? <DownloadPropertyPdfButton propertyId={propertyId} type="guest-app-card" label="Download PDF" /> : null}
      </div>
    </div>
  );
}
