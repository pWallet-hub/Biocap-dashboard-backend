// scripts/seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const User = require('../models/User');

async function seedAdmin() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🔌 Connected to database...');

  const email = 'b.felix@afs-rwanda.org';
  let admin = await User.findOne({ email });

  if (admin) {
    console.log('⚠️ Admin already exists:', admin.username);
    
    // Ensure existing user has isActive set to true and correct role fields
    if (!admin.isActive || admin.role !== 'admin') {
      admin.isActive = true;
      admin.role = 'admin';
      await admin.save();
      console.log('🔧 Updated existing admin profile flags to active status.');
    }
  } else {
    const tempPassword = 'ChangeMe123!'; 
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    admin = await User.create({
      username: 'felix.rugangazi',
      email,
      password: hashedPassword,
      role: 'admin',
      firstName: 'Felix',
      lastName: 'Rugangazi',
      organization: 'AFS-RWANDA',
      isPasswordResetRequired: true,
      isActive: true, 
    });

    console.log('🎉 Seed admin created successfully!');
  }

  // ─── GENERATE COMPLETE TOKEN PAYLOAD ───────────────────────────────
  const payload = {
    id: admin._id.toString(),
    username: admin.username,
    role: admin.role,
    email: admin.email
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '30d', 
  });

  console.log('\n================================================================');
  console.log('🔑 YOUR AUTHENTICATION DETAILS');
  console.log('================================================================');
  console.log(`👤 Username:      ${admin.username}`);
  console.log(`📧 Email:         ${admin.email}`);
  console.log(`🔓 Temp Password: ChangeMe123!`);
  console.log('\n📋 COPY YOUR NEW ENRICHED JWT BEARER TOKEN BELOW:');
  console.log(`\n${token}\n`);
  console.log('================================================================\n');

  await mongoose.connection.close();
  process.exit(0);
}

seedAdmin().catch(async (err) => {
  console.error('❌ Error seeding and generating token:', err);
  await mongoose.connection.close();
  process.exit(1);
});