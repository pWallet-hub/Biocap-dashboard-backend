const test = require('node:test');
const assert = require('node:assert/strict');

const { diffWords, htmlToText } = require('../utils/wordDiff');

// Writes the diff as text: [-deleted-] and {+inserted+}, unchanged words as-is.
const marked = (segments) =>
  segments
    .map((segment) => {
      if (segment.type === 'insert') return `{+${segment.text}+}`;
      if (segment.type === 'delete') return `[-${segment.text}-]`;
      return segment.text;
    })
    .join('');

// Before text rebuilt from equal and deleted segments, after text from equal and inserted ones.
const rebuild = (segments, keep) =>
  segments
    .filter((segment) => segment.type !== (keep === 'before' ? 'insert' : 'delete'))
    .map((segment) => segment.text)
    .join('');

test('diffWords marks a word added in the middle of a sentence', () => {
  assert.equal(
    marked(diffWords('The cat sat on the mat.', 'The cat sat on the red mat today.')),
    'The cat sat on the {+red +}mat{+ today+}.'
  );
});

test('diffWords treats punctuation as its own token', () => {
  assert.equal(marked(diffWords('Hello world', 'Hello, big world!')), 'Hello{+,+} {+big +}world{+!+}');
});

test('diffWords shows a whole new text as inserted and a removed text as deleted', () => {
  assert.equal(marked(diffWords('', 'all new')), '{+all new+}');
  assert.equal(marked(diffWords('gone entirely', '')), '[-gone entirely-]');
});

test('diffWords reports identical text as unchanged', () => {
  assert.equal(marked(diffWords('same words', 'same words')), 'same words');
});

test('diffWords rebuilds both texts exactly from its segments', () => {
  for (let run = 0; run < 200; run += 1) {
    const pick = () => Array.from({ length: 30 }, () => ['a', 'b', 'c', ' ', '.'][Math.floor(Math.random() * 5)]).join('');
    const before = pick();
    const after = pick();
    const segments = diffWords(before, after);
    assert.equal(rebuild(segments, 'before'), before);
    assert.equal(rebuild(segments, 'after'), after);
  }
});

test('htmlToText strips tags, decodes entities and keeps paragraphs apart', () => {
  assert.equal(htmlToText('<p>Hi &amp; <b>bye</b></p><p>next&nbsp;line</p>'), 'Hi & bye next line');
  assert.equal(htmlToText(undefined), '');
});
