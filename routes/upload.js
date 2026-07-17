const express = require('express');
const router = express.Router();
const { upload } = require('../middleware/upload');
const { protect } = require('../middleware/authMiddleware');
const { handleDirectUpload } = require('../controllers/uploadController');

router.post('/image', protect, upload.single('image'), handleDirectUpload);

module.exports = router;
