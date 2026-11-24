const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Blog = require('../models/Blog');
const { parseBlogBody } = require('../middleware/validateBlogInput');

const WRITER = new mongoose.Types.ObjectId();

const storyWith = (overrides = {}) =>
  new Blog({
    originalAuthor: WRITER,
    originalAuthorRole: 'principal_investigator',
    author: WRITER,
    authorRole: 'principal_investigator',
    ...overrides,
  });

const completeStory = (overrides = {}) =>
  storyWith({
    title: 'Banana wilt resistance trials',
    tag: 'Modern Agriculture',
    excerpt: 'Field results from Rubona.',
    img: 'https://res.cloudinary.com/demo/cover.jpg',
    imgPublicId: 'blogs/images/cover',
    blocks: [{ type: 'p', text: 'Body' }],
    ...overrides,
  });

const parse = (body) => {
  const req = { body };
  let response = null;
  const res = {
    status(code) {
      response = { code };
      return { json: (payload) => Object.assign(response, { payload }) };
    },
  };
  parseBlogBody(req, res, () => {});
  return { parsed: req.parsedBody, response };
};

// ─── Model ───────────────────────────────────────────────────────────────────

test('a draft may be saved with only a title', () => {
  const draft = storyWith({ title: 'Work in progress' });
  assert.equal(draft.validateSync(), undefined);
});

test('a draft may be saved without title, category or cover', () => {
  const draft = storyWith({ excerpt: 'Just an idea' });
  assert.equal(draft.validateSync(), undefined);
});

test('a story past draft still needs title, category and cover', () => {
  const story = storyWith({ status: 'pending_review', excerpt: 'Only an excerpt' });
  const error = story.validateSync();
  assert.ok(error);
  for (const field of ['title', 'tag', 'img', 'imgPublicId']) {
    assert.ok(error.errors[field], `${field} should be required`);
  }
});

test('a social media creator may save a draft before adding a social handle', async () => {
  const draft = storyWith({ authorRole: 'social_media_content_creator', title: 'Draft' });
  await assert.doesNotReject(draft.validate());
});

test('a social media creator cannot leave draft without a social handle', async () => {
  const story = completeStory({ authorRole: 'social_media_content_creator', status: 'pending_review' });
  await assert.rejects(story.validate(), /socialHandle is required/);
});

test('getSubmissionErrors is empty for a complete story', () => {
  assert.deepEqual(completeStory().getSubmissionErrors(), []);
});

test('getSubmissionErrors lists every missing field of an empty draft', () => {
  assert.deepEqual(storyWith().getSubmissionErrors(), ['title', 'tag', 'img', 'content']);
});

test('getSubmissionErrors treats whitespace as missing', () => {
  const story = completeStory({ title: '   ', tag: ' ' });
  assert.deepEqual(story.getSubmissionErrors(), ['title', 'tag']);
});

test('getSubmissionErrors needs the cover public id, not only its URL', () => {
  const story = completeStory({ imgPublicId: undefined });
  assert.deepEqual(story.getSubmissionErrors(), ['img']);
});

test('getSubmissionErrors checks role-specific author links', () => {
  assert.deepEqual(
    completeStory({ authorRole: 'social_media_content_creator' }).getSubmissionErrors(),
    ['socialHandle']
  );
  assert.deepEqual(
    completeStory({ authorRole: 'media_correspondent' }).getSubmissionErrors(),
    ['organizationLink']
  );
});

// ─── Body parsing ────────────────────────────────────────────────────────────

test('fields the client did not send stay undefined, so an update leaves them alone', () => {
  const { parsed } = parse({ title: 'Only the title' });
  assert.equal(parsed.title, 'Only the title');
  for (const field of ['tag', 'excerpt', 'img', 'imgPublicId', 'blocks', 'excerptBlocks', 'modal', 'socialHandle']) {
    assert.equal(parsed[field], undefined, field);
  }
});

test('blank strings are kept so a draft field can be cleared', () => {
  const { parsed } = parse({ title: '  ', tag: '' });
  assert.equal(parsed.title, '');
  assert.equal(parsed.tag, '');
});

test('img: null is kept as null so the cover can be removed', () => {
  const { parsed } = parse({ img: null, imgPublicId: null });
  assert.equal(parsed.img, null);
  assert.equal(parsed.imgPublicId, null);
});

test('blocks are accepted as an array or as a JSON string', () => {
  const blocks = [{ type: 'p', text: 'Hi' }];
  assert.deepEqual(parse({ blocks }).parsed.blocks, blocks);
  assert.deepEqual(parse({ blocks: JSON.stringify(blocks) }).parsed.blocks, blocks);
  assert.deepEqual(parse({ blocks: [] }).parsed.blocks, []);
});

test('invalid blocks are refused with 400', () => {
  assert.equal(parse({ blocks: '{not json' }).response.code, 400);
  assert.equal(parse({ blocks: { type: 'p' } }).response.code, 400);
});
