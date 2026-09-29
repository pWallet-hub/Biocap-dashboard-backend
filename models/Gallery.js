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
    // Website visibility. true  = visible on the public website gallery.
    //                     false = hidden (draft), still visible in the dashboard.
    // Defaults to true so newly uploaded items behave exactly as before.
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
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
          // OPTIONAL per-image caption the uploader typed for this photo.
          caption: {
            type: String,
            trim: true,
            maxlength: [300, 'Image caption cannot exceed 300 characters'],
            default: null,
          },
          // Stable per-image reference id, generated client-side on
          // selection (or server-side as a fallback below). Used to
          // build the "BioCap-<caption>-<referenceId>" download filename
          // and to address one specific image later (e.g. re-assigning
          // the cover, or a deep link).
          referenceId: {
            type: String,
            required: true,
          },
          // Exactly one image per folder collection should be the cover.
          isCover: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: undefined, // Prevents creating an empty array [] on video entries
      validate: [
        {
          validator: function (val) {
            const type = this.mediaType || (this.getUpdate && this.getUpdate().$set?.mediaType);
            if (type === 'folder') {
              return Array.isArray(val) && val.length > 0;
            }
            return true;
          },
          message: 'A folder collection must contain at least one image.',
        },
        {
          validator: function (val) {
            const type = this.mediaType || (this.getUpdate && this.getUpdate().$set?.mediaType);
            if (type === 'folder' && Array.isArray(val) && val.length > 0) {
              return val.filter((img) => img.isCover).length === 1;
            }
            return true;
          },
          message: 'A folder collection must have exactly one cover image.',
        },
      ],
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

// Safety net: if a folder collection is ever saved without exactly one
// isCover flag set (e.g. a caller forgot to pass coverIndex), fall back
// to marking the first image as the cover instead of failing the save.
gallerySchema.pre('validate', function () {
  if (this.mediaType === 'folder' && Array.isArray(this.images) && this.images.length > 0) {
    const coverCount = this.images.filter((img) => img.isCover).length;
    if (coverCount === 0) {
      this.images[0].isCover = true;
    } else if (coverCount > 1) {
      let firstFound = false;
      this.images.forEach((img) => {
        if (img.isCover) {
          if (firstFound) img.isCover = false;
          firstFound = true;
        }
      });
    }
  }
  // No `next` parameter/callback: this hook has arity 0, so Mongoose
  // treats it as a plain synchronous hook and proceeds automatically
  // once it returns. Declaring `function (next)` here previously caused
  // "next is not a function" depending on how Kareem inspected the
  // hook's arity for this Mongoose version.
});

// ─── INDEXES FOR ENTERPRISE PERFORMANCE ─────────────────────────────────────
// 1. Compound Index for filtered paginated queries
gallerySchema.index({ category: 1, mediaType: 1, createdAt: -1 });

// 2. Compound Index for the public website query (published only)
gallerySchema.index({ isPublished: 1, category: 1, mediaType: 1, createdAt: -1 });

// 3. Text Index for fast regex/full-text search across titles and captions
gallerySchema.index({ title: 'text', caption: 'text' });

module.exports = mongoose.model('Gallery', gallerySchema);