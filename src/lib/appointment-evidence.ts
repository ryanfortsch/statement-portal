/** High-confidence address disagreement only. Never chooses a replacement home. */
export function appointmentAddressConflict(propertyName: string | null, title: string, location?: string | null): boolean {
  const filed = propertyName?.match(/^(\d+)(?:[_\s]|$)/)?.[1];
  const atAddress = title.match(/\b(?:at|at the)\s+(\d+)\s+(?!am\b|pm\b|minutes?\b|hours?\b)[A-Za-z]{3,}/i)?.[1];
  const locationAddress = location?.match(/^(\d+)\s+[A-Za-z]{3,}/)?.[1];
  return !!filed && [atAddress, locationAddress].some(n => !!n && n !== filed);
}
