// Pure helpers for editor proposals: snapshots, diffs, and human-readable summaries.
// Kept free of database and mail code so they can be unit tested directly.

const SCALAR_FIELDS = ['title', 'excerpt', 'tag', 'img', 'imgPublicId', 'bodyHtml'];

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

module.exports = {
  FIELD_LABELS,
  snapshotOf,
  diffSnapshots,
  summarizeChanges,
};
