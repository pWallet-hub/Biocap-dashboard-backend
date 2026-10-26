// services/blogEventListener.js
const blogEventBus = require('../config/eventBus');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { ROLES } = require('../constants/roles');
const { sendStoryPublishedToEditorEmail } = require('../utils/sendEmail');

// Emails every active editor that the story is published. Failures are logged per editor, not thrown.
const emailEditorsAboutPublication = async (blog, userId) => {
  const [publisher, editors] = await Promise.all([
    User.findById(userId).select('firstName lastName username').lean(),
    User.find({ role: ROLES.EDITOR, isActive: true }).select('email firstName').lean(),
  ]);
  const publishedBy = [publisher?.firstName, publisher?.lastName].filter(Boolean).join(' ') || publisher?.username || 'Someone';
  const storyLink = `${process.env.FRONTEND_URL}/Stewardship-News/${blog.slug}`;

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
    ];

    if (authorId) {
      tasks.push(
        Notification.create({
          recipient: authorId,
          sender: userId,
          message: `Your story "${blog.title}" is live on the website!`,
          type: 'publish',
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
          type: 'unpublish',
          article: blog._id,
        })
      );
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error('Async Worker Error (Unpublish):', err.message || err);
  }
});