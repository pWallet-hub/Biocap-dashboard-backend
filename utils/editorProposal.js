// Pure helpers for editor proposals: snapshots, diffs, and human-readable summaries.
// Kept free of database and mail code so they can be unit tested directly.

const { diffWords, htmlToText } = require('./wordDiff');

const SCALAR_FIELDS = ['title', 'excerpt', 'tag', 'img', 'imgPublicId', 'bodyHtml'];

// Internal storage details that are not shown to people.
const HIDDEN_FIELDS = new Set(['imgPublicId']);

const FIELD_LABELS = {
  title: 'Title',
  excerpt: 'Excerpt',
  tag: 'Tag',
  img: 'Cover image',
  imgPublicId: 'Cover image',
  bodyHtml: 'Body text',
  blocks: 'Content blocks',
};

// Plain-object copy of a value, so Mongoose subdocuments and plain objects compare the same way.
const toPlain = (value) => JSON.parse(JSON.stringify(value ?? null));

// Captures the content fields an editor is allowed to propose changes to.
const snapshotOf = (source) => ({
  title: source.title ?? '',
  excerpt: source.excerpt ?? '',
  tag: source.tag ?? '',
  img: source.img ?? '',
  imgPublicId: source.imgPublicId ?? '',
  bodyHtml: source.bodyHtml ?? '',
  blocks: toPlain(source.blocks || []),
});

// Returns a list of changes between two snapshots.
// Scalar fields report before/after values; blocks report index-by-index differences.
const diffSnapshots = (before, after) => {
  const changes = [];

  for (const field of SCALAR_FIELDS) {
    const beforeValue = before[field] ?? '';
    const afterValue = after[field] ?? '';
    if (beforeValue !== afterValue) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  }

  const beforeBlocks = before.blocks || [];
  const afterBlocks = after.blocks || [];
  const length = Math.max(beforeBlocks.length, afterBlocks.length);
  const changedBlocks = [];

  for (let index = 0; index < length; index += 1) {
    const beforeBlock = beforeBlocks[index] ?? null;
    const afterBlock = afterBlocks[index] ?? null;
    if (JSON.stringify(beforeBlock) !== JSON.stringify(afterBlock)) {
      changedBlocks.push({ index, before: beforeBlock, after: afterBlock });
    }
  }

  if (changedBlocks.length > 0) {
    changes.push({
      field: 'blocks',
      changedBlocks,
      beforeCount: beforeBlocks.length,
      afterCount: afterBlocks.length,
    });
  }

  return changes;
};

// Short labels for the fields that changed, e.g. ["Title", "Content blocks (2 changed)"].
const summarizeChanges = (changes) => {
  const labels = [];
  const seen = new Set();

  for (const change of changes) {
    if (change.field === 'blocks') {
      labels.push(`Content blocks (${change.changedBlocks.length} changed)`);
      continue;
    }
    const label = FIELD_LABELS[change.field] || change.field;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
};

const DEFAULT_MAX_CHARS = 1500;

const blockContent = (block) => (block ? String(block.text ?? (typeof block.src === 'string' ? block.src : '')) : '');

const BLOCK_LABELS = {
  p: 'Paragraph',
  h1: 'Heading',
  h2: 'Subheading',
  quote: 'Quote',
  list: 'List',
  image: 'Image',
  video: 'Video',
  hero: 'Hero',
  html: 'HTML block',
};

const blockKind = (block) => BLOCK_LABELS[block?.type] || 'Block';

const blockSegments = (before, after) => {
  if (before?.type === 'image' || after?.type === 'image') {
    return [
      ...(before ? [{ type: 'delete', text: 'previous image' }] : []),
      ...(after ? [{ type: 'insert', text: 'new image' }] : []),
    ];
  }
  return diffWords(blockContent(before), blockContent(after));
};

// Keeps the first maxChars characters of a diff so one very long body cannot fill an email.
const capSegments = (segments, maxChars) => {
  let remaining = maxChars;
  const capped = [];
  for (const segment of segments) {
    if (remaining <= 0) break;
    if (segment.text.length <= remaining) {
      capped.push(segment);
      remaining -= segment.text.length;
    } else {
      capped.push({ ...segment, text: `${segment.text.slice(0, remaining)}…` });
      remaining = 0;
    }
  }
  return capped;
};

// Word-level, human-readable items for each change: { label, segments, truncated }.
// Matches the review panel in the app, so the email shows the same added and deleted text.
const describeChanges = (changes, { maxChars = DEFAULT_MAX_CHARS } = {}) => {
  const items = [];

  for (const change of changes) {
    if (HIDDEN_FIELDS.has(change.field)) continue;

    if (change.field === 'blocks') {
      for (const block of change.changedBlocks || []) {
        items.push({
          label: `${blockKind(block.after ?? block.before)} ${block.index + 1}`,
          segments: blockSegments(block.before, block.after),
        });
      }
      continue;
    }

    const label = FIELD_LABELS[change.field] || change.field;
    if (change.field === 'img') {
      items.push({
        label,
        segments: [
          { type: 'delete', text: 'previous cover image' },
          { type: 'insert', text: 'new cover image' },
        ],
      });
      continue;
    }

    const before = String(change.before ?? '');
    const after = String(change.after ?? '');
    const segments =
      change.field === 'bodyHtml' ? diffWords(htmlToText(before), htmlToText(after)) : diffWords(before, after);
    items.push({ label, segments });
  }

  return items.map((item) => {
    const total = item.segments.reduce((sum, segment) => sum + segment.text.length, 0);
    return { label: item.label, segments: capSegments(item.segments, maxChars), truncated: total > maxChars };
  });
};

// Content fields an accepted proposal writes onto the live story.
const APPLIED_FIELDS = ['title', 'excerpt', 'tag', 'img', 'imgPublicId', 'bodyHtml', 'blocks'];

// Whether the user wrote the story (original author, or the current author).
const isWriterOf = (blog, userId) =>
  String(blog.originalAuthor?._id ?? blog.originalAuthor) === String(userId) ||
  String(blog.author?._id ?? blog.author) === String(userId);

// An editor may propose changes until the story is published. Published stories must be unpublished first,
// so accepted changes never go live without a publisher's review. A writer edits their own story directly,
// since they would otherwise be the only person who could decide on their own proposal.
const canProposeEdit = (blog, userId) => {
  if (blog.status === 'published') {
    return { allowed: false, reason: 'Unpublish this story before proposing changes.' };
  }
  if (userId && isWriterOf(blog, userId)) {
    return { allowed: false, reason: 'You wrote this story, so edit it directly instead of proposing changes.' };
  }
  return { allowed: true };
};

// Only the writer (original author, or the current author) may accept or reject a proposal,
// and never the editor who made it.
const canDecideProposal = ({ blog, userId, proposal }) => {
  if (!isWriterOf(blog, userId)) {
    return { allowed: false, reason: 'Only the writer can approve or reject editor changes.' };
  }
  if (proposal.editor && String(proposal.editor) === String(userId)) {
    return { allowed: false, reason: 'You cannot decide on a proposal you made yourself.' };
  }
  return { allowed: true };
};

// The update that records a writer's decision on the pending proposal.
// Accepting copies the proposal onto the story. Rejecting returns it to draft, unless it is already published,
// in which case the live story stays published. Both keep the proposal in history and clear the live copy.
const buildConsentDecision = ({ proposal, approved, note, decidedBy, now, currentStatus }) => {
  const set = {
    publishConsentStatus: approved ? 'approved' : 'rejected',
    publishConsentNote: note,
    publishConsentBy: decidedBy,
    'editorProposals.$[p].status': approved ? 'accepted' : 'rejected',
    'editorProposals.$[p].decidedAt': now,
    'editorProposals.$[p].decidedBy': decidedBy,
    'editorProposals.$[p].decisionNote': note,
  };

  if (approved) {
    for (const field of APPLIED_FIELDS) {
      if (proposal[field] !== undefined) set[field] = proposal[field];
    }
    set.status = currentStatus === 'published' ? 'published' : 'approved';
  } else {
    set.status = currentStatus === 'published' ? 'published' : 'draft';
  }

  return { set, unset: { editorModifications: '' } };
};

module.exports = {
  FIELD_LABELS,
  APPLIED_FIELDS,
  snapshotOf,
  diffSnapshots,
  summarizeChanges,
  describeChanges,
  canProposeEdit,
  canDecideProposal,
  buildConsentDecision,
};
