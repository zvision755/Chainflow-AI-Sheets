import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLongText } from '../core/text-segmenter';

test('splits multilingual sentences, retains punctuation runs, and trims empty pieces', () => {
  assert.deepEqual(splitLongText('  こんにちは？！\nHello world.\n\n終わり。 ', {
    delimiters: '。！？?.', splitLines: true, keepDelimiter: true,
  }), ['こんにちは？！', 'Hello world.', '終わり。']);
});

test('supports custom rules, optional line boundaries, and dropping delimiters', () => {
  assert.deepEqual(splitLongText('A|B\nC|D', {
    delimiters: '|', splitLines: false, keepDelimiter: false,
  }), ['A', 'B\nC', 'D']);
});
