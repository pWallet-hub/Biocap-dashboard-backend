const Blog = require('../models/Blog');
const User = require('../models/User');
const Notification = require('../models/Notification');
const cloudinary = require('../config/cloudinary');
const { REVIEWERS, CREATORS, isReviewer, ROLES } = require('../constants/roles');
const { parsePagination, paginatedResponse } = require('../utils/pagination');
const { generateSlug } = require('../utils/slugify');
const { writeAuditLog } = require('../utils/auditLogger');
const {
  sendBlogApprovalEmail,
  sendBlogRejectionEmail,
  sendBlogPublishedEmail,
} = require('../utils/sendEmail');

// ─── Private Helpers ──────────────────────────────────────────────────────────

const destroyAsset = async (publicId, resourceType = 'image') => {
  if (!publicId) return;
  await cloudinary.uploader
    .destroy(publicId, { resource_type: resourceType })
    .catch((err) => console.error(`Failed to remove Cloudinary asset (${resourceType}):`, err.message));
};

const buildBlogFilter = (query, user) => {
  const filter = { isDeleted: false };

  if (!isReviewer(user.role)) {
    // External creators only see their own blogs
    filter.$or = [{ originalAuthor: user.id }, { author: user.id }];
  }

  if (query.status) filter.status = query.status;
  if (query.author && isReviewer(user.role)) filter.author = query.author;

  if (query.search?.trim()) {
    filter.$text = { $search: query.search.trim() };
  }

  return filter;
};

// ─── Public Endpoints (No Auth) ───────────────────────────────────────────────

/**
 * GET /api/blogs/public
 * Paginated list of published blogs for the public website.
 */
exports.getPublicBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { status: 'published', isDeleted: false };
  if (req.query.tag) filter.tag = { $regex: req.query.tag.trim(), $options: 'i' };
  if (req.query.search?.trim()) filter.$text = { $search: query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'firstName lastName username socialHandle organizationLink'),
    Blog.countDocuments(filter),
  ]);

  const formatted = blogs.map((b) => {
    const creator = b.originalAuthor;
    const authorName = creator ? `${creator.firstName} ${creator.lastName}` : 'Anonymous';
    const publishedDate = b.publishedAt ? b.publishedAt.toLocaleDateString('en-GB') : '';

    return {
      _id: b._id,
      slug: b.slug,
      title: b.title,
      img: b.img,
      tag: b.tag,
      excerpt: b.excerpt,
      blocks: b.blocks || [],
      modal: b.modal || {},
      views: b.views,
      documentUrl: b.documentUrl || null,
      documentName: b.documentName || null,
      originalAuthor: creator,
      publishedWith: `${authorName} on ${publishedDate}`,
      link: b.originalAuthorRole === ROLES.BROADCAST_CONTENT_CREATOR ? b.organizationLink : b.socialHandle,
      publishedAt: b.publishedAt,
    };
  });

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
  ).populate('originalAuthor', 'firstName lastName username socialHandle organization organizationLink');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const blogObj = blog.toObject();

  if (blogObj.author && blogObj.originalAuthor && blogObj.author.toString() !== blogObj.originalAuthor._id.toString()) {
    delete blogObj.author;
  }

  res.json(blogObj);
};

// ─── Authenticated List / Detail ──────────────────────────────────────────────

/**
 * GET /api/blogs
 * Reviewers see all blogs; creators see only their own.
 */
exports.getBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildBlogFilter(req.query, req.user);

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username email role firstName lastName')
      .populate('author', 'username email role firstName lastName')
      .populate('publishedBy', 'username firstName lastName')
      .populate('reviewHistory.reviewer', 'username firstName lastName')
      .populate('changeRequests.commenter', 'username firstName lastName role'),
    Blog.countDocuments(filter),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

/**
 * GET /api/blogs/my-submissions
 * Status tracker for content creators.
 */
exports.getMySubmissions = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {
    $or: [{ originalAuthor: req.user.id }, { author: req.user.id }],
    isDeleted: false,
  };
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
 * Full blog detail for permitted roles.
 */
exports.getBlogById = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('originalAuthor', 'username email role firstName lastName socialHandle organization organizationLink')
    .populate('author', 'username email role firstName lastName socialHandle organization organizationLink')
    .populate('publishedBy', 'username firstName lastName')
    .populate('reviewHistory.reviewer', 'username firstName lastName role')
    .populate('changeRequests.commenter', 'username firstName lastName role');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isOwner =
    (blog.originalAuthor && blog.originalAuthor._id.toString() === req.user.id) ||
    (blog.author && blog.author._id.toString() === req.user.id);

  if (!isReviewer(req.user.role) && !isOwner) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(blog);
};

// ─── Blog Statistics ──────────────────────────────────────────────────────────

exports.getBlogStats = async (req, res) => {
  const baseFilter = isReviewer(req.user.role)
    ? { isDeleted: false }
    : { $or: [{ originalAuthor: req.user.id }, { author: req.user.id }], isDeleted: false };

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

// ─── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * POST /api/blogs
 * Create a new draft blog article.
 */
exports.createBlog = async (req, res) => {
  const imgFile = req.files?.img?.[0];
  const docFile = req.files?.document?.[0];

  if (!imgFile) {
    return res.status(400).json({ error: 'A cover image is required' });
  }

  const bodyData = req.parsedBody || req.body || {};
  let { title, tag, excerpt, socialHandle, organizationLink, modal, blocks } = bodyData;

  if (!title || !tag || !excerpt) {
    return res.status(400).json({ error: 'title, tag, and excerpt are required' });
  }

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) { blocks = []; }
  }

  if (typeof modal === 'string') {
    try { modal = JSON.parse(modal); } catch (e) { modal = {}; }
  }

  const author = await User.findById(req.user.id).select('socialHandle organizationLink role');
  const slug = await generateSlug(title);

  const imgPublicId = imgFile.filename || imgFile.public_id || '';
  const docPublicId = docFile ? (docFile.filename || docFile.public_id || '') : '';

  const blog = await Blog.create({
    title,
    slug,
    tag,
    excerpt,
    blocks: Array.isArray(blocks) ? blocks : [],
    modal: modal || {},
    socialHandle: socialHandle || author?.socialHandle,
    organizationLink: organizationLink || author?.organizationLink,
    img: imgFile.path,
    imgPublicId,
    ...(docFile && {
      documentUrl: docFile.path,
      documentPublicId: docPublicId,
      documentName: docFile.originalname,
    }),
    originalAuthor: req.user.id,
    originalAuthorRole: req.user.role,
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

  res.status(201).json({ message: 'Created successfully', blog });
};

/**
 * PUT /api/blogs/:id
 * Updates blog content. 
 */
exports.updateBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isReviewerUser = isReviewer(req.user.role);

  if (!isReviewerUser && !blog.canBeEditedBy(req.user)) {
    return res.status(403).json({
      error:
        blog.status === 'published'
          ? 'Published blogs can only be edited by an admin. Unpublish first or contact admin.'
          : `Cannot edit a blog in "${blog.status}" status. Only review actions are available now.`,
    });
  }

  const bodyData = req.parsedBody || req.body || {};
  let { title, tag, excerpt, socialHandle, organizationLink, modal, blocks } = bodyData;

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) {}
  }
  if (typeof modal === 'string') {
    try { modal = JSON.parse(modal); } catch (e) {}
  }

  const prevTitle = blog.title;
  if (title) {
    blog.title = title;
    if (title !== prevTitle) {
      blog.slug = await generateSlug(title, blog._id);
    }
  }
  if (tag) blog.tag = tag;
  if (excerpt) blog.excerpt = excerpt;
  if (socialHandle) blog.socialHandle = socialHandle;
  if (organizationLink) blog.organizationLink = organizationLink;
  if (modal) blog.modal = modal;
  if (blocks) blog.blocks = Array.isArray(blocks) ? blocks : blog.blocks;

  blog.author = req.user.id;
  blog.authorRole = req.user.role;

  const imgFile = req.files?.img?.[0] || req.file;
  const docFile = req.files?.document?.[0];

  if (imgFile) {
    await destroyAsset(blog.imgPublicId, 'image');
    blog.img = imgFile.path;
    blog.imgPublicId = imgFile.filename || imgFile.public_id || '';
  }

  if (docFile) {
    await destroyAsset(blog.documentPublicId, 'raw');
    blog.documentUrl = docFile.path;
    blog.documentPublicId = docFile.filename || docFile.public_id || '';
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

  res.json({ message: 'Blog updated successfully', blog });
};

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

exports.restoreBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: true });
  if (!blog) return res.status(404).json({ error: 'Blog not found in trash' });

  blog.isDeleted = false;
  blog.deletedAt = undefined;
  blog.deletedBy = undefined;

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

exports.getDeletedBlogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const [blogs, total] = await Promise.all([
    Blog.find({ isDeleted: true })
      .sort({ deletedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'username firstName lastName')
      .populate('deletedBy', 'username firstName lastName'),
    Blog.countDocuments({ isDeleted: true }),
  ]);

  res.json(paginatedResponse(blogs, total, { page, limit }));
};

// ─── Workflow Actions ──────────────────────────────────────────────────────────

exports.submitBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isCreator =
    blog.originalAuthor.toString() === req.user.id || blog.author.toString() === req.user.id;
  if (!isCreator) {
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

exports.reviewBlog = async (req, res) => {
  const { decision, note } = req.body;

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
  }
  if (decision === 'rejected' && !note?.trim()) {
    return res.status(400).json({ error: 'A comment explaining the rejection is required' });
  }

  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false }).populate(
    'originalAuthor',
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
    // Record structured change request so the creator can track and mark implementation
    blog.status = 'draft';
    blog.lastRejectionNote = note;
    blog.submittedAt = undefined;
    if (!blog.changeRequests) blog.changeRequests = [];
    blog.changeRequests.push({
      commenter: req.user.id,
      role: req.user.role,
      comment: note,
      requestedAt: new Date(),
      implemented: false,
    });
  }

  await blog.save();

  // Notify Officers when a blog is approved and ready for publishing
  if (decision === 'approved' && Notification) {
    const officers = await User.find({ role: ROLES.COMMUNICATION_OFFICER, isActive: true }).select('_id');
    const alerts = officers.map((off) => ({
      recipient: off._id,
      sender: req.user.id,
      type: 'BLOG_APPROVED',
      message: `Article "${blog.title}" has been approved and is ready to be published live.`,
      article: blog._id,
    }));
    if (alerts.length > 0) await Notification.insertMany(alerts);
  }

  if (blog.originalAuthor?.email) {
    if (decision === 'approved') {
      sendBlogApprovalEmail(blog.originalAuthor.email, blog.originalAuthor.firstName, blog.title).catch((err) =>
        console.error('[Email] Failed to send approval email:', err.message)
      );
    } else {
      sendBlogRejectionEmail(blog.originalAuthor.email, blog.originalAuthor.firstName, blog.title, note).catch((err) =>
        console.error('[Email] Failed to send rejection email:', err.message)
      );
      // Send in-app notification to the original author about requested changes
      if (Notification) {
        try {
          await Notification.create({
            recipient: blog.originalAuthor._id || blog.originalAuthor,
            sender: req.user.id,
            type: 'CHANGE_REQUEST',
            message: `Reviewer asked for changes on "${blog.title}": ${note}`,
            article: blog._id,
          });
        } catch (err) {
          console.error('Failed to create change request notification:', err.message);
        }
      }
    }
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
        ? 'Blog approved. It now awaits publishing by an authorized publisher.'
        : 'Blog rejected and returned to draft with your comment.',
    blog,
  });
};

exports.publishBlog = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false }).populate(
    'originalAuthor',
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

  if (blog.originalAuthor?.email) {
    sendBlogPublishedEmail(blog.originalAuthor.email, blog.originalAuthor.firstName, blog.title, blog.slug).catch(
      (err) => console.error('[Email] Failed to send published email:', err.message)
    );
  }

  writeAuditLog({
    req,
    action: 'blog.publish',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Blog is now live on the website', blog });
};

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

exports.REVIEWERS = REVIEWERS;
exports.CREATORS = CREATORS;