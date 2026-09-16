const mongoose = require('mongoose');

const gallerySchema = new mongoose.Schema(
  {
    mediaType: {
      type: String,
      enum: ['folder', 'video'],
      required: [true, 'Media type is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [120, 'Title cannot exceed 120 characters'],
    },
    category: {
      type: String,
      enum: ['events', 'team', 'activities'],
      required: [true, 'Category is required'],
      index: true,
    },
    caption: {
      type: String,
      required: [true, 'Caption/Description is required'],
      trim: true,
      maxlength: [1000, 'Caption cannot exceed 1000 characters'],
    },
    // Video Specific Fields
    videoUrl: {
      type: String,
      required: [
        function () {
          const type = this.mediaType || (this.getUpdate && this.getUpdate().$set?.mediaType);
          return type === 'video';
        },
        'Video URL is required for video media type',
      ],
    },
    thumbnailUrl: {
      type: String,
      required: [
        function () {
          const type = this.mediaType || (this.getUpdate && this.getUpdate().$set?.mediaType);
          return type === 'video';
        },
        'Thumbnail URL is required for video media type',
      ],
    },
    // Folder/Collection Specific Fields (Batch Upload Array)
    images: {
      type: [
        {
          url: { type: String, required: true },
          publicId: { type: String, required: true },
        },
      ],
      default: undefined, // Prevents creating an empty array [] on video entries
      validate: {
        validator: function (val) {
          const type = this.mediaType || (this.getUpdate && this.getUpdate().$set?.mediaType);
          if (type === 'folder') {
            return Array.isArray(val) && val.length > 0;
          }
          return true;
        },
        message: 'A folder collection must contain at least one image.',
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator reference is required'],
      index: true,
    },
  },
  { timestamps: true }
);

// ─── INDEXES FOR ENTERPRISE PERFORMANCE ─────────────────────────────────────
// 1. Compound Index for filtered paginated queries
gallerySchema.index({ category: 1, mediaType: 1, createdAt: -1 });

// 2. Text Index for fast regex/full-text search across titles and captions
gallerySchema.index({ title: 'text', caption: 'text' });

module.exports = mongoose.model('Gallery', gallerySchema);