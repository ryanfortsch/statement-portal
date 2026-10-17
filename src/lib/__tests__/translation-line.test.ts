/**
 * The English line under a guest card written in another language
 * (Spanish at 73 Rocky Neck, 2026-10-17).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { englishLineText, TRANSLATING_TEXT } from '../translation-line.ts';

test('the English shows when the concierge sent it', () => {
  assert.equal(
    englishLineText('Perfect, thank you so much for the help! Enjoy the evening!', false),
    'Perfect, thank you so much for the help! Enjoy the evening!',
  );
  assert.equal(englishLineText('  Thanks!  ', true), 'Thanks!', 'English wins over the pending note');
});

test('while it is being made the card says so in place', () => {
  assert.equal(englishLineText('', true), TRANSLATING_TEXT);
  assert.equal(englishLineText(undefined, true), TRANSLATING_TEXT);
});

test('English text, an older concierge, or a failed translation shows nothing', () => {
  assert.equal(englishLineText('', false), null);
  assert.equal(englishLineText(undefined, undefined), null);
  assert.equal(englishLineText(null, null), null);
});

test('the guest card renders the English on both sides and under the editor', () => {
  const card = readFileSync(new URL('../../app/messaging/MessagingQueue.tsx', import.meta.url), 'utf8');
  assert.match(card, /<EnglishLine text=\{approval\.guest_text_english\} translating=\{approval\.guest_text_translating\} \/>/);
  assert.match(card, /savedDraft == null && <EnglishLine text=\{approval\.draft_english\} translating=\{approval\.draft_translating\} \/>/);
  assert.match(card, /<EnglishLine text=\{approval\.draft_english\} label="English, as drafted" \/>/);
});
