const express = require('express');
const router = express.Router();
const officerBlogController = require('../controllers/officerBlogController');
const blogController = require('../controllers/blogController');
const { protect, authorize } = require('../middleware/authMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');
const upload = require('../middleware/upload');
const { parseBlogBody } = require('../middleware/validateBlogInput');

router.use(protect);
router.use(authorize(ROLES.EDITOR, ROLES.ADMIN));

// Editor Dashboard & Blog Queue
router.get('/blogs/stats', asyncHandler(officerBlogController.getBlogStats));
router.get('/blogs/review-queue', asyncHandler(officerBlogController.getReviewQueue));

// Blog Actions (No User Management Routes)
router.get('/blogs', asyncHandler(officerBlogController.listBlogs));
router.get('/blogs/:id', asyncHandler(officerBlogController.getBlogById));

const blogUploadFields = upload.fields([
  { name: 'img', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);

router.post('/blogs', blogUploadFields, parseBlogBody, asyncHandler(blogController.createBlog));
router.put('/blogs/:id', blogUploadFields, parseBlogBody, asyncHandler(blogController.updateBlog));
router.patch('/blogs/:id/submit', asyncHandler(blogController.submitBlog));
router.patch('/blogs/:id/review', asyncHandler(blogController.reviewBlog));
router.patch('/blogs/:id/unpublish', asyncHandler(blogController.unpublishBlog));

module.exports = router;