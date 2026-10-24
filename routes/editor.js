const express = require('express');
const router = express.Router();
const officerBlogController = require('../controllers/officerBlogController');
const blogController = require('../controllers/blogController');
const editorBlogController = require('../controllers/editorBlogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');
const uploadModule = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');

router.use(protect);
router.use(authorize(ROLES.EDITOR, ROLES.ADMIN));

// Safely extract upload instance or pre-configured uploadBlogFiles
const rawUpload = uploadModule.upload || uploadModule;

// Configure fields including 'images' for inline section photos
const blogUploadFields = uploadModule.uploadBlogFiles || rawUpload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'images', maxCount: 20 },
  { name: 'document', maxCount: 1 },
]);

/**
 * @swagger
 * tags:
 *   name: Communication Editor
 *   description: Editorial review queue, draft modifications, review decisions, and editorial oversight
 */

// ─── Editorial Dashboard & Queue ──────────────────────────────────────────────

/**
 * @swagger
 * /api/editor/blogs/stats:
 *   get:
 *     summary: Get blog counts across all statuses
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Editorial blog statistics summary
 */
router.get('/blogs/stats', asyncHandler(officerBlogController.getBlogStats));

/**
 * @swagger
 * /api/editor/blogs/review-queue:
 *   get:
 *     summary: Get articles pending review ordered oldest-first (FIFO)
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Paginated queue of pending reviews
 */
router.get('/blogs/review-queue', asyncHandler(officerBlogController.getReviewQueue));

// ─── Blog Management & Review Operations ───────────────────────────────────────

/**
 * @swagger
 * /api/editor/blogs:
 *   get:
 *     summary: List all blogs with status, author, or search filtering
 *     tags: [Communication Editor]
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
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: List of articles
 */
router.get('/blogs', asyncHandler(officerBlogController.listBlogs));

/**
 * @swagger
 * /api/editor/blogs/{id}:
 *   get:
 *     summary: Get full detail of an article by ID
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Full article document
 *       404:
 *         description: Article not found
 */
router.get('/blogs/:id', asyncHandler(officerBlogController.getBlogById));

/**
 * @swagger
 * /api/editor/blogs:
 *   post:
 *     summary: Create a new blog post as an Editor
 *     tags: [Communication Editor]
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
 *               modal: { type: string, description: "JSON stringified modal object" }
 *               img: { type: string, format: binary }
 *               images: 
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: "Inline section images"
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Article created successfully
 */
router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));

/**
 * @swagger
 * /api/editor/blogs/{id}:
 *   put:
 *     summary: Edit an article (Saves proposed changes & alerts Communication Officers to accept)
 *     tags: [Communication Editor]
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
 *               blocks: { type: string, description: "JSON stringified blocks array" }
 *               img: { type: string, format: binary }
 *               images: 
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: "Inline section images"
 *               document: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Proposal saved. The live story is unchanged until the writer accepts it. The writer is emailed.
 *       400:
 *         description: Invalid blocks JSON, or no changes to propose
 *       404:
 *         description: Article not found
 *       409:
 *         description: A proposal is already awaiting the writer's decision
 */

/**
 * @swagger
 * /api/editor/blogs/{id}/revisions:
 *   get:
 *     summary: Version history of editor proposals
 *     description: |
 *       Lists every editor proposal with its decision, plus `changesSinceLastProposal`, which compares the
 *       current submitted story with the last proposed version. Use it to review a writer's resubmission.
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Proposal history and diffs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string }
 *                 publishConsentStatus: { type: string, enum: [not_required, pending, approved, rejected] }
 *                 current: { type: object, description: "The story's current content snapshot" }
 *                 changesSinceLastProposal: { type: array, items: { type: object } }
 *                 proposals:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       version: { type: integer }
 *                       status: { type: string, enum: [pending, accepted, rejected] }
 *                       editor: { type: object }
 *                       proposedAt: { type: string, format: date-time }
 *                       decidedAt: { type: string, format: date-time }
 *                       decisionNote: { type: string }
 *                       changes: { type: array, items: { type: object } }
 *       404:
 *         description: Article not found
 */
/**
 * @swagger
 * /api/editor/blogs/{id}/proposal:
 *   delete:
 *     summary: Withdraw the pending editor proposal
 *     description: The editor who proposed the changes (or an admin) withdraws them before the writer decides. The writer is emailed.
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Proposal withdrawn
 *       403:
 *         description: The caller did not propose these changes
 *       404:
 *         description: Article not found
 *       409:
 *         description: No pending proposal, or it changed while withdrawing
 */
router.delete('/blogs/:id/proposal', asyncHandler(editorBlogController.withdrawEditorProposal));

router.get('/blogs/:id/revisions', asyncHandler(editorBlogController.getEditorRevisions));

/**
 * @swagger
 * /api/editor/blogs/{id}/submit:
 *   patch:
 *     summary: Submit an editor draft for formal review
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Article submitted to review queue
 */
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));

/**
 * @swagger
 * /api/editor/blogs/{id}/review:
 *   patch:
 *     summary: Approve or reject a submitted draft with feedback notes
 *     tags: [Communication Editor]
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
 *                 description: Required when decision is 'rejected'
 *     responses:
 *       200:
 *         description: Article review decision recorded and author notified
 */
router.patch('/blogs/:id/review', asyncHandler(blogController.reviewBlog));

/**
 * @swagger
 * /api/editor/blogs/{id}/publish:
 *   patch:
 *     summary: Publish an approved blog to the live website (editor or admin)
 *     tags: [Communication Editor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Blog published successfully }
 *       400: { description: Blog not in approved status }
 *       403: { description: Forbidden }
 */
router.patch('/blogs/:id/publish', asyncHandler(blogController.publishBlog));

/**
 * @swagger
 * /api/editor/blogs/{id}/unpublish:
 *   patch:
 *     summary: Return a published article back to approved status for revision
 *     tags: [Communication Editor]
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
 *     responses:
 *       200:
 *         description: Article unpublished successfully
 */
router.patch('/blogs/:id/unpublish', asyncHandler(blogController.unpublishBlog));

// Editor proposals. server.js mounts this ahead of the shared blog alias at /api/editor/blogs,
// otherwise PUT /api/editor/blogs/:id reaches the live-update handler and bypasses the proposal workflow.
const proposalRouter = express.Router();
proposalRouter.put(
  '/:id',
  protect,
  authorize(ROLES.EDITOR, ROLES.ADMIN),
  blogUploadFields,
  parseBlogBody,
  asyncHandler(editorBlogController.updateBlogByEditor)
);

module.exports = router;
module.exports.proposalRouter = proposalRouter;