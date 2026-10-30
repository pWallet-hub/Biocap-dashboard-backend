const mongoose = require('mongoose');

// One-time codes that hand a finished AFS sign-in from the API to the frontend. Only the hash is stored.
// Documents are removed automatically after they expire.
const SsoCodeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  usedAt: { type: Date, default: null },
});

module.exports = mongoose.model('SsoCode', SsoCodeSchema);
