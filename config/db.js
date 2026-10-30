const mongoose = require('mongoose');

// Connects once and throws on failure. The caller (server.js) decides how to retry.
// The connection string comes only from MONGO_URI. There is no built-in fallback, so credentials never live in the code.
const connectDB = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  const conn = await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`🟢 Biocap DB Connected: ${conn.connection.host}`);
};

module.exports = connectDB;
