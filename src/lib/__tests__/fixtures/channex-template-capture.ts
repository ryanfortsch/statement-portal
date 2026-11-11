/** Entirely synthetic. Never replace with a captured customer template. */
export const syntheticCapture = {
  observedAt: '2026-01-01T12:00:00.000Z', source: 'synthetic UI capture', property: '65_calderwood',
  templates: {
    booking_confirmed: 'Hello {{guest_first}},\n\nYour synthetic stay is confirmed.',
    pre_arrival: 'Hello {{guest_first}},\nArrival {{checkin}}; departure {{checkout}}.',
    checkin_day: 'Hi {{guest_first}},\nCode: {{listing_lock_code}}\nName: Synthetic Network\nPassword: SyntheticWifiSecret\n\nEnjoy!',
    pre_checkout: 'Hello {{guest_first}}, checkout is tomorrow.',
    cleaner_reminder: 'Synthetic cleaner: {{checkin}} at {{listing_nickname}} until {{checkout}}.\nhttps://app.guesty.com/reservations?viewId=000000000000000000000001',
    cleaner_arrival: 'Synthetic cleaner: arrival today at {{listing_nickname}}, departure {{checkout}}.',
  },
};
