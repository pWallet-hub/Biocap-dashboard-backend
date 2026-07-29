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
app.use(helmet());
app.use(morgan('dev'));
app.use(cors());

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
        url: `http://localhost:${process.env.PORT || 5000}`,
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