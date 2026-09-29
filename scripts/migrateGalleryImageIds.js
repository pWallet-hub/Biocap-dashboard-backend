/**
 * migrateGalleryImageIds.js
 *
 * One-time backfill for Gallery documents created BEFORE the
 * caption / referenceId / isCover fields were added to the `images`
 * sub-schema (see models/Gallery.js).
 *
 * Mongoose re-validates an ENTIRE document on every .save()/update, so
 * any old folder-type Gallery item whose images are missing a
 * `referenceId` will fail to save until it's backfilled. This script
 * fixes that once, for every existing document, so nothing breaks the
 * next time an old item is edited.
 *
 * For each folder-type Gallery document:
 *   - Any image missing `referenceId` gets one generated.
 *   - Any image missing `caption` gets `caption: null` (already the
 *     schema default, but set explicitly for consistency in the DB).
 *   - If no image has `isCover: true`, the first image is marked as
 *     the cover.
 *   - If more than one image has `isCover: true` (shouldn't happen on
 *     old data, but just in case), only the first one is kept.
 *
 * Usage:
 *   node scripts/migrateGalleryImageIds.js
 *   node scripts/migrateGalleryImageIds.js --dry-run   (report only, no writes)
 *
 * Follows the same run-as-a-script pattern as
 * scripts/migrateExcerptToBlocks.js — adjust the DB connection lines
 * below if your other scripts connect differently (e.g. via a shared
 * config/db.js connect() helper) rather than mongoose.connect directly.
 */

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const Gallery = require('../models/Gallery');

const isDryRun = process.argv.includes('--dry-run');

const generateReferenceId = () => crypto.randomBytes(4).toString('hex'); // e.g. "a1b2c3d4"

async function migrate() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error('Missing MONGO_URI (or MONGODB_URI) in your .env file.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB.${isDryRun ? ' Running in --dry-run mode (no writes).' : ''}`);

  // Bypass Mongoose validation while reading, since these are exactly
  // the documents that currently WOULDN'T pass validation.
  const folderItems = await Gallery.find({ mediaType: 'folder' });

  console.log(`Found ${folderItems.length} folder-type gallery item(s) to check.`);

  let updatedCount = 0;
  let skippedCount = 0;
  let touchedImages = 0;

  for (const item of folderItems) {
    let needsSave = false;

    if (!Array.isArray(item.images) || item.images.length === 0) {
      console.warn(`  ⚠ Skipping ${item._id} — mediaType is "folder" but has no images.`);
      skippedCount += 1;
      continue;
    }

    item.images.forEach((img) => {
      if (!img.referenceId) {
        img.referenceId = generateReferenceId();
        needsSave = true;
        touchedImages += 1;
      }
      if (img.caption === undefined) {
        img.caption = null;
        needsSave = true;
      }
    });

    const coverCount = item.images.filter((img) => img.isCover).length;
    if (coverCount === 0) {
      item.images[0].isCover = true;
      needsSave = true;
    } else if (coverCount > 1) {
      let firstFound = false;
      item.images.forEach((img) => {
        if (img.isCover) {
          if (firstFound) img.isCover = false;
          firstFound = true;
        }
      });
      needsSave = true;
    }

    if (needsSave) {
      console.log(`  → ${item._id} ("${item.title}") needs backfilling.`);
      if (!isDryRun) {
        await item.save();
      }
      updatedCount += 1;
    }
  }

  console.log('\nMigration summary:');
  console.log(`  Documents updated: ${updatedCount}`);
  console.log(`  Documents skipped (no images): ${skippedCount}`);
  console.log(`  Images given a new referenceId: ${touchedImages}`);
  if (isDryRun) {
    console.log('  (dry run — no changes were actually written)');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});