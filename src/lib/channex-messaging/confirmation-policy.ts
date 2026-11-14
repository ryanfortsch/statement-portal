/** Owner-approved on 2026-11-13. This policy does not activate a sender. */
export const CALDERWOOD_NEW_CONFIRMATION_POLICY = Object.freeze({
  id: 'calderwood_new_airbnb_first_receipt_30m_v1',
  anchor: 'helm_first_received_at',
  minutes: 30,
  appliesTo: 'verified_new_airbnb_only',
} as const);
