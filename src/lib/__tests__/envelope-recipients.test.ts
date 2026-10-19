/**
 * The owner card's To line names who the reply reaches.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLine } from '../envelope-recipients.ts';

test('an SMS number carries the name the service sent with it', () => {
  assert.equal(
    toLine({ channel: 'sms', to: ['+16172933378', '+18583367896'], to_names: ['Danielle Ramsey', 'Mark Ramsey'] }),
    'Danielle Ramsey · (617) 293-3378, Mark Ramsey · (858) 336-7896',
  );
});

test('an unknown number, or an older service with no names, shows the number alone', () => {
  assert.equal(toLine({ channel: 'sms', to: ['+16172933378', '+19785550000'], to_names: ['Danielle Ramsey', ''] }),
    'Danielle Ramsey · (617) 293-3378, (978) 555-0000');
  assert.equal(toLine({ channel: 'sms', to: ['+16172933378'] }), '(617) 293-3378');
});

test('email addresses are printed as they are', () => {
  assert.equal(toLine({ channel: 'email', to: ['owner@example.test'], to_names: ['Ignored'] }), 'owner@example.test');
});
