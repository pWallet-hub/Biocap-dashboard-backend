const Blog = require('../models/Blog');
const cloudinary = require('../config/cloudinary');

const REVIEWERS = ['admin', 'communication_officer'];
const CREATORS = ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'];

const destroyAsset = async (publicId, resourceType = 'image') => {
  if (!publicId) return;
  await cloudinary.uploader
    .destroy(publicId, { resource_type: resourceType })
    .catch((err) => console.error(`Failed to remove Cloudinary asset (${resourceType}):`, err.message));
};

exports.getPublicBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find({ status: 'published' })
      .sort({ publishedAt: -1 })
      .populate('author', 'firstName lastName username');

    const formatted = blogs.map((b) => ({
      _id: b._id,
      title: b.title,
      img: b.img,
      tag: b.tag,
      excerpt: b.excerpt,
      modal: b.modal,
      documentUrl: b.documentUrl || null,
      documentName: b.documentName || null,
      publishedWith: `${b.author.firstName} ${b.author.lastName} on ${b.publishedAt.toLocaleDateString('en-GB')}`,
      link: b.authorRole === 'broadcast_media' ? b.organizationLink : b.socialHandle,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBlogs = async (req, res) => {
  try {
    const filter = REVIEWERS.includes(req.user.role) ? {} : { author: req.user.id };
    const blogs = await Blog.find(filter)
      .sort({ createdAt: -1 })
      .populate('author', 'username email role')
      .populate('publishedBy', 'username')
      .populate('reviewHistory.reviewer', 'username');
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMySubmissions = async (req, res) => {
  try {
    const blogs = await Blog.find({ author: req.user.id })
      .select('title status lastRejectionNote submittedAt publishedAt createdAt')
      .sort({ updatedAt: -1 });
    res.json(blogs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id).populate('author', 'username email role');
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const isOwner = blog.author._id.toString() === req.user.id;
    if (!REVIEWERS.includes(req.user.role) && !isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(blog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createBlog = async (req, res) => {
  try {
    const imgFile = req.files?.img?.[0];
    const docFile = req.files?.document?.[0];

    if (!imgFile) {
      return res.status(400).json({ error: 'A cover image is required' });
    }

    const { title, tag, excerpt, socialHandle, organizationLink, modal } = req.parsedBody;

    const blog = await Blog.create({
      title,
      tag,
      excerpt,
      modal,
      socialHandle,
      organizationLink,
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

    res.status(201).json(blog);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    const isOwner = blog.author.toString() === req.user.id;
    const isReviewer = REVIEWERS.includes(req.user.role);

    if (!isReviewer && (!isOwner || !blog.canOwnerModify())) {
      return res.status(403).json({
        error: `Cannot edit a blog in "${blog.status}" status. Only review actions are available now.`,
      });
    }

    const { title, tag, excerpt, socialHandle, organizationLink, modal } = req.parsedBody;

    if (title) blog.title = title;
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
    res.json(blog);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });

    if (!blog.canBeDeletedBy(req.user)) {
      return res.status(403).json({
        error:
          blog.status === 'published'
            ? 'Only an admin can delete a published blog'
            : 'You are not permitted to delete this blog',
      });
    }

    await destroyAsset(blog.imgPublicId, 'image');
    await destroyAsset(blog.documentPublicId, 'raw');

    await blog.deleteOne();
    res.json({ message: 'Blog deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.submitBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
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

    res.json({
      message: wasRejectedBefore ? 'Blog resubmitted for review' : 'Blog submitted for review',
      blog,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.reviewBlog = async (req, res) => {
  try {
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }
    if (decision === 'rejected' && !note?.trim()) {
      return res.status(400).json({ error: 'A comment explaining the rejection is required' });
    }

    const blog = await Blog.findById(req.params.id);
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

    res.json({
      message:
        decision === 'approved'
          ? 'Blog approved. It now awaits publishing.'
          : 'Blog rejected and sent back to draft with your comment.',
      blog,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.publishBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    if (blog.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved blogs can be published' });
    }

    blog.status = 'published';
    blog.publishedAt = new Date();
    blog.publishedBy = req.user.id;
    await blog.save();

    res.json({ message: 'Blog is now live on the website', blog });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.REVIEWERS = REVIEWERS;
exports.CREATORS = CREATORS;