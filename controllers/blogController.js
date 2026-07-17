const Blog = require('../models/Blog');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { REVIEWERS, CREATORS, isReviewer } = require('../constants/roles');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { generateSlug } = require('../utils/slugify');
const { writeAuditLog } = require('../utils/auditLogger');
const {
  sendBlogApprovalEmail,
  sendBlogRejectionEmail,
  sendBlogPublishedEmail,
} = require('../utils/sendEmail');

// ─── Private helpers ──────────────────────────────────────────────────────────

const destroyAsset = async (publicId, resourceType = 'image') => {
  if (!publicId) return;
  await cloudinary.uploader
    .destroy(publicId, { resource_type: resourceType })
    .catch((err) => console.error(`Failed to remove Cloudinary asset (${resourceType}):`, err.message));
};

const buildBlogFilter = (query, user) => {
  // Soft-deleted blogs are invisible to everyone except through the admin trash route
  const filter = { isDeleted: false };

  if (!isReviewer(user.role)) {
    // Regular creators only see their own blogs
    filter.author = user.id;
  }

  if (query.status) filter.status = query.status;
  if (query.author && isReviewer(user.role)) filter.author = query.author;

  if (query.search?.trim()) {
    filter.$text = { $search: query.search.trim() };
  }

  return filter;
};

// ─── Public endpoints (no auth) ───────────────────────────────────────────────

/**
 * GET /api/blogs/public
 * Paginated list of all published blogs for the public website.
 */
exports.getPublicBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { status: 'published', isDeleted: false };
  if (req.query.tag) filter.tag = { $regex: req.query.tag.trim(), $options: 'i' };
  if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'firstName lastName username'),
    Blog.countDocuments(filter),
  ]);

  const formatted = blogs.map((b) => ({
    _id: b._id,
    slug: b.slug,
    title: b.title,
    img: b.img,
    tag: b.tag,
    excerpt: b.excerpt,
    modal: b.modal,
    views: b.views,
    documentUrl: b.documentUrl || null,
    documentName: b.documentName || null,
    publishedWith: `${b.author.firstName} ${b.author.lastName} on ${b.publishedAt.toLocaleDateString('en-GB')}`,
    link: b.authorRole === 'broadcast_media' ? b.organizationLink : b.socialHandle,
    publishedAt: b.publishedAt,
  }));

  res.json(paginatedResponse(formatted, total, { page, limit }));
};

/**
 * GET /api/blogs/public/:slug
 * Single published blog by URL slug — increments view counter.
 */
exports.getPublicBlogBySlug = async (req, res) => {
  const blog = await Blog.findOneAndUpdate(
    { slug: req.params.slug, status: 'published', isDeleted: false },
    { $inc: { views: 1 } },
    { new: true }
  ).populate('author', 'firstName lastName username socialHandle organization organizationLink');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  res.json(blog);
};

// ─── Authenticated list / detail ──────────────────────────────────────────────

/**
 * GET /api/blogs
 * Reviewers see all blogs; other roles see only their own.
 */
exports.getBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildBlogFilter(req.query, req.user);

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username email role firstName lastName')
      .populate('publishedBy', 'username firstName lastName')
      .populate('reviewHistory.reviewer', 'username firstName lastName'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/blogs/my-submissions
 * Lightweight status tracker for external contributors.
 */
exports.getMySubmissions = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { author: req.user.id, isDeleted: false };
  if (req.query.status) filter.status = req.query.status;

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .select('title slug status lastRejectionNote submittedAt publishedAt views createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/blogs/:id
 * Full blog detail — visible to reviewers and the blog's own author.
 */
exports.getBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('author', 'username email role firstName lastName socialHandle organization organizationLink')
    .populate('publishedBy', 'username firstName lastName')
    .populate('reviewHistory.reviewer', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isOwner = blog.author._id.toString() === req.user.id;
  if (!isReviewer(req.user.role) && !isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(blog);
};

// ─── Blog stats ───────────────────────────────────────────────────────────────

/**
 * GET /api/blogs/stats
 * Blog counts by status — scoped to the requester's visible set.
 */
exports.getBlogStats = async (req, res) => {
  const baseFilter = isReviewer(req.user.role)
    ? { isDeleted: false }
    : { author: req.user.id, isDeleted: false };

  const [stats, deletedCount] = await Promise.all([
    Blog.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    isReviewer(req.user.role) ? Blog.countDocuments({ isDeleted: true }) : Promise.resolve(0),
  ]);

  const byStatus = Object.fromEntries(stats.map((s) => [s._id, s.count]));

  res.json({
    draft: byStatus.draft || 0,
    pending_review: byStatus.pending_review || 0,
    approved: byStatus.approved || 0,
    published: byStatus.published || 0,
    deleted: deletedCount,
    total: (byStatus.draft || 0) + (byStatus.pending_review || 0) + (byStatus.approved || 0) + (byStatus.published || 0),
  });
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/blogs
 * Create a new blog as a draft. Always starts in draft status.
 */
exports.createBlog = async (req, res) => {
  const imgFile = req.files?.img?.[0];
  const docFile = req.files?.document?.[0];

  if (!imgFile) {
    return res.status(400).json({ error: 'A cover image is required' });
  }

  const { title, tag, excerpt, socialHandle, organizationLink, modal } = req.parsedBody;

  if (!title || !tag || !excerpt || !modal?.intro) {
    return res.status(400).json({ error: 'title, tag, excerpt, and modal.intro are required' });
  }

  const author = await User.findById(req.user.id).select('socialHandle organizationLink role');
  const slug = await generateSlug(title);

  const blog = await Blog.create({
    title,
    slug,
    tag,
    excerpt,
    modal,
    socialHandle: socialHandle || author?.socialHandle,
    organizationLink: organizationLink || author?.organizationLink,
    img: imgFile.path,
    imgPublicId: imgFile.filename,
    ...(docFile && {
      documentUrl: docFile.path,
      documentPublicId: docFile.filename,
      documentName: docFile.originalname,
    }),
    author: req.user.id,
    authorRole: req.user.role,
    status: 'draft',
  });

  writeAuditLog({
    req,
    action: 'blog.create',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.status(201).json(blog);
};

/**
 * PUT /api/blogs/:id
 * Update a blog. Permission rules enforced by canBeEditedBy().
 */
exports.updateBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  if (!blog.canBeEditedBy(req.user)) {
    return res.status(403).json({
      error:
        blog.status === 'published'
          ? 'Published blogs can only be edited by an admin. Unpublish first or contact admin.'
          : `Cannot edit a blog in "${blog.status}" status. Only review actions are available now.`,
    });
  }

  const { title, tag, excerpt, socialHandle, organizationLink, modal } = req.parsedBody;

  const prevTitle = blog.title;
  if (title) {
    blog.title = title;
    // Regenerate slug only if the title actually changed
    if (title !== prevTitle) {
      blog.slug = await generateSlug(title, blog._id);
    }
  }
  if (tag) blog.tag = tag;
  if (excerpt) blog.excerpt = excerpt;
  if (socialHandle) blog.socialHandle = socialHandle;
  if (organizationLink) blog.organizationLink = organizationLink;
  if (modal) blog.modal = modal;

  const imgFile = req.files?.img?.[0];
  const docFile = req.files?.document?.[0];

  if (imgFile) {
    await destroyAsset(blog.imgPublicId, 'image');
    blog.img = imgFile.path;
    blog.imgPublicId = imgFile.filename;
  }

  if (docFile) {
    await destroyAsset(blog.documentPublicId, 'raw');
    blog.documentUrl = docFile.path;
    blog.documentPublicId = docFile.filename;
    blog.documentName = docFile.originalname;
  }

  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.update',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json(blog);
};

/**
 * DELETE /api/blogs/:id
 * Soft-delete a blog (marks isDeleted=true, keeps Cloudinary assets).
 * Published blogs require admin. Hard delete is a separate admin-only endpoint.
 */
exports.deleteBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  if (!blog.canBeDeletedBy(req.user)) {
    return res.status(403).json({
      error:
        blog.status === 'published'
          ? 'Only an admin can delete a published blog'
          : 'You are not permitted to delete this blog',
    });
  }

  blog.isDeleted = true;
  blog.deletedAt = new Date();
  blog.deletedBy = req.user.id;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { previousStatus: blog.status },
  });

  res.json({ message: 'Blog removed. It can be restored by an admin.' });
};

/**
 * PATCH /api/blogs/:id/restore   (admin only)
 * Un-soft-deletes a blog, returning it to its previous status.
 */
exports.restoreBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: true });
  if (!blog) return res.status(404).json({ error: 'Blog not found in trash' });

  blog.isDeleted = false;
  blog.deletedAt = undefined;
  blog.deletedBy = undefined;

  // Restored published blogs go back to approved so admin can re-publish intentionally
  if (blog.status === 'published') blog.status = 'approved';

  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.restore',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog restored successfully', blog });
};

/**
 * DELETE /api/blogs/:id/hard   (admin only)
 * Permanently removes a soft-deleted blog and its Cloudinary assets.
 */
exports.hardDeleteBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: true });
  if (!blog) {
    return res.status(404).json({ error: 'Blog not found in trash. Soft-delete it first.' });
  }

  await destroyAsset(blog.imgPublicId, 'image');
  await destroyAsset(blog.documentPublicId, 'raw');
  await blog.deleteOne();

  writeAuditLog({
    req,
    action: 'blog.hard_delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog permanently deleted' });
};

/**
 * GET /api/blogs/trash   (admin only)
 * List all soft-deleted blogs.
 */
exports.getDeletedBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const [blogs, total] = await Promise.all([
    Blog.find({ isDeleted: true })
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username firstName lastName')
      .populate('deletedBy', 'username firstName lastName'),
    Blog.countDocuments({ isDeleted: true }),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

// ─── Workflow actions ──────────────────────────────────────────────────────────

/**
 * PATCH /api/blogs/:id/submit
 * Submit (or resubmit) a draft blog for review.
 */
exports.submitBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  if (blog.author.toString() !== req.user.id) {
    return res.status(403).json({ error: 'You can only submit your own blog' });
  }
  if (blog.status !== 'draft') {
    return res.status(400).json({ error: `Cannot submit a blog in "${blog.status}" status` });
  }

  const wasRejectedBefore = blog.reviewHistory.some((r) => r.decision === 'rejected');

  blog.status = 'pending_review';
  blog.submittedAt = new Date();
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.submit',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { resubmission: wasRejectedBefore },
  });

  res.json({
    message: wasRejectedBefore ? 'Blog resubmitted for review' : 'Blog submitted for review',
    blog,
  });
};

/**
 * PATCH /api/blogs/:id/review   (admin + communication_officer)
 * Approve or reject a pending blog. Sends email to the author.
 */
exports.reviewBlog = async (req, res) => {
  const { decision, note } = req.body;

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
  }
  if (decision === 'rejected' && !note?.trim()) {
    return res.status(400).json({ error: 'A comment explaining the rejection is required' });
  }

  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false }).populate(
    'author',
    'email firstName'
  );
  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  if (blog.status !== 'pending_review') {
    return res.status(400).json({ error: 'Blog is not awaiting review' });
  }

  blog.reviewHistory.push({ decision, reviewer: req.user.id, note: note || '' });

  if (decision === 'approved') {
    blog.status = 'approved';
    blog.lastRejectionNote = undefined;
  } else {
    blog.status = 'draft';
    blog.lastRejectionNote = note;
    blog.submittedAt = undefined;
  }

  await blog.save();

  // Non-blocking email notification to author
  if (decision === 'approved') {
    sendBlogApprovalEmail(blog.author.email, blog.author.firstName, blog.title).catch((err) =>
      console.error('[Email] Failed to send approval email:', err.message)
    );
  } else {
    sendBlogRejectionEmail(blog.author.email, blog.author.firstName, blog.title, note).catch((err) =>
      console.error('[Email] Failed to send rejection email:', err.message)
    );
  }

  writeAuditLog({
    req,
    action: 'blog.review',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { decision, note: note || null },
  });

  res.json({
    message:
      decision === 'approved'
        ? 'Blog approved. It now awaits publishing by an admin.'
        : 'Blog rejected and returned to draft with your comment.',
    blog,
  });
};

/**
 * PATCH /api/blogs/:id/publish   (ADMIN ONLY)
 * Publishes an approved blog to the live website.
 */
exports.publishBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false }).populate(
    'author',
    'email firstName'
  );
  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  if (blog.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved blogs can be published' });
  }

  blog.status = 'published';
  blog.publishedAt = new Date();
  blog.publishedBy = req.user.id;
  await blog.save();

  // Notify author that their post is now live
  sendBlogPublishedEmail(blog.author.email, blog.author.firstName, blog.title, blog.slug).catch(
    (err) => console.error('[Email] Failed to send published email:', err.message)
  );

  writeAuditLog({
    req,
    action: 'blog.publish',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog is now live on the website', blog });
};

/**
 * PATCH /api/blogs/:id/unpublish   (admin + communication_officer)
 * Removes a published blog from the live website (returns to approved).
 */
exports.unpublishBlog = async (req, res) => {
  const { note } = req.body;
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  if (blog.status !== 'published') {
    return res.status(400).json({ error: 'Only published blogs can be unpublished' });
  }

  blog.status = 'approved';
  blog.publishedAt = undefined;
  blog.publishedBy = undefined;

  if (note?.trim()) {
    blog.reviewHistory.push({
      decision: 'rejected',
      reviewer: req.user.id,
      note: `Unpublished: ${note.trim()}`,
    });
  }

  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.unpublish',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
    detail: { note: note || null },
  });

  res.json({
    message: 'Blog removed from the public website. It is back in approved status.',
    blog,
  });
};

// Re-export role constants so routes can import from here
exports.REVIEWERS = REVIEWERS;
exports.CREATORS = CREATORS;
