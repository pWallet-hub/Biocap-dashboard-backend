// services/blogEventListener.js
const blogEventBus = require('../config/eventBus');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../constants/roles');
const { sendStoryPublishedToEditorEmail, sendStoryUnpublishedEmail, publicUrl } = require('../utils/sendEmail');
const { notifyUsersByRole } = require('../utils/notify');

// Emails every active editor that the story is published. Failures are logged per editor, not thrown.
const emailEditorsAboutPublication = async (blog, userId) => {
  const [publisher, editors] = await Promise.all([
    User.findById(userId).select('firstName lastName username').lean(),
    User.find({ role: ROLES.EDITOR, isActive: true }).select('email firstName').lean(),
  ]);
  const publishedBy = [publisher?.firstName, publisher?.lastName].filter(Boolean).join(' ') || publisher?.username || 'Someone';
  const storyLink = `${publicUrl(`/Stewardship-News/${blog.slug}`)}`;

  const recipients = editors.filter((editor) => editor.email);
  const results = await Promise.allSettled(
    recipients.map((editor) =>
      sendStoryPublishedToEditorEmail(editor.email, editor.firstName, blog.title, { publishedBy, storyLink })
    )
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Publish email to editor ${recipients[index].email} failed:`, result.reason?.message || result.reason);
    }
  });
};

// Emails the writer that the story was taken off the website. Errors are logged, not thrown.
const emailAuthorAboutUnpublishing = async (blog, userId) => {
  try {
    const [actor, author] = await Promise.all([
      User.findById(userId).select('firstName lastName username').lean(),
      User.findById(blog.originalAuthor?._id || blog.originalAuthor || blog.author?._id || blog.author)
        .select('email firstName')
        .lean(),
    ]);
    if (!author?.email) return;

    const unpublishedBy = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.username || 'An editor';
    await sendStoryUnpublishedEmail(author.email, author.firstName, blog.title, { unpublishedBy });
  } catch (err) {
    console.error('Unpublish email to writer failed:', err.message);
  }
};

// Handle Post-Publish Background Side-Effects
blogEventBus.on('blog:published', async ({ blog, userId }) => {
  try {
    const authorId = blog?.author?._id || blog?.author || blog?.originalAuthor?._id || blog?.originalAuthor;

    const tasks = [
      AuditLog.create({
        user: userId,
        action: 'PUBLISH_BLOG',
        targetId: blog._id,
        details: `Published article: "${blog.title}"`,
      }),
      emailEditorsAboutPublication(blog, userId),
      notifyUsersByRole([ROLES.EDITOR, ROLES.ADMIN], {
        type: 'STORY_PUBLISHED',
        message: `"${blog.title}" was published.`,
        article: blog._id,
        sender: userId,
      }),
    ];

    if (authorId) {
      tasks.push(
        Notification.create({
          recipient: authorId,
          sender: userId,
          message: `Your story "${blog.title}" is live on the website!`,
          type: 'STORY_PUBLISHED',
          article: blog._id,
        })
      );
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error('Async Worker Error (Publish):', err.message || err);
  }
});

// Handle Post-Unpublish Background Side-Effects
blogEventBus.on('blog:unpublished', async ({ blog, userId }) => {
  try {
    const authorId = blog?.author?._id || blog?.author || blog?.originalAuthor?._id || blog?.originalAuthor;

    const tasks = [
      AuditLog.create({
        user: userId,
        action: 'UNPUBLISH_BLOG',
        targetId: blog._id,
        details: `Unpublished article: "${blog.title}"`,
      }),
    ];

    if (authorId) {
      tasks.push(
        Notification.create({
          recipient: authorId,
          sender: userId,
          message: `Your story "${blog.title}" was unpublished from the website.`,
          type: 'STORY_UNPUBLISHED',
          article: blog._id,
        })
      );
    }

    tasks.push(emailAuthorAboutUnpublishing(blog, userId));

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error('Async Worker Error (Unpublish):', err.message || err);
  }
});