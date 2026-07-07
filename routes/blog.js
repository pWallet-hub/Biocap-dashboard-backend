const express = require('express');
const router = express.Router();

const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadBlogFiles } = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');

const { REVIEWERS, CREATORS } = blogController;

/**
 * @swagger
 * tags:
 *   name: Blogs
 *   description: Blog creation, review, and publishing workflow
 */

/**
 * @swagger
 * /api/blogs/public:
 *   get:
 *     summary: Get all published blogs (public website feed)
 *     tags: [Blogs]
 *     responses:
 *       200:
 *         description: List of published blogs with live attribution
 */
router.get('/public', blogController.getPublicBlogs);

/**
 * @swagger
 * /api/blogs:
 *   get:
 *     summary: Get blogs (admin/comm officer see all, others see only their own)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of blogs scoped to the requester's role
 */
router.get('/', protect, blogController.getBlogs);

/**
 * @swagger
 * /api/blogs/my-submissions:
 *   get:
 *     summary: Track the status of the requester's own blog submissions
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 */
router.get('/my-submissions', protect, authorize(...CREATORS), blogController.getMySubmissions);

/**
 * @swagger
 * /api/blogs/{id}:
 *   get:
 *     summary: Get a single blog (owner or reviewer only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', protect, blogController.getBlogById);

/**
 * @swagger
 * /api/blogs:
 *   post:
 *     summary: Create a blog post with an uploaded image (always starts as draft)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, tag, excerpt, modal, img]
 *             properties:
 *               title: { type: string }
 *               tag: { type: string }
 *               excerpt: { type: string }
 *               socialHandle: { type: string }
 *               organizationLink: { type: string }
 *               modal: { type: string, description: "JSON-stringified modal object" }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary, description: "Optional PDF" }
 *     responses:
 *       201:
 *         description: Blog created as draft
 *       400:
 *         description: Missing image or invalid data
 *       401:
 *         description: Unauthorized
 */
router.post('/', protect, authorize(...CREATORS), uploadBlogFiles, parseBlogBody, blogController.createBlog);

/**
 * @swagger
 * /api/blogs/{id}:
 *   put:
 *     summary: Update a blog (optionally replacing the image/PDF)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               tag: { type: string }
 *               excerpt: { type: string }
 *               modal: { type: string, description: "JSON-stringified" }
 *               socialHandle: { type: string }
 *               organizationLink: { type: string }
 *               img: { type: string, format: binary }
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Blog updated
 *       403:
 *         description: Not permitted to edit this blog in its current status
 */
router.put('/:id', protect, uploadBlogFiles, parseBlogBody, blogController.updateBlog);

/**
 * @swagger
 * /api/blogs/{id}:
 *   delete:
 *     summary: Delete a blog (published blogs are admin-only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Blog deleted
 *       403:
 *         description: Not permitted to delete this blog
 */
router.delete('/:id', protect, blogController.deleteBlog);

/**
 * @swagger
 * /api/blogs/{id}/submit:
 *   patch:
 *     summary: Submit (or resubmit after rejection) a draft blog for review
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:id/submit', protect, authorize(...CREATORS), blogController.submitBlog);

/**
 * @swagger
 * /api/blogs/{id}/review:
 *   patch:
 *     summary: Approve or reject a submitted blog (admin/communication officer only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [approved, rejected] }
 *               note: { type: string, description: "Required when decision is rejected" }
 */
router.patch('/:id/review', protect, authorize(...REVIEWERS), blogController.reviewBlog);

/**
 * @swagger
 * /api/blogs/{id}/publish:
 *   patch:
 *     summary: Publish an approved blog to the live website (admin/communication officer only)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:id/publish', protect, authorize(...REVIEWERS), blogController.publishBlog);

module.exports = router;