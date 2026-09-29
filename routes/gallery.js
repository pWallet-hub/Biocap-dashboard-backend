const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { ROLES } = require('../constants/roles');
const { uploadGalleryFiles } = require('../middleware/uploadGallery');
const {
  createGalleryItem,
  getGalleryItems,
  getGalleryItemById,
  updateGalleryItem,
  deleteGalleryItem,
} = require('../controllers/galleryController');

/**
 * @swagger
 * /api/gallery:
 *   get:
 *     summary: Fetch paginated gallery items
 *     tags: [Gallery]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, events, team, activities]
 *         description: Filter by category
 *       - in: query
 *         name: mediaType
 *         schema:
 *           type: string
 *           enum: [all, folder, video]
 *         description: Filter by media type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword across titles and captions
 *     responses:
 *       200:
 *         description: Paginated gallery list returned successfully
 */
router.get('/', getGalleryItems);

/**
 * @swagger
 * /api/gallery/{id}:
 *   get:
 *     summary: Get single gallery item by ID
 *     tags: [Gallery]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gallery item details returned
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', getGalleryItemById);

// ─── PROTECTED ROUTES (ADMIN & EDITOR ONLY) ─────────────────────────────────
router.use(protect, authorize(ROLES.ADMIN, ROLES.EDITOR));

/**
 * @swagger
 * /api/gallery:
 *   post:
 *     summary: Create new folder collection or video entry
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - mediaType
 *               - title
 *               - category
 *               - caption
 *             properties:
 *               mediaType:
 *                 type: string
 *                 enum: [folder, video]
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [events, team, activities]
 *               caption:
 *                 type: string
 *               video:
 *                 type: string
 *                 format: binary
 *                 description: MP4/MOV video file (Required if mediaType is video)
 *               thumbnail:
 *                 type: string
 *                 format: binary
 *                 description: Thumbnail image file (Required if mediaType is video)
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Multiple image files (Required if mediaType is folder)
 *               coverIndex:
 *                 type: integer
 *                 description: >
 *                   0-based index (into the `images` array above) of the
 *                   image the uploader chose as the collection cover.
 *                   Required for mediaType=folder.
 *               imageCaptions:
 *                 type: string
 *                 description: >
 *                   JSON-stringified array of OPTIONAL per-image captions,
 *                   same order/length as `images`
 *                   (e.g. '["","Rubona field visit",""]').
 *               imageReferenceIds:
 *                 type: string
 *                 description: >
 *                   JSON-stringified array of client-generated per-image
 *                   reference ids, same order/length as `images`
 *                   (e.g. '["k3f9a1p2","a8x1n0qz"]'). Used to build the
 *                   BioCap-<caption>-<referenceId> download filename and
 *                   to later address one specific image (e.g. changing
 *                   the cover). If omitted, the server generates its own.
 *     responses:
 *       201:
 *         description: Gallery item created successfully
 *       400:
 *         description: Missing mandatory fields or invalid media format
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post('/', uploadGalleryFiles, createGalleryItem);

/**
 * @swagger
 * /api/gallery/{id}:
 *   put:
 *     summary: Update metadata or append media to existing gallery item
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [events, team, activities]
 *               caption:
 *                 type: string
 *               video:
 *                 type: string
 *                 format: binary
 *               thumbnail:
 *                 type: string
 *                 format: binary
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: New images to append to an existing folder collection
 *               imageCaptions:
 *                 type: string
 *                 description: >
 *                   JSON-stringified array of OPTIONAL captions for the
 *                   newly appended `images`, same order/length as `images`.
 *               imageReferenceIds:
 *                 type: string
 *                 description: >
 *                   JSON-stringified array of reference ids for the newly
 *                   appended `images`, same order/length as `images`.
 *               coverReferenceId:
 *                 type: string
 *                 description: >
 *                   referenceId of an existing (or newly appended) image
 *                   to mark as the collection's new cover.
 *     responses:
 *       200:
 *         description: Gallery item updated successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put('/:id', uploadGalleryFiles, updateGalleryItem);

/**
 * @swagger
 * /api/gallery/{id}:
 *   delete:
 *     summary: Delete gallery entry and purge Cloudinary storage assets
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gallery item and Cloudinary assets deleted successfully
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/:id', deleteGalleryItem);

module.exports = router;