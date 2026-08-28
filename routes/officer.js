const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const officerBlogController = require('../controllers/officerBlogController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');

// Enforce authentication globally across all officer route modules
router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Communication Officer
 *   description: Published article viewing, officer commenting system, editor edit review & approvals, and notifications
 */

// ─── Officer Dashboard & Stats ────────────────────────────────────────────────

/**
 * @swagger
 * /api/officer/dashboard:
 *   get:
 *     summary: Officer dashboard metrics & pending notification alerts
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/dashboard',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(officerBlogController.getDashboard)
);

/**
 * @swagger
 * /api/officer/blogs/stats:
 *   get:
 *     summary: Platform-wide blog counts and published statistics
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/blogs/stats',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(officerBlogController.getBlogStats)
);

// ─── Published Articles & Officer Commenting System ───────────────────────────

/**
 * @swagger
 * /api/officer/published:
 *   get:
 *     summary: List all published articles available for reading and commenting
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 */
router.get(
  '/published',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR, ROLES.BROADCAST_CONTENT_CREATOR),
  asyncHandler(officerBlogController.listPublishedBlogs)
);

/**
 * @swagger
 * /api/officer/published/{id}:
 *   get:
 *     summary: Fetch single published article detail
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get(
  '/published/:id',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR, ROLES.BROADCAST_CONTENT_CREATOR),
  asyncHandler(officerBlogController.getPublishedBlogById)
);

/**
 * 🟢 SOLVES 403 FORBIDDEN ERROR: Allows Editors, Officers, Admins, and Creators to read internal review notes
 */
/**
 * @swagger
 * /api/officer/published/{id}/comments:
 *   get:
 *     summary: Get all comments for a specific published article
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get(
  '/published/:id/comments',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR, ROLES.BROADCAST_CONTENT_CREATOR),
  asyncHandler(officerBlogController.getArticleComments)
);

/**
 * 🟢 SOLVES 403 FORBIDDEN ERROR: Allows Editors, Officers, Admins, and Creators to post revision notes
 */
/**
 * @swagger
 * /api/officer/published/{id}/comments:
 *   post:
 *     summary: Add a comment to a published article (Triggers notification to team)
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
 *             required: [content]
 *             properties:
 *               content: { type: string, description: "Officer comment text" }
 */
router.post(
  '/published/:id/comments',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR, ROLES.BROADCAST_CONTENT_CREATOR),
  asyncHandler(officerBlogController.addArticleComment)
);

// ─── Editor Changes Approval Workflow ──────────────────────────────────────────

/**
 * @swagger
 * /api/officer/blogs/{id}/editor-changes:
 *   get:
 *     summary: Review modifications made by the Editor on an article
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get(
  '/blogs/:id/editor-changes',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR),
  asyncHandler(officerBlogController.getEditorChanges)
);

/**
 * @swagger
 * /api/officer/blogs/{id}/accept-editor-changes:
 *   patch:
 *     summary: Accept and finalize changes submitted by the Editor for an article
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
 *               approvalNote: { type: string, description: "Optional note upon accepting changes" }
 */
router.patch(
  '/blogs/:id/accept-editor-changes',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(officerBlogController.acceptEditorChanges)
);

// ─── Notifications & Alerts ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/officer/notifications:
 *   get:
 *     summary: Fetch officer notifications (e.g., new article comments & editor update prompts)
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/notifications',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR),
  asyncHandler(officerBlogController.getOfficerNotifications)
);

/**
 * @swagger
 * /api/officer/notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification alert as read
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch(
  '/notifications/:id/read',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN, ROLES.EDITOR),
  asyncHandler(officerBlogController.markNotificationRead)
);

// ─── User Review (External Contributors Oversight) ───────────────────────────

/**
 * @swagger
 * /api/officer/users:
 *   get:
 *     summary: List external contributor profiles for oversight
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/users',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(userController.listUsers)
);

/**
 * @swagger
 * /api/officer/users/review-queue:
 *   get:
 *     summary: View external contributors awaiting profile verification
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/users/review-queue',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(userController.getUserReviewQueue)
);

/**
 * @swagger
 * /api/officer/users/{id}:
 *   get:
 *     summary: View external contributor profile detail
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get(
  '/users/:id',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(userController.getUserById)
);

/**
 * @swagger
 * /api/officer/users/{id}/review:
 *   patch:
 *     summary: Review contributor profile (verify or request attention)
 *     tags: [Communication Officer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch(
  '/users/:id/review',
  authorize(ROLES.COMMUNICATION_OFFICER, ROLES.ADMIN),
  asyncHandler(userController.reviewUser)
);

module.exports = router;