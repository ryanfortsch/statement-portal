import test from 'node:test';
import { newBookingRehearsalCases } from './fixtures/channex-new-booking-rehearsal.ts';

for (const scenario of newBookingRehearsalCases) test(scenario.name, scenario.run);
