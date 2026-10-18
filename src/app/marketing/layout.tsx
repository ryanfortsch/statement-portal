import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { GrowthFrame } from '@/components/GrowthTabs';

/**
 * Growth layout: the masthead and the one Growth strip render here, so every
 * page under /marketing carries them by construction. Pages contribute their
 * content sections and footer only.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <GrowthFrame masthead={<HelmMasthead />}>{children}</GrowthFrame>;
}
