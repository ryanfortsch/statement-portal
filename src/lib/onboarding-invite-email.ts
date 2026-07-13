/**
 * Owner onboarding-invite email rendering.
 *
 * Shared between the property page's preview modal (client) and the
 * /api/draft-onboarding-email route (server) so the in-UI preview and the
 * Gmail draft always match, exactly like email-templates.ts does for
 * statements.
 *
 * This is the "please fill in your property details" invite an operator sends
 * an owner, typically right after promoting a prospect to a managed property.
 * It carries the property's public onboarding-form URL; the owner's answers
 * write straight back into the managed property record.
 */

export type OnboardingInviteArgs = {
  greeting: string; // owner_greeting, e.g. "Claudia and Vicente"
  propertyShort: string; // p.name, e.g. "21 Horton"
  onboardingUrl: string; // full public form URL
};

export type RenderedOnboardingInvite = {
  subject: string;
  body: string;
};

export function renderOnboardingInviteEmail(args: OnboardingInviteArgs): RenderedOnboardingInvite {
  const greeting = (args.greeting || '').trim() || 'there';
  const propertyShort = (args.propertyShort || 'your property').trim();
  const url = args.onboardingUrl;

  const subject = `Getting ${propertyShort} set up with Rising Tide`;

  const body = [
    `Hi ${greeting},`,
    '',
    `We're so glad to have ${propertyShort} with Rising Tide. To get everything ready for guests, we put together a short onboarding form for the property details we keep on our end: utilities, guest access, parking, trash, and a 24-hour emergency contact.`,
    '',
    `You can fill it in here whenever it's convenient:`,
    url,
    '',
    `It takes about ten minutes, and your answers save as you go, so you can step away and pick it back up. If anything is unclear or you'd rather share the details another way, just reply to this email.`,
    '',
    `Thanks so much,`,
    `Allie & Ryan`,
  ].join('\n');

  return { subject, body };
}
