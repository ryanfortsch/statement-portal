import test from 'node:test';
import assert from 'node:assert/strict';
import { greetedName, greetingMismatch, startsWithGreeting } from '../quote-message.ts';

test('greetedName reads the first-line greeting', () => {
  assert.equal(greetedName('Hi Emily, here is the quote we discussed.'), 'Emily');
  assert.equal(greetedName('Hello, Kaitlin! Great to hear from you'), 'Kaitlin');
  assert.equal(greetedName('Here is what the week would look like.'), null);
  assert.equal(greetedName(''), null);
  assert.equal(greetedName(null), null);
});

test('greetingMismatch blocks a note addressed to someone else', () => {
  assert.match(greetingMismatch('Hi Emily, here is the quote we discussed.', 'Kaitlin') ?? '', /greets Emily, but this quote is for Kaitlin/);
  assert.equal(greetingMismatch('Hi Kaitlin, here is the quote.', 'Kaitlin'), null);
  assert.equal(greetingMismatch('hi kaitlin', 'Kaitlin'), null);
  assert.equal(greetingMismatch('Hi Kaitlin and Tom,', 'Kaitlin MacRae'), null);
  assert.equal(greetingMismatch('Hi there, here is the quote.', 'Kaitlin'), null);
  assert.equal(greetingMismatch('Dear Ms. MacRae,', 'Kaitlin'), null);
  assert.equal(greetingMismatch('Here is the quote.', 'Kaitlin'), null);
  assert.equal(greetingMismatch('Hi Emily,', ''), null);
});

test('startsWithGreeting tells the email to skip its own Hi line', () => {
  assert.equal(startsWithGreeting('Hi Kaitlin, here is the quote.'), true);
  assert.equal(startsWithGreeting('Hello!'), true);
  assert.equal(startsWithGreeting('Dear Kaitlin,'), true);
  assert.equal(startsWithGreeting('Here is the quote.'), false);
  assert.equal(startsWithGreeting('High season starts in July.'), false);
  assert.equal(startsWithGreeting(null), false);
});
