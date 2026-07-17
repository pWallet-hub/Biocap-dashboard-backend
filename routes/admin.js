const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const adminController = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');

router.use(protect);
router.use(adminOnly);

/**
 * @swagger
 * tags:
 *   name: Admin Management
 *   description: Full user lifecycle management and platform oversight (admin only)
 */

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Platform overview — user stats, blog stats, pending queues, recent logins
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users: { type: object }
 *                 blogs: { type: object }
 *                 pendingUserReviews: { type: integer }
 *                 pendingBlogReviews: { type: integer }
 *                 readyToPublish: { type: integer }
 *                 recentActivity: { type: object }
 */
router.get('/dashboard', asyncHandler(adminController.getDashboardStats));

// ─── User Management ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users with pagination, role, status, and search filters
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [admin, communication_officer, broadcast_media, social_media_influencer] }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: profileReviewStatus
 *         schema: { type: string, enum: [pending, verified, needs_attention] }
 *       - in: query
 *         name: search
 *         schema: { type: string, description: "Search username, email, firstName, lastName" }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/users', asyncHandler(userController.listUsers));

/**
 * @swagger
 * /api/admin/users/review-queue:
 *   get:
 *     summary: External contributors awaiting profile verification
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 */
router.get('/users/review-queue', asyncHandler(userController.getUserReviewQueue));

/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get a single user's profile with blog activity and stats
 *     tags: [Admin Management]
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
 * /api/admin/users/{id}:
 *   put:
 *     summary: Update a user's profile fields
 *     tags: [Admin Management]
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
 *               username: { type: string }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               organization: { type: string }
 *               organizationLink: { type: string }
 *               socialHandle: { type: string }
 *               role: { type: string, enum: [admin, communication_officer, broadcast_media, social_media_influencer] }
 */
router.put('/users/:id', asyncHandler(adminController.updateUser));

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   patch:
 *     summary: Change a user's role
 *     tags: [Admin Management]
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
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, broadcast_media, social_media_influencer]
 *               organizationLink:
 *                 type: string
 *                 description: Required when assigning broadcast_media role
 */
router.patch('/users/:id/role', asyncHandler(adminController.changeUserRole));

/**
 * @swagger
 * /api/admin/users/{id}/review:
 *   patch:
 *     summary: Review a user's profile (verify, flag for attention, or add a note)
 *     tags: [Admin Management]
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

/**
 * @swagger
 * /api/admin/users/{id}/reset-password:
 *   post:
 *     summary: Generate a new temporary password and email it to the user; invalidates all sessions
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.post('/users/:id/reset-password', asyncHandler(adminController.resetUserPassword));

/**
 * @swagger
 * /api/admin/users/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a user account (blocks login without deleting)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch('/users/:id/deactivate', asyncHandler(adminController.deactivateUser));

/**
 * @swagger
 * /api/admin/users/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a previously deactivated user
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.patch('/users/:id/reactivate', asyncHandler(adminController.reactivateUser));

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Permanently delete a user (blocked if they have published blogs)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.delete('/users/:id', asyncHandler(adminController.deleteUser));

// ─── Audit Logs ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/audit-logs:
 *   get:
 *     summary: Full paginated audit trail of all system actions
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema: { type: string, description: "Filter by action enum (e.g. blog.publish)" }
 *       - in: query
 *         name: actor
 *         schema: { type: string, description: "Filter by actor user ID" }
 *       - in: query
 *         name: targetModel
 *         schema: { type: string, enum: [Blog, User] }
 *       - in: query
 *         name: targetId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date, description: "Start of date range" }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date, description: "End of date range" }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 */
router.get('/audit-logs', asyncHandler(adminController.getAuditLogs));

/**
 * @swagger
 * /api/admin/audit-logs/blog/{id}:
 *   get:
 *     summary: Full change history for a specific blog
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get('/audit-logs/blog/:id', asyncHandler(adminController.getBlogAuditTrail));

/**
 * @swagger
 * /api/admin/audit-logs/user/{id}:
 *   get:
 *     summary: Full change history for a specific user (both as target and as actor)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.get('/audit-logs/user/:id', asyncHandler(adminController.getUserAuditTrail));

module.exports = router;
