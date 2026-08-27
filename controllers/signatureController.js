const cloudinary = require('../config/cloudinary');

/**
 * Generates a signed upload token for direct Cloudinary uploads from the browser
 * GET /api/upload/signature
 */
exports.getUploadSignature = async (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'blogs/images';

    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp: timestamp,
        folder: folder,
      },
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      folder: folder,
    });
  } catch (error) {
    console.error('Failed to generate Cloudinary signature:', error);
    res.status(500).json({ error: 'Failed to generate upload signature' });
  }
};