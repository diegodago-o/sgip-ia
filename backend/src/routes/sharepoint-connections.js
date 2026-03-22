/**
 * /api/sharepoint-connections — CRUD para conexiones SharePoint
 *
 * Cada conexión = un tenant (Azure AD) + app registration + sitio SharePoint.
 * Múltiples conexiones permiten integrar proyectos de distintos tenants/organizaciones.
 *
 * GET    /api/sharepoint-connections              → listar (sin client_secret)
 * POST   /api/sharepoint-connections              → crear
 * PUT    /api/sharepoint-connections/:id          → actualizar
 * DELETE /api/sharepoint-connections/:id          → eliminar (falla si hay proyectos vinculados)
 * POST   /api/sharepoint-connections/:id/test     → probar conexión
 * GET    /api/sharepoint-connections/:id/drives   → listar bibliotecas de documentos
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const sp   = require('../services/sharepoint');

const router       = express.Router();
const requireAdmin = roleMiddleware('admin', 'director_pmo');

router.use(authMiddleware, requireAdmin);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

// ─────────────────────────────────────────────
// GET / — list all connections (client_secret masked)
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, tenant_id, client_id, site_url, description, created_at
       FROM sharepoint_connections ORDER BY name`
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST / — create
// ─────────────────────────────────────────────
router.post('/', [
  body('name').notEmpty().trim().withMessage('Nombre requerido'),
  body('tenant_id').notEmpty().trim().withMessage('Tenant ID requerido'),
  body('client_id').notEmpty().trim().withMessage('Client ID requerido'),
  body('client_secret').notEmpty().trim().withMessage('Client Secret requerido'),
  body('site_url').isURL({ require_tld: true }).trim().withMessage('URL de sitio inválida'),
], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const { name, tenant_id, client_id, client_secret, site_url, description } = req.body;
    const [result] = await pool.execute(
      `INSERT INTO sharepoint_connections (name, tenant_id, client_id, client_secret, site_url, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, tenant_id, client_id, client_secret, site_url, description || null]
    );
    res.status(201).json({ data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /:id — update
// ─────────────────────────────────────────────
router.put('/:id', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const allowed = ['name', 'tenant_id', 'client_id', 'client_secret', 'site_url', 'description'];
    const updates = [];
    const values  = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined && req.body[f] !== '') {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar.' });
    values.push(req.params.id);
    await pool.execute(
      `UPDATE sharepoint_connections SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /:id
// ─────────────────────────────────────────────
router.delete('/:id', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [projects] = await pool.execute(
      'SELECT COUNT(*) AS cnt FROM projects WHERE sharepoint_connection_id = ?',
      [req.params.id]
    );
    if (projects[0].cnt > 0) {
      return res.status(409).json({
        error: `Esta conexión está en uso por ${projects[0].cnt} proyecto(s). Desvincula los proyectos primero.`,
      });
    }
    await pool.execute('DELETE FROM sharepoint_connections WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /:id/test — test connection
// ─────────────────────────────────────────────
router.post('/:id/test', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM sharepoint_connections WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conexión no encontrada.' });
    const result = await sp.testConnection(rows[0]);
    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /:id/drives — list document libraries
// ─────────────────────────────────────────────
router.get('/:id/drives', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM sharepoint_connections WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conexión no encontrada.' });
    const drives = await sp.listDrives(rows[0]);
    res.json({ data: drives });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
