const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// Cover image storage
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'blogs/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1600, height: 900, crop: 'limit' }],
  },
});

// PDF document storage (raw resource type — required for non-image files)
const pdfStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'blogs/documents',
    resource_type: 'raw',
    allowed_formats: ['pdf'],
  },
});

// multer-storage-cloudinary only supports one storage engine per multer instance,
// so this wrapper routes each incoming file to the right storage based on its field name.
const dualStorage = {
  _handleFile(req, file, cb) {
    const target = file.fieldname === 'document' ? pdfStorage : imageStorage;
    target._handleFile(req, file, cb);
  },
  _removeFile(req, file, cb) {
    const target = file.fieldname === 'document' ? pdfStorage : imageStorage;
    target._removeFile(req, file, cb);
  },
};

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'img' && !file.mimetype.startsWith('image/')) {
    return cb(new Error('img must be an image file (jpg, jpeg, png, webp)'), false);
  }
  if (file.fieldname === 'document' && file.mimetype !== 'application/pdf') {
    return cb(new Error('document must be a PDF file'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: dualStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
});

// Accepts one cover image ("img") and one optional PDF ("document") in the same request
const uploadBlogFiles = upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

module.exports = { upload, uploadBlogFiles };