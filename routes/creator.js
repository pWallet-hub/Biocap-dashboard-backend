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

/**
 * @swagger
 * /api/contributor/profile:
 *   get:
 *     summary: Get logged-in creator profile details
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Creator profile payload }
 */
router.get('/profile', asyncHandler(creatorController.getMyProfile));

/**
 * @swagger
 * /api/contributor/activity:
 *   get:
 *     summary: Get recent account activity feed
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Activity timeline }
 */
router.get('/activity', asyncHandler(creatorController.getMyActivity));

// ─── Personal Blogs Management ────────────────────────────────────────────────

/**
 * @swagger
 * /api/contributor/my-blogs:
 *   get:
 *     summary: List stories created by logged-in contributor
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: List of personal blog posts }
 */
router.get('/my-blogs', asyncHandler(creatorController.getMyBlogs));

/**
 * @swagger
 * /api/contributor/my-blogs/{id}:
 *   get:
 *     summary: Get single personal blog post by ID
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog detail }
 */
router.get('/my-blogs/:id', asyncHandler(creatorController.getMyBlogById));

// ─── Blog Operations (Create, Update, Submit, Delete) ─────────────────────────

/**
 * @swagger
 * /api/contributor/blogs:
 *   post:
 *     summary: Create new blog draft
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, tag, excerpt, img]
 *             properties:
 *               title: { type: string }
 *               tag: { type: string }
 *               excerpt: { type: string }
 *               blocks: { type: string, description: "JSON stringified blocks" }
 *               modal: { type: string, description: "JSON stringified modal metadata" }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 *     responses:
 *       201: { description: Draft created }
 */
router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}:
 *   put:
 *     summary: Update existing draft or rejected blog
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               tag: { type: string }
 *               excerpt: { type: string }
 *               blocks: { type: string }
 *               modal: { type: string }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 *     responses:
 *       200: { description: Blog updated }
 */
router.put('/blogs/:id', blogUploadFields, parseBlogBody, asyncHandler(blogController.updateBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}/submit:
 *   patch:
 *     summary: Submit draft blog for review
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog submitted }
 */
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}:
 *   delete:
 *     summary: Soft delete personal draft story
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog moved to trash }
 */
router.delete('/blogs/:id', asyncHandler(blogController.deleteBlog));

// ─── Published Feed (Read-Only) ──────────────────────────────────────────────

/**
 * @swagger
 * /api/contributor/published:
 *   get:
 *     summary: Read-only live published website articles feed
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Published articles list }
 */
router.get('/published', asyncHandler(creatorController.getPublishedFeed));

/**
 * @swagger
 * /api/contributor/published/{slug}:
 *   get:
 *     summary: Get published article by URL slug
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Article detail }
 */
router.get('/published/:slug', asyncHandler(creatorController.getPublishedBlogBySlug));

module.exports = router;