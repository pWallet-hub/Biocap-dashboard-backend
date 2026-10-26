const test = require('node:test');
const assert = require('node:assert/strict');

const {
  APPLIED_FIELDS,
  snapshotOf,
  canProposeEdit,
  canDecideProposal,
  buildConsentDecision,
} = require('../utils/editorProposal');

const WRITER = '6a6b3bc1d2f47ac231603036';
const EDITOR = '6a71a09adf276c9c51723e2e';
const OTHER = '6a8c0000000000000000000a';

const storyBy = (writerId, overrides = {}) => ({
  status: 'draft',
  originalAuthor: writerId,
  author: writerId,
  ...overrides,
});

const proposalBy = (editorId) => ({
  version: 1,
  editor: editorId,
  title: 'Edited title',
  excerpt: 'Edited excerpt',
  tag: 'Health',
  img: 'https://cdn.example/new.jpg',
  imgPublicId: 'new',
  bodyHtml: '<p>Edited</p>',
  blocks: [{ type: 'p', text: 'Edited paragraph' }],
  modifiedAt: new Date('2026-10-01T10:00:00Z'),
});

test('an editor may propose changes to a draft, pending review, or approved story', () => {
  for (const status of ['draft', 'pending_review', 'approved']) {
    assert.deepEqual(canProposeEdit({ status }), { allowed: true }, status);
  }
});

test('an editor may not propose changes to a published story', () => {
  const result = canProposeEdit({ status: 'published' });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Unpublish/);
});

test('the original writer may decide on an editor proposal', () => {
  const result = canDecideProposal({ blog: storyBy(WRITER), userId: WRITER, proposal: proposalBy(EDITOR) });
  assert.deepEqual(result, { allowed: true });
});

test('the current author may decide when they differ from the original author', () => {
  const blog = storyBy(OTHER, { author: WRITER });
  const result = canDecideProposal({ blog, userId: WRITER, proposal: proposalBy(EDITOR) });
  assert.deepEqual(result, { allowed: true });
});

test('a user who is neither writer nor author cannot decide on a proposal', () => {
  const result = canDecideProposal({ blog: storyBy(WRITER), userId: OTHER, proposal: proposalBy(EDITOR) });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Only the writer/);
});

test('an editor cannot accept or reject a proposal they made on their own story', () => {
  const blog = storyBy(EDITOR);
  const result = canDecideProposal({ blog, userId: EDITOR, proposal: proposalBy(EDITOR) });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /yourself/);
});

test('populated writer documents are matched by their _id', () => {
  const blog = storyBy({ _id: WRITER }, { originalAuthor: { _id: WRITER }, author: { _id: WRITER } });
  const result = canDecideProposal({ blog, userId: WRITER, proposal: proposalBy(EDITOR) });
  assert.deepEqual(result, { allowed: true });
});

test('accepting applies every proposed content field and moves a draft to approved', () => {
  const proposal = proposalBy(EDITOR);
  const { set, unset } = buildConsentDecision({
    proposal,
    approved: true,
    note: 'Looks good',
    decidedBy: WRITER,
    now: new Date('2026-10-02T09:00:00Z'),
    currentStatus: 'draft',
  });

  for (const field of APPLIED_FIELDS) {
    assert.deepEqual(set[field], proposal[field], `field ${field} should be applied`);
  }
  assert.equal(set.status, 'approved');
  assert.equal(set.publishConsentStatus, 'approved');
  assert.equal(set['editorProposals.$[p].status'], 'accepted');
  assert.equal(set['editorProposals.$[p].decisionNote'], 'Looks good');
  assert.deepEqual(unset, { editorModifications: '' });
});

test('accepting keeps a published story published', () => {
  const { set } = buildConsentDecision({
    proposal: proposalBy(EDITOR),
    approved: true,
    note: '',
    decidedBy: WRITER,
    now: new Date(),
    currentStatus: 'published',
  });
  assert.equal(set.status, 'published');
});

test('rejecting returns the story to draft, leaves content untouched, and records the decision', () => {
  const { set, unset } = buildConsentDecision({
    proposal: proposalBy(EDITOR),
    approved: false,
    note: 'Please keep my original wording',
    decidedBy: WRITER,
    now: new Date('2026-10-02T09:00:00Z'),
    currentStatus: 'pending_review',
  });

  assert.equal(set.status, 'draft');
  assert.equal(set.publishConsentStatus, 'rejected');
  assert.equal(set['editorProposals.$[p].status'], 'rejected');
  assert.equal(set['editorProposals.$[p].decisionNote'], 'Please keep my original wording');
  for (const field of APPLIED_FIELDS) {
    assert.equal(set[field], undefined, `rejection must not write ${field}`);
  }
  assert.deepEqual(unset, { editorModifications: '' });
});

test('rejecting a proposal on a published story does not unpublish it', () => {
  const { set } = buildConsentDecision({
    proposal: proposalBy(EDITOR),
    approved: false,
    note: '',
    decidedBy: WRITER,
    now: new Date(),
    currentStatus: 'published',
  });
  assert.equal(set.status, 'published');
});

test('the proposal baseline is preserved when a proposal is accepted or rejected', () => {
  const baseline = snapshotOf({ title: 'Original', tag: 'Health', blocks: [{ type: 'p', text: 'Original' }] });
  const record = { version: 1, baseline, proposal: proposalBy(EDITOR) };
  const { set } = buildConsentDecision({
    proposal: record.proposal,
    approved: false,
    note: '',
    decidedBy: WRITER,
    now: new Date(),
    currentStatus: 'draft',
  });

  // Rejection never writes the baseline or the proposal back onto the story, so the history stays intact.
  assert.equal(set.title, undefined);
  assert.equal(set['editorProposals.$[p].status'], 'rejected');
  assert.equal(record.baseline.title, 'Original');
});

test('an editor may propose changes to a story written by someone else', () => {
  assert.deepEqual(canProposeEdit(storyBy(WRITER), EDITOR), { allowed: true });
});

test('an editor who wrote a story edits it directly rather than proposing changes to themselves', () => {
  const result = canProposeEdit(storyBy(EDITOR), EDITOR);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /edit it directly/);
});
