/** Studio = 0 bedrooms, anything else gets the "N BR" form. */
export function formatBedroomLabel(bedrooms: number): string {
  if (bedrooms === 0) return 'Studio';
  return `${bedrooms} BR`;
}
