const test = require('node:test');
const assert = require('node:assert/strict');

const { snapshotOf, diffSnapshots, summarizeChanges } = require('../utils/editorProposal');

const baseStory = () => ({
  title: 'Original title',
  excerpt: 'Original excerpt',
  tag: 'Health',
  img: 'https://cdn.example/a.jpg',
  imgPublicId: 'a',
  bodyHtml: '<p>Body</p>',
  blocks: [
    { type: 'h1', text: 'Heading' },
    { type: 'p', text: 'First paragraph' },
  ],
});

test('snapshotOf copies only content fields and normalizes missing values', () => {
  const snapshot = snapshotOf({ title: 'T', blocks: undefined, unrelated: 'ignored' });

  assert.deepEqual(snapshot, {
    title: 'T',
    excerpt: '',
    tag: '',
    img: '',
    imgPublicId: '',
    bodyHtml: '',
    blocks: [],
  });
});

test('diffSnapshots returns nothing for identical content', () => {
  assert.deepEqual(diffSnapshots(snapshotOf(baseStory()), snapshotOf(baseStory())), []);
});

test('diffSnapshots reports changed scalar fields with before and after values', () => {
  const before = snapshotOf(baseStory());
  const after = snapshotOf({ ...baseStory(), title: 'New title', tag: 'Policy' });

  const changes = diffSnapshots(before, after);

  assert.deepEqual(changes, [
    { field: 'title', before: 'Original title', after: 'New title' },
    { field: 'tag', before: 'Health', after: 'Policy' },
  ]);
});

test('diffSnapshots reports only the blocks that changed, by index', () => {
  const before = snapshotOf(baseStory());
  const edited = baseStory();
  edited.blocks[1] = { type: 'p', text: 'Edited paragraph' };
  edited.blocks.push({ type: 'quote', text: 'New quote' });

  const [blocksChange] = diffSnapshots(before, snapshotOf(edited));

  assert.equal(blocksChange.field, 'blocks');
  assert.equal(blocksChange.beforeCount, 2);
  assert.equal(blocksChange.afterCount, 3);
  assert.deepEqual(
    blocksChange.changedBlocks.map((block) => block.index),
    [1, 2]
  );
  assert.equal(blocksChange.changedBlocks[0].after.text, 'Edited paragraph');
  assert.equal(blocksChange.changedBlocks[1].before, null);
});

test('diffSnapshots treats a cover image change as a change to img and imgPublicId', () => {
  const after = snapshotOf({ ...baseStory(), img: 'https://cdn.example/b.jpg', imgPublicId: 'b' });

  const fields = diffSnapshots(snapshotOf(baseStory()), after).map((change) => change.field);

  assert.deepEqual(fields, ['img', 'imgPublicId']);
});

test('summarizeChanges gives readable labels and merges the two image fields', () => {
  const changes = diffSnapshots(
    snapshotOf(baseStory()),
    snapshotOf({
      ...baseStory(),
      title: 'New',
      img: 'https://cdn.example/b.jpg',
      imgPublicId: 'b',
      blocks: [{ type: 'h1', text: 'Changed' }],
    })
  );

  assert.deepEqual(summarizeChanges(changes), ['Title', 'Cover image', 'Content blocks (2 changed)']);
});
