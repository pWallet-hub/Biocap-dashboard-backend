// Runs the draft autosave flow (create → update → submit) against a MongoDB instance.
// Skipped unless TEST_MONGO_URI is set, e.g. TEST_MONGO_URI=mongodb://127.0.0.1:27018
// Each run uses its own throwaway database, which is dropped at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const TEST_URI = process.env.TEST_MONGO_URI;
const skip = TEST_URI ? false : 'set TEST_MONGO_URI to run database integration tests';

const blogController = require('../controllers/blogController');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const Blog = require('../models/Blog');
const User = require('../models/User');

const runId = crypto.randomBytes(4).toString('hex');
const writerId = new mongoose.Types.ObjectId();
const socialId = new mongoose.Types.ObjectId();

const fakeRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.location = (url) => {
    res.headers.location = url;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

// Runs parseBlogBody and then the controller, as the real routes do.
const call = async (handler, { userId, role, params = {}, body = {} }) => {
  const req = { user: { id: String(userId), role }, params, body, files: undefined, ip: '127.0.0.1', get: () => '' };
  const res = fakeRes();
  let parsed = false;
  parseBlogBody(req, res, () => {
    parsed = true;
  });
  if (!parsed) return res;
  let thrown = null;
  await handler(req, res, (err) => {
    thrown = err;
  });
  if (thrown) throw thrown;
  return res;
};

const seedUser = (_id, role, firstName) => ({
  _id,
  username: `${firstName.toLowerCase()}_${runId}`,
  email: `${firstName.toLowerCase()}.${runId}@example.test`,
  password: 'not-used',
  role,
  firstName,
  lastName: 'Test',
  isActive: true,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test('story draft autosave against MongoDB', { skip }, async (t) => {
  await mongoose.connect(TEST_URI, { dbName: `biocap_draft_test_${runId}`, serverSelectionTimeoutMS: 15000 });
  t.after(async () => {
    await settle();
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  await User.collection.insertMany([
    seedUser(writerId, 'principal_investigator', 'Writer'),
    seedUser(socialId, 'social_media_content_creator', 'Social'),
  ]);
  const writer = { userId: writerId, role: 'principal_investigator' };

  await t.test('an empty draft is refused', async () => {
    const res = await call(blogController.createBlog, { ...writer, body: {} });
    assert.equal(res.statusCode, 400);
  });

  let draftId;
  await t.test('a draft is created from only a title, without a cover image', async () => {
    const res = await call(blogController.createBlog, { ...writer, body: { title: 'Half a thought' } });
    assert.equal(res.statusCode, 201);
    draftId = String(res.body.blog._id);
    assert.equal(res.headers.location, `/api/blogs/${draftId}`);
    const draft = await Blog.findById(draftId).lean();
    assert.equal(draft.status, 'draft');
    assert.equal(draft.title, 'Half a thought');
    assert.equal(draft.img, undefined);
  });

  await t.test('a draft can be created by a social creator before the social handle is known', async () => {
    const res = await call(blogController.createBlog, {
      userId: socialId,
      role: 'social_media_content_creator',
      body: { excerpt: 'Idea' },
    });
    assert.equal(res.statusCode, 201);
  });

  await t.test('an update changes only the fields that were sent', async () => {
    await call(blogController.updateBlog, {
      ...writer,
      params: { id: draftId },
      body: { blocks: [{ type: 'p', text: 'First paragraph' }], tag: 'Modern Agriculture' },
    });
    const res = await call(blogController.updateBlog, { ...writer, params: { id: draftId }, body: { excerpt: 'Short summary' } });
    assert.equal(res.statusCode, 200);
    const draft = await Blog.findById(draftId).lean();
    assert.equal(draft.title, 'Half a thought');
    assert.equal(draft.tag, 'Modern Agriculture');
    assert.equal(draft.excerpt, 'Short summary');
    assert.deepEqual(draft.blocks.map((b) => b.text), ['First paragraph']);
  });

  await t.test('submitting an incomplete draft returns 422 with the missing fields', async () => {
    const res = await call(blogController.submitBlog, { ...writer, params: { id: draftId } });
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.body.missingFields, ['img']);
    assert.equal((await Blog.findById(draftId).lean()).status, 'draft');
  });

  await t.test('a draft field can be cleared, and the cover set and removed', async () => {
    await call(blogController.updateBlog, { ...writer, params: { id: draftId }, body: { title: '' } });
    assert.equal((await Blog.findById(draftId).lean()).title, '');

    await call(blogController.updateBlog, {
      ...writer,
      params: { id: draftId },
      body: { img: 'https://cdn.example/a.jpg', imgPublicId: 'a' },
    });
    let draft = await Blog.findById(draftId).lean();
    assert.equal(draft.img, 'https://cdn.example/a.jpg');
    assert.equal(draft.imgPublicId, 'a');

    await call(blogController.updateBlog, { ...writer, params: { id: draftId }, body: { img: null } });
    draft = await Blog.findById(draftId).lean();
    assert.equal(draft.img, undefined);
    assert.equal(draft.imgPublicId, undefined);
  });

  await t.test('a complete draft is submitted for review', async () => {
    await call(blogController.updateBlog, {
      ...writer,
      params: { id: draftId },
      body: { title: 'Full story', img: 'https://cdn.example/b.jpg', imgPublicId: 'b' },
    });
    const res = await call(blogController.submitBlog, { ...writer, params: { id: draftId } });
    assert.equal(res.statusCode, 200);
    const story = await Blog.findById(draftId).lean();
    assert.equal(story.status, 'pending_review');
    assert.match(story.slug, /^full-story/);
  });

  await t.test('a story past draft cannot have its title cleared', async () => {
    await assert.rejects(
      call(blogController.updateBlog, { userId: writerId, role: 'admin', params: { id: draftId }, body: { title: '' } }),
      { name: 'ValidationError' }
    );
  });
});
