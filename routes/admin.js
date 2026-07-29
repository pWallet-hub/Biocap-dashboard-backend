const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const adminController = require('../controllers/adminController');
const { protect, adminOnly, authorize } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { USER_MANAGERS } = require('../constants/roles');

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Admin Management
 *   description: Full user lifecycle management and platform oversight
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
 *         description: Dashboard summary data
 */
router.get('/dashboard', adminOnly, asyncHandler(adminController.getDashboardStats));

// ─── User Management ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/users:
 *   post:
 *     summary: Create a user account directly with password set (Staff creation)
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password, firstName, lastName, role]
 *             properties:
 *               username: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, editor, broadcast_content_creator, social_media_content_creator]
 *               organization: { type: string }
 *               organizationLink: { type: string }
 *               socialHandle: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *     responses:
 *       201:
 *         description: User created successfully
 */
router.post('/users', authorize(...USER_MANAGERS), asyncHandler(adminController.createUser));

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
 *         schema:
 *           type: string
 *           enum: [admin, communication_officer, editor, broadcast_content_creator, social_media_content_creator]
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: profileReviewStatus
 *         schema: { type: string, enum: [pending, verified, needs_attention] }
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
 *         description: List of users retrieved successfully
 */
router.get('/users', authorize(...USER_MANAGERS), asyncHandler(userController.listUsers));

/**
 * @swagger
 * /api/admin/users/review-queue:
 *   get:
 *     summary: External contributors awaiting profile verification
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification queue retrieved successfully
 */
router.get('/users/review-queue', authorize(...USER_MANAGERS), asyncHandler(userController.getUserReviewQueue));

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
 *     responses:
 *       200:
 *         description: User profile details
 */
router.get('/users/:id', authorize(...USER_MANAGERS), asyncHandler(userController.getUserById));

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
 *               role:
 *                 type: string
 *                 enum: [admin, communication_officer, editor, broadcast_content_creator, social_media_content_creator]
 *     responses:
 *       200:
 *         description: User updated successfully
 */
router.put('/users/:id', adminOnly, asyncHandler(adminController.updateUser));

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
 *                 enum: [admin, communication_officer, editor, broadcast_content_creator, social_media_content_creator]
 *               organizationLink: { type: string }
 *     responses:
 *       200:
 *         description: Role updated successfully
 */
router.patch('/users/:id/role', adminOnly, asyncHandler(adminController.changeUserRole));

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
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Profile review recorded
 */
router.patch('/users/:id/review', authorize(...USER_MANAGERS), asyncHandler(userController.reviewUser));

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
 *     responses:
 *       200:
 *         description: Password reset initiated
 */
router.post('/users/:id/reset-password', adminOnly, asyncHandler(adminController.resetUserPassword));

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
 *     responses:
 *       200:
 *         description: User deactivated
 */
router.patch('/users/:id/deactivate', adminOnly, asyncHandler(adminController.deactivateUser));

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
 *     responses:
 *       200:
 *         description: User reactivated
 */
router.patch('/users/:id/reactivate', adminOnly, asyncHandler(adminController.reactivateUser));

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
 *     responses:
 *       200:
 *         description: User deleted
 */
router.delete('/users/:id', adminOnly, asyncHandler(adminController.deleteUser));

// ─── Audit Logs (Admin Only) ─────────────────────────────────────────────────

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
 *         schema: { type: string }
 *       - in: query
 *         name: actor
 *         schema: { type: string }
 *       - in: query
 *         name: targetModel
 *         schema: { type: string, enum: [Blog, User] }
 *       - in: query
 *         name: targetId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Audit logs list
 */
router.get('/audit-logs', adminOnly, asyncHandler(adminController.getAuditLogs));

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
 *     responses:
 *       200:
 *         description: Blog audit logs
 */
router.get('/audit-logs/blog/:id', adminOnly, asyncHandler(adminController.getBlogAuditTrail));

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
 *     responses:
 *       200:
 *         description: User audit logs
 */
router.get('/audit-logs/user/:id', adminOnly, asyncHandler(adminController.getUserAuditTrail));

module.exports = router;