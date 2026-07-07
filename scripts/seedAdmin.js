// scripts/seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  await mongoose.connect(process.env.MONGO_URI);

  const email = 'b.felix@afs-rwanda.org';
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('Admin already exists:', existing.username);
    return process.exit(0);
  }

  const tempPassword = 'ChangeMe123!'; // you'll reset this on first login
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(tempPassword, salt);

  const admin = await User.create({
    username: 'felix.rugangazi',
    email,
    password: hashedPassword,
    role: 'admin',
    firstName: 'Felix',
    lastName: 'Rugangazi',
    organization: 'AFS-RWANDA',
    isPasswordResetRequired: true,
  });

  console.log('Seed admin created:', admin.username);
  console.log('Temp password:', tempPassword);
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});