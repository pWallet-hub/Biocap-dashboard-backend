const slugifyLib = require('slugify');
const Blog = require('../models/Blog');

/**
 * Converts a blog title to a URL-safe slug.
 * Automatically appends a short suffix when a slug already exists in the DB.
 *
 * @param {string} title
 * @param {string|null} excludeId  – pass the existing blog _id when updating so
 *                                   the current blog's own slug isn't flagged as a collision.
 * @returns {Promise<string>}
 */
async function generateSlug(title, excludeId = null) {
  const base = slugifyLib(title, { lower: true, strict: true, trim: true });

  const query = { slug: base };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await Blog.findOne(query).lean();
  if (!existing) return base;

  // Collision — append a 5-char random hex suffix
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

module.exports = { generateSlug };
