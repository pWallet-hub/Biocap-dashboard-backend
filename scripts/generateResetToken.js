require('dotenv').config();
const jwt = require('jsonwebtoken');

const email = 'b.felix@afs-rwanda.org';

const resetToken = jwt.sign(
  { sub: email, purpose: 'password_reset' },
  process.env.JWT_SECRET,
  { expiresIn: '30m' }
);

console.log('Reset token:', resetToken);