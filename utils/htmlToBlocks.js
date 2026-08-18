// Naive HTML to blocks parser used to normalize full article HTML into structured blocks.
// This is intentionally lightweight to avoid adding heavy dependencies.
const stripTags = (str) => str.replace(/<[^>]*>/g, '').trim();

function extractAttrs(tag) {
  const srcMatch = tag.match(/src=["']([^"']+)["']/i);
  const src = srcMatch ? srcMatch[1] : '';
  const altMatch = tag.match(/alt=["']([^"']+)["']/i);
  const alt = altMatch ? altMatch[1] : '';
  return { src, alt };
}

function htmlToBlocks(html) {
  if (!html || typeof html !== 'string') return [];

  const blocks = [];

  // Remove script/style
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // Detect first hero: if an <h1> and an <img> appear near top
  const topSlice = cleaned.slice(0, 2000);
  const h1Match = topSlice.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const imgMatch = topSlice.match(/<img[^>]*>/i);
  if (h1Match || imgMatch) {
    const hero = { type: 'hero' };
    if (h1Match) hero.text = stripTags(h1Match[0]);
    if (imgMatch) {
      const { src, alt } = extractAttrs(imgMatch[0]);
      if (src) hero.background = src;
      if (alt) hero.caption = alt;
    }
    blocks.push(hero);
  }

  // Match common block-level tags in order
  const tagRe = /<(h1|h2|h3|p|blockquote|ul|ol|li|img)([^>]*)>([\s\S]*?)<\/(?:h1|h2|h3|p|blockquote|ul|ol|li)>/gi;
  let match;
  // Fallback pass: handle <img/> as self-closing
  const imgSelfRe = /<img([^>]*)\/>/gi;

  // First, handle lists separately using regex for ul/ol
  const listRe = /<(ul|ol)([^>]*)>([\s\S]*?)<\/(?:ul|ol)>/gi;
  let cursor = 0;
  while ((match = listRe.exec(cleaned))) {
    const itemsHtml = match[3];
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    const items = [];
    let li;
    while ((li = liRe.exec(itemsHtml))) {
      items.push(stripTags(li[1]));
    }
    if (items.length) {
      blocks.push({ type: 'list', items });
    }
    cursor = match.index + match[0].length;
  }

  // Generic tag pass: headings, paragraphs, blockquotes, images
  const genericRe = /<(h1|h2|p|blockquote)([^>]*)>([\s\S]*?)<\/\1>/gi;
  while ((match = genericRe.exec(cleaned))) {
    const tag = match[1].toLowerCase();
    const content = match[3] || '';
    if (tag === 'h1') blocks.push({ type: 'h1', text: stripTags(content) });
    else if (tag === 'h2') blocks.push({ type: 'h2', text: stripTags(content) });
    else if (tag === 'p') blocks.push({ type: 'p', text: stripTags(content) });
    else if (tag === 'blockquote') blocks.push({ type: 'quote', text: stripTags(content) });
  }

  // Images (self-closing or with closing tag)
  while ((match = imgSelfRe.exec(cleaned))) {
    const attrs = match[1] || '';
    const { src, alt } = extractAttrs('<img ' + attrs + '/>');
    if (src) blocks.push({ type: 'image', src, caption: alt || '' });
  }

  // If no blocks were produced but we have HTML, store as a single html block
  if (blocks.length === 0) {
    const text = cleaned.replace(/<[^>]+>/g, '').trim();
    if (text) {
      blocks.push({ type: 'html', text: text });
    }
  }

  return blocks;
}

module.exports = { htmlToBlocks };
