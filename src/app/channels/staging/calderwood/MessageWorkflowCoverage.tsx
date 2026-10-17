const workflows = [
  {
    name: 'Calderwood Messaging', count: 4,
    scope: '65 Calderwood. All sources except Website, Manual and Direct - stay cape ann.',
    delivery: 'Guest through the booking channel.',
    schedule: 'Confirmation +30 minutes; check-in instructions 1 day before arrival; key code 1 hour before arrival; checkout reminder 1 day before departure.',
    coverage: 'Four timing previews. Per-stay channel eligibility and current queue still need reconciliation.',
  },
  {
    name: 'Cleaning updates - Luana', count: 2,
    scope: '65 Calderwood. All sources.',
    delivery: 'Phone-book contact by SMS.',
    schedule: '10 days before arrival and 7 hours before arrival.',
    coverage: 'Two timing previews. Cleaner queue, delivery history and recipient binding remain unverified.',
  },
  {
    name: 'Copy of STAFF Booking Change CT', count: 1,
    scope: 'Bridgeport property rule. All sources.',
    delivery: 'User by SMS.',
    schedule: 'At booking alteration. The active message is named TEST Change to Stay.',
    coverage: 'Outside the timing preview. Recipient, relevant changes, prior sends and pending obligations need reconciliation.',
  },
  {
    name: 'DIRECT BOOKING', count: 8,
    scope: 'All properties. Website, Manual and Direct - stay cape ann only.',
    delivery: 'Guest by SMS and email, with a separate message for each delivery method.',
    schedule: 'Both methods: at confirmation; 1 day before arrival; 1 hour before arrival; 1 day before departure.',
    coverage: 'Outside the timing preview. These confirmations have no 30-minute offset. The linked Stay Collections portal requires a contact form and gated property information; both delivery methods also need replacement coverage.',
  },
  {
    name: 'Rental Agreement', count: 1,
    scope: 'All properties. Website only.',
    delivery: 'Guest by email.',
    schedule: '1 hour after confirmation. The message attaches Rental Agreement 2025.pdf.',
    coverage: 'Outside the timing preview. The one-page attachment was inspected. Current approval, unchanged attachment delivery and any payment obligations still need verification.',
  },
  {
    name: 'STAFF messages ONLY', count: 4,
    scope: 'All properties. All sources.',
    delivery: 'User by SMS for all four messages.',
    schedule: 'Two notices 1 day before arrival; one notice 1 day before departure; one notice 3 hours before departure.',
    coverage: 'Outside the timing preview. Exact user recipients, delivery history and pending queues remain unverified.',
  },
] as const;

export default function MessageWorkflowCoverage() {
  const count = workflows.reduce((sum, workflow) => sum + workflow.count, 0);
  return <section aria-labelledby="message-workflow-coverage" className="space-y-4 rounded-lg border bg-white p-5">
    <div>
      <h2 id="message-workflow-coverage" className="text-lg font-semibold">Message workflow coverage</h2>
      <p className="mt-1 text-sm text-slate-600">{workflows.length} active workflows · {count} configured templates · Reviewed October 17, 2026</p>
    </div>
    <p className="text-sm">The timing review covers six recurring templates. Fourteen additional templates are listed here for migration planning. Template counts are not pending-message counts, and source conditions mean every template does not apply to every stay.</p>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">This is a dated inventory from Guesty, not a live configuration feed. Source labels have not been mapped to reservation API values. Guesty remains the sender; neither this inventory nor a calculated time establishes message eligibility or delivery.</p>
    <div className="divide-y rounded-lg border">{workflows.map(workflow => <details className="p-4" key={workflow.name}>
      <summary className="cursor-pointer text-sm font-medium">{workflow.name} · {workflow.count} {workflow.count === 1 ? 'template' : 'templates'}</summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {[['Applies to', workflow.scope], ['Delivery', workflow.delivery], ['Existing timing', workflow.schedule], ['Migration coverage', workflow.coverage]].map(([label, value]) => <div key={label}>
          <dt className="font-medium">{label}</dt><dd className="mt-1 text-slate-600">{value}</dd>
        </div>)}
      </dl>
    </details>)}</div>
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">Guest portal and agreement dependencies</summary>
      <p className="mt-3 text-sm text-slate-600">Reviewed from the existing Stay Collections app and agreement email on October 17. Configuration shows what is enabled, not what a particular guest has received.</p>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Required check-in form</dt>
          <dd className="mt-1 text-slate-600">First name, last name, email and phone number are required. Reservation information is enabled. The payment-info form and guidebook are off.</dd>
        </div>
        <div>
          <dt className="font-medium">Property information and access</dt>
          <dd className="mt-1 text-slate-600">Additional information unlocks after form submission. Selected categories include WiFi, house rules and access-code fields. Actual populated values and guest visibility still need checking against the 3 PM code message and any manual hold.</dd>
        </div>
        <div>
          <dt className="font-medium">Separate agreement email</dt>
          <dd className="mt-1 text-slate-600">Website bookings are configured to receive the PDF attachment one hour after confirmation. The inspected PDF has no signing fields. Helm’s existing signing flow is a different process; replacing the attachment with it requires a separate decision.</dd>
        </div>
        <div>
          <dt className="font-medium">Costs and payment dependencies</dt>
          <dd className="mt-1 text-slate-600">GuestVerify and Upsells are selected only for properties covered by those add-ons. Calderwood’s coverage and charges are unverified. A deposit described in the agreement does not prove a payment hold was created.</dd>
        </div>
      </dl>
    </details>
    <p className="text-xs text-slate-500">All day-based offsets still require daylight-saving queue checks. No workflow, recipient, attachment, schedule or send permission is changed here.</p>
  </section>;
}
