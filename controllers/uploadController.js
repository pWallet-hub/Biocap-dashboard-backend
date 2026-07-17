const cloudinary = require('../config/cloudinary'); // Uses your existing Cloudinary config
const fs = require('fs');

/**
 * Uploads the raw binary cropped image file to Cloudinary
 * and returns the secure public URL to the frontend.
 */
const handleDirectUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file detected in upload stream.'
      });
    }

    const tempFilePath = req.file.path;

    // Upload temporary file directly to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(tempFilePath, {
      folder: 'biocap_aligned_crops', 
      resource_type: 'image'
    });

    // Clean up temporary local server storage
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    return res.status(200).json({
      success: true,
      imageUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id
    });

  } catch (error) {
    console.error('Error during image upload:', error);
    return res.status(500).json({
      success: false,
      message: 'Standalone upload to Cloudinary failed.'
    });
  }
};

module.exports = {
  handleDirectUpload
};