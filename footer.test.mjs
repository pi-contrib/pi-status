import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { test } from 'node:test';
import { formatFooter } from './index.ts';

const plain = (_color, text) => text;
const styled = (color, text) => `${color}:${text}`;

const state = {
  percent: 70, estimatedCost: 0.02, model: 'gpt-6-sol',
  directory: 'my\nproject', branch: 'main',
};

test('uses warning and error colors at the context thresholds', () => {
  assert.match(formatFooter(state, 100, styled), /warning:⣿/);
  assert.match(formatFooter({ ...state, percent: 90 }, 100, styled), /error:⣿/);
});

test('sanitizes labels and handles unknown context usage', () => {
  const line = stripVTControlCharacters(formatFooter({ ...state, percent: null }, 100, plain));
  assert.match(line, /—.*myproject/);
  assert.doesNotMatch(line, /\n/);
});

test('keeps the model visible in a narrow terminal', () => {
  assert.equal(stripVTControlCharacters(formatFooter(state, 9, plain)), state.model);
});
