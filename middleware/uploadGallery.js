const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const galleryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // ── HD/4K VIDEO STORAGE CONFIGURATION ──────────────────────────────
    if (file.fieldname === 'video') {
      return {
        folder: 'afs_gallery/videos',
        resource_type: 'video',
        allowed_formats: ['mp4', 'mov', 'mkv', 'webm'],
        transformation: [
          {
            quality: 'auto:best', // Forces maximum visual fidelity with minimal compression artifacts
            video_codec: 'h264',  // Ensures universal cross-device crisp playback
            flags: 'streaming_attachment', // Optimizes video headers for instant Web pre-roll
          },
        ],
        eager: [
          { width: 1920, height: 1080, crop: 'limit', quality: 'auto:best', format: 'mp4' },
          { streaming_profile: 'full_hd', format: 'm3u8' }, // High-definition HLS stream
        ],
        async: true,        // NON-BLOCKING: Prevents API gateway timeout on large uploads
        eager_async: true,  // BACKGROUND PROCESSING: Encodes HD streams asynchronously
      };
    }

    // ── HD/4K IMAGE & THUMBNAIL STORAGE CONFIGURATION ─────────────────
    return {
      folder: 'afs_gallery/images',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [
        { width: 3840, height: 2160, crop: 'limit' }, // Extends scaling threshold up to 4K UHD
        { quality: '100' },                           // Disables lossy compression to preserve crisp detail
      ],
    };
  },
});

const galleryFileFilter = (req, file, cb) => {
  // 1. Video validation
  if (file.fieldname === 'video') {
    if (file.mimetype.startsWith('video/')) return cb(null, true);
    return cb(new Error('Video field must contain a valid MP4, MOV, MKV, or WEBM video file.'), false);
  }

  // 2. Image validation (Supports single or multi-image field variants)
  if (['thumbnail', 'images', 'img', 'image'].includes(file.fieldname)) {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Thumbnail and collection uploads must be valid image files.'), false);
  }

  cb(new Error('Unexpected field name detected in multipart payload.'), false);
};

const uploadGallery = multer({
  storage: galleryStorage,
  fileFilter: galleryFileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB maximum buffer to handle raw HD video streams
    files: 21,                  // Accepts up to 20 collection images + 1 video thumbnail
  },
});

// Configure exact multi-part field uploads for Editor/Admin operations
const uploadGalleryFiles = uploadGallery.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'images', maxCount: 20 },
]);

module.exports = { uploadGalleryFiles };