const express = require('express');
const router = express.Router();
const creatorController = require('../controllers/creatorController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadBlogFiles } = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const asyncHandler = require('../utils/asyncHandler');
const { EXTERNAL_CREATORS } = require('../constants/roles');

// Enforce Authentication and Creator Role Authorization for all routes below
router.use(protect);
router.use(authorize(...EXTERNAL_CREATORS));

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
 *               socialHandle: { type: string }
 *               organizationLink: { type: string }
 *               img: { type: string, format: binary }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: "Array of inline section images"
 *               document: { type: string, format: binary }
 *     responses:
 *       201: { description: Draft created }
 */
router.post('/blogs', uploadBlogFiles, parseBlogBody, asyncHandler(blogController.createBlog));

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
 *               socialHandle: { type: string }
 *               organizationLink: { type: string }
 *               img: { type: string, format: binary }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: "Updated inline section images"
 *               document: { type: string, format: binary }
 *     responses:
 *       200: { description: Blog updated }
 */
router.put('/blogs/:id', uploadBlogFiles, parseBlogBody, asyncHandler(blogController.updateBlog));

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
 * /api/contributor/blogs/{id}/change-implemented:
 *   patch:
 *     summary: Mark a reviewer-requested change as implemented (creator only)
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
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               changeId:
 *                 type: string
 *                 description: ID of the changeRequests item to mark implemented (optional)
 *               implementationNote:
 *                 type: string
 *                 description: Optional note describing what was changed
 *     responses:
 *       200: { description: Change marked implemented and updated blog returned }
 *       400: { description: No pending change to mark or bad request }
 *       403: { description: Forbidden — only the original author may perform this action }
 *       404: { description: Blog not found }
 */
router.patch('/blogs/:id/change-implemented', asyncHandler(creatorController.markChangeImplemented));

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