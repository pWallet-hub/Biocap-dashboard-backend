require('dotenv').config();
require('dotenv').config({ path: '.env.local' }); // Fallback to Next.js env file
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const User = require('../models/User');

async function seedAdmin() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in environment variables');
  }

  const jwtSecret = process.env.JWT_SECRET || 'fallback_secret_key_for_dev_only';

  console.log('🔌 Connecting to database...');
  await mongoose.connect(mongoUri);

  const email = 'b.felix@afs-rwanda.org';
  const rawPassword = 'ChangeMe123!'; 
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(rawPassword, salt);

  // ─── UPSERT ADMIN USER ───────────────────────────────────────────────
  // Upsert ensures clean updates with NO password expiry or block flags
  const adminData = {
    username: 'felix.rugangazi',
    email,
    password: hashedPassword,
    role: 'admin',
    firstName: 'Felix',
    lastName: 'Rugangazi',
    organization: 'afs-rwanda',
    organizationLink: 'https://afs-rwanda.org',
    socialHandle: '@felix_rugangazi',
    dateOfBirth: '1995-05-15',
    isPasswordResetRequired: false, // 👈 Fixes 403 Forbidden on login
    isActive: true,                 // 👈 Fixes 403 account disabled check
    isApproved: true,               // 👈 Fixes 403 approval pending check
  };

  const admin = await User.findOneAndUpdate(
    { email },
    { $set: adminData },
    { new: true, upsert: true, runValidators: false }
  );

  console.log('🎉 Admin user successfully created/updated in MongoDB!');

  // ─── GENERATE AUTHENTICATION JWT ─────────────────────────────────────
  const payload = {
    id: admin._id.toString(),
    _id: admin._id.toString(),
    username: admin.username,
    role: admin.role,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
  };

  const token = jwt.sign(payload, jwtSecret, {
    expiresIn: '30d', 
  });

  console.log('\n================================================================');
  console.log('🔑 YOUR ADMIN LOGIN CREDENTIALS');
  console.log('================================================================');
  console.log(`👤 Username:       ${admin.username}`);
  console.log(`📧 Email:          ${admin.email}`);
  console.log(`🔓 Password:       ${rawPassword}`);
  console.log(`🛡️  Role:           ${admin.role}`);
  console.log(`⚡ Password Reset: Disabled (Ready for instant login)`);
  console.log('\n📋 BEARER TOKEN FOR API TESTING:');
  console.log(`\n${token}\n`);
  console.log('================================================================\n');

  await mongoose.connection.close();
  process.exit(0);
}

seedAdmin().catch(async (err) => {
  console.error('❌ Error seeding admin user:', err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(1);
});