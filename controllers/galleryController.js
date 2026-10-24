const crypto = require('crypto');
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
 * Fallback reference id generator. The frontend normally sends its own
 * client-generated referenceId per image (so it can be shown/downloaded
 * before the item is even saved), but if a caller hits this endpoint
 * without one (e.g. a script, or a future admin tool), we still need a
 * stable id to store.
 */
const generateReferenceId = () => crypto.randomBytes(4).toString('hex'); // e.g. "a1b2c3d4"

/**
 * Safely parses the JSON-array fields the frontend sends alongside the
 * `images` files: imageCaptions and imageReferenceIds. Both arrive as
 * form-data string fields (JSON.stringify'd arrays), same order/length
 * as req.files.images.
 */
const parseImageMetaArray = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return null; // signals "invalid JSON" to the caller
  }
};

/**
 * Builds the `images` sub-document array for a folder collection from
 * the uploaded files plus the optional per-image captions/reference ids
 * and the chosen cover index.
 */
const buildImageDocs = (files, { captions, referenceIds, coverIndex }) => {
  const images = files.map((img, index) => ({
    url: img.path,
    publicId: img.filename || getPublicIdFromUrl(img.path),
    caption: (captions[index] && String(captions[index]).trim()) || null,
    referenceId: referenceIds[index] || generateReferenceId(),
    isCover: index === coverIndex,
  }));

  // Safety net: if coverIndex was missing/out of range, default to the
  // first image so we never save a collection with zero covers (the
  // model's pre-validate hook also catches this, but failing fast here
  // gives a clearer picture in logs).
  if (!images.some((img) => img.isCover)) {
    images[0].isCover = true;
  }

  return images;
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

/**
 * Normalises the publish state on an item before sending it to the client.
 * Items created before the `isPublished` field existed have no value in
 * MongoDB, so they are treated as published (only an explicit `false`
 * means hidden). Also adds a `status` string for convenience.
 */
const withPublishState = (item) => {
  const plain = typeof item.toObject === 'function' ? item.toObject() : item;
  const isPublished = plain.isPublished !== false;
  return { ...plain, isPublished, status: isPublished ? 'published' : 'draft' };
};

/**
 * Shared query builder for list endpoints (category, mediaType, search).
 */
const buildListQuery = ({ category, mediaType, search }) => {
  const query = {};
  if (category && category !== 'all') query.category = category;
  if (mediaType && mediaType !== 'all') query.mediaType = mediaType;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { caption: { $regex: search, $options: 'i' } },
    ];
  }
  return query;
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
/**
 * @desc   Create new Gallery entry (Folder Collection or Video)
 * @route  POST /api/gallery
 * @access Private (Admin & Editor only)
 */
exports.createGalleryItem = async (req, res) => {
  try {
    const {
      mediaType,
      title,
      category,
      caption,
      coverIndex,
      imageCaptions,
      imageReferenceIds,
    } = req.body;

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
        isPublished: true,
        publishedAt: new Date(),
        createdBy: req.user.id,
      });

      await newVideo.save();

      return res.status(201).json({
        success: true,
        message: 'Video entry published successfully.',
        shareableUrl: `${req.protocol}://${req.get('host')}/gallery/item/${newVideo._id}`,
        data: withPublishState(newVideo),
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

      // Parse the per-image caption/reference-id arrays the frontend
      // sends as JSON strings, same order & length as req.files.images.
      const parsedCaptions = parseImageMetaArray(imageCaptions);
      const parsedReferenceIds = parseImageMetaArray(imageReferenceIds);

      if (parsedCaptions === null || parsedReferenceIds === null) {
        return res.status(400).json({
          success: false,
          message: 'imageCaptions and imageReferenceIds must be valid JSON arrays.',
        });
      }

      const parsedCoverIndex = Number.isInteger(Number(coverIndex)) ? Number(coverIndex) : 0;
      if (parsedCoverIndex < 0 || parsedCoverIndex >= req.files.images.length) {
        return res.status(400).json({
          success: false,
          message: 'coverIndex does not match any uploaded image.',
        });
      }

      const uploadedImages = buildImageDocs(req.files.images, {
        captions: parsedCaptions,
        referenceIds: parsedReferenceIds,
        coverIndex: parsedCoverIndex,
      });

      const newFolder = new Gallery({
        mediaType: 'folder',
        title: title.trim(),
        category,
        caption: caption.trim(),
        images: uploadedImages,
        isPublished: true,
        publishedAt: new Date(),
        createdBy: req.user.id,
      });

      await newFolder.save();

      return res.status(201).json({
        success: true,
        message: 'Folder collection published successfully.',
        shareableUrl: `${req.protocol}://${req.get('host')}/gallery/item/${newFolder._id}`,
        data: withPublishState(newFolder),
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid mediaType supplied.' });
  } catch (error) {
    console.error('Gallery Creation Error:', error);
    return res.status(500).json({ success: false, message: 'Server processing error during upload.' });
  }
};

// ─── READ ALL — PUBLIC WEBSITE (PUBLISHED ONLY) ─────────────────────────────
/**
 * @desc   Get paginated PUBLISHED gallery items with optional search & category filter.
 *         Unpublished (draft) items are never returned here, so unpublishing
 *         an item removes it from the public website gallery.
 * @route  GET /api/gallery
 * @access Public
 */
exports.getGalleryItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 12;

    const query = buildListQuery(req.query);
    // Only an explicit `false` is hidden. Legacy items that have no
    // isPublished field yet stay visible until they are unpublished.
    query.isPublished = { $ne: false };

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
      data: items.map(withPublishState),
    });
  } catch (error) {
    console.error('Get Gallery Items Error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving gallery items.' });
  }
};

// ─── READ ALL — ADMIN DASHBOARD (PUBLISHED + DRAFTS) ────────────────────────
/**
 * @desc   Get paginated gallery items INCLUDING unpublished drafts,
 *         for the admin dashboard.
 * @route  GET /api/gallery/admin/list
 * @access Private (Admin & Editor only)
 */
exports.getAdminGalleryItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;

    const query = buildListQuery(req.query);

    const total = await Gallery.countDocuments(query);
    const items = await Gallery.find(query)
      .select('-__v')
      .populate('createdBy', 'username role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      count: items.length,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
      data: items.map(withPublishState),
    });
  } catch (error) {
    console.error('Get Admin Gallery Items Error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving gallery items.' });
  }
};

// ─── READ SINGLE BY ID ───────────────────────────────────────────────────────
/**
 * @desc   Get single PUBLISHED gallery item (For permalink views and direct sharing).
 *         Unpublished items return 404 so their links stop working too.
 * @route  GET /api/gallery/:id
 * @access Public
 */
exports.getGalleryItemById = async (req, res) => {
  try {
    const item = await Gallery.findById(req.params.id)
      .select('-__v')
      .populate('createdBy', 'username role');

    if (!item || item.isPublished === false) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    return res.status(200).json({ success: true, data: withPublishState(item) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Invalid ID format or server error.' });
  }
};

// ─── PUBLISH / UNPUBLISH ─────────────────────────────────────────────────────
/**
 * @desc   Make a gallery item visible on the public website
 * @route  PATCH /api/gallery/:id/publish
 * @access Private (Admin & Editor only)
 */
exports.publishGalleryItem = async (req, res) => {
  try {
    const item = await Gallery.findByIdAndUpdate(
      req.params.id,
      { $set: { isPublished: true, publishedAt: new Date() } },
      { returnDocument: 'after' }
    ).populate('createdBy', 'username role');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Gallery item is now visible on the website.',
      data: withPublishState(item),
    });
  } catch (error) {
    console.error('Publish Gallery Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to publish gallery item.' });
  }
};

/**
 * @desc   Hide a gallery item from the public website (keeps it in the dashboard)
 * @route  PATCH /api/gallery/:id/unpublish
 * @access Private (Admin & Editor only)
 */
exports.unpublishGalleryItem = async (req, res) => {
  try {
    const item = await Gallery.findByIdAndUpdate(
      req.params.id,
      { $set: { isPublished: false, publishedAt: null } },
      { returnDocument: 'after' }
    ).populate('createdBy', 'username role');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Gallery item removed from the website.',
      data: withPublishState(item),
    });
  } catch (error) {
    console.error('Unpublish Gallery Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to unpublish gallery item.' });
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
    const {
      title,
      category,
      caption,
      imageCaptions,
      imageReferenceIds,
      coverReferenceId,
    } = req.body;

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

    if (item.mediaType === 'folder') {
      // Append new images if new files are attached to a Folder collection.
      // Newly appended images never auto-replace the existing cover —
      // use coverReferenceId (below) to explicitly change it.
      if (req.files?.images?.length > 0) {
        const parsedCaptions = parseImageMetaArray(imageCaptions);
        const parsedReferenceIds = parseImageMetaArray(imageReferenceIds);

        if (parsedCaptions === null || parsedReferenceIds === null) {
          return res.status(400).json({
            success: false,
            message: 'imageCaptions and imageReferenceIds must be valid JSON arrays.',
          });
        }

        const newImages = req.files.images.map((img, index) => ({
          url: img.path,
          publicId: img.filename || getPublicIdFromUrl(img.path),
          caption: (parsedCaptions[index] && String(parsedCaptions[index]).trim()) || null,
          referenceId: parsedReferenceIds[index] || generateReferenceId(),
          isCover: false,
        }));

        item.images.push(...newImages);
      }

      // Explicitly re-assign which image is the cover, by its referenceId.
      if (coverReferenceId) {
        const match = item.images.find((img) => img.referenceId === coverReferenceId);
        if (!match) {
          return res.status(400).json({
            success: false,
            message: 'coverReferenceId does not match any image in this collection.',
          });
        }
        item.images.forEach((img) => {
          img.isCover = img.referenceId === coverReferenceId;
        });
      }
    }

    await item.save();

    return res.status(200).json({
      success: true,
      message: 'Gallery item updated successfully.',
      data: withPublishState(item),
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