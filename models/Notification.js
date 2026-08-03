const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    // The user who receives the alert (e.g., Communication Officer or Editor)
    recipient: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    
    // The user who triggered the action (e.g., Editor or Commenter)
    sender: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    
    // Notification type to handle UI badge icons and routing
    type: {
      type: String,
      enum: ['ARTICLE_COMMENT', 'EDITOR_EDIT_PROMPT', 'BLOG_APPROVED'],
      required: true,
    },
    
    message: { 
      type: String, 
      required: true, 
      trim: true 
    },
    
    // Associated blog post
    article: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Blog', 
      required: true 
    },
    
    // Status tracking
    isRead: { 
      type: Boolean, 
      default: false 
    },
  },
  { timestamps: true }
);

// Indexes for fast lookup on user dashboards
NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);