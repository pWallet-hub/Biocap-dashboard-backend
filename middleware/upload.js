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
    };
  },
});

const fileFilter = (req, file, cb) => {
  // 🟢 Allow 'img', 'image', and 'images' field names
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
});

// Configure exact fields accepted by POST/PUT blog endpoints
const uploadBlogFiles = upload.fields([
  { name: 'img', maxCount: 1 },        // Cover Image
  { name: 'images', maxCount: 50 },    // Inline Section Images
  { name: 'document', maxCount: 1 },   // PDF Document
]);

// 🟢 Clean exports object
module.exports = {
  upload,
  uploadBlogFiles,
};