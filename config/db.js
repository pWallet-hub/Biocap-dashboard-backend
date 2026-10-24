const mongoose = require('mongoose');

// Connects once and throws on failure. The caller (server.js) decides how to retry.
const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`🟢 Biocap DB Connected: ${conn.connection.host}`);
};

module.exports = connectDB;
