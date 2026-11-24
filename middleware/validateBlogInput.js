// Parses multipart-form and JSON body fields into structured objects,
// attaching all fields (including Cloudinary image URLs) to req.parsedBody.
//
// A field the client did not send stays undefined, so PUT only changes what was sent.
// An empty string is kept as '' so a draft can clear a field. img/imgPublicId may be null to remove the cover.

const has = (body, field) => Object.prototype.hasOwnProperty.call(body, field);

const parseText = (body, field) => {
  if (!has(body, field) || body[field] === undefined) return undefined;
  if (body[field] === null) return '';
  return typeof body[field] === 'string' ? body[field].trim() : undefined;
};

const parseNullableText = (body, field) => {
  if (has(body, field) && body[field] === null) return null;
  return parseText(body, field);
};

const parseJsonField = (body, field) => {
  if (!has(body, field) || body[field] === undefined || body[field] === null || body[field] === '') return undefined;
  return typeof body[field] === 'string' ? JSON.parse(body[field]) : body[field];
};

const parseBlogBody = (req, res, next) => {
  const body = req.body || {};
  const parsed = {
    title: parseText(body, 'title'),
    tag: parseText(body, 'tag'),
    excerpt: parseText(body, 'excerpt'),
    socialHandle: parseText(body, 'socialHandle'),
    organizationLink: parseText(body, 'organizationLink'),
    // Image URL & public ID from direct Cloudinary uploads (null removes the cover)
    img: parseNullableText(body, 'img'),
    imgPublicId: parseNullableText(body, 'imgPublicId'),
    // Optional document attachment fields
    documentUrl: parseText(body, 'documentUrl'),
    documentPublicId: parseText(body, 'documentPublicId'),
    documentName: parseText(body, 'documentName'),
  };

  for (const field of ['modal', 'blocks', 'excerptBlocks']) {
    try {
      parsed[field] = parseJsonField(body, field);
    } catch (err) {
      return res.status(400).json({ error: `"${field}" must be valid JSON` });
    }
  }

  if (parsed.blocks !== undefined && !Array.isArray(parsed.blocks)) {
    return res.status(400).json({ error: '"blocks" must be an array' });
  }
  if (parsed.excerptBlocks !== undefined && !Array.isArray(parsed.excerptBlocks)) {
    return res.status(400).json({ error: '"excerptBlocks" must be an array' });
  }
  if (parsed.modal !== undefined && (typeof parsed.modal !== 'object' || Array.isArray(parsed.modal))) {
    return res.status(400).json({ error: '"modal" must be an object' });
  }

  req.parsedBody = parsed;
  next();
};

module.exports = { parseBlogBody };
