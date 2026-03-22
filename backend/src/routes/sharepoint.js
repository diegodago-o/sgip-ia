/**
 * /api/sharepoint — SharePoint Online per-project file operations
 *
 * GET  /api/sharepoint/test                          → test global connection (admin)
 * GET  /api/sharepoint/projects/:id/files            → list root folder/library
 * POST /api/sharepoint/projects/:id/upload           → upload file (multipart/form-data)
 * GET  /api/sharepoint/projects/:id/download/:itemId → returns { url } for download
 * GET  /api/sharepoint/projects/:id/preview/:itemId  → embed/web preview URL
 *
 * Connection resolution (per project, in order):
 *  1. project.sharepoint_connection_id → load from sharepoint_connections table
 *  2. project.sharepoint_site_url → env credentials + per-project site URL
 *  3. fallback → all SP_* env variables
 */

const express  = require('express');
const multer   = require('multer');
const { param, validationResult } = require('express-validator');
const pool     = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const sp       = require('../services/sharepoint');

const router       = express.Router();
const requireAdmin = roleMiddleware('admin', 'director_pmo');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

/** Load project — returns all SP-related fields. */
async function getProject(req, res) {
  const [rows] = await pool.execute(
    `SELECT id, name, sharepoint_folder, sharepoint_site_url,
            sharepoint_connection_id, sharepoint_drive_id
     FROM projects WHERE id = ?`,
    [req.params.id]
  );
  if (!rows.length) { res.status(404).json({ error: 'Proyecto no encontrado' }); return null; }
  return rows[0];
}

/**
 * Resolve the connection object for a project.
 * Priority: DB connection → env + per-project site URL → env fallback.
 */
async function getProjectConn(project) {
  if (project.sharepoint_connection_id) {
    const [rows] = await pool.execute(
      'SELECT * FROM sharepoint_connections WHERE id = ?',
      [project.sharepoint_connection_id]
    );
    if (!rows.length) throw new Error('La conexión SharePoint asignada a este proyecto no fue encontrada.');
    return rows[0];
  }
  // Fallback: env credentials
  return sp.connFromEnv(project.sharepoint_site_url || null);
}

/** Returns true if this project has some form of SP configured. */
function isProjectConfigured(project) {
  return !!(project.sharepoint_connection_id || project.sharepoint_folder);
}

// ─────────────────────────────────────────────
// Auth on all routes
// ─────────────────────────────────────────────
router.use(authMiddleware);

// ─────────────────────────────────────────────
// GET /api/sharepoint/test — test global env-based connection
// ─────────────────────────────────────────────
router.get('/test', requireAdmin, async (req, res) => {
  try {
    if (!sp.isConfigured()) {
      return res.status(503).json({
        error: 'SharePoint no configurado. Agrega SP_TENANT_ID, SP_CLIENT_ID y SP_CLIENT_SECRET en el .env del servidor, o crea conexiones en Configuración → SharePoint.',
      });
    }
    const conn   = sp.connFromEnv();
    const result = await sp.testConnection(conn);
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    res.status(status).json({ error: `Error conectando con SharePoint: ${msg}` });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/files
// ─────────────────────────────────────────────
router.get('/projects/:id/files', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    if (!isProjectConfigured(project)) {
      return res.status(400).json({ error: 'Este proyecto no tiene SharePoint configurado.' });
    }

    const conn     = await getProjectConn(project);
    const driveId  = project.sharepoint_drive_id || null;
    const subpath  = req.query.subpath || '';
    const baseFolder = project.sharepoint_folder || '';
    const folderPath = subpath
      ? `${baseFolder.replace(/\/+$/, '')}/${subpath}`.replace(/^\/+/, '')
      : baseFolder;

    const items = await sp.listFolder(conn, folderPath, driveId);
    res.json({ data: items, folderPath });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    console.error('[sharepoint] listFolder error:', msg);
    res.status(status).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// POST /api/sharepoint/projects/:id/upload
// ─────────────────────────────────────────────
router.post('/projects/:id/upload', [param('id').isInt()], upload.single('file'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const project = await getProject(req, res);
    if (!project) return;
    if (!isProjectConfigured(project)) {
      return res.status(400).json({ error: 'Este proyecto no tiene SharePoint configurado.' });
    }

    const conn       = await getProjectConn(project);
    const driveId    = project.sharepoint_drive_id || null;
    const baseFolder = project.sharepoint_folder || '';
    const destSub    = req.body.destFolder ? req.body.destFolder.replace(/^\/+/, '') : '';
    const folderPath = destSub
      ? `${baseFolder.replace(/\/+$/, '')}/${destSub}`.replace(/^\/+/, '')
      : baseFolder;

    const result = await sp.uploadFile(
      conn,
      folderPath,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype,
      driveId
    );
    res.status(201).json({ data: result });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    console.error('[sharepoint] upload error:', msg);
    res.status(status).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/download/:itemId
// Returns { url } — frontend opens in new tab
// ─────────────────────────────────────────────
router.get('/projects/:id/download/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    const conn    = await getProjectConn(project);
    const driveId = project.sharepoint_drive_id || null;
    const url     = await sp.getDownloadUrl(conn, req.params.itemId, driveId);
    res.json({ url });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/preview/:itemId
// Returns { url, type } for iframe embed or web fallback
// ─────────────────────────────────────────────
router.get('/projects/:id/preview/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    const conn    = await getProjectConn(project);
    const driveId = project.sharepoint_drive_id || null;
    const result  = await sp.getPreviewUrl(conn, req.params.itemId, driveId);
    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
