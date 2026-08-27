// services/blogEventListener.js
const blogEventBus = require('../config/eventBus');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

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