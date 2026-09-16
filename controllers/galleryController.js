const Gallery = require('../models/Gallery');
const cloudinary = require('../config/cloudinary');

/**
 * Helper to extract Cloudinary Public ID from a secure URL
 * Needed to execute physical asset cleanup on Cloudinary CDN
 */
const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  const publicIdWithExt = parts[1].replace(/^v\d+\//, ''); // Strip version prefix (e.g. v171234/)
  return publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
};

/**
 * Helper to purge Cloudinary storage files for a given gallery document
 */
const purgeCloudinaryAssets = async (item) => {
  if (item.mediaType === 'video') {
    const videoPublicId = getPublicIdFromUrl(item.videoUrl);
    const thumbPublicId = getPublicIdFromUrl(item.thumbnailUrl);

    if (videoPublicId) {
      await cloudinary.uploader.destroy(videoPublicId, { resource_type: 'video' });
    }
    if (thumbPublicId) {
      await cloudinary.uploader.destroy(thumbPublicId, { resource_type: 'image' });
    }
  }

  if (item.mediaType === 'folder' && item.images?.length > 0) {
    const deletePromises = item.images.map((img) => {
      const publicId = img.publicId || getPublicIdFromUrl(img.url);
      if (publicId) {
        return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      }
      return Promise.resolve();
    });
    await Promise.all(deletePromises);
  }
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
/**
 * @desc   Create new Gallery entry (Folder Collection or Video)
 * @route  POST /api/gallery
 * @access Private (Admin & Editor only)
 */
exports.createGalleryItem = async (req, res) => {
  try {
    const { mediaType, title, category, caption } = req.body;

    // Common Metadata Validation
    if (!mediaType || !title || !category || !caption) {
      return res.status(400).json({
        success: false,
        message: 'Media type, title, category, and caption are mandatory fields.',
      });
    }

    // ── 1. Video Entry Upload ──
    if (mediaType === 'video') {
      if (!req.files?.video?.[0] || !req.files?.thumbnail?.[0]) {
        return res.status(400).json({
          success: false,
          message: 'Video uploads require both an MP4 video file and a thumbnail image.',
        });
      }

      const newVideo = new Gallery({
        mediaType: 'video',
        title: title.trim(),
        category,
        caption: caption.trim(),
        videoUrl: req.files.video[0].path,
        thumbnailUrl: req.files.thumbnail[0].path,
        createdBy: req.user.id,
      });

      await newVideo.save();

      return res.status(201).json({
        success: true,
        message: 'Video entry published successfully.',
        shareableUrl: `${req.protocol}://${req.get('host')}/gallery/item/${newVideo._id}`,
        data: newVideo,
      });
    }

    // ── 2. Folder / Image Collection Upload ──
    if (mediaType === 'folder') {
      if (!req.files?.images || req.files.images.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Folder collections require at least one image file.',
        });
      }

      const uploadedImages = req.files.images.map((img) => ({
        url: img.path,
        publicId: img.filename || getPublicIdFromUrl(img.path),
      }));

      const newFolder = new Gallery({
        mediaType: 'folder',
        title: title.trim(),
        category,
        caption: caption.trim(),
        images: uploadedImages,
        createdBy: req.user.id,
      });

      await newFolder.save();

      return res.status(201).json({
        success: true,
        message: 'Folder collection published successfully.',
        shareableUrl: `${req.protocol}://${req.get('host')}/gallery/item/${newFolder._id}`,
        data: newFolder,
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid mediaType supplied.' });
  } catch (error) {
    console.error('Gallery Creation Error:', error);
    return res.status(500).json({ success: false, message: 'Server processing error during upload.' });
  }
};

// ─── READ ALL (PAGINATED & FILTERED) ────────────────────────────────────────
/**
 * @desc   Get paginated gallery items with optional search & category filter
 * @route  GET /api/gallery
 * @access Public
 */
exports.getGalleryItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;
    const { category, mediaType, search } = req.query;

    const query = {};
    if (category && category !== 'all') query.category = category;
    if (mediaType && mediaType !== 'all') query.mediaType = mediaType;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { caption: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Gallery.countDocuments(query);
    const items = await Gallery.find(query)
      .select('-__v')
      .populate('createdBy', 'username role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(); // Convert Mongoose document overhead to lightweight JS objects

    return res.status(200).json({
      success: true,
      count: items.length,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      data: items,
    });
  } catch (error) {
    console.error('Get Gallery Items Error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving gallery items.' });
  }
};

// ─── READ SINGLE BY ID ───────────────────────────────────────────────────────
/**
 * @desc   Get single gallery item (For permalink views and direct sharing)
 * @route  GET /api/gallery/:id
 * @access Public
 */
exports.getGalleryItemById = async (req, res) => {
  try {
    const item = await Gallery.findById(req.params.id)
      .select('-__v')
      .populate('createdBy', 'username role');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Invalid ID format or server error.' });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
/**
 * @desc   Update metadata or append media files to an existing gallery entry
 * @route  PUT /api/gallery/:id
 * @access Private (Admin & Editor only)
 */
exports.updateGalleryItem = async (req, res) => {
  try {
    const { title, category, caption } = req.body;
    const item = await Gallery.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    // Update Text Metadata
    if (title) item.title = title.trim();
    if (category) item.category = category;
    if (caption) item.caption = caption.trim();

    // Update Video stream or Thumbnail if new files are attached
    if (item.mediaType === 'video') {
      if (req.files?.video?.[0]) {
        const oldVideoId = getPublicIdFromUrl(item.videoUrl);
        if (oldVideoId) await cloudinary.uploader.destroy(oldVideoId, { resource_type: 'video' });
        item.videoUrl = req.files.video[0].path;
      }

      if (req.files?.thumbnail?.[0]) {
        const oldThumbId = getPublicIdFromUrl(item.thumbnailUrl);
        if (oldThumbId) await cloudinary.uploader.destroy(oldThumbId, { resource_type: 'image' });
        item.thumbnailUrl = req.files.thumbnail[0].path;
      }
    }

    // Append new images if new files are attached to a Folder collection
    if (item.mediaType === 'folder' && req.files?.images?.length > 0) {
      const newImages = req.files.images.map((img) => ({
        url: img.path,
        publicId: img.filename || getPublicIdFromUrl(img.path),
      }));
      item.images.push(...newImages);
    }

    await item.save();

    return res.status(200).json({
      success: true,
      message: 'Gallery item updated successfully.',
      data: item,
    });
  } catch (error) {
    console.error('Update Gallery Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update gallery item.' });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
/**
 * @desc   Delete Gallery item document and purge corresponding Cloudinary assets
 * @route  DELETE /api/gallery/:id
 * @access Private (Admin & Editor only)
 */
exports.deleteGalleryItem = async (req, res) => {
  try {
    const item = await Gallery.findById(req.params.id);

    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    // Purge physical files from Cloudinary storage before dropping MongoDB record
    await purgeCloudinaryAssets(item);
    await item.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Gallery item and associated Cloudinary assets deleted successfully.',
    });
  } catch (error) {
    console.error('Delete Gallery Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete gallery item.' });
  }
};