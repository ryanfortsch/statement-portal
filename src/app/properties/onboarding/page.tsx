import { redirect } from 'next/navigation';

/**
 * The fleet onboarding board folded into /properties as its Coming online
 * section (UI/UX audit 2026-10-17, Properties Phase 3). "Onboarding" named
 * five different things; this route was one of them. Old links, the atlas
 * entry and any bookmark land on the section.
 */
export default function OnboardingBoardRedirect() {
  redirect('/properties#coming-online');
}
