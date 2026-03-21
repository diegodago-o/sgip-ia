/**
 * /api/sharepoint — SharePoint Online integration via Microsoft Graph API
 *
 * GET  /api/sharepoint/test                          → test connection (admin)
 * GET  /api/sharepoint/projects/:id/files            → list root folder
 * GET  /api/sharepoint/projects/:id/files/*          → list subfolder (?subpath=...)
 * POST /api/sharepoint/projects/:id/upload           → upload file (multipart/form-data)
 * GET  /api/sharepoint/projects/:id/download/:itemId → redirect to temp download URL
 * GET  /api/sharepoint/projects/:id/preview/:itemId  → embed/web preview URL
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { param, validationResult } = require('express-validator');
const pool     = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const sp       = require('../services/sharepoint');

const router      = express.Router();
const requireAdmin = roleMiddleware('admin', 'director_pmo');

// Multer — memory storage so we pass buffer directly to Graph API
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

/** Load project and verify sharepoint_folder is configured. */
async function getProject(req, res) {
  const [rows] = await pool.execute('SELECT id, name, sharepoint_folder FROM projects WHERE id = ?', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Proyecto no encontrado' }); return null; }
  return rows[0];
}

// ─────────────────────────────────────────────
// Auth on all routes
// ─────────────────────────────────────────────
router.use(authMiddleware);

// ─────────────────────────────────────────────
// GET /api/sharepoint/test
// ─────────────────────────────────────────────
router.get('/test', requireAdmin, async (req, res) => {
  try {
    if (!sp.isConfigured()) {
      return res.status(503).json({
        error: 'SharePoint no configurado. Agrega SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET y SP_SITE_URL en el .env del servidor.',
      });
    }
    const result = await sp.testConnection();
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    res.status(status).json({ error: `Error conectando con SharePoint: ${msg}` });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/files
// GET /api/sharepoint/projects/:id/files/*   (subpath via ?subpath=)
// ─────────────────────────────────────────────
router.get('/projects/:id/files', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    if (!sp.isConfigured()) return res.status(503).json({ error: 'SharePoint no configurado.' });

    const project = await getProject(req, res);
    if (!project) return;
    if (!project.sharepoint_folder) {
      return res.status(400).json({ error: 'Este proyecto no tiene carpeta de SharePoint configurada.' });
    }

    // Allow browsing subfolders: ?subpath=Contratos/2025
    const subpath = req.query.subpath || '';
    const folderPath = subpath
      ? `${project.sharepoint_folder.replace(/\/+$/, '')}/${subpath}`
      : project.sharepoint_folder;

    const items = await sp.listFolder(folderPath);
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
// Body: multipart/form-data — field "file" + optional "destFolder"
// ─────────────────────────────────────────────
router.post('/projects/:id/upload', [param('id').isInt()], upload.single('file'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    if (!sp.isConfigured()) return res.status(503).json({ error: 'SharePoint no configurado.' });
    if (!req.file)          return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const project = await getProject(req, res);
    if (!project) return;
    if (!project.sharepoint_folder) {
      return res.status(400).json({ error: 'Este proyecto no tiene carpeta de SharePoint configurada.' });
    }

    const baseFolder = project.sharepoint_folder.replace(/\/+$/, '');
    const destSub    = req.body.destFolder ? req.body.destFolder.replace(/^\/+/, '') : '';
    const folderPath = destSub ? `${baseFolder}/${destSub}` : baseFolder;

    const result = await sp.uploadFile(
      folderPath,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype
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
// Returns { url } — frontend opens it in new tab
// ─────────────────────────────────────────────
router.get('/projects/:id/download/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    if (!sp.isConfigured()) return res.status(503).json({ error: 'SharePoint no configurado.' });

    const project = await getProject(req, res);
    if (!project) return;

    const url = await sp.getDownloadUrl(req.params.itemId);
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
    if (!sp.isConfigured()) return res.status(503).json({ error: 'SharePoint no configurado.' });

    const project = await getProject(req, res);
    if (!project) return;

    const result = await sp.getPreviewUrl(req.params.itemId);
    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
