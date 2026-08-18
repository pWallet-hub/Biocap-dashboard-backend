/**
 * Run with: node scripts/migrateExcerptToBlocks.js
 * This will migrate existing Blog.excerpt strings into Blog.excerptBlocks
 * by creating a single paragraph block containing the excerpt text when excerptBlocks is empty.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Blog = require('../models/Blog');

const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/biocap';

(async () => {
  try {
    await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');

    const cursor = Blog.find({ excerpt: { $exists: true, $ne: '' }, $or: [{ excerptBlocks: { $exists: false } }, { excerptBlocks: { $size: 0 } }] }).cursor();
    let count = 0;
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      const text = doc.excerpt;
      if (text && text.trim()) {
        doc.excerptBlocks = [{ type: 'p', text: text.trim() }];
        await doc.save();
        count++;
        console.log('Migrated blog', doc._id.toString());
      }
    }

    console.log('Migration complete. Total migrated:', count);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
