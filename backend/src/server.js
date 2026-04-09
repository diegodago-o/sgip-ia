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
const indicatorsRoutes = require('./routes/indicators');
const correspondenceRoutes = require('./routes/correspondence');
const emailInboxRoutes     = require('./routes/emailInbox');
const settingsRoutes       = require('./routes/settings');
const apiKeysRoutes        = require('./routes/apiKeys');
const notificationsRoutes  = require('./routes/notifications');
const { signaturesRouter, firmaRouter } = require('./routes/signatures');
const { corrSigRouter, corrSigPublicRouter } = require('./routes/corrSignatures');
const { freeSignAuthRouter, freeSignPublicRouter } = require('./routes/freeSignatures');
const oauthRoutes          = require('./routes/oauth');
const sharepointRoutes     = require('./routes/sharepoint');
const sharepointConnRoutes = require('./routes/sharepoint-connections');
const { startScheduler }   = require('./jobs/notificationScheduler');
const { runEmailPolling }  = require('./services/emailPoller');

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
// RUTA PÚBLICA — adjunto inline para Office Online Viewer
// Registrada ANTES de cualquier router autenticado para que
// los servidores de Microsoft puedan descargar el archivo sin JWT.
// ══════════════════════════════════════════════
{
  const _pool = require('./config/database');
  const _fs   = require('fs');
  const _path = require('path');
  const MIME_MAP = { '.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc':'application/msword', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls':'application/vnd.ms-excel', '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt':'application/vnd.ms-powerpoint', '.odt':'application/vnd.oasis.opendocument.text', '.ods':'application/vnd.oasis.opendocument.spreadsheet', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml', '.csv':'text/csv' };
  app.get('/api/exec/:projectId/correspondence/:corrId/attachments/:attId/view', async (req, res) => {
    try {
      const [[att]] = await _pool.execute(
        'SELECT * FROM correspondence_attachments WHERE id = ? AND correspondence_id = ?',
        [req.params.attId, req.params.corrId]
      );
      if (!att) return res.status(404).send('Adjunto no encontrado');
      const absPath = _path.join(__dirname, '..', 'uploads', ...att.file_path.replace(/^uploads[\\/]/, '').split(/[\\/]/));
      if (!_fs.existsSync(absPath)) return res.status(404).send('Archivo no encontrado en disco');
      const ext  = _path.extname(att.original_name || '').toLowerCase();
      const mime = att.mime_type || MIME_MAP[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('Access-Control-Allow-Origin', '*');
      _fs.createReadStream(absPath).pipe(res);
    } catch (err) {
      console.error('[view-attachment]', err.message);
      res.status(500).send('Error interno');
    }
  });
}

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
app.use('/api/exec', emailInboxRoutes);
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
app.use('/api/indicators', indicatorsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/settings/api-keys', apiKeysRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/exec/:projectId/minutes/:minuteId/firma', signaturesRouter);
app.use('/api/firma', firmaRouter);
app.use('/api/exec/:projectId/correspondence/:correspondenceId/firma', corrSigRouter);
app.use('/api/firma/corr', corrSigPublicRouter);
app.use('/api/exec/:projectId/firma-libre', freeSignAuthRouter);
app.use('/api/firma/libre', freeSignPublicRouter);
app.use('/api/sharepoint', sharepointRoutes);
app.use('/api/sharepoint-connections', sharepointConnRoutes);

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
// AUTO-MIGRATIONS (run at startup, safe to re-run)
// ══════════════════════════════════════════════
const pool = require('./config/database');

async function runMigrations() {
  const run = async (label, sql) => {
    try {
      await pool.execute(sql);
      console.log(`[migrate] ✓ ${label}`);
    } catch (e) {
      // Duplicate column / already exists → silent skip
      if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_DUP_KEYNAME' ||
          (e.message && (e.message.includes('Duplicate column') || e.message.includes('Duplicate key')))) {
        console.log(`[migrate] ~ ${label} (ya existe)`);
      } else {
        console.warn(`[migrate] ⚠ ${label}:`, e.message);
      }
    }
  };

  // OAuth SSO columns (added for SSO feature)
  await run('users.password_hash nullable',
    'ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL');
  await run('users.oauth_provider',
    'ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(20) NULL DEFAULT NULL AFTER password_hash');
  await run('users.oauth_provider_id',
    'ALTER TABLE users ADD COLUMN oauth_provider_id VARCHAR(255) NULL DEFAULT NULL AFTER oauth_provider');
  await run('users.avatar_url',
    'ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL DEFAULT NULL');
  await run('users uq_oauth index',
    'ALTER TABLE users ADD UNIQUE KEY uq_oauth (oauth_provider, oauth_provider_id)');

  // ── Firma libre tables ───────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS free_signature_requests (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      project_id   INT NOT NULL,
      title        VARCHAR(255) NOT NULL,
      file_name    VARCHAR(255) NOT NULL,
      file_data    LONGBLOB NOT NULL,
      file_hash    VARCHAR(64),
      status       ENUM('in_progress','completed','rejected','cancelled') DEFAULT 'in_progress',
      created_by   INT NOT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS free_signature_signers (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      request_id       INT NOT NULL,
      signer_name      VARCHAR(255) NOT NULL,
      signer_email     VARCHAR(255) NOT NULL,
      signer_role      VARCHAR(100),
      sign_order       INT DEFAULT 1,
      token            VARCHAR(64) UNIQUE NOT NULL,
      status           ENUM('pending','notified','viewed','signed','rejected') DEFAULT 'pending',
      page_num         INT DEFAULT 1,
      x_percent        DECIMAL(8,6),
      y_percent        DECIMAL(8,6),
      width_percent    DECIMAL(8,6),
      height_percent   DECIMAL(8,6),
      signature_image  LONGTEXT,
      signed_at        TIMESTAMP NULL,
      ip_address       VARCHAR(45),
      user_agent       VARCHAR(500),
      rejection_reason TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── SharePoint connections table ─────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sharepoint_connections (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      name           VARCHAR(100)  NOT NULL,
      tenant_id      VARCHAR(200)  NOT NULL,
      client_id      VARCHAR(200)  NOT NULL,
      client_secret  VARCHAR(500)  NOT NULL,
      site_url       VARCHAR(500)  NOT NULL,
      description    VARCHAR(500)  NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── SharePoint integration columns ──────────────────────────────
  await run('projects.sharepoint_folder',
    'ALTER TABLE projects ADD COLUMN sharepoint_folder VARCHAR(500) NULL');
  await run('projects.sharepoint_site_url',
    'ALTER TABLE projects ADD COLUMN sharepoint_site_url VARCHAR(500) NULL');
  await run('projects.sharepoint_connection_id',
    'ALTER TABLE projects ADD COLUMN sharepoint_connection_id INT NULL DEFAULT NULL');
  await run('projects.sharepoint_drive_id',
    'ALTER TABLE projects ADD COLUMN sharepoint_drive_id VARCHAR(200) NULL DEFAULT NULL');
  await run('policies.sp_item_id',
    'ALTER TABLE policies ADD COLUMN sp_item_id VARCHAR(200) NULL');
  await run('policies.sp_file_url',
    'ALTER TABLE policies ADD COLUMN sp_file_url VARCHAR(500) NULL');
  await run('deliverables.sp_item_id',
    'ALTER TABLE deliverables ADD COLUMN sp_item_id VARCHAR(200) NULL');
  await run('deliverables.sp_file_url',
    'ALTER TABLE deliverables ADD COLUMN sp_file_url VARCHAR(500) NULL');
  await run('meeting_minutes.sp_item_id',
    'ALTER TABLE meeting_minutes ADD COLUMN sp_item_id VARCHAR(200) NULL');
  await run('meeting_minutes.sp_file_url',
    'ALTER TABLE meeting_minutes ADD COLUMN sp_file_url VARCHAR(500) NULL');
  await run('correspondence.sender_entity',
    'ALTER TABLE correspondence ADD COLUMN sender_entity VARCHAR(255) NULL DEFAULT NULL AFTER sender_title');

  // ── Correspondencia personalizable por proyecto ──────────────────
  await run('projects.correspondence_sender_name',
    'ALTER TABLE projects ADD COLUMN correspondence_sender_name VARCHAR(255) NULL DEFAULT NULL');
  await run('projects.correspondence_logo',
    'ALTER TABLE projects ADD COLUMN correspondence_logo MEDIUMTEXT NULL DEFAULT NULL');

  // ── Correspondencia v2: Entrada/Salida ──────────────────────────────
  await run('correspondence.direction',
    "ALTER TABLE correspondence ADD COLUMN direction ENUM('salida','entrada') NOT NULL DEFAULT 'salida' AFTER project_id");
  await run('correspondence.consecutive_num',
    'ALTER TABLE correspondence ADD COLUMN consecutive_num INT NULL AFTER direction');
  await run('correspondence.consecutive_code',
    'ALTER TABLE correspondence ADD COLUMN consecutive_code VARCHAR(60) NULL AFTER consecutive_num');
  await run('correspondence.radicado_entrada',
    'ALTER TABLE correspondence ADD COLUMN radicado_entrada VARCHAR(100) NULL');
  await run('correspondence.sender_entity_external',
    'ALTER TABLE correspondence ADD COLUMN sender_entity_external VARCHAR(255) NULL');
  await run('correspondence.sender_name_external',
    'ALTER TABLE correspondence ADD COLUMN sender_name_external VARCHAR(255) NULL');
  await run('correspondence.received_date',
    'ALTER TABLE correspondence ADD COLUMN received_date DATE NULL');
  await run('correspondence.attachment_path',
    'ALTER TABLE correspondence ADD COLUMN attachment_path VARCHAR(500) NULL');
  await run('correspondence.attachment_original_name',
    'ALTER TABLE correspondence ADD COLUMN attachment_original_name VARCHAR(255) NULL');
  await run('correspondence.assigned_to',
    'ALTER TABLE correspondence ADD COLUMN assigned_to INT NULL');
  await run('correspondence.parent_id',
    'ALTER TABLE correspondence ADD COLUMN parent_id INT NULL');
  try { await pool.execute('ALTER TABLE correspondence ADD CONSTRAINT fk_corr_parent FOREIGN KEY (parent_id) REFERENCES correspondence(id) ON DELETE SET NULL'); } catch (_) {}
  try { await pool.execute('ALTER TABLE correspondence ADD CONSTRAINT fk_corr_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL'); } catch (_) {}

  // ── Adjuntos múltiples de correspondencia ────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS correspondence_attachments (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      correspondence_id INT NOT NULL,
      file_path         VARCHAR(500) NOT NULL,
      original_name     VARCHAR(255) NOT NULL,
      file_size         INT NULL,
      mime_type         VARCHAR(100) NULL,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (correspondence_id) REFERENCES correspondence(id) ON DELETE CASCADE,
      INDEX idx_corr_att (correspondence_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Email inbox por proyecto ─────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS project_email_inbox (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      project_id          INT NOT NULL UNIQUE,
      provider            ENUM('imap','gmail','m365_basic','m365_modern') NOT NULL DEFAULT 'imap',
      email               VARCHAR(255) NOT NULL,
      imap_host           VARCHAR(255) NULL,
      imap_port           INT NULL DEFAULT 993,
      imap_use_ssl        TINYINT(1) DEFAULT 1,
      imap_folder         VARCHAR(100) DEFAULT 'INBOX',
      username            VARCHAR(255) NULL,
      password_enc        TEXT NULL,
      tenant_id           VARCHAR(200) NULL,
      client_id           VARCHAR(200) NULL,
      client_secret_enc   TEXT NULL,
      poll_interval_min   INT DEFAULT 15,
      enabled             TINYINT(1) DEFAULT 0,
      last_polled_at      DATETIME NULL,
      last_uid            BIGINT DEFAULT 0,
      graph_delta_link    TEXT NULL,
      emails_imported     INT DEFAULT 0,
      last_error          TEXT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS email_inbox_processed (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      project_id    INT NOT NULL,
      message_id    VARCHAR(220) NOT NULL,
      processed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_project_msg (project_id, message_id),
      INDEX idx_proc_project (project_id),
      INDEX idx_proc_date (processed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Expandir ENUM status para nuevos estados de entrada ──────────────────────
  await run('correspondence.status_enum_v2',
    `ALTER TABLE correspondence MODIFY COLUMN status ENUM('borrador','radicado','enviado','recibido','asignado','en_revision','soporte_solicitado','respondido','cerrado','archivado','en_atencion') NOT NULL DEFAULT 'recibido'`);

  // ── Tabla trazabilidad correspondencia ────────────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS correspondence_timeline (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      correspondence_id   INT NOT NULL,
      from_status         VARCHAR(30) NULL,
      to_status           VARCHAR(30) NOT NULL,
      notes               TEXT NULL,
      assigned_to_user_id INT NULL,
      created_by          INT NOT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (correspondence_id) REFERENCES correspondence(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_timeline_corr (correspondence_id),
      INDEX idx_timeline_date (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Backfill timeline: registrar evento inicial para entradas sin timeline ────
  try {
    await pool.execute(`
      INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, created_by, created_at)
      SELECT c.id, NULL, c.status, c.created_by, c.created_at
      FROM correspondence c
      WHERE c.direction = 'entrada'
        AND NOT EXISTS (SELECT 1 FROM correspondence_timeline t WHERE t.correspondence_id = c.id LIMIT 1)
    `);
  } catch (_) {}

  // ── Backfill: marcar como 'respondido' entradas que ya tienen replies ─────────
  try {
    await pool.execute(`
      UPDATE correspondence c
      SET status = 'respondido'
      WHERE direction = 'entrada'
        AND status NOT IN ('archivado')
        AND EXISTS (
          SELECT 1 FROM correspondence ch WHERE ch.parent_id = c.id LIMIT 1
        )
    `);
  } catch (_) {}

  // ── Plazos de respuesta por tipo documental ───────────────────────────────────
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS correspondence_type_deadlines (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      correspondence_type VARCHAR(50) NOT NULL UNIQUE,
      business_days       INT NOT NULL DEFAULT 5,
      description         VARCHAR(200) NULL,
      updated_by          INT NULL,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Agregar columna label si no existe
  await run('correspondence_type_deadlines.label_col',
    `ALTER TABLE correspondence_type_deadlines ADD COLUMN label VARCHAR(100) NULL AFTER correspondence_type`);

  // Seed valores por defecto si la tabla está vacía
  try {
    const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM correspondence_type_deadlines');
    if (cnt === 0) {
      await pool.execute(`
        INSERT INTO correspondence_type_deadlines (correspondence_type, label, business_days, description) VALUES
        ('oficio',           'Oficio',             5,  NULL),
        ('circular',         'Circular',           5,  NULL),
        ('memorando',        'Memorando',          5,  NULL),
        ('comunicado',       'Comunicado',         5,  NULL),
        ('carta',            'Carta',              5,  NULL),
        ('radicado',         'Radicado',           5,  NULL),
        ('derecho_peticion', 'Derecho de Petición',15, 'Ley 1755 de 2015 — 15 días hábiles')
      `);
    } else {
      // Backfill labels para registros existentes sin label
      const defaults = { oficio:'Oficio', circular:'Circular', memorando:'Memorando', comunicado:'Comunicado', carta:'Carta', radicado:'Radicado', derecho_peticion:'Derecho de Petición' };
      for (const [type, label] of Object.entries(defaults)) {
        await pool.execute(`UPDATE correspondence_type_deadlines SET label = ? WHERE correspondence_type = ? AND (label IS NULL OR label = '')`, [label, type]).catch(() => {});
      }
    }
  } catch (_) {}

  // ── Columna fecha_limite en correspondence ────────────────────────────────────
  await run('correspondence.fecha_limite_col',
    `ALTER TABLE correspondence ADD COLUMN fecha_limite DATE NULL`);

  // ── Correo del remitente ──────────────────────────────────────────────────────
  await run('correspondence.sender_email_col',
    `ALTER TABLE correspondence ADD COLUMN sender_email VARCHAR(200) NULL`);
}

runMigrations().catch(e => console.error('[migrate] Fatal:', e.message));

// ══════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════
// Start notification scheduler
startScheduler();

// ── Email inbox polling — revisa cada 1 min si hay bandejas vencidas ──
setTimeout(async () => {
  console.log('[emailPoller] Primera revisión de bandejas...');
  await runEmailPolling().catch(e => console.error('[emailPoller]', e.message));
}, 45_000); // 45s después del arranque

setInterval(async () => {
  await runEmailPolling().catch(e => console.error('[emailPoller]', e.message));
}, 60 * 1000); // cada 1 minuto (la frecuencia real la controla poll_interval_min por inbox)

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
