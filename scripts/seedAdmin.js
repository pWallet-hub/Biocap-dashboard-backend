// scripts/seedAdmin.js
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

  await mongoose.connect(mongoUri);
  console.log('🔌 Connected to database...');

  const email = 'b.felix@afs-rwanda.org';
  const tempPassword = 'ChangeMe123!'; 
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(tempPassword, salt);

  let admin = await User.findOne({ email });

  if (admin) {
    console.log('⚠️ Admin already exists:', admin.username);
    
    // Ensure existing user has isActive, isApproved, correct role, and reset password
    admin.isActive = true;
    if ('isApproved' in admin) admin.isApproved = true;
    admin.role = 'admin';
    admin.password = hashedPassword;
    admin.isPasswordResetRequired = true;
    
    await admin.save();
    console.log('🔧 Updated existing admin profile & reset password to default temp password.');
  } else {
    admin = await User.create({
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
      isPasswordResetRequired: false,
      isActive: true,
      isApproved: true,
    });

    console.log('🎉 Seed admin created successfully!');
  }

  // ─── GENERATE COMPLETE TOKEN PAYLOAD ───────────────────────────────
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
  console.log('🔑 YOUR AUTHENTICATION DETAILS');
  console.log('================================================================');
  console.log(`👤 Username:       ${admin.username}`);
  console.log(`📧 Email:          ${admin.email}`);
  console.log(`🔓 Password:       ChangeMe123!`);
  console.log(`🛡️  Role:           ${admin.role}`);
  console.log('\n📋 COPY YOUR NEW ENRICHED JWT BEARER TOKEN BELOW:');
  console.log(`\n${token}\n`);
  console.log('================================================================\n');

  await mongoose.connection.close();
  process.exit(0);
}

seedAdmin().catch(async (err) => {
  console.error('❌ Error seeding and generating token:', err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  process.exit(1);
});