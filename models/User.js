const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ['admin', 'communication_officer', 'broadcast_media', 'social_media_influencer'],
      required: true,
      default: 'social_media_influencer',
    },

    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    dateOfBirth: { type: Date },

    // For broadcast_media: their organization name + the link shown on published posts
    organization: { type: String },
    organizationLink: { type: String, trim: true },

    // For social_media_influencer: their default handle, pre-filled on new posts
    socialHandle: { type: String, trim: true },

    // Every account is created by an admin — track who created it
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Admin can deactivate an account without deleting it
    isActive: { type: Boolean, default: true },

    // True until the user resets the auto-generated temporary password sent at registration
    isPasswordResetRequired: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Enforce role-specific required fields at the data layer, not just in routes
UserSchema.pre('validate', function () {
  if (this.role === 'broadcast_media' && !this.organizationLink) {
    throw new Error('organizationLink is required for broadcast_media accounts');
  }
});

module.exports = mongoose.model('User', UserSchema);