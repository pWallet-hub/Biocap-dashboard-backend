// Parses the multipart-form "modal" field (arrives as a JSON string) into an object,
// and attaches all text fields to req.parsedBody so controllers stay clean.
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

  req.parsedBody = { title, tag, excerpt, socialHandle, organizationLink, modal };
  next();
};

module.exports = { parseBlogBody };