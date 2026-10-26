// Runs the real editor and writer controllers against a MongoDB instance.
// Skipped unless TEST_MONGO_URI is set, e.g. TEST_MONGO_URI=mongodb://127.0.0.1:27018
// Each run uses its own throwaway database, which is dropped at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const TEST_URI = process.env.TEST_MONGO_URI;
const skip = TEST_URI ? false : 'set TEST_MONGO_URI to run database integration tests';

const editorController = require('../controllers/editorBlogController');
const blogController = require('../controllers/blogController');
const Blog = require('../models/Blog');
const User = require('../models/User');

const runId = crypto.randomBytes(4).toString('hex');
const ids = {
  writer: new mongoose.Types.ObjectId(),
  editor: new mongoose.Types.ObjectId(),
  stranger: new mongoose.Types.ObjectId(),
};

// Minimal fake Express response that records the status and JSON body.
const fakeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const call = async (handler, { userId, role, params = {}, body = {} }) => {
  const res = fakeRes();
  let thrown = null;
  await handler({ user: { id: String(userId), role }, params, body, files: undefined, ip: '127.0.0.1', get: () => '' }, res, (err) => {
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

const seedBlog = (overrides = {}) => ({
  title: 'Original title',
  slug: `original-title-${runId}-${crypto.randomBytes(3).toString('hex')}`,
  tag: 'Health',
  excerpt: 'Original excerpt',
  blocks: [{ type: 'p', text: 'Original paragraph' }],
  bodyHtml: '<p>Original paragraph</p>',
  img: 'https://cdn.example/original.jpg',
  imgPublicId: 'original',
  originalAuthor: ids.writer,
  originalAuthorRole: 'principal_investigator',
  author: ids.writer,
  authorRole: 'principal_investigator',
  status: 'draft',
  publishConsentStatus: 'not_required',
  isDeleted: false,
  ...overrides,
});

// Waits for the non-blocking email and audit work that the controllers schedule with setImmediate.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test(
  'editor proposal workflow against MongoDB',
  { skip },
  async (t) => {
    await mongoose.connect(TEST_URI, { dbName: `biocap_test_${runId}`, serverSelectionTimeoutMS: 15000 });
    t.after(async () => {
      await settle();
      await mongoose.connection.db.dropDatabase();
      await mongoose.disconnect();
    });

    await User.collection.insertMany([
      seedUser(ids.writer, 'principal_investigator', 'Writer'),
      seedUser(ids.editor, 'editor', 'Editor'),
      seedUser(ids.stranger, 'principal_investigator', 'Stranger'),
    ]);

    const { insertedId } = await Blog.collection.insertOne(seedBlog());
    const blogId = String(insertedId);

    const live = async () => Blog.findById(blogId).select('+editorProposals +editorModifications').lean();

    await t.test('an editor proposal is stored as a pending version and does not change the live story', async () => {
      const res = await call(editorController.updateBlogByEditor, {
        userId: ids.editor,
        role: 'editor',
        params: { id: blogId },
        body: { title: 'Edited title', blocks: [{ type: 'p', text: 'Edited paragraph' }] },
      });

      assert.equal(res.statusCode, 200);
      const blog = await live();
      assert.equal(blog.title, 'Original title');
      assert.equal(blog.publishConsentStatus, 'pending');
      assert.equal(blog.editorProposals.length, 1);
      assert.equal(blog.editorProposals[0].version, 1);
      assert.equal(blog.editorProposals[0].status, 'pending');
      assert.equal(blog.editorProposals[0].baseline.title, 'Original title');
      assert.equal(blog.editorProposals[0].proposal.title, 'Edited title');
      assert.equal(blog.editorModifications.title, 'Edited title');
    });

    await t.test('a second proposal is refused while one is awaiting the writer', async () => {
      const res = await call(editorController.updateBlogByEditor, {
        userId: ids.editor,
        role: 'editor',
        params: { id: blogId },
        body: { title: 'Another title' },
      });
      assert.equal(res.statusCode, 409);
      assert.equal((await live()).editorProposals.length, 1);
    });

    await t.test('a user who is not the writer cannot decide on the proposal', async () => {
      const res = await call(blogController.respondToEditorConsent, {
        userId: ids.stranger,
        role: 'principal_investigator',
        params: { id: blogId },
        body: { approved: true },
      });
      assert.equal(res.statusCode, 403);
      assert.equal((await live()).publishConsentStatus, 'pending');
    });

    await t.test('the proposing editor cannot decide on their own proposal', async () => {
      const res = await call(blogController.respondToEditorConsent, {
        userId: ids.editor,
        role: 'editor',
        params: { id: blogId },
        body: { approved: true },
      });
      assert.equal(res.statusCode, 403);
      assert.equal((await live()).publishConsentStatus, 'pending');
    });

    await t.test('the writer rejects with a note: the story stays a draft and the proposal is kept in history', async () => {
      const res = await call(blogController.respondToEditorConsent, {
        userId: ids.writer,
        role: 'principal_investigator',
        params: { id: blogId },
        body: { approved: false, note: 'Keep my original wording' },
      });
      assert.equal(res.statusCode, 200);

      const blog = await live();
      assert.equal(blog.status, 'draft');
      assert.equal(blog.title, 'Original title', 'rejection must not change the live title');
      assert.equal(blog.publishConsentStatus, 'rejected');
      assert.equal(blog.editorModifications, undefined, 'the live proposal is cleared');
      assert.equal(blog.editorProposals.length, 1);
      assert.equal(blog.editorProposals[0].status, 'rejected');
      assert.equal(blog.editorProposals[0].decisionNote, 'Keep my original wording');
      assert.equal(blog.editorProposals[0].proposal.title, 'Edited title', 'rejected content is kept for comparison');
    });

    await t.test('after a rejection the editor can propose again as version 2 without losing version 1', async () => {
      const res = await call(editorController.updateBlogByEditor, {
        userId: ids.editor,
        role: 'editor',
        params: { id: blogId },
        body: { title: 'Revised title' },
      });
      assert.equal(res.statusCode, 200);

      const blog = await live();
      assert.equal(blog.editorProposals.length, 2);
      assert.equal(blog.editorProposals[0].status, 'rejected');
      assert.equal(blog.editorProposals[1].version, 2);
      assert.equal(blog.editorProposals[1].status, 'pending');
      assert.equal(blog.editorProposals[1].baseline.title, 'Original title');
    });

    await t.test('the writer accepts version 2: every proposed field is applied and the story is approved', async () => {
      const res = await call(blogController.respondToEditorConsent, {
        userId: ids.writer,
        role: 'principal_investigator',
        params: { id: blogId },
        body: { approved: true, note: 'Thanks' },
      });
      assert.equal(res.statusCode, 200);

      const blog = await live();
      assert.equal(blog.title, 'Revised title');
      assert.equal(blog.status, 'approved');
      assert.equal(blog.publishConsentStatus, 'approved');
      assert.equal(blog.editorModifications, undefined);
      assert.equal(blog.editorProposals[1].status, 'accepted');
      assert.equal(blog.editorProposals[0].status, 'rejected', 'version 1 keeps its own decision');
    });

    await t.test('an editor cannot propose changes to a published story', async () => {
      await Blog.collection.updateOne({ _id: new mongoose.Types.ObjectId(blogId) }, { $set: { status: 'published' } });
      const res = await call(editorController.updateBlogByEditor, {
        userId: ids.editor,
        role: 'editor',
        params: { id: blogId },
        body: { title: 'Published edit' },
      });
      assert.equal(res.statusCode, 409);
      assert.match(res.body.error, /Unpublish/);
    });

    await t.test('rejecting a proposal on a published story leaves it published', async () => {
      const oid = new mongoose.Types.ObjectId(blogId);
      const modifiedAt = new Date('2026-10-05T08:00:00Z');
      await Blog.collection.updateOne(
        { _id: oid },
        {
          $set: {
            publishConsentStatus: 'pending',
            editorModifications: {
              editor: ids.editor,
              version: 3,
              title: 'Legacy proposal',
              modifiedAt,
            },
          },
          $push: {
            editorProposals: {
              version: 3,
              editor: ids.editor,
              status: 'pending',
              baseline: { title: 'Revised title', blocks: [] },
              proposal: { title: 'Legacy proposal', blocks: [] },
              proposedAt: modifiedAt,
            },
          },
        }
      );

      const res = await call(blogController.respondToEditorConsent, {
        userId: ids.writer,
        role: 'principal_investigator',
        params: { id: blogId },
        body: { approved: false, note: 'No' },
      });
      assert.equal(res.statusCode, 200);

      const blog = await live();
      assert.equal(blog.status, 'published');
      assert.equal(blog.title, 'Revised title');
    });
  }
);
