export type RentalInquiry = {
  check_in: string;
  check_out: string;
  guests: number | null;
  flexible: boolean;
  history_checked: boolean;
  checked_at: string;
  needs: string[];
  homes: Array<{
    title: string;
    listing_id: string;
    property_id: string;
    sleeps: number | null;
    availability: string;
    quote: { total: number; currency: string } | null;
    work_slip_id?: string;
    work_error?: string;
  }>;
};

export function inquiryAvailability(status: string): string {
  return ({ available: 'Requested nights open', prerelease: 'Pre-release · confirmation needed', unavailable: 'Full stay not available', terms_review: 'Stay rules need review', too_small: 'Capacity does not fit' } as Record<string, string>)[status] || 'Availability not verified';
}

export function inquiryQuoteHref(inquiry: RentalInquiry, property: string, guest: { first: string; email?: string; source: string }): string {
  const params = new URLSearchParams({ property, check_in: inquiry.check_in, check_out: inquiry.check_out, first: guest.first, source: 'rental_inquiry', source_ref: guest.source });
  if (inquiry.guests) params.set('guests', String(inquiry.guests));
  if (guest.email) params.set('email', guest.email);
  return `/guests/quotes/new?${params}`;
}
