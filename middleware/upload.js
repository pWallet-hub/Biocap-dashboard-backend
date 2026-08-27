require('dotenv').config();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    if (file.fieldname === 'document') {
      return {
        folder: 'blogs/documents',
        resource_type: 'raw',
      };
    }

    // Cover Image ('img') and Inline Section Images ('images')
    return {
      folder: 'blogs/images',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      // 🟢 CRITICAL SPEED FIX: Resize huge camera photos and auto-compress on Cloudinary
      transformation: [
        { width: 1920, height: 1080, crop: 'limit' }, // Resizes 4K/Camera photos down to 1080p
        { quality: 'auto:good', fetch_format: 'auto' }, // Automatically uses WebP/AVIF compression
      ],
    };
  },
});

const fileFilter = (req, file, cb) => {
  const isImageField = ['img', 'image', 'images'].includes(file.fieldname);

  if (isImageField && !file.mimetype.startsWith('image/')) {
    return cb(new Error('Uploaded file must be an image (jpg, jpeg, png, webp)'), false);
  }

  if (file.fieldname === 'document' && file.mimetype !== 'application/pdf') {
    return cb(new Error('Document must be a PDF file'), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024,   // 15MB max per image/PDF file
    fieldSize: 100 * 1024 * 1024, // 100MB max for stringified text fields (blocks/JSON content)
    fields: 500,                  // Allowed form fields count
    parts: 1000,                  // Allowed total parts
  },
});

// Configure exact fields accepted by POST/PUT blog endpoints
const uploadBlogFiles = upload.fields([
  { name: 'img', maxCount: 1 },        // Cover Image
  { name: 'images', maxCount: 100 },   // Inline Section Images
  { name: 'document', maxCount: 1 },   // PDF Document
]);

module.exports = {
  upload,
  uploadBlogFiles,
};