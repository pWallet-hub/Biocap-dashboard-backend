const express = require('express');
const router = express.Router();
const { getUploadSignature } = require('../controllers/signatureController');
const { protect } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Uploads
 *   description: Media and Cloudinary file upload endpoints
 */

/**
 * @swagger
 * /api/upload/signature:
 *   get:
 *     summary: Generate a Cloudinary direct upload signature
 *     description: Returns a signed timestamp and parameters allowing clients to upload assets directly to Cloudinary.
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Signature generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signature:
 *                   type: string
 *                   description: Cloudinary cryptographic SHA-1 signature
 *                 timestamp:
 *                   type: number
 *                   description: UNIX timestamp used for signature generation
 *                 apiKey:
 *                   type: string
 *                   description: Cloudinary public API key
 *                 cloudName:
 *                   type: string
 *                   description: Cloudinary account name
 *       401:
 *         description: Unauthorized - Bearer token missing or invalid
 */
router.get('/', protect, getUploadSignature);

module.exports = router;