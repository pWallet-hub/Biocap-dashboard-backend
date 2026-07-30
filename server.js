const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const connectDB = require('./config/db');
const uploadRoutes = require('./routes/upload');

// Load environment variables
dotenv.config();

// Connect to Biocap Database
connectDB();

const app = express();

// --- Security & Core Middlewares ---

// Configure Helmet to allow cross-origin requests & Swagger UI scripts
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(morgan('dev'));

// Configured CORS for production and development
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL, // e.g. https://your-app.vercel.app
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, or Postman)
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(null, true); // Fallback allow during initial setup
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body Parsers (Must run before query property patch and mongoSanitize)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express 5 Compatibility: Make req.query writable so express-mongo-sanitize doesn't throw getter error
app.use((req, res, next) => {
  if (req.query) {
    Object.defineProperty(req, 'query', {
      value: { ...req.query },
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  next();
});

// Sanitize inputs against MongoDB Operator Injection
app.use(mongoSanitize());

// --- Swagger Configuration Options ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Biocap Dashboard API',
      version: '1.0.0',
      description: 'API documentation for the Biocap Blog & User Dashboard platform',
    },
    servers: [
      {
        url: process.env.SERVER_URL || 'https://biocap-dashboard-backend.onrender.com',
        description: 'Production Server',
      },
      {
        url: `http://localhost:${process.env.PORT || 5000}`,
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token in the format: Bearer <your_token_here>',
        },
      },
    },
  },
  apis: ['./routes/*.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

// --- API Documentation Route ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// --- Route Declarations ---
app.use('/api/upload', uploadRoutes);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/blogs', require('./routes/blog'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/officer', require('./routes/officer'));
app.use('/api/editor', require('./routes/editor'));
app.use('/api/contributor', require('./routes/creator'));

// Baseline health check route
app.get('/', (req, res) => {
  res.send('Biocap API is functional. Visit <a href="/api-docs">/api-docs</a> for interactive Swagger documentation.');
});

// Global error handler (must be after all routes)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Start Server Listeners
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Biocap Server spinning on port ${PORT}`);
  console.log(`📑 Swagger Docs available at http://localhost:${PORT}/api-docs`);
});