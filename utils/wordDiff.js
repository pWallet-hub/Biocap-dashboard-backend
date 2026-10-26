// Word-level diff for editor proposals. Mirrors the frontend's src/lib/diff.ts so the email shows the same marks the app shows.
// Each segment is { type: 'equal' | 'insert' | 'delete', text }.

// Above this many cell comparisons the table gets too large, so the whole span is shown as replaced.
const MAX_DIFF_CELLS = 1000000;

// Words, whitespace and punctuation are separate tokens, so "mat." and "mat" are compared as "mat" plus ".".
const tokenize = (text) => text.match(/\s+|[\p{L}\p{N}_']+|[^\s\p{L}\p{N}_']/gu) || [];

const diffWords = (before, after) => {
  const a = tokenize(before);
  const b = tokenize(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };

  a.slice(0, start).forEach((token) => push('equal', token));

  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_DIFF_CELLS) {
    midA.forEach((token) => push('delete', token));
    midB.forEach((token) => push('insert', token));
  } else {
    // lcs[i * width + j] = longest common subsequence of midA[i..] and midB[j..], stored flat.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('equal', midA[i]);
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        push('delete', midA[i]);
        i += 1;
      } else {
        push('insert', midB[j]);
        j += 1;
      }
    }
    while (i < n) push('delete', midA[i++]);
    while (j < m) push('insert', midB[j++]);
  }

  a.slice(endA).forEach((token) => push('equal', token));
  return out;
};

// Reduces stored HTML to readable plain text so two body versions can be compared word by word.
const htmlToText = (html) =>
  String(html ?? '')
    .replace(/<\/?(p|div|h[1-6]|li|blockquote|br)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

module.exports = { diffWords, htmlToText };
