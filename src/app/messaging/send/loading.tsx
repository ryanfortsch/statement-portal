import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingTabs } from '@/components/MessagingTabs';
import { Section } from '@/components/Section';

/** Route-level skeleton so the Send lens paints its shell instantly on
 * navigation (the landings house rule for heavy segments). */
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="send" />
      <Section title="Send a message" eyebrow="pick a stay, write, send">
        <div style={{ borderTop: '1px solid var(--ink)', padding: '18px 0', fontSize: 13, color: 'var(--ink-4)' }}>
          Loading stays...
        </div>
      </Section>
    </div>
  );
}
