const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const connectDB = require('./config/db');
const uploadRoutes = require('./routes/upload');

// Load environment variables
dotenv.config();

// Connect to Biocap Database
connectDB();

const app = express();

// Standard Middlewares
app.use(cors());
app.use(express.json()); // Parses incoming JSON payloads

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
        url: 'http://localhost:5000',
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
  // Tells swagger to read documentation comments from all files in the routes folder
  apis: ['./routes/*.js'], 
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

// --- API Documentation Route ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use('/api/upload', uploadRoutes);

// --- Route Declarations ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/blogs', require('./routes/blog'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/officer', require('./routes/officer'));

// Global error handler (must be after routes)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Baseline health check route
app.get('/', (req, res) => {
  res.send('Biocap API is functional. Visit <a href="/api-docs">/api-docs</a> for interactive Swagger documentation.');
});

// Start Server Listeners
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Biocap Server spinning on port ${PORT}`);
  console.log(`📑 Swagger Docs available at http://localhost:${PORT}/api-docs`);
});