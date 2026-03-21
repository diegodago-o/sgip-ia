process.env.TZ = 'America/Bogota'; // Must be set before ANY date operation
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const hpp = require('hpp');
const path = require('path');

// ── Route imports ──
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const documentRoutes = require('./routes/documents');
const obligationRoutes = require('./routes/obligations');
const policyRoutes = require('./routes/policies');
const budgetRoutes = require('./routes/budget');
const teamRoutes = require('./routes/team');
const milestonesRoutes = require('./routes/milestones');
const scheduleRoutes = require('./routes/schedule');
const progressRoutes = require('./routes/progress');
const paymentsRoutes = require('./routes/payments');
const minutesRoutes = require('./routes/minutes');
const changesRoutes = require('./routes/changes');
const risksRoutes = require('./routes/risks');
const closureRoutes = require('./routes/closure');
const liquidationRoutes = require('./routes/liquidation');
const lessonsRoutes = require('./routes/lessons');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');
const exportRoutes = require('./routes/exports');
const budgetTrackingRoutes = require('./routes/budgetTracking');
const aiPopulateRoutes = require('./routes/aiPopulate');
const committeeRoutes = require('./routes/committee');
const committeeCommitmentsRoutes = require('./routes/committeeCommitments');
const biDashboardRoutes = require('./routes/biDashboard');
const correspondenceRoutes = require('./routes/correspondence');
const settingsRoutes       = require('./routes/settings');
const apiKeysRoutes        = require('./routes/apiKeys');
const notificationsRoutes  = require('./routes/notifications');
const { signaturesRouter, firmaRouter } = require('./routes/signatures');
const { corrSigRouter, corrSigPublicRouter } = require('./routes/corrSignatures');
const oauthRoutes          = require('./routes/oauth');
const { startScheduler }   = require('./jobs/notificationScheduler');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;
const isDev = process.env.NODE_ENV !== 'production';

// ══════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ══════════════════════════════════════════════

// 1. Helmet — HTTP security headers (XSS, clickjacking, MIME sniff, etc)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow uploads to load
  contentSecurityPolicy: false, // Disable CSP for API (no HTML served)
}));

// 2. CORS — strict origin control
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',');
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (Postman, curl, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400, // Cache preflight for 24h
}));

// 3. Rate limiting — global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 500,               // 500 requests per window per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente de nuevo en 15 minutos.' },
  skip: (req) => isDev && req.ip === '127.0.0.1', // Skip in dev for localhost
});
app.use('/api/', globalLimiter);

// 4. Auth rate limiter — strict for login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // 20 login attempts per 15 min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intente en 15 minutos.' },
  skipSuccessfulRequests: true,
});

// 4b. AI route limiter — expensive LLM calls, limit per user (by JWT sub)
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,                 // 60 AI calls per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Límite de solicitudes al Motor IA alcanzado. Intente en una hora.' },
  keyGenerator: (req) => req.user?.id ? `ai_user_${req.user.id}` : req.ip,
  skip: (req) => isDev && req.ip === '127.0.0.1',
});

// 4c. Export limiter — PDF/Excel generation is CPU-intensive
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30,                 // 30 exports per 15 min per user
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Límite de exportaciones alcanzado. Intente en 15 minutos.' },
  keyGenerator: (req) => req.user?.id ? `export_user_${req.user.id}` : req.ip,
  skip: (req) => isDev && req.ip === '127.0.0.1',
});

// 5. Body parsers with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// 6. HPP — prevent HTTP parameter pollution
app.use(hpp());

// 7. Compression — gzip responses
app.use(compression());

// 8. Remove X-Powered-By (redundant with helmet, but explicit)
app.disable('x-powered-by');

// ══════════════════════════════════════════════
// SERVE UPLOADED FILES (with caching headers)
// ══════════════════════════════════════════════
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  maxAge: '1d',
  etag: true,
}));

// ══════════════════════════════════════════════
// REQUEST LOGGING
// ══════════════════════════════════════════════
app.use((req, _res, next) => {
  if (isDev) {
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${ts}] ${req.method} ${req.path}`);
  }
  next();
});

// ══════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════
app.use('/api/auth', oauthRoutes);         // SSO OAuth redirects (no rate limit — they're browser redirects)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/obligations', obligationRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/pm', milestonesRoutes);
app.use('/api/exec', scheduleRoutes);
app.use('/api/exec', progressRoutes);
app.use('/api/exec', paymentsRoutes);
app.use('/api/exec', minutesRoutes);
app.use('/api/exec', changesRoutes);
app.use('/api/exec', risksRoutes);
app.use('/api/exec', correspondenceRoutes);
app.use('/api/close', closureRoutes);
app.use('/api/close', liquidationRoutes);
app.use('/api/close', lessonsRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/exports', exportLimiter, exportRoutes);
app.use('/api/budget', budgetTrackingRoutes);
app.use('/api/ai-populate', aiLimiter, aiPopulateRoutes);
app.use('/api/committee', committeeRoutes);
app.use('/api/committee/:projectId/commitments', committeeCommitmentsRoutes);
app.use('/api/dashboard', biDashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/settings/api-keys', apiKeysRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/exec/:projectId/minutes/:minuteId/firma', signaturesRouter);
app.use('/api/firma', firmaRouter);
app.use('/api/exec/:projectId/correspondence/:correspondenceId/firma', corrSigRouter);
app.use('/api/firma/corr', corrSigPublicRouter);

// ══════════════════════════════════════════════
// HEALTH CHECK
// ══════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', service: 'SGIP-IA API', uptime: process.uptime() });
});

// ══════════════════════════════════════════════
// 404 HANDLER
// ══════════════════════════════════════════════
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ══════════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ══════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  // Don't leak error details in production
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  console.error('Unhandled error:', isDev ? err : err.message);
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Error interno del servidor',
  });
});

// ══════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════
// Start notification scheduler
startScheduler();

const server = app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║     SGIP-IA  ·  API Backend  v2.0            ║
  ║     http://localhost:${PORT}                    ║
  ║     Entorno: ${(process.env.NODE_ENV || 'development').padEnd(24)}║
  ║     Seguridad: helmet + rate-limit + hpp     ║
  ╚══════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => { process.exit(0); });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
