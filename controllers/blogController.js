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
const { htmlToBlocks } = require('../utils/htmlToBlocks');

/**
 * Map uploaded files (req.files.images) into blocks or excerptBlocks.
 * Strategies used:
 * 1. Exact match by originalname vs fileKey / uploadKey / src / source
 * 2. Fallback by position (sequential index matching) if exact key matching fails
 */
const applyUploadedImagesToBlocks = (blocks = [], uploadedFiles = []) => {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) return blocks;

  const byOriginalName = new Map();
  uploadedFiles.forEach((f) => {
    if (f.originalname) byOriginalName.set(f.originalname, f);
  });

  let fileIndex = 0;

  return blocks.map((blk) => {
    if (!blk || typeof blk !== 'object') return blk;

    if (blk.type === 'image' || blk.type === 'hero' || blk.type === 'embed' || blk.type === 'html') {
      const fileKey = blk.fileKey || blk.uploadKey || blk.src || blk.source;
      let matched = null;

      // 1. Try matching by explicit originalname key
      if (fileKey && byOriginalName.has(fileKey)) {
        matched = byOriginalName.get(fileKey);
      } else if (blk.src && byOriginalName.has(blk.src)) {
        matched = byOriginalName.get(blk.src);
      }

      // 2. Sequential fallback if key lookup missed
      if (!matched && uploadedFiles[fileIndex]) {
        matched = uploadedFiles[fileIndex];
      }

      if (matched) {
        fileIndex++;
        const newBlk = { ...blk };
        newBlk.src = matched.path || matched.location || matched.url || matched.secure_url || blk.src;
        newBlk.source = matched.filename || matched.public_id || matched.key || newBlk.source;
        return newBlk;
      }
    }

    return blk;
  });
};

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

const summarizeChanges = (before, after) => {
  const items = [];

  if (before.title !== after.title) items.push(`title changed from "${before.title}" to "${after.title}"`);
  if (before.excerpt !== after.excerpt) items.push('excerpt updated');
  if ((before.tag || '') !== (after.tag || '')) items.push(`tag changed from "${before.tag || ''}" to "${after.tag || ''}"`);
  if (JSON.stringify(before.blocks || []) !== JSON.stringify(after.blocks || [])) items.push('body content updated');
  if (JSON.stringify(before.excerptBlocks || []) !== JSON.stringify(after.excerptBlocks || [])) items.push('excerpt section updated');
  if ((before.socialHandle || '') !== (after.socialHandle || '')) items.push('social handle updated');
  if ((before.organizationLink || '') !== (after.organizationLink || '')) items.push('organization link updated');

  return items.length ? items.join('; ') : 'content updated';
};

/**
 * Finds any comment or nested reply by ID regardless of visibility/deletion state.
 * Allows moderation endpoints (hide, unhide, soft-delete) to locate hidden comments.
 */
const findCommentById = (blog, commentId) => {
  if (!blog || !commentId) return null;

  const direct = blog.comments?.find((comment) => comment._id.toString() === commentId.toString());
  if (direct) return { comment: direct, parent: null };

  for (const comment of blog.comments || []) {
    const nested = (comment.replies || []).find((reply) => reply._id.toString() === commentId.toString());
    if (nested) return { comment: nested, parent: comment };
  }

  return null;
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
  if (req.query.search?.trim()) filter.$text = { $search: req.query.search.trim() };

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('originalAuthor', 'firstName lastName username jobTitle socialHandle organizationLink organization')
      .populate('author', 'firstName lastName username jobTitle socialHandle organizationLink organization'),
    Blog.countDocuments(filter),
  ]);

  const formatted = blogs.map((b) => {
    const creator = b.originalAuthor || b.author;
    const authorName = creator ? `${creator.firstName} ${creator.lastName}`.trim() : 'Anonymous';
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
      link: b.originalAuthorRole === ROLES.BROADCAST_CONTENT_CREATOR 
        ? (b.organizationLink || creator?.organizationLink) 
        : (b.socialHandle || creator?.socialHandle),
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
  )
    .populate('originalAuthor', 'firstName lastName username jobTitle socialHandle organization organizationLink')
    .populate('author', 'firstName lastName username jobTitle socialHandle organization organizationLink')
    .populate('comments.user', 'firstName lastName username email role jobTitle')
    .populate('comments.replies.user', 'firstName lastName username email role jobTitle');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const blogObj = blog.toObject();

  if (blogObj.author && blogObj.originalAuthor && blogObj.author._id.toString() !== blogObj.originalAuthor._id.toString()) {
    delete blogObj.author;
  }

  blogObj.comments = (blogObj.comments || [])
    .filter((comment) => comment && !comment.isDeleted && comment.isVisible !== false)
    .map((comment) => ({
      ...comment,
      replies: (comment.replies || []).filter((reply) => !reply.isDeleted && reply.isVisible !== false),
    }));

  res.json(blogObj);
};

exports.addPublicComment = async (req, res) => {
  const { slug } = req.params;
  const { name, email, phone, content, parentComment } = req.body || {};

  if (!name?.trim() || !email?.trim() || !content?.trim()) {
    return res.status(400).json({ error: 'Name, email, and comment content are required.' });
  }

  const blog = await Blog.findOne({ slug, status: 'published', isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const payload = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone?.trim() || '',
    role: req.user?.role || 'guest',
    user: req.user?.id || null,
    content: content.trim(),
    parentComment: parentComment || null,
    isVisible: true,
    isDeleted: false,
    replies: [],
    createdAt: new Date(),
  };

  if (parentComment) {
    const target = findCommentById(blog, parentComment);
    if (!target) {
      return res.status(404).json({ error: 'Parent comment not found' });
    }

    if (target.parent) {
      target.parent.replies.push(payload);
    } else {
      target.comment.replies.push(payload);
    }
  } else {
    blog.comments.push(payload);
  }

  await blog.save();

  const reviewers = await User.find({ role: { $in: [ROLES.ADMIN, ROLES.COMMUNICATION_OFFICER, ROLES.EDITOR] }, isActive: true });
  if (reviewers.length > 0) {
    const notifications = reviewers.map((reviewer) => ({
      recipient: reviewer._id,
      sender: req.user?._id || null,
      type: 'ARTICLE_COMMENT',
      message: `New comment on "${blog.title}" from ${payload.name}.`,
      article: blog._id,
    }));

    await Notification.insertMany(notifications).catch((err) => console.error('Comment notification failed:', err.message));
  }

  res.status(201).json({ message: 'Comment added successfully', comment: parentComment ? payload : blog.comments[blog.comments.length - 1] });
};

// ─── Comment Moderation Endpoints ─────────────────────────────────────────────

exports.hideComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isVisible = false;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_hide',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment hidden successfully', comment });
};

exports.unhideComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isVisible = true;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_unhide',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment unhidden successfully', comment });
};

exports.deleteComment = async (req, res) => {
  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false });
  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const target = findCommentById(blog, req.params.commentId);
  if (!target) return res.status(404).json({ error: 'Comment not found' });

  const comment = target.comment;
  comment.isDeleted = true;
  comment.isVisible = false;
  await blog.save();

  writeAuditLog({
    req,
    action: 'blog.comment_delete',
    targetModel: 'Blog',
    targetId: blog._id,
    targetLabel: blog.title,
  });

  res.json({ message: 'Comment deleted successfully' });
};

exports.respondToEditorConsent = async (req, res) => {
  const { approved, note } = req.body || {};

  const blog = await Blog.findOne({ _id: req.params.id, isDeleted: false })
    .populate('originalAuthor', 'firstName lastName email username jobTitle')
    .populate('author', 'firstName lastName email username jobTitle');

  if (!blog) return res.status(404).json({ error: 'Blog not found' });

  const isWriter = blog.originalAuthor && blog.originalAuthor._id.toString() === req.user.id;
  if (!isWriter && blog.author && blog.author._id.toString() !== req.user.id) {
    return res.status(403).json({ error: 'Only the original writer can approve or reject editor changes.' });
  }

  if (approved === undefined || approved === null || approved === '') {
    return res.status(400).json({ error: 'approved is required' });
  }

  blog.publishConsentStatus = approved ? 'approved' : 'rejected';
  blog.publishConsentNote = note?.trim() || '';
  blog.publishConsentBy = req.user.id;
  blog.publishConsentRequestedAt = blog.publishConsentRequestedAt || new Date();

  if (approved) {
    blog.status = blog.status === 'published' ? 'published' : 'approved';
  } else {
    blog.status = 'draft';
  }

  await blog.save();

  const recipient = blog.author && blog.author._id ? blog.author._id : blog.originalAuthor?._id;
  if (recipient) {
    await Notification.create({
      recipient,
      sender: req.user.id,
      type: 'EDITOR_EDIT_PROMPT',
      message: approved
        ? `The writer approved changes to "${blog.title}" and publishing can proceed.`
        : `The writer rejected the editor changes for "${blog.title}" and publication is blocked.`,
      article: blog._id,
    }).catch((err) => console.error('Consent notification failed:', err.message));
  }

  res.json({
    message: approved ? 'Editor changes approved. This blog can continue to publication.' : 'Editor changes rejected. The blog has been returned to draft.',
    blog,
  });
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
      .populate('originalAuthor', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
      .populate('author', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
      .populate('publishedBy', 'username firstName lastName jobTitle')
      .populate('reviewHistory.reviewer', 'username firstName lastName jobTitle')
      .populate('changeRequests.commenter', 'username firstName lastName role jobTitle'),
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
    .populate('originalAuthor', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
    .populate('author', 'username email role firstName lastName jobTitle socialHandle organization organizationLink')
    .populate('publishedBy', 'username firstName lastName jobTitle')
    .populate('reviewHistory.reviewer', 'username firstName lastName role jobTitle')
    .populate('changeRequests.commenter', 'username firstName lastName role jobTitle');

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
  let { title, tag, excerpt, excerptBlocks, socialHandle, organizationLink, modal, blocks, bodyHtml } = bodyData;

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) { blocks = []; }
  }
  if (typeof excerptBlocks === 'string') {
    try { excerptBlocks = JSON.parse(excerptBlocks); } catch (e) { excerptBlocks = []; }
  }
  if (typeof modal === 'string') {
    try { modal = JSON.parse(modal); } catch (e) { modal = {}; }
  }

  if (!title || !tag || (!(excerpt && excerpt.trim()) && (!Array.isArray(excerptBlocks) || excerptBlocks.length === 0) && (!Array.isArray(blocks) || blocks.length === 0))) {
    return res.status(400).json({ error: 'title, tag, and at least one of excerpt/excerptBlocks/blocks is required' });
  }

  const author = await User.findById(req.user.id).select('socialHandle organizationLink role jobTitle');
  const slug = await generateSlug(title);

  const imgPublicId = imgFile.filename || imgFile.public_id || '';
  const docPublicId = docFile ? (docFile.filename || docFile.public_id || '') : '';

  // Apply uploaded inline images to blocks and excerptBlocks
  const inlineFiles = req.files?.images || [];
  const finalBlocks = applyUploadedImagesToBlocks(Array.isArray(blocks) ? blocks : [], inlineFiles);
  const finalExcerptBlocks = applyUploadedImagesToBlocks(Array.isArray(excerptBlocks) ? excerptBlocks : [], inlineFiles);

  const blog = await Blog.create({
    title,
    slug,
    tag,
    excerpt,
    excerptBlocks: finalExcerptBlocks || [],
    blocks: finalBlocks || [],
    modal: modal || {},
    socialHandle: socialHandle || author?.socialHandle,
    organizationLink: organizationLink || author?.organizationLink,
    img: imgFile.path,
    imgPublicId,
    bodyHtml: bodyHtml || '',
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

  // If frontend provided bodyHtml but no structured blocks, attempt to parse into blocks
  try {
    if ((!blog.blocks || blog.blocks.length === 0) && bodyHtml) {
      const parsed = htmlToBlocks(bodyHtml);
      if (parsed && parsed.length) {
        blog.blocks = applyUploadedImagesToBlocks(parsed, req.files?.images || []);
        await blog.save();
      }
    }
  } catch (e) {
    console.error('htmlToBlocks parse failed:', e.message);
  }

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
  let { title, tag, excerpt, excerptBlocks, socialHandle, organizationLink, modal, blocks, bodyHtml } = bodyData;

  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); } catch (e) {}
  }
  if (typeof excerptBlocks === 'string') {
    try { excerptBlocks = JSON.parse(excerptBlocks); } catch (e) {}
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
  if (excerpt !== undefined) blog.excerpt = excerpt;
  if (excerptBlocks) blog.excerptBlocks = Array.isArray(excerptBlocks) ? excerptBlocks : blog.excerptBlocks;
  if (socialHandle) blog.socialHandle = socialHandle;
  if (organizationLink) blog.organizationLink = organizationLink;
  if (modal) blog.modal = modal;
  if (blocks) blog.blocks = Array.isArray(blocks) ? blocks : blog.blocks;

  if (typeof bodyHtml === 'string') {
    blog.bodyHtml = bodyHtml;
  }

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

  // Apply uploaded inline images to blocks and excerptBlocks
  const inlineFiles = req.files?.images || [];
  if (inlineFiles.length > 0) {
    try {
      blog.blocks = applyUploadedImagesToBlocks(Array.isArray(blog.blocks) ? blog.blocks : [], inlineFiles);
      blog.excerptBlocks = applyUploadedImagesToBlocks(Array.isArray(blog.excerptBlocks) ? blog.excerptBlocks : [], inlineFiles);
    } catch (e) {
      console.error('Failed to apply uploaded inline images:', e.message);
    }
  }

  // If blocks still empty but bodyHtml provided, attempt to parse to structured blocks
  if ((!blog.blocks || blog.blocks.length === 0) && bodyHtml) {
    try {
      const parsed = htmlToBlocks(bodyHtml);
      if (parsed && parsed.length) blog.blocks = parsed;
    } catch (e) {
      console.error('htmlToBlocks parse failed during update:', e.message);
    }
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
      .populate('originalAuthor', 'username firstName lastName jobTitle')
      .populate('deletedBy', 'username firstName lastName jobTitle'),
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
    'email firstName jobTitle'
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
    'email firstName jobTitle'
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