const express = require('express');
const router = express.Router();
const { getUploadSignature } = require('../controllers/signatureController');
const { protect } = require('../middleware/authMiddleware');

// Route to get signature
router.get('/', protect, getUploadSignature);

module.exports = router;