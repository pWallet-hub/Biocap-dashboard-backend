const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const officerBlogController = require('../controllers/officerBlogController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');

router.use(protect);
router.use(authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN));

const blogUploadFields = upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

/**
 * @swagger
 * tags:
 *   name: Communication Officer
 *   description: Blog review/moderation, publishing, user oversight, and blog management
 */

// ─── Officer Dashboard ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/officer/dashboard:
 *   get:
 *     summary: Officer dashboard — pending blog reviews, user review queue, blog stats
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get('/dashboard', asyncHandler(officerBlogController.getDashboard));

// ─── Blog Management (all blogs visible) ──────────────────────────────────────

/**
 * @swagger
 * /api/officer/blogs:
 *   get:
 *     summary: List all blogs across all statuses with filters
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, pending_review, approved, published] }
 *       - in: query
 *         name: author
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/blogs', asyncHandler(officerBlogController.listBlogs));

/**
 * @swagger
 * /api/officer/blogs/stats:
 *   get:
 *     summary: Blog counts by status (platform-wide)
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get('/blogs/stats', asyncHandler(officerBlogController.getBlogStats));

/**
 * @swagger
 * /api/officer/blogs/review-queue:
 *   get:
 *     summary: Pending review queue ordered oldest-first (FIFO)
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/blogs/review-queue', asyncHandler(officerBlogController.getReviewQueue));

/**
 * @swagger
 * /api/officer/blogs/{id}:
 *   get:
 *     summary: Full detail of any blog
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get('/blogs/:id', asyncHandler(officerBlogController.getBlogById));

/**
 * @swagger
 * /api/officer/blogs:
 *   post:
 *     summary: Create a new blog post as the officer (starts as draft)
 *     tags: [Communication Officer]
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
 *               blocks: { type: string, description: "JSON-stringified blocks array" }
 *               modal: { type: string, description: "JSON-stringified modal metadata object" }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 */
router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}:
 *   put:
 *     summary: Edit a blog (officer can edit any non-published blog)
 *     tags: [Communication Officer]
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
 *               blocks: { type: string, description: "JSON-stringified blocks array" }
 *               modal: { type: string }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 */
router.put('/blogs/:id', blogUploadFields, parseBlogBody, asyncHandler(blogController.updateBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}:
 *   delete:
 *     summary: Soft-delete a blog (officer cannot delete published blogs)
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.delete('/blogs/:id', asyncHandler(blogController.deleteBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}/submit:
 *   patch:
 *     summary: Submit the officer's own draft blog for review
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}/review:
 *   patch:
 *     summary: Approve or reject a pending blog — notifies author by email
 *     tags: [Communication Officer]
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
 */
router.patch('/blogs/:id/review', asyncHandler(blogController.reviewBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}/publish:
 *   patch:
 *     summary: Publish an approved blog post to the live site
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch('/blogs/:id/publish', asyncHandler(blogController.publishBlog));

/**
 * @swagger
 * /api/officer/blogs/{id}/unpublish:
 *   patch:
 *     summary: Remove a published blog from the live website
 *     tags: [Communication Officer]
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
 *               note: { type: string, description: "Reason for unpublishing" }
 */
router.patch('/blogs/:id/unpublish', asyncHandler(blogController.unpublishBlog));

// ─── Trash & Permanent Wipe Operations ────────────────────────────────────────

/**
 * @swagger
 * /api/officer/trash:
 *   get:
 *     summary: List soft-deleted blogs for officer trash bin
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get('/trash', asyncHandler(blogController.getDeletedBlogs));

/**
 * @swagger
 * /api/officer/trash/{id}/restore:
 *   patch:
 *     summary: Restore a soft-deleted blog back to queue
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch('/trash/:id/restore', asyncHandler(blogController.restoreBlog));

/**
 * @swagger
 * /api/officer/trash/{id}/permanent:
 *   delete:
 *     summary: Permanently delete blog and remove Cloudinary media
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.delete('/trash/:id/permanent', asyncHandler(blogController.permanentDeleteBlog));

// ─── User Review (external contributors only) ─────────────────────────────────

/**
 * @swagger
 * /api/officer/users:
 *   get:
 *     summary: List external contributor accounts for review
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: profileReviewStatus
 *         schema: { type: string, enum: [pending, verified, needs_attention] }
 */
router.get('/users', asyncHandler(userController.listUsers));

/**
 * @swagger
 * /api/officer/users/review-queue:
 *   get:
 *     summary: Users awaiting profile review
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users/review-queue', asyncHandler(userController.getUserReviewQueue));

/**
 * @swagger
 * /api/officer/users/{id}:
 *   get:
 *     summary: View a contributor profile with full blog activity
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get('/users/:id', asyncHandler(userController.getUserById));

/**
 * @swagger
 * /api/officer/users/{id}/review:
 *   patch:
 *     summary: Review a contributor profile (verify, flag, or add note)
 *     tags: [Communication Officer]
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
 *                 enum: [verified, needs_attention, noted]
 *               note:
 *                 type: string
 *                 description: Required when decision is needs_attention
 */
router.patch('/users/:id/review', asyncHandler(userController.reviewUser));

module.exports = router;