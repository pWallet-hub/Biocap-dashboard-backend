const express = require('express');
const router = express.Router();
const creatorController = require('../controllers/creatorController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const asyncHandler = require('../utils/asyncHandler');
const { EXTERNAL_CREATORS } = require('../constants/roles');

router.use(protect);
router.use(authorize(...EXTERNAL_CREATORS));

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
 *     summary: Get creator profile and blog statistics
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Creator profile details and blog status count
 */
router.get('/profile', asyncHandler(creatorController.getMyProfile));

/**
 * @swagger
 * /api/contributor/activity:
 *   get:
 *     summary: Get creator recent activity (timeline, total views, audit trail)
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account timeline and metrics
 */
router.get('/activity', asyncHandler(creatorController.getMyActivity));

// ─── My Blogs Management ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/contributor/my-blogs:
 *   get:
 *     summary: Get creator's own blogs with status filter and search
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, pending_review, approved, published] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of own blogs
 */
router.get('/my-blogs', asyncHandler(creatorController.getMyBlogs));

/**
 * @swagger
 * /api/contributor/my-blogs/{id}:
 *   get:
 *     summary: Get detail of creator's own blog
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Blog detail
 */
router.get('/my-blogs/:id', asyncHandler(creatorController.getMyBlogById));

/**
 * @swagger
 * /api/contributor/blogs:
 *   post:
 *     summary: Create a new blog draft with blocks and cover image
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
 *               blocks: { type: string, description: "JSON stringified blocks array" }
 *               modal: { type: string }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Blog draft created
 */
router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}:
 *   put:
 *     summary: Update an existing draft blog
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
 *       200:
 *         description: Blog draft updated
 */
router.put('/blogs/:id', blogUploadFields, parseBlogBody, asyncHandler(blogController.updateBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}/submit:
 *   patch:
 *     summary: Submit a draft blog post for staff review
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Blog submitted for review
 */
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));

/**
 * @swagger
 * /api/contributor/blogs/{id}:
 *   delete:
 *     summary: Delete a draft blog post
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Blog post deleted
 */
router.delete('/blogs/:id', asyncHandler(blogController.deleteBlog));

// ─── Published Feed (Read-Only) ──────────────────────────────────────────────

/**
 * @swagger
 * /api/contributor/published:
 *   get:
 *     summary: View published blog feed (read-only for inspiration)
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Published blogs feed
 */
router.get('/published', asyncHandler(creatorController.getPublishedFeed));

/**
 * @swagger
 * /api/contributor/published/{slug}:
 *   get:
 *     summary: View a single published blog by slug
 *     tags: [Content Creator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Published blog detail
 */
router.get('/published/:slug', asyncHandler(creatorController.getPublishedBlogBySlug));

module.exports = router;