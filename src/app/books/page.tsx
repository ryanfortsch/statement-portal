import { redirect } from 'next/navigation';

/**
 * LLC Accounting lands on the Rising Tide ledger, where the review work is.
 * The other two entities are one tab away on its switcher, and the chart of
 * accounts lives at /books/accounts.
 */
export default function BooksIndex() {
  redirect('/books/rising_tide');
}
