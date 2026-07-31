const express = require('express');
const router = express.Router();
const creatorController = require('../controllers/creatorController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const asyncHandler = require('../utils/asyncHandler');
const { EXTERNAL_CREATORS } = require('../constants/roles');

// Enforce Authentication and Creator Role Authorization for all routes below
router.use(protect);
router.use(authorize(...EXTERNAL_CREATORS));

// File upload configuration for multi-part forms
const blogUploadFields = upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

/**
 * @swagger
 * tags:
 *   name: Content Creator
 *   description: Endpoints for social_media_content_creator & broadcast_content_creator
 */

// ─── Profile & Dashboard ──────────────────────────────────────────────────────

router.get('/profile', asyncHandler(creatorController.getMyProfile));
router.get('/activity', asyncHandler(creatorController.getMyActivity));

// ─── Personal Blogs Management ────────────────────────────────────────────────

router.get('/my-blogs', asyncHandler(creatorController.getMyBlogs));
router.get('/my-blogs/:id', asyncHandler(creatorController.getMyBlogById));

// ─── Blog Operations (Create, Update, Submit, Delete) ─────────────────────────

router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));
router.put('/blogs/:id', blogUploadFields, parseBlogBody, asyncHandler(blogController.updateBlog));
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));
router.delete('/blogs/:id', asyncHandler(blogController.deleteBlog));

// ─── Published Feed (Read-Only) ──────────────────────────────────────────────

router.get('/published', asyncHandler(creatorController.getPublishedFeed));
router.get('/published/:slug', asyncHandler(creatorController.getPublishedBlogBySlug));

// Export router instance directly
module.exports = router;