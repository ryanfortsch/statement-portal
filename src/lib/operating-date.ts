/** Business-day comparisons use the properties' Eastern timezone on server and phone. */
export function operatingDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}
