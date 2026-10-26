const mongoose = require('mongoose');

// Hardcoded fallback used when MONGO_URI is not set in the environment.
const DEFAULT_MONGO_URI =
  'mongodb+srv://biocap-dashboard:biocap%402026@cluster0.nyqqirp.mongodb.net/biocap_db?retryWrites=true&w=majority&appName=Cluster0';

// Connects once and throws on failure. The caller (server.js) decides how to retry.
const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGO_URI || DEFAULT_MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`🟢 Biocap DB Connected: ${conn.connection.host}`);
};

module.exports = connectDB;
