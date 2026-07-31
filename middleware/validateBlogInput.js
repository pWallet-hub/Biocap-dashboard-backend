// Parses multipart-form "modal" and "blocks" fields (which arrive as JSON strings) into objects,
// and attaches fields to req.parsedBody so controllers stay clean.
const parseBlogBody = (req, res, next) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
    const socialHandle = typeof body.socialHandle === 'string' ? body.socialHandle.trim() : '';
    const organizationLink = typeof body.organizationLink === 'string' ? body.organizationLink.trim() : '';

    let modal = {};
    if (body.modal) {
      try {
        modal = typeof body.modal === 'string' ? JSON.parse(body.modal) : body.modal;
      } catch (err) {
        return res.status(400).json({ error: '"modal" must be valid JSON' });
      }
    }

    let blocks = [];
    if (body.blocks) {
      try {
        blocks = typeof body.blocks === 'string' ? JSON.parse(body.blocks) : body.blocks;
      } catch (err) {
        return res.status(400).json({ error: '"blocks" must be valid JSON' });
      }
    }

    req.parsedBody = {
      title,
      tag,
      excerpt,
      socialHandle,
      organizationLink,
      modal: modal || {},
      blocks: Array.isArray(blocks) ? blocks : [],
    };

    next();
  } catch (error) {
    return res.status(400).json({ error: 'Failed to parse request body: ' + error.message });
  }
};

module.exports = { parseBlogBody };