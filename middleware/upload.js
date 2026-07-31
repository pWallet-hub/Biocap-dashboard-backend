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

    // Cover Image storage
    return {
      folder: 'blogs/images',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    };
  },
});

const fileFilter = (req, file, cb) => {
  if ((file.fieldname === 'img' || file.fieldname === 'image') && !file.mimetype.startsWith('image/')) {
    return cb(new Error('img must be an image file (jpg, jpeg, png, webp)'), false);
  }
  if (file.fieldname === 'document' && file.mimetype !== 'application/pdf') {
    return cb(new Error('document must be a PDF file'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
});

const uploadBlogFiles = upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

module.exports = upload;
module.exports.upload = upload;
module.exports.uploadBlogFiles = uploadBlogFiles;