const express = require('express');
const router = express.Router();

const blogController = require('../controllers/blogController');
const { protect, authorize, adminOnly, publisherOnly } = require('../middleware/authMiddleware');
const { uploadBlogFiles } = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const asyncHandler = require('../utils/asyncHandler');

const { REVIEWERS, CREATORS } = blogController;

/**
 * @swagger
 * tags:
 *   name: Blogs
 *   description: Blog creation, review, and publishing workflow
 */

// ─── Public routes (no auth required) ─────────────────────────────────────────

/**
 * @swagger
 * /api/blogs/public:
 *   get:
 *     summary: Get all published blogs (public website feed)
 *     tags: [Blogs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "Full-text search across title, tag, excerpt" }
 *     responses:
 *       200: { description: Paginated list of published blogs }
 */
router.get('/public', asyncHandler(blogController.getPublicBlogs));

/**
 * @swagger
 * /api/blogs/public/{slug}:
 *   get:
 *     summary: Get a single published blog by URL slug (increments view counter)
 *     tags: [Blogs]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog post }
 *       404: { description: Blog not found }
 */
router.get('/public/:slug', asyncHandler(blogController.getPublicBlogBySlug));

/**
 * @swagger
 * /api/blogs/public/{slug}/comments:
 *   post:
 *     summary: Add a public comment or reply to a published blog
 *     tags: [Blogs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, content]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               content: { type: string }
 *               parentComment: { type: string, description: 'Optional parent comment id for replying' }
 *     responses:
 *       201: { description: Comment posted }
 */
router.post('/public/:slug/comments', asyncHandler(blogController.addPublicComment));

router.get('/public/:slug/comments', asyncHandler(blogController.getPublicBlogBySlug));

router.patch('/:id/comments/:commentId/hide', protect, authorize(...REVIEWERS), asyncHandler(blogController.hideComment));
router.delete('/:id/comments/:commentId', protect, authorize(...REVIEWERS), asyncHandler(blogController.deleteComment));
router.patch('/:id/consent', protect, asyncHandler(blogController.respondToEditorConsent));

// ─── Authenticated list / stats ────────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs:
 *   get:
 *     summary: Get blogs scoped to the requester's role (reviewers see all; others see own only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, pending_review, approved, published] }
 *       - in: query
 *         name: author
 *         schema: { type: string, description: "Filter by author ID (reviewer only)" }
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
 *       200: { description: Paginated blogs }
 */
router.get('/', protect, asyncHandler(blogController.getBlogs));

/**
 * @swagger
 * /api/blogs/stats:
 *   get:
 *     summary: Blog counts by status (scoped to role)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Counts for draft, pending_review, approved, published, deleted, total
 */
router.get('/stats', protect, asyncHandler(blogController.getBlogStats));

/**
 * @swagger
 * /api/blogs/trash:
 *   get:
 *     summary: List soft-deleted blogs (admin only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Paginated list of deleted blogs }
 *       403: { description: Admin only }
 */
router.get('/trash', protect, adminOnly, asyncHandler(blogController.getDeletedBlogs));

/**
 * @swagger
 * /api/blogs/my-submissions:
 *   get:
 *     summary: Track status of the requester's own blog submissions
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 */
router.get('/my-submissions', protect, authorize(...CREATORS), asyncHandler(blogController.getMySubmissions));

/**
 * @swagger
 * /api/blogs/{id}:
 *   get:
 *     summary: Get a single blog (owner or reviewer only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog detail }
 *       403: { description: Not allowed to view this blog }
 *       404: { description: Blog not found }
 */
router.get('/:id', protect, asyncHandler(blogController.getBlogById));

// ─── Create ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs:
 *   post:
 *     summary: Create a blog post (always starts as draft). Supports cover image, inline section images, and optional PDF upload.
 *     tags: [Blogs]
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
 *               blocks: { type: string, description: "JSON-stringified array of section blocks" }
 *               socialHandle: { type: string, description: "Required for social_media_influencer" }
 *               organizationLink: { type: string, description: "Required for broadcast_media" }
 *               img: { type: string, format: binary, description: "Cover image (required)" }
 *               images: 
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: "Array of inline section images"
 *               document: { type: string, format: binary, description: "Optional supporting PDF" }
 *     responses:
 *       201: { description: Blog created as draft }
 *       400: { description: Missing image or invalid data }
 */
router.post('/', protect, authorize(...CREATORS), uploadBlogFiles, parseBlogBody, asyncHandler(blogController.createBlog));

// ─── Update ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs/{id}:
 *   put:
 *     summary: Update a blog. Permission depends on role and blog status.
 *     tags: [Blogs]
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
 *               blocks: { type: string, description: "JSON-stringified section blocks" }
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
 *       403: { description: Not permitted in current status }
 */
router.put('/:id', protect, uploadBlogFiles, parseBlogBody, asyncHandler(blogController.updateBlog));

// ─── Delete (soft) ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs/{id}:
 *   delete:
 *     summary: Soft-delete a blog (admin can delete published; others only their own draft)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog moved to trash }
 *       403: { description: Not permitted }
 */
router.delete('/:id', protect, asyncHandler(blogController.deleteBlog));

// ─── Admin-only trash management ──────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs/{id}/restore:
 *   patch:
 *     summary: Restore a soft-deleted blog (admin only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog restored }
 *       404: { description: Blog not in trash }
 */
router.patch('/:id/restore', protect, adminOnly, asyncHandler(blogController.restoreBlog));

/**
 * @swagger
 * /api/blogs/{id}/hard-delete:
 *   delete:
 *     summary: Permanently delete a blog and its assets (admin only; blog must be soft-deleted first)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog permanently deleted }
 *       404: { description: Blog not found in trash }
 */
router.delete('/:id/hard-delete', protect, adminOnly, asyncHandler(blogController.hardDeleteBlog));

// ─── Workflow actions ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/blogs/{id}/submit:
 *   patch:
 *     summary: Submit (or resubmit after rejection) a draft blog for review
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog submitted for review }
 *       400: { description: Blog not in draft status }
 *       403: { description: Not your blog }
 */
router.patch('/:id/submit', protect, authorize(...CREATORS), asyncHandler(blogController.submitBlog));

/**
 * @swagger
 * /api/blogs/{id}/review:
 *   patch:
 *     summary: Approve or reject a submitted blog (admin, communication_officer, editor)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [approved, rejected]
 *               note:
 *                 type: string
 *                 description: Required when decision is rejected
 *     responses:
 *       200: { description: Review recorded; author notified by email }
 *       400: { description: Blog not in pending_review status }
 */
router.patch('/:id/review', protect, authorize(...REVIEWERS), asyncHandler(blogController.reviewBlog));

/**
 * @swagger
 * /api/blogs/{id}/publish:
 *   patch:
 *     summary: Publish an approved blog to the live website (admin, communication_officer, editor)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog published; author notified by email }
 *       400: { description: Blog not in approved status }
 *       403: { description: Admin only }
 */
router.patch('/:id/publish', protect, publisherOnly, asyncHandler(blogController.publishBlog));

/**
 * @swagger
 * /api/blogs/{id}/unpublish:
 *   patch:
 *     summary: Remove a published blog from the live website (admin/communication_officer)
 *     tags: [Blogs]
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
 *               note: { type: string, description: "Optional reason recorded in review history" }
 *     responses:
 *       200: { description: Blog unpublished, returned to approved status }
 */
router.patch('/:id/unpublish', protect, authorize(...REVIEWERS), asyncHandler(blogController.unpublishBlog));

module.exports = router;