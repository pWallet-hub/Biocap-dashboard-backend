// Parses multipart-form "modal" and "blocks" fields (which arrive as JSON strings) into objects,
// and attaches fields to req.parsedBody so controllers stay clean.
const parseBlogBody = (req, res, next) => {
  const { title, tag, excerpt, socialHandle, organizationLink } = req.body;

  let modal;
  if (req.body.modal) {
    try {
      modal = typeof req.body.modal === 'string' ? JSON.parse(req.body.modal) : req.body.modal;
    } catch (err) {
      return res.status(400).json({ error: '"modal" must be valid JSON' });
    }
  }

  let blocks;
  if (req.body.blocks) {
    try {
      blocks = typeof req.body.blocks === 'string' ? JSON.parse(req.body.blocks) : req.body.blocks;
    } catch (err) {
      return res.status(400).json({ error: '"blocks" must be valid JSON' });
    }
  }

  req.parsedBody = { title, tag, excerpt, socialHandle, organizationLink, modal, blocks };
  next();
};

module.exports = { parseBlogBody };