const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const connectDB = require('./config/db');
const uploadRoutes = require('./routes/upload');
const galleryRoutes = require('./routes/gallery');

// Load environment variables
dotenv.config();

// Connect to Biocap Database
connectDB();

// Initialize background event bus listener for non-blocking side effects
require('./services/blogEventListener');

const app = express();

// --- Security & Core Middlewares ---

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
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body Parsers for Large Article Payloads (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// ─── SENIOR-GRADE OPENAPI 3.0 SPECIFICATION ────────────────────────────────────
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Biocap Dashboard API',
      version: '1.0.0',
      description:
        'Interactive, production-ready API documentation for the Biocap Blog & User Dashboard platform. Built with OpenAPI 3.0 standards for multi-role workflows (Admin, Communication Officer, Communication Editor, Content Creator).',
      contact: {
        name: 'BIOCAP Engineering Team',
        url: 'https://biocap-rwanda.afs-rwanda.org',
        email: 'dev@biocap-rwanda.org',
      },
    },
    // 🟢 1. STRICT TAG TAXONOMY: Pins Authentication on top
    tags: [
      {
        name: 'Authentication',
        description: 'Public registration, login, token refresh, and password recovery management',
      },
      {
        name: 'Communication Officer',
        description: 'Communication Officer review & management endpoints',
      },
      {
        name: 'Communication Editor',
        description: 'Editor workspace & article review endpoints',
      },
      {
        name: 'Content Creator',
        description: 'Contributor/Creator story submission endpoints',
      },
      {
        name: 'Blogs',
        description: 'Public and member blog operations',
      },
      {
        name: 'Gallery',
        description: 'Media management endpoints for HD video and image folder collections',
      },
      {
        name: 'Admin Management',
        description: 'Administrative user management & platform settings',
      },
      {
        name: 'Uploads',
        description: 'Media and Cloudinary file upload endpoints',
      },
    ],
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
      // 🟢 2. SECURITY SCHEMES: Standardized JWT Authentication
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token in the format: Bearer <your_token_here>',
        },
      },
      // 🟢 3. REUSABLE DATA SCHEMES (Rendered cleanly at the bottom of Swagger UI)
      schemas: {
        // --- User Domain ---
        User: {
          type: 'object',
          required: ['_id', 'username', 'email', 'firstName', 'lastName', 'role'],
          properties: {
            _id: { type: 'string', example: '66a12345bc67890123456789', description: 'MongoDB ObjectId' },
            username: { type: 'string', example: 'biocap_contributor' },
            email: { type: 'string', format: 'email', example: 'contributor@biocap-rwanda.org' },
            firstName: { type: 'string', example: 'Jean' },
            lastName: { type: 'string', example: 'Nkurunziza' },
            role: {
              type: 'string',
              enum: ['admin', 'communication_officer', 'editor', 'broadcast_content_creator', 'regular_user'],
              example: 'broadcast_content_creator',
            },
            organization: { type: 'string', example: 'Alliance for Science Rwanda (AfS-Rwanda)' },
            jobTitle: { type: 'string', example: 'Biotech Researcher' },
            organizationLink: { type: 'string', format: 'uri', example: 'https://afs-rwanda.org' },
            socialHandle: { type: 'string', example: 'Twitter: @jnkurunziza | LinkedIn: in/jnkurunziza' },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T09:30:00.000Z' },
          },
        },
        AuthTokenResponse: {
          type: 'object',
          required: ['accessToken', 'refreshToken', 'role', 'username', 'expiresIn'],
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: '8f921a9c33e2182b84234567890abcdef1234567' },
            role: { type: 'string', example: 'editor' },
            username: { type: 'string', example: 'editor_rwanda' },
            expiresIn: { type: 'string', example: '30m' },
          },
        },

        // --- Article / Blog Domain ---
        BlogBlock: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['p', 'h2', 'quote', 'image'], example: 'p' },
            text: { type: 'string', example: 'Enhancing cassava drought tolerance using CRISPR technology.' },
            caption: { type: 'string', example: 'Cassava crop trial fields in Huye District.' },
            fitMode: { type: 'string', enum: ['cover', 'contain'], example: 'cover' },
            src: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/biocap/image/upload/v1/cassava.jpg' },
            fileKey: { type: 'string', example: 'section-img-123.jpg' },
          },
        },
        BlogPost: {
          type: 'object',
          required: ['_id', 'title', 'slug', 'status', 'author'],
          properties: {
            _id: { type: 'string', example: '66b98765dc43210987654321' },
            title: { type: 'string', example: 'Advancements in Rwandan Crop Biotechnology 2026' },
            slug: { type: 'string', example: 'advancements-in-rwandan-crop-biotechnology-2026' },
            excerpt: { type: 'string', example: 'A summary of new agricultural stewardship policies in Rwanda.' },
            img: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/biocap/image/upload/v1/banner.jpg' },
            tag: { type: 'string', example: 'Agriculture' },
            status: { type: 'string', enum: ['draft', 'under_review', 'published', 'rejected'], example: 'published' },
            author: { $ref: '#/components/schemas/User' },
            originalAuthor: { $ref: '#/components/schemas/User' },
            blocks: {
              type: 'array',
              items: { $ref: '#/components/schemas/BlogBlock' },
            },
            organizationLink: { type: 'string', format: 'uri', example: 'https://biocap-rwanda.afs-rwanda.org' },
            socialHandle: { type: 'string', example: '@RwandaBioCap' },
            documentUrl: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/biocap/raw/upload/v1/report.pdf' },
            documentName: { type: 'string', example: 'Annual_Stewardship_Report_2026.pdf' },
            publishedAt: { type: 'string', format: 'date-time', example: '2026-02-10T14:00:00.000Z' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-02-01T10:00:00.000Z' },
          },
        },

        // --- Article Comments Domain ---
        ArticleComment: {
          type: 'object',
          required: ['_id', 'blog', 'content', 'email', 'name'],
          properties: {
            _id: { type: 'string', example: '66c111223344556677889900' },
            blog: { type: 'string', example: '66b98765dc43210987654321' },
            name: { type: 'string', example: 'Dr. Alice Mukamana' },
            email: { type: 'string', format: 'email', example: 'alice.m@rab.gov.rw' },
            content: { type: 'string', example: 'This is a well-researched publication on agricultural resilience.' },
            isVisible: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time', example: '2026-02-12T08:20:00.000Z' },
          },
        },

        // --- Gallery Domain ---
        GalleryItem: {
          type: 'object',
          required: ['_id', 'mediaType', 'title', 'category', 'caption'],
          properties: {
            _id: { type: 'string', example: '66d445566778899001122334' },
            mediaType: { type: 'string', enum: ['folder', 'video'], example: 'folder' },
            title: { type: 'string', example: 'RAB Rubona Cassava Field Trials' },
            category: { type: 'string', enum: ['events', 'team', 'activities'], example: 'activities' },
            caption: { type: 'string', example: 'Field evaluation of virus-resistant cassava strains in Huye.' },
            videoUrl: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/biocap/video/upload/v1/sample.mp4' },
            thumbnailUrl: { type: 'string', format: 'uri', example: 'https://res.cloudinary.com/biocap/image/upload/v1/thumb.jpg' },
            images: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', format: 'uri' },
                  publicId: { type: 'string' },
                },
              },
            },
            createdBy: { $ref: '#/components/schemas/User' },
            createdAt: { type: 'string', format: 'date-time', example: '2026-03-01T11:00:00.000Z' },
          },
        },

        // --- Media & Cloudinary Domain ---
        CloudinarySignatureResponse: {
          type: 'object',
          required: ['signature', 'timestamp', 'apiKey', 'cloudName'],
          properties: {
            signature: {
              type: 'string',
              example: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
              description: 'Cryptographic SHA-1 signature',
            },
            timestamp: {
              type: 'number',
              example: 1770728000,
              description: 'UNIX timestamp used for signature generation',
            },
            apiKey: {
              type: 'string',
              example: '123456789012345',
              description: 'Cloudinary public API key',
            },
            cloudName: {
              type: 'string',
              example: 'biocap-rwanda',
              description: 'Cloudinary cloud environment name',
            },
          },
        },
        DirectUploadResponse: {
          type: 'object',
          required: ['url', 'public_id'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://res.cloudinary.com/biocap/image/upload/v12345/sample.jpg',
              description: 'Cloudinary CDN image URL',
            },
            public_id: {
              type: 'string',
              example: 'blog_images/sample_123',
              description: 'Public asset identifier in Cloudinary',
            },
          },
        },

        // --- Error Domain ---
        ErrorResponse: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              example: 'Invalid input parameters or authorization failed.',
            },
          },
        },
      },
      // 🟢 4. REUSABLE API RESPONSES
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing, expired, or invalid',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        ForbiddenError: {
          description: 'Insufficient role permissions for requested action',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotFoundError: {
          description: 'Requested resource could not be found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    },
  },
  // 🟢 5. SINGLE ROUTE PATTERN MATCHING (Prevents duplicate endpoint scanning)
  apis: ['./routes/*.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

// Endpoint to inspect generated raw Swagger JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerDocs);
});

// 🟢 6. SWAGGER UI DISPLAY OPTIONS
const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    filter: true, // Enables live endpoint search bar
    persistAuthorization: true, // Remembers Bearer JWT tokens across page reloads
    docExpansion: 'list', // Renders clean, shortened bar view
  },
};

// --- API Documentation Route ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, swaggerUiOptions));

// --- Route Declarations & Role-Based Mount Aliases ---
app.use('/api/upload', uploadRoutes);

// Mount standalone signature route for direct browser uploads to Cloudinary
app.use('/api/upload/signature', require('./routes/signature'));

// Main blog routes module
const blogRouter = require('./routes/blog');

// Primary App Mount Points
app.use('/api/auth', require('./routes/auth'));
app.use('/api/blogs', blogRouter);
app.use('/api/gallery', galleryRoutes);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/officer', require('./routes/officer'));

// ALIAS MOUNTS: Prevents 404s when Editor or Contributors hit role-prefixed URLs
// Editor proposals must be mounted before the blog alias so they never reach the live-update handler
app.use('/api/editor/blogs', require('./routes/editor').proposalRouter);
app.use('/api/editor/blogs', blogRouter);
app.use('/api/editor', require('./routes/editor'));

app.use('/api/contributor/blogs', blogRouter);
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