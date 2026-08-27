// Parses multipart-form and JSON body fields into structured objects,
// attaching all fields (including Cloudinary image URLs) to req.parsedBody.
const parseBlogBody = (req, res, next) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
    const socialHandle = typeof body.socialHandle === 'string' ? body.socialHandle.trim() : '';
    const organizationLink = typeof body.organizationLink === 'string' ? body.organizationLink.trim() : '';

    // 🟢 PASS IMAGE URL & PUBLIC ID FROM DIRECT CLOUDINARY UPLOADS
    const img = typeof body.img === 'string' ? body.img.trim() : '';
    const imgPublicId = typeof body.imgPublicId === 'string' ? body.imgPublicId.trim() : '';

    // Pass optional document attachment fields
    const documentUrl = typeof body.documentUrl === 'string' ? body.documentUrl.trim() : '';
    const documentPublicId = typeof body.documentPublicId === 'string' ? body.documentPublicId.trim() : '';
    const documentName = typeof body.documentName === 'string' ? body.documentName.trim() : '';

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

    let excerptBlocks = [];
    if (body.excerptBlocks) {
      try {
        excerptBlocks = typeof body.excerptBlocks === 'string' ? JSON.parse(body.excerptBlocks) : body.excerptBlocks;
      } catch (err) {
        return res.status(400).json({ error: '"excerptBlocks" must be valid JSON' });
      }
    }

    req.parsedBody = {
      title,
      tag,
      excerpt,
      img, // 🟢 NOW INCLUDED IN PARSED BODY
      imgPublicId,
      documentUrl,
      documentPublicId,
      documentName,
      socialHandle,
      organizationLink,
      modal: modal || {},
      blocks: Array.isArray(blocks) ? blocks : [],
      excerptBlocks: Array.isArray(excerptBlocks) ? excerptBlocks : [],
    };

    next();
  } catch (error) {
    return res.status(400).json({ error: 'Failed to parse request body: ' + error.message });
  }
};

module.exports = { parseBlogBody };