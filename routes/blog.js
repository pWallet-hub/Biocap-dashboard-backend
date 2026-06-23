const express = require('express');
const router = express.Router();
const Blog = require('../models/Blog');
const { protect } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/blogs:
 *   get:
 *     summary: Fetch all blog posts sorted by most recent
 *     tags: [Blogs]
 *     responses:
 *       200:
 *         description: List of blogs retrieved successfully
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 }).populate('author', 'username email role');
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/blogs:
 *   post:
 *     summary: Create a new blog post (matches the ProjectModal frontend shape)
 *     tags: [Blogs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - img
 *               - tag
 *               - modal
 *             properties:
 *               title:
 *                 type: string
 *               img:
 *                 type: string
 *               tag:
 *                 type: string
 *               modal:
 *                 type: object
 *                 required:
 *                   - intro
 *                 properties:
 *                   date:
 *                     type: string
 *                   organizer:
 *                     type: string
 *                   partners:
 *                     type: string
 *                   intro:
 *                     type: string
 *                   objectives:
 *                     type: array
 *                     items:
 *                       type: string
 *                   sessions:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         role:
 *                           type: string
 *                         name:
 *                           type: string
 *                         summary:
 *                           type: string
 *                   collaboration:
 *                     type: array
 *                     items:
 *                       type: string
 *                   quote:
 *                     type: string
 *                   quoteSource:
 *                     type: string
 *     responses:
 *       201:
 *         description: Blog created successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/', protect, async (req, res) => {
  try {
    const { title, img, tag, modal } = req.body;

    const newBlog = await Blog.create({
      title,
      img,
      tag,
      modal,
      author: req.user.id,
    });

    res.status(201).json(newBlog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;