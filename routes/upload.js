const express = require('express');
const router = express.Router();
const { upload } = require('../middleware/upload');
const { protect } = require('../middleware/authMiddleware');
const { handleDirectUpload } = require('../controllers/uploadController');

/**
 * @swagger
 * tags:
 *   name: Uploads
 *   description: Media and Cloudinary file upload endpoints
 */

/**
 * @swagger
 * /api/upload/image:
 *   post:
 *     summary: Upload an image file directly
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image file to upload (JPEG, PNG, WebP)
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: Cloudinary image CDN URL
 *                 public_id:
 *                   type: string
 *                   description: Cloudinary image public asset ID
 *       400:
 *         description: No file uploaded or invalid file format
 *       401:
 *         description: Unauthorized - Bearer token missing or invalid
 */
router.post('/image', protect, upload.single('image'), handleDirectUpload);

module.exports = router;