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
 *     summary: Platform overview with statistics, recent logins, and recent audited actions
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard summary. recentActivity.actions contains the ten most recent audit entries.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminDashboardResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
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
 *     summary: Search the paginated system audit trail (admin only)
 *     description: >
 *       Returns successful action records newest first. Events include account creation, profile and role changes,
 *       account status changes, profile reviews, authentication/password events, blog lifecycle and editorial
 *       workflow, comment moderation, and gallery lifecycle actions. Failed requests are not represented as
 *       successful business actions. Credential request fields and raw request bodies are excluded; selected
 *       workflow actions may include business notes in detail. Historical events from before audit coverage was
 *       added cannot be reconstructed.
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         description: Exact namespaced action filter.
 *         schema:
 *           type: string
 *           example: user.create
 *       - in: query
 *         name: actor
 *         description: MongoDB ID of the user who performed the action.
 *         schema: { type: string, example: 66a12345bc67890123456789 }
 *       - in: query
 *         name: actorRole
 *         description: Role captured at the time of the action.
 *         schema:
 *           type: string
 *           enum: [admin, communication_officer, editor, social_media_content_creator, media_correspondent, principal_investigator, system, anonymous]
 *       - in: query
 *         name: targetModel
 *         description: Type of entity affected.
 *         schema: { type: string, enum: [Blog, User, Gallery] }
 *       - in: query
 *         name: targetId
 *         description: MongoDB ID of the affected entity.
 *         schema: { type: string, example: 66b98765dc43210987654321 }
 *       - in: query
 *         name: from
 *         description: Include events at or after this ISO-8601 timestamp.
 *         schema: { type: string, format: date-time, example: '2026-11-01T00:00:00.000Z' }
 *       - in: query
 *         name: to
 *         description: Include events at or before this ISO-8601 timestamp.
 *         schema: { type: string, format: date-time, example: '2026-11-17T23:59:59.999Z' }
 *       - in: query
 *         name: page
 *         description: 1-based page number. Defaults to 1.
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         description: Results per page; defaults to 20 and is capped at 100.
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Audit events with populated actor profiles and pagination metadata.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLogListResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/audit-logs', adminOnly, asyncHandler(adminController.getAuditLogs));

/**
 * @swagger
 * /api/admin/audit-logs/blog/{id}:
 *   get:
 *     summary: Retrieve the full action history for a blog
 *     description: >
 *       Returns all recorded actions targeting this blog, newest first, in the { count, logs } response shape.
 *       This endpoint is not paginated; use GET /api/admin/audit-logs with targetModel=Blog and targetId for
 *       pagination and filtering. Records include actor snapshot, action, optional details, and request metadata.
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
 *         description: Blog audit history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BlogAuditTrailResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/audit-logs/blog/:id', adminOnly, asyncHandler(adminController.getBlogAuditTrail));

/**
 * @swagger
 * /api/admin/audit-logs/gallery/{id}:
 *   get:
 *     summary: Retrieve paginated action history for a gallery item
 *     description: Returns recorded creation, update, publish, unpublish, and delete events targeting this gallery item, newest first.
 *     tags: [Admin Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         description: 1-based page number. Defaults to 1.
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         description: Results per page; defaults to 20 and is capped at 100.
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated gallery audit history.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLogListResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/audit-logs/gallery/:id', adminOnly, asyncHandler(adminController.getGalleryAuditTrail));

/**
 * @swagger
 * /api/admin/audit-logs/user/{id}:
 *   get:
 *     summary: Retrieve actions affecting a user and actions performed by them
 *     description: >
 *       actionsOnThisUser contains recorded events targeting this account. actionsPerformedByThisUser contains
 *       recorded events performed by the account. Actor names and roles are included where available. Records
 *       remain available after the user is deleted because the audit event stores an actor label snapshot.
 *       Response arrays are not paginated; use the global audit endpoint with actor or targetId for pagination.
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
 *         description: User history grouped by target and actor.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserAuditTrailResponse'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.get('/audit-logs/user/:id', adminOnly, asyncHandler(adminController.getUserAuditTrail));

module.exports = router;